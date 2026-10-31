"""Baseline tier for a whole state: every tract gets ACS housing data and an allocated share
of its permit-issuing jurisdiction's Census BPS permits. No place is named here.

Allocation (contract section 1.2, AUDIT.md section 4):
1. Each tract's inner point decides its issuer: an issuing place containing it, else an
   issuing county subdivision (township), else its county's unincorporated or whole-county row.
2. An issuer's units are split over its tracts by housing units (equal split if all are zero).
3. An issuer whose area holds no tract point (a small village) goes to the tract containing
   the village's own inner point.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

from pipeline.connectors import acs, census_bps
from pipeline.core.geo import StateGeography, inner_point

BUCKETS = ("units_1", "units_2", "units_3_4", "units_5plus", "bldgs_5plus")


@dataclass
class TractRow:
    geoid: str
    state_fips: str
    county_fips: str
    place_id: Optional[str]
    name: str
    geom: object
    centroid: object
    housing_units: Optional[int]
    year_built: dict
    acs_year: int


@dataclass
class BaselinePermitRow:
    geoid: str
    year: int
    units_1: float
    units_2: float
    units_3_4: float
    units_5plus: float
    bldgs_5plus: float
    issuers: list[str]


def assign_places(geo: StateGeography, places) -> dict[str, Optional[str]]:
    """tract -> place_id per contract section 1.3: city configs (census_place) take tracts whose
    inner point is inside that place; county configs take the rest of their county."""
    pts = [geo.tract_point[g] for g in geo.tracts.ids]
    in_place = dict(zip(geo.tracts.ids, geo.places.locate_points(pts)))
    out: dict[str, Optional[str]] = {g: None for g in geo.tracts.ids}
    for p in places:
        if p.config.census_place:
            for g, pl in in_place.items():
                if pl == p.config.census_place:
                    out[g] = p.place_id
    for p in places:
        if not p.config.census_place:
            for g in geo.tracts.ids:
                if out[g] is None and geo.tract_county[g] == p.config.county_fips:
                    out[g] = p.place_id
    return out


def tract_rows(geo: StateGeography, acs_table: dict[str, dict], place_of: dict[str, Optional[str]],
               *, state_fips: str, acs_year: int) -> list[TractRow]:
    pts = [geo.tract_point[g] for g in geo.tracts.ids]
    place_name = dict(zip(geo.places.ids, geo.places.names))
    in_place = dict(zip(geo.tracts.ids, geo.places.locate_points(pts)))
    rows = []
    for g, geom in zip(geo.tracts.ids, geo.tracts.geoms):
        a = acs_table.get(g, {})
        where = place_name.get(in_place[g]) or geo.county_name.get(geo.tract_county[g]) or geo.tract_county[g]
        rows.append(TractRow(
            geoid=g, state_fips=state_fips, county_fips=geo.tract_county[g], place_id=place_of.get(g),
            name=f"{where} · Tract {geo.tract_number[g]}", geom=geom, centroid=geo.tract_point[g],
            housing_units=a.get("housing_units"),
            year_built={k: v for k, v in a.items() if k.startswith("built_")},
            acs_year=acs_year,
        ))
    return rows


def allocate(geo: StateGeography, bps: list[census_bps.BpsRow], housing: dict[str, Optional[int]]) -> list[BaselinePermitRow]:
    ids = geo.tracts.ids
    pts = [geo.tract_point[g] for g in ids]
    in_place = dict(zip(ids, geo.places.locate_points(pts)))
    in_cousub = dict(zip(ids, geo.cousubs.locate_points(pts)))
    place_geom = dict(zip(geo.places.ids, geo.places.geoms))
    cousub_geom = dict(zip(geo.cousubs.ids, geo.cousubs.geoms))

    out: dict[tuple[str, int], BaselinePermitRow] = {}
    for year in sorted({r.year for r in bps}):
        rows = [r for r in bps if r.year == year]
        issuing = {r.issuer_id for r in rows}
        members: dict[str, list[str]] = defaultdict(list)
        for g in ids:
            county = geo.tract_county[g]
            for cand in (f"place:{in_place[g]}" if in_place[g] else None,
                         f"cousub:{in_cousub[g]}" if in_cousub[g] else None,
                         f"county_rest:{county}", f"county:{county}"):
                if cand and cand in issuing:
                    members[cand].append(g)
                    break
        for r in rows:
            tracts = members.get(r.issuer_id)
            if not tracts:  # issuer too small to hold a tract point: use the tract under its own point
                shape = place_geom.get(r.issuer_id[6:]) if r.issuer_type == "place" else \
                    cousub_geom.get(r.issuer_id[7:]) if r.issuer_type == "cousub" else None
                hit = geo.tracts.locate_points([inner_point(shape)])[0] if shape is not None else None
                tracts = [hit] if hit else []
            if not tracts:
                continue
            weights = [max(housing.get(g) or 0, 0) for g in tracts]
            total = sum(weights)
            shares = [w / total for w in weights] if total else [1 / len(tracts)] * len(tracts)
            for g, s in zip(tracts, shares):
                rec = out.setdefault((g, year), BaselinePermitRow(g, year, 0, 0, 0, 0, 0, []))
                for b in BUCKETS:
                    setattr(rec, b, getattr(rec, b) + getattr(r, b) * s)
                rec.issuers.append(r.issuer_id)
    return list(out.values())


def run(state_cfg, places, geo: StateGeography, *, refresh: bool = False):
    """Everything the baseline tier needs for one state."""
    b = state_cfg.baseline
    acs_table = acs.tract_table(b.housing, state_fips=state_cfg.state_fips, refresh=refresh)
    place_of = assign_places(geo, places)
    tracts = tract_rows(geo, acs_table, place_of, state_fips=state_cfg.state_fips, acs_year=b.housing.year)
    bps = census_bps.fetch(b.permits, state_fips=state_cfg.state_fips, state=state_cfg.state, refresh=refresh)
    housing = {t.geoid: t.housing_units for t in tracts}
    permits = allocate(geo, bps, housing)
    return tracts, bps, permits
