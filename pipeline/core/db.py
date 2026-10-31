"""Write pipeline output to Postgres (db/migrations). Uses DATABASE_URL from the root .env.

Each write replaces one place's rows (or one state's tracts) inside a transaction, so a
failed run leaves the previous data in place.
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Iterable, Optional

import psycopg
import shapely
from psycopg.types.json import Jsonb

from pipeline.core.env import load_env


def connect() -> psycopg.Connection:
    load_env()
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set in .env (use --no-db to skip the database)")
    # autocommit: each `with conn.transaction()` block is then a real transaction that commits
    # on exit. Without it, the first query opens an implicit transaction and every block
    # becomes a savepoint inside it, which is rolled back when the connection closes.
    return psycopg.connect(url, autocommit=True)


def ewkb(geom) -> Optional[str]:
    return None if geom is None else shapely.to_wkb(shapely.set_srid(geom, 4326), hex=True, include_srid=True)


def point(lat, lng) -> Optional[str]:
    return None if lat is None or lng is None else ewkb(shapely.Point(lng, lat))


def check_schema(conn) -> None:
    need = {"places", "tracts", "properties", "permits", "catalysts", "baseline_permits"}
    have = {r[0] for r in conn.execute(
        "select table_name from information_schema.tables where table_schema = 'public'")}
    missing = sorted(need - have)
    if missing:
        raise RuntimeError(f"tables missing: {', '.join(missing)}. Apply db/migrations/*.sql first.")


def _copy(cur, table: str, cols: list[str], rows: Iterable[tuple]) -> int:
    n = 0
    with cur.copy(f"copy {table} ({', '.join(cols)}) from stdin") as cp:
        for r in rows:
            cp.write_row(r)
            n += 1
    return n


def upsert_places(conn, places, bounds: dict[str, object]) -> None:
    with conn.cursor() as cur:
        for p in places:
            c = p.config
            cfg = c.model_dump(mode="json")
            cur.execute(
                """insert into places (place_id, name, state, county_fips, census_place, peer_group,
                                       coverage_tier, bounds, config, config_sha256, updated_at)
                   values (%s, %s, %s, %s, %s, %s, %s, %s::geometry, %s, %s, now())
                   on conflict (place_id) do update set
                     name = excluded.name, state = excluded.state, county_fips = excluded.county_fips,
                     census_place = excluded.census_place, peer_group = excluded.peer_group,
                     coverage_tier = excluded.coverage_tier, bounds = excluded.bounds,
                     config = excluded.config, config_sha256 = excluded.config_sha256, updated_at = now()""",
                (c.place_id, c.name, c.state, c.county_fips, c.census_place, p.peer_group, c.coverage_tier,
                 ewkb(bounds.get(c.place_id)), Jsonb(cfg),
                 hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()),
            )


def write_state(conn, places, tracts, baseline_rows, bounds) -> None:
    """Places, every tract in the state, and baseline permits, in one transaction."""
    state_fips = tracts[0].state_fips
    with conn.transaction():
        upsert_places(conn, places, bounds)
        with conn.cursor() as cur:
            cur.execute("create temp table t_tracts (like tracts including defaults) on commit drop")
            cols = ["geoid", "state_fips", "county_fips", "place_id", "name", "geom", "centroid",
                    "housing_units", "year_built", "acs_year"]
            _copy(cur, "t_tracts", cols, (
                (t.geoid, t.state_fips, t.county_fips, t.place_id, t.name, ewkb(t.geom), ewkb(t.centroid),
                 t.housing_units, json.dumps(t.year_built), t.acs_year) for t in tracts))
            cur.execute(f"""insert into tracts ({', '.join(cols)}, updated_at)
                            select {', '.join(cols)}, now() from t_tracts
                            on conflict (geoid) do update set
                              {', '.join(f'{c} = excluded.{c}' for c in cols[1:])}, updated_at = now()""")
            cur.execute("delete from baseline_permits where geoid like %s", (state_fips + "%",))
            _copy(cur, "baseline_permits",
                  ["geoid", "year", "units_1", "units_2", "units_3_4", "units_5plus", "bldgs_5plus", "issuers"],
                  ((b.geoid, b.year, round(b.units_1, 3), round(b.units_2, 3), round(b.units_3_4, 3),
                    round(b.units_5plus, 3), round(b.bldgs_5plus, 3), sorted(set(b.issuers))) for b in baseline_rows))


def write_place(conn, place_id: str, properties, prop_tract, permits, permit_tract, permit_parcel, catalysts) -> None:
    """Replace one place's properties, permits and catalysts."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("delete from permits where place_id = %s", (place_id,))
        cur.execute("delete from properties where place_id = %s", (place_id,))
        cur.execute("delete from catalysts where place_id = %s", (place_id,))
        _copy(cur, "properties",
              ["place_id", "parcel_id", "address", "geom", "tract_geoid", "year_built", "year_built_source",
               "units", "stories", "land_use", "owner_name", "source"],
              ((p.place_id, p.parcel_id, p.address, point(p.lat, p.lng), prop_tract.get(p.parcel_id), p.year_built,
                p.year_built_source, p.units, p.stories, p.land_use, p.owner_name, p.source) for p in properties))
        ids = dict(cur.execute("select parcel_id, id from properties where place_id = %s", (place_id,)).fetchall())
        _copy(cur, "permits",
              ["place_id", "permit_id", "issued_date", "address", "geom", "parcel_ids", "permit_class", "units",
               "cost", "description", "source_url", "tract_geoid", "property_id"],
              ((p.place_id, p.permit_id, p.issued_date, p.address, point(p.lat, p.lng), list(p.parcel_ids),
                p.permit_class, p.units, p.cost, p.description, p.source_url, permit_tract.get(p.permit_id),
                ids.get(permit_parcel.get(p.permit_id))) for p in permits))
        _copy(cur, "catalysts",
              ["id", "place_id", "name", "type", "status", "geom", "budget_usd", "expected_completion",
               "description", "source_url", "source", "retrieved_at"],
              ((c["id"], place_id, c["name"], c["type"], c["status"], point(c["lat"], c["lng"]), c.get("budget_usd"),
                c.get("expected_completion"), c.get("description") or "", c.get("source_url"), "curated",
                c.get("retrieved_at")) for c in catalysts))
