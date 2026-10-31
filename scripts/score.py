"""Build real Chicago tract scores in the contract.md shapes.

    scripts/.venv/bin/python scripts/score.py [--as-of YYYY-MM-DD] [--refresh]

Reads   data/infrastructure.json (whatever is there)
Writes  data/tracts.geojson, public/tracts.geojson (identical), data/permits.json, public/permits.json
Caches  raw downloads in data/raw/ (delete them or pass --refresh to re-download)
"""
from __future__ import annotations

import argparse
import io
import json
import math
import re
import sys
import zipfile
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
import shapely

sys.path.insert(0, str(Path(__file__).parent))
from units import is_new_project, parse_units  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA, PUBLIC, RAW = ROOT / "data", ROOT / "public", ROOT / "data" / "raw"

SODA = "https://data.cityofchicago.org/resource"
PERMITS_ID = "ydr8-5enu"  # Building Permits
CITY_ID = "qqq8-j68g"  # Boundaries - City
COMMUNITY_AREAS_ID = "igwz-8jzy"  # Boundaries - Community Areas
TRACTS_URL = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_17_tract_500k.zip"

IL_EAST = "EPSG:3435"  # NAD83 / Illinois East (US feet), for areas and simplification
MIN_CITY_SHARE = 0.10  # tract kept if >= 10% of its land area is inside the city (drops border slivers)
SIMPLIFY_FT = 40  # coverage simplification tolerance; keeps shared edges aligned
MAX_GEOJSON_BYTES = 5_000_000

MIN_ACTIVITY = 3  # v2: permits (5+ units, last 24 mo) needed for full weight on permit signals
WEIGHT = {"under_construction": 1.0, "funded": 0.8, "planned": 0.5, "complete": 0.0}
EARTH_MI = 3958.8


# ---------------------------------------------------------------- downloads

def cached(name: str, fetch, refresh: bool) -> Path:
    path = RAW / name
    if refresh or not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        print(f"  downloading {name} ...")
        path.write_bytes(fetch())
    return path


def soda_geojson(dataset: str):
    def fetch() -> bytes:
        r = requests.get(f"{SODA}/{dataset}.geojson", params={"$limit": 5000}, timeout=120)
        r.raise_for_status()
        return r.content
    return fetch


def fetch_permits(start: date, as_of: date):
    def fetch() -> bytes:
        rows, offset, page = [], 0, 50_000
        where = (
            "permit_type = 'PERMIT - NEW CONSTRUCTION'"
            f" AND issue_date >= '{start.isoformat()}T00:00:00'"
            f" AND issue_date <= '{as_of.isoformat()}T23:59:59'"
        )
        select = ("permit_,permit_status,issue_date,work_description,residential_unit_change,"
                  "street_number,street_direction,street_name,latitude,longitude")
        while True:
            r = requests.get(f"{SODA}/{PERMITS_ID}.json", timeout=120, params={
                "$select": select, "$where": where, "$order": "issue_date DESC, permit_",
                "$limit": page, "$offset": offset,
            })
            r.raise_for_status()
            batch = r.json()
            rows += batch
            if len(batch) < page:
                return json.dumps(rows).encode()
            offset += page
    return fetch


def fetch_url(url: str):
    def fetch() -> bytes:
        r = requests.get(url, timeout=300)
        r.raise_for_status()
        return r.content
    return fetch


# ---------------------------------------------------------------- helpers

def years_before(d: date, n: int) -> date:
    try:
        return d.replace(year=d.year - n)
    except ValueError:  # Feb 29
        return d.replace(year=d.year - n, day=28)


def pct_rank(values) -> np.ndarray:
    """contract §3.1: round(100 * (below + (equal - 1) / 2) / (n - 1))."""
    v = np.asarray(values, dtype=float)
    s = np.sort(v)
    below = np.searchsorted(s, v, "left")
    equal = np.searchsorted(s, v, "right") - below
    out = 100 * (below + (equal - 1) / 2) / (len(v) - 1)
    return np.floor(out + 0.5).astype(int)  # round half up, like JS Math.round


def haversine_mi(lat1, lng1, lat2, lng2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dlat, dlng = p2 - p1, np.radians(np.asarray(lng2) - np.asarray(lng1))
    a = np.sin(dlat / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlng / 2) ** 2
    return 2 * EARTH_MI * np.arcsin(np.sqrt(a))


def contract_centroid(geom: dict) -> tuple[float, float]:
    """contract §3.4: mean of outer-ring vertices, closing point excluded. Returns (lat, lng)."""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    pts = [pt for poly in polys for pt in poly[0][:-1]]
    return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)


