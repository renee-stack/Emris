"""Run the pipeline for a state (baseline for every tract, then each place with sources)
or for one place.

    python -m pipeline.run il                 # baseline + every place config in places/il/
    python -m pipeline.run il-<slug> [...]    # baseline geography + those places only
    options: --no-db (skip Postgres), --refresh (re-download), --skip-baseline

Normalized records are always written to data/out/<place_id>/ as JSON lines.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import shapely

from pipeline.connectors import socrata
from pipeline.core import baseline, db, geo as geography
from pipeline.core.config import ConfigError, Place, load_state
from pipeline.core.env import REPO_ROOT
from pipeline.core.link import link_permits, tracts_for
from pipeline.core.normalize import normalize_permits, normalize_properties

OUT_DIR = REPO_ROOT / "data" / "out"
CONNECTORS = {"socrata": socrata}


@dataclass
class PlaceStats:
    place_id: str
    tier: str
    tracts: int = 0
    permits: int = 0
    properties: int = 0
    catalysts: int = 0
    with_coords: int = 0
    linked: int = 0
    parcel_known: int = 0
    with_parcel_ids: int = 0
    with_year_built: int = 0
    classes: Counter = field(default_factory=Counter)
    seconds: float = 0


def months_ago(d: date, months: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 - months, 12)
    return date(y, m + 1, min(d.day, 28))


def _connector(src):
    mod = CONNECTORS.get(src.connector)
    if mod is None:
        raise ConfigError(f"no connector for {src.connector!r} yet (built: {', '.join(CONNECTORS)})")
    return mod


def _dump(path: Path, records) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        for r in records:
            fh.write(r.model_dump_json() + "\n")


def run_place(p: Place, geo, *, refresh: bool, conn) -> PlaceStats:
    t0 = time.time()
    s = PlaceStats(p.place_id, p.config.coverage_tier)
    src = p.config.sources
    permits, props, universe = [], [], set()
    if src.permits:
        since = months_ago(date.today(), p.since_months)
        rows = _connector(src.permits).fetch_permits(src.permits, place_id=p.place_id, since=since, refresh=refresh)
        permits = normalize_permits(src.permits, rows, p.place_id)
    if src.parcels:
        parts = [(ps, _connector(ps).fetch_parcels(ps, place_id=p.place_id, refresh=refresh)) for ps in src.parcels]
        props = normalize_properties(parts, p.place_id, universe=universe)
    catalysts = []
    if src.catalysts and src.catalysts.seed_file:
        catalysts = json.loads((REPO_ROOT / src.catalysts.seed_file).read_text())

    parcel_of = link_permits(permits, props)
    permit_tract = dict(zip([x.permit_id for x in permits], tracts_for(geo, permits)))
    prop_tract = dict(zip([x.parcel_id for x in props], tracts_for(geo, props)))

    _dump(OUT_DIR / p.place_id / "permits.jsonl", permits)
    _dump(OUT_DIR / p.place_id / "properties.jsonl", props)
    if conn is not None:
        db.write_place(conn, p.place_id, props, prop_tract, permits, permit_tract, parcel_of, catalysts)

    s.permits, s.properties, s.catalysts = len(permits), len(props), len(catalysts)
    s.with_coords = sum(x.lat is not None for x in permits)
    s.linked = sum(v is not None for v in parcel_of.values())
    s.with_parcel_ids = sum(bool(x.parcel_ids) for x in permits)
    s.parcel_known = sum(any(i in universe for i in x.parcel_ids) for x in permits) if universe else 0
    s.with_year_built = sum(x.year_built is not None for x in props)
    s.classes = Counter(x.permit_class for x in permits)
    s.seconds = time.time() - t0
    return s


def pct(a: int, b: int) -> str:
    return f"{100 * a / b:5.1f}%" if b else "    -"


def report(stats: list[PlaceStats], tract_counts: Counter, baseline_tracts: int, bps_rows: int) -> None:
    print("\nRows per place")
    print(f"  {'place_id':<18} {'tier':<15} {'tracts':>6} {'permits':>8} {'properties':>10} {'catalysts':>9}")
    for s in stats:
        print(f"  {s.place_id:<18} {s.tier:<15} {tract_counts.get(s.place_id, 0):>6} {s.permits:>8} {s.properties:>10} {s.catalysts:>9}")
    print(f"  {'(no place file)':<18} {'baseline':<15} {tract_counts.get(None, 0):>6}")
    print(f"  baseline tier: {baseline_tracts} tracts with ACS housing data, {bps_rows} Census BPS issuer-years allocated")
    for s in stats:
        if not (s.permits or s.properties):
            continue
        print(f"\n{s.place_id} ({s.seconds:.0f}s)")
        if s.permits:
            print(f"  permits with coordinates:         {pct(s.with_coords, s.permits)}  ({s.with_coords:,} of {s.permits:,})")
            print(f"  permits linked to a property:     {pct(s.linked, s.permits)}  ({s.linked:,})")
            if s.parcel_known:
                print(f"  permits on a known parcel id:     {pct(s.parcel_known, s.permits)}  ({s.parcel_known:,}; "
                      f"{pct(s.with_parcel_ids, s.permits).strip()} carry any parcel id)")
        if s.properties:
            print(f"  properties with year built:       {pct(s.with_year_built, s.properties)}  ({s.with_year_built:,} of {s.properties:,})")
        if s.permits:
            print("  permit_class:")
            for c in ("new_mf", "alteration", "demolition", "roof", "major_mep", "other"):
                print(f"    {c:<11} {s.classes.get(c, 0):>7,}  {pct(s.classes.get(c, 0), s.permits)}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline.run")
    ap.add_argument("targets", nargs="+", help="a state code (il) or place ids (il-<slug>)")
    ap.add_argument("--no-db", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--skip-baseline", action="store_true", help="don't rewrite tracts / baseline permits")
    a = ap.parse_args(argv)

    states = {t.split("-", 1)[0] for t in a.targets}
    if len(states) != 1:
        print("one state per run", file=sys.stderr)
        return 2
    state = states.pop()
    try:
        st, places = load_state(state)
    except ConfigError as e:
        print(e, file=sys.stderr)
        return 1
    wanted = [p for p in places if p.place_id in a.targets] if any("-" in t for t in a.targets) else places
    unknown = [t for t in a.targets if "-" in t and t not in {p.place_id for p in places}]
    if unknown:
        print(f"unknown place id(s): {', '.join(unknown)}", file=sys.stderr)
        return 1

    conn = None if a.no_db else db.connect()
    if conn is not None:
        db.check_schema(conn)

    t0 = time.time()
    geo = geography.load(st.geography, state=st.state, refresh=a.refresh)
    tracts, bps, base = baseline.run(st, places, geo, refresh=a.refresh)
    tract_counts = Counter(t.place_id for t in tracts)
    if conn is not None and not a.skip_baseline:
        bounds = {}
        for pid in {t.place_id for t in tracts if t.place_id}:
            bounds[pid] = shapely.envelope(shapely.union_all([t.geom for t in tracts if t.place_id == pid]))
        db.write_state(conn, places, tracts, base, bounds)
    print(f"baseline: {len(tracts)} tracts, {len(base)} tract-years of BPS permits ({time.time() - t0:.0f}s)")

    stats = []
    for p in wanted:
        if not (p.config.sources.permits or p.config.sources.parcels):
            stats.append(PlaceStats(p.place_id, p.config.coverage_tier))
            continue
        try:
            stats.append(run_place(p, geo, refresh=a.refresh, conn=conn))
        except ConfigError as e:
            print(f"{p.place_id}: skipped: {e}", file=sys.stderr)
            stats.append(PlaceStats(p.place_id, p.config.coverage_tier))
    report(stats, tract_counts, sum(t.housing_units is not None for t in tracts), len(bps))
    if conn is not None:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
