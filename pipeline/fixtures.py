"""Save real source rows for a place as test fixtures in tests/fixtures/<place_id>/.

    python -m pipeline.fixtures <place_id> [--n 50]

- permits.json: n rows, spread across permit classes (as the place's config classifies them)
- <parcel source name>.json: n rows per characteristics source, all inside the place
- <geometry source name>.json: n rows giving points for half of each characteristics pick
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date

from pipeline.connectors import socrata
from pipeline.core.config import load_place
from pipeline.core.env import REPO_ROOT
from pipeline.core.normalize import column, normalize_permit, parcel_ids
from pipeline.run import months_ago

FIX = REPO_ROOT / "tests" / "fixtures"


def spread_permits(src, place_id: str, n: int) -> list[dict]:
    since = months_ago(date.today(), 3)
    rows = list(socrata.fetch_permits(src, place_id=place_id, since=since, limit=10_000))
    by_class: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        p = normalize_permit(src, r, place_id)
        if p is not None:
            by_class[p.permit_class].append(r)
    picked: list[dict] = []
    while len(picked) < n and any(by_class.values()):  # round-robin over classes
        for c in sorted(by_class):
            if by_class[c] and len(picked) < n:
                picked.append(by_class[c].pop(0))
    return picked


def geometry_rows(geo_src, place_id: str, ids: list[str]) -> list[dict]:
    api = socrata.Socrata(geo_src.domain, geo_src.dataset, cache_dir_name=geo_src.name, place_id=place_id)
    pid_col = geo_src.fields.parcel_id if isinstance(geo_src.fields.parcel_id, str) else geo_src.fields.parcel_id[0]
    out = []
    for i in range(0, len(ids), 200):
        where = socrata.where_clause({**geo_src.filter, pid_col: ids[i:i + 200]})
        out += list(api.rows(socrata.columns_of(geo_src.fields), where))
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline.fixtures")
    ap.add_argument("place_id")
    ap.add_argument("--n", type=int, default=50)
    a = ap.parse_args(argv)
    p = load_place(a.place_id)
    out = FIX / p.place_id
    out.mkdir(parents=True, exist_ok=True)
    meta = {"place_id": p.place_id, "retrieved": date.today().isoformat(), "files": {}}

    if p.config.sources.permits:
        rows = spread_permits(p.config.sources.permits, p.place_id, a.n)
        (out / "permits.json").write_text(json.dumps(rows, indent=1) + "\n")
        meta["files"]["permits.json"] = len(rows)

    srcs = p.config.sources.parcels
    geo_srcs = [s for s in srcs if s.role == "geometry" and s.connector == "socrata"]
    geo_ids: list[str] = []
    for s in srcs:
        if s.role != "characteristics" or s.connector != "socrata":
            continue
        cand = list(socrata.fetch_parcels(s, place_id=p.place_id, limit=2000))
        if geo_srcs:  # keep rows for parcels the geometry source puts inside the place
            ids = list(dict.fromkeys(i for r in cand for i in parcel_ids(column(r, s.fields.parcel_id), s.parcel_id_format)[:1]))
            inside = {parcel_ids(column(g, geo_srcs[0].fields.parcel_id), geo_srcs[0].parcel_id_format)[0]
                      for g in geometry_rows(geo_srcs[0], p.place_id, ids)}
            cand = [r for r in cand if parcel_ids(column(r, s.fields.parcel_id), s.parcel_id_format)[:1]
                    and parcel_ids(column(r, s.fields.parcel_id), s.parcel_id_format)[0] in inside]
        cols = socrata.columns_of(s.fields)  # prefer rows with the most mapped fields filled
        cand.sort(key=lambda r: -sum(r.get(c) not in (None, "") for c in cols))
        rows = cand[: a.n]
        (out / f"{s.name}.json").write_text(json.dumps(rows, indent=1) + "\n")
        meta["files"][f"{s.name}.json"] = len(rows)
        picked = list(dict.fromkeys(parcel_ids(column(r, s.fields.parcel_id), s.parcel_id_format)[0] for r in rows))
        geo_ids += picked[: a.n // 2]
    for g in geo_srcs:
        rows = geometry_rows(g, p.place_id, geo_ids)[: a.n]
        (out / f"{g.name}.json").write_text(json.dumps(rows, indent=1) + "\n")
        meta["files"][f"{g.name}.json"] = len(rows)
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(json.dumps(meta, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