def title_case(s: str) -> str:
    out = []
    for w in s.split():
        if re.fullmatch(r"\d+(ST|ND|RD|TH)", w):
            out.append(w.lower())
        elif len(w) == 1:
            out.append(w)
        elif w == "OHARE":
            out.append("O'Hare")
        elif w in {"MC", "MCKINLEY"}:
            out.append("McKinley")
        else:
            out.append("-".join(p.capitalize() for p in w.split("-")).replace("O'h", "O'H"))
    return " ".join(out)


CODE_PREFIX = re.compile(r"^.{0,45}?\b(?:CBC|CBRC|CHICAGO BUILDING CODE)\b\)?[\s.:;,\-]*")


def clean_description(desc: str) -> str:
    d = " ".join(desc.split())
    m = CODE_PREFIX.match(d)
    if m and len(d) - m.end() > 20:
        d = d[m.end():]
    return d


def round_coords(obj, nd=6):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(x), nd) for x in obj]
        return [round_coords(x, nd) for x in obj]
    return obj


# ---------------------------------------------------------------- tracts

def load_tracts(refresh: bool) -> gpd.GeoDataFrame:
    tracts_zip = cached("cb_2020_17_tract_500k.zip", fetch_url(TRACTS_URL), refresh)
    city_path = cached("chicago_city_boundary.geojson", soda_geojson(CITY_ID), refresh)
    ca_path = cached("chicago_community_areas.geojson", soda_geojson(COMMUNITY_AREAS_ID), refresh)

    with zipfile.ZipFile(tracts_zip) as z:
        shp = next(n for n in z.namelist() if n.endswith(".shp"))
    tracts = gpd.read_file(f"zip://{tracts_zip}!{shp}")
    tracts = tracts[(tracts["COUNTYFP"] == "031") & (tracts["ALAND"] > 0)].to_crs(IL_EAST)
    city = gpd.read_file(city_path).to_crs(IL_EAST).union_all()
    cas = gpd.read_file(ca_path).to_crs(IL_EAST)[["community", "geometry"]]

    share = tracts.geometry.intersection(city).area / tracts.geometry.area
    tracts = tracts[share >= MIN_CITY_SHARE].copy()

    # Community area = the one covering most of the tract
    ov = gpd.overlay(tracts[["GEOID", "geometry"]], cas, how="intersection", keep_geom_type=True)
    ov["a"] = ov.geometry.area
    best = ov.sort_values("a", ascending=False).drop_duplicates("GEOID").set_index("GEOID")["community"]
    tracts["community"] = tracts["GEOID"].map(best).map(lambda c: title_case(c) if isinstance(c, str) else "Chicago")

    tract_no = tracts["NAME"].astype(str).str.replace(r"\.00$", "", regex=True)
    tracts["name"] = tracts["community"] + " · Tract " + tract_no
    tracts = tracts.rename(columns={"GEOID": "geoid"})[["geoid", "name", "geometry"]]
    return tracts.reset_index(drop=True)


def simplified_geojson_geoms(tracts: gpd.GeoDataFrame) -> list[dict]:
    simp = shapely.coverage_simplify(tracts.geometry.values, tolerance=SIMPLIFY_FT)
    s = gpd.GeoSeries(simp, crs=IL_EAST).to_crs("EPSG:4326").make_valid()
    geoms = []
    for g in s:
        if g.geom_type == "GeometryCollection":
            g = shapely.MultiPolygon([p for p in g.geoms if p.geom_type == "Polygon"])
        gj = shapely.geometry.mapping(g)
        geoms.append({"type": gj["type"], "coordinates": round_coords(gj["coordinates"])})
    return geoms


# ---------------------------------------------------------------- permits

def load_permits(as_of: date, refresh: bool) -> pd.DataFrame:
    start = years_before(as_of, 2)
    path = cached(f"permits_new_construction_{start}_{as_of}.json", fetch_permits(start, as_of), refresh)
    df = pd.DataFrame(json.loads(path.read_text()))
    n_raw = len(df)

    df = df[df["permit_status"].fillna("") != "CANCELLED"]
    df = df[df["work_description"].map(is_new_project)]
    df = df.dropna(subset=["latitude", "longitude"])
    df["lat"] = df["latitude"].astype(float)
    df["lng"] = df["longitude"].astype(float)

    def units(row) -> int | None:
        u = parse_units(row["work_description"])
        field = pd.to_numeric(row.get("residential_unit_change"), errors="coerce")
        if (u is None or u == 0) and pd.notna(field) and field >= 1:
            return int(field)  # regex found nothing residential but the city recorded units
        return u

    df["units"] = df.apply(units, axis=1).astype("object")
    df["units"] = df["units"].where(df["units"].notna(), None)
    # Contract: keep 5+ unit permits and permits whose unit count is unknown.
    df = df[df["units"].map(lambda u: u is None or u >= 5)].copy()

    df["issue_date"] = df["issue_date"].str.slice(0, 10)
    df["address"] = (df["street_number"].fillna("").astype(str) + " " + df["street_direction"].fillna("")
                     + " " + df["street_name"].fillna("")).map(title_case)

    # Phased permits (caissons, foundation, superstructure, full) for one project share an address.
    # Keep one row per address: earliest issue date, largest known unit count.
    df = df.sort_values(["issue_date", "permit_"])
    max_units = df.groupby("address")["units"].agg(lambda s: max((u for u in s if u is not None), default=None))
    df = df.drop_duplicates("address", keep="first").copy()
    df["units"] = df["address"].map(max_units).map(lambda u: None if u is None or pd.isna(u) else int(u))

    df["description"] = df["work_description"].fillna("").map(clean_description)
    df["id"] = df["permit_"].astype(str)
    print(f"  permits: {n_raw} new-construction rows -> {len(df)} projects (5+ units or unknown)")
    return df[["id", "address", "lat", "lng", "issue_date", "units", "description"]].reset_index(drop=True)


# ---------------------------------------------------------------- scoring

def score(tracts: gpd.GeoDataFrame, geoms: list[dict], permits: pd.DataFrame,
          projects: list[dict], as_of: date, scoring: str = "v1") -> list[dict]:
    as_of_ts = pd.Timestamp(as_of)
    permits = permits.copy()
    permits["age"] = (as_of_ts - pd.to_datetime(permits["issue_date"])).dt.days / 365.25
    permits["u"] = pd.to_numeric(permits["units"], errors="coerce")  # None -> NaN
    # v2 (proposed §3): momentum counts only permits with a known unit count (>= 5).
    permits["mom_ok"] = (permits["u"] >= 5) if scoring == "v2" else True
    g = permits.groupby("geoid")

    mf = g.apply(lambda d: float((0.5 ** d.loc[d["u"] >= 5, "age"]).sum()), include_groups=False)
    L = g.apply(lambda d: int(((d["age"] < 1) & d["mom_ok"]).sum()), include_groups=False)
    P = g.apply(lambda d: int(((d["age"] >= 1) & (d["age"] < 2) & d["mom_ok"]).sum()), include_groups=False)
    cnt24 = g["age"].apply(lambda a: int((a < 2).sum()))
    units24 = g.apply(lambda d: int(d.loc[d["age"] < 2, "u"].fillna(0).sum()), include_groups=False)

    ids = tracts["geoid"]
    mf_raw = ids.map(mf).fillna(0.0).to_numpy()
    L_ = ids.map(L).fillna(0).to_numpy()
    P_ = ids.map(P).fillna(0).to_numpy()
    mom_pct_raw = (L_ - P_) / np.maximum(P_, 1)
    n_act = L_ + P_
    if scoring == "v2":
        # Smoothed, and neutral (0) below MIN_ACTIVITY permits so 1 vs 0 is not +100%.
        mom_raw = np.where(n_act >= MIN_ACTIVITY, (L_ - P_) / (P_ + 2), 0.0)
    else:
        mom_raw = mom_pct_raw

    cents = np.array([contract_centroid(gm) for gm in geoms])  # (lat, lng)
    infra_raw = np.zeros(len(tracts))
    for p in projects:
        w = WEIGHT.get(p["status"], 0.0)
        if not w:
            continue
        d = haversine_mi(cents[:, 0], cents[:, 1], p["lat"], p["lng"])
        decay = np.where(d <= 0.25, 1.0, np.where(d >= 1, 0.0, (1 - d) / 0.75))
        infra_raw += w * decay

    s_mf, s_mom, s_infra = pct_rank(mf_raw), pct_rank(mom_raw), pct_rank(infra_raw)
    if scoring == "v2":
        # Shrink the permit part toward the citywide median when evidence is thin,
        # so one permit can't put a tract at the top. Infrastructure is not shrunk.
        permit_part = 0.45 * s_mf + 0.30 * s_mom
        med = float(np.median(permit_part))
        k = np.minimum(1.0, n_act / MIN_ACTIVITY)
        units_arr = ids.map(units24).fillna(0).to_numpy()
        composite = med + (permit_part - med) * k + 0.25 * s_infra + units_arr * 1e-6  # tie-break by units
    else:
        composite = 0.45 * s_mf + 0.30 * s_mom + 0.25 * s_infra
    scores = pct_rank(composite)
    sorted_c = np.sort(composite)
    pctl = np.floor(100 * np.searchsorted(sorted_c, composite, "left") / len(composite) + 0.5).astype(int)

    features = []
    for i, row in tracts.iterrows():
        mp = math.floor(mom_pct_raw[i] * 1000 + 0.5) / 10
        thin = scoring == "v2" and n_act[i] < MIN_ACTIVITY
        features.append({
            "type": "Feature",
            "properties": {
                "geoid": row["geoid"],
                "name": row["name"],
                "score": int(scores[i]),
                "percentile": int(pctl[i]),
                "momentum": "flat" if thin else "up" if mp > 10 else "down" if mp < -10 else "flat",
                "momentum_pct": mp,
                "signals": {
                    "mf_permits": int(s_mf[i]),
                    "permit_momentum": int(s_mom[i]),
                    "infra_proximity": int(s_infra[i]),
                },
                "permit_count_24mo": int(ids.map(cnt24).fillna(0).iloc[i]),
                "units_24mo": int(ids.map(units24).fillna(0).iloc[i]),
            },
            "geometry": geoms[i],
        })
    return features


# ---------------------------------------------------------------- validation (contract §1)

def validate(fc: dict, permits: list[dict], projects: list[dict]) -> None:
    errs: list[str] = []

    def chk(cond, msg):
        if not cond:
            errs.append(msg)

    def is_int(x, lo=None, hi=None):
        return isinstance(x, int) and not isinstance(x, bool) and (lo is None or x >= lo) and (hi is None or x <= hi)

    def is_num(x):
        return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)

    chk(fc.get("type") == "FeatureCollection", "tracts: type")
    chk(re.fullmatch(r"\d{4}-\d{2}-\d{2}", fc.get("as_of", "")), "tracts: as_of")
    geoids = set()
    for f in fc["features"]:
        p, gm = f["properties"], f["geometry"]
        k = p.get("geoid")
        chk(f.get("type") == "Feature" and "id" not in f, f"{k}: feature shape")
        chk(isinstance(k, str) and re.fullmatch(r"\d{11}", k), f"{k}: geoid")
        chk(k not in geoids, f"{k}: duplicate geoid")
        geoids.add(k)
        chk(isinstance(p.get("name"), str) and " · Tract " in p["name"], f"{k}: name")
        chk(is_int(p.get("score"), 0, 100), f"{k}: score")
        chk(is_int(p.get("percentile"), 0, 100), f"{k}: percentile")
        chk(p.get("momentum") in ("up", "flat", "down"), f"{k}: momentum")
        chk(is_num(p.get("momentum_pct")) and round(p["momentum_pct"], 1) == p["momentum_pct"], f"{k}: momentum_pct")
        sg = p.get("signals", {})
        chk(set(sg) == {"mf_permits", "permit_momentum", "infra_proximity"}, f"{k}: signal keys")
        chk(all(is_int(v, 0, 100) for v in sg.values()), f"{k}: signal values")
        chk(is_int(p.get("permit_count_24mo"), 0), f"{k}: permit_count_24mo")
        chk(is_int(p.get("units_24mo"), 0), f"{k}: units_24mo")
        chk(set(p) == {"geoid", "name", "score", "percentile", "momentum", "momentum_pct", "signals",
                       "permit_count_24mo", "units_24mo"}, f"{k}: property keys")
        chk(gm["type"] in ("Polygon", "MultiPolygon") and gm["coordinates"], f"{k}: geometry")

    prev = "9999-12-31"
    for r in permits:
        k = r.get("id")
        chk(list(r) == ["id", "address", "lat", "lng", "issue_date", "units", "description", "geoid"], f"permit {k}: keys")
        chk(isinstance(k, str) and k, f"permit {k}: id")
        chk(isinstance(r["address"], str) and r["address"].strip(), f"permit {k}: address")
        chk(is_num(r["lat"]) and 41.6 < r["lat"] < 42.1 and is_num(r["lng"]) and -88 < r["lng"] < -87.5, f"permit {k}: coords")
        chk(re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["issue_date"]) and r["issue_date"] <= prev, f"permit {k}: issue_date/order")
        prev = r["issue_date"]
        chk(r["units"] is None or is_int(r["units"], 5), f"permit {k}: units")
        chk(isinstance(r["description"], str), f"permit {k}: description")
        chk(r["geoid"] in geoids, f"permit {k}: geoid not a tract")
    chk(len({r["id"] for r in permits}) == len(permits), "permits: duplicate ids")

    for p in projects:  # warn only: this file belongs to Renee
        k = p.get("id")
        if p.get("status") not in WEIGHT or not (is_num(p.get("lat")) and is_num(p.get("lng"))):
            print(f"  WARNING infrastructure {k}: bad status or coords, scored as weight 0")

    if errs:
        print(f"\nVALIDATION FAILED ({len(errs)} problems):")
        for e in errs[:40]:
            print("  -", e)
        sys.exit(1)
    print("  validation: OK (tracts + permits match contract §1)")


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--refresh", action="store_true", help="re-download everything in data/raw")
    ap.add_argument("--scoring", choices=["v1", "v2"], default="v1",
                    help="v1 = contract.md §3 as signed off; v2 = proposed fix (scripts/proposal-scoring-v2.md)")
    ap.add_argument("--out", type=Path, help="write outputs here instead of data/ and public/")
    args = ap.parse_args()
    as_of: date = args.as_of
    print(f"Emris scoring {args.scoring}, as of {as_of}")

    tracts = load_tracts(args.refresh)
    permits = load_permits(as_of, args.refresh)

    # Spatial join on full-resolution tracts; permits outside every tract are dropped.
    pts = gpd.GeoDataFrame(permits, geometry=gpd.points_from_xy(permits["lng"], permits["lat"]), crs="EPSG:4326")
    joined = gpd.sjoin(pts.to_crs(IL_EAST), tracts[["geoid", "geometry"]], predicate="within", how="inner")
    joined = joined.drop_duplicates("id")
    print(f"  permits inside Chicago tracts: {len(joined)} of {len(permits)}")
    permits = pd.DataFrame(joined.drop(columns=["geometry", "index_right"]))

    projects = json.loads((DATA / "infrastructure.json").read_text())
    print(f"  infrastructure projects: {len(projects)}"
          + ("  (still the mock file)" if all(p.get("source_url") is None for p in projects)
             and any(p.get("id") == "infra-001" for p in projects) else ""))

    geoms = simplified_geojson_geoms(tracts)
    features = score(tracts, geoms, permits, projects, as_of, args.scoring)
    fc = {"type": "FeatureCollection", "as_of": as_of.isoformat(), "features": features}

    permits = permits.sort_values(["issue_date", "id"], ascending=[False, True])
    permit_rows = [{
        "id": r.id, "address": r.address, "lat": round(r.lat, 6), "lng": round(r.lng, 6),
        "issue_date": r.issue_date, "units": None if r.units is None or pd.isna(r.units) else int(r.units),
        "description": r.description, "geoid": r.geoid,
    } for r in permits.itertuples()]

    validate(fc, permit_rows, projects)

    gj = json.dumps(fc, separators=(",", ":"), ensure_ascii=False)
    if len(gj.encode()) > MAX_GEOJSON_BYTES:
        sys.exit(f"tracts.geojson is {len(gj.encode()) / 1e6:.1f} MB, over 5 MB; raise SIMPLIFY_FT")
    pj = json.dumps(permit_rows, indent=1, ensure_ascii=False)
    out_dirs = (args.out,) if args.out else (DATA, PUBLIC)
    for d in out_dirs:
        d.mkdir(parents=True, exist_ok=True)
        (d / "tracts.geojson").write_text(gj + "\n")
        (d / "permits.json").write_text(pj + "\n")

    print(f"\nTracts: {len(features)}   Permits: {len(permit_rows)}   "
          f"tracts.geojson: {len(gj.encode()) / 1e6:.2f} MB")
    print("Top 10 tracts by score:")
    top = sorted(features, key=lambda f: (-f["properties"]["score"], f["properties"]["geoid"]))[:10]
    for f in top:
        p = f["properties"]
        print(f"  {p['score']:>3}  {p['name']:<40} {p['geoid']}  "
              f"units_24mo={p['units_24mo']:<5} momentum={p['momentum_pct']:+.1f}%")


if __name__ == "__main__":
    main()
