"""Build data/infrastructure.json from public pages using Firecrawl structured extraction.

    scripts/.venv/bin/python scripts/fetch_catalysts.py [--refresh] [--keep-mock] [--dry-run]

Needs FIRECRAWL_API_KEY in .env (repo root) only when something isn't cached yet.
Raw Firecrawl responses and geocodes are cached in data/raw/firecrawl/, so reruns spend no credits.
Firecrawl SDK (pip package `firecrawl`, v4): Firecrawl.scrape(url, formats=[{"type": "json", ...}]) -> Document.json,
Firecrawl.search(query, limit, scrape_options=ScrapeOptions(formats=[...])) -> SearchData.web[Document].
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import math
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import requests
import shapely
from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "raw" / "firecrawl"
INFRA = DATA / "infrastructure.json"
MOCK = ROOT / "mock" / "infrastructure.json"
NEIGHBORHOODS = ROOT / "lib" / "neighborhoods.json"

# Proposed sources (official project pages first, then news). Edit to change what gets scraped.
SOURCES = [
    "https://www.transitchicago.com/rle/",
    "https://www.transitchicago.com/projects/",
    "https://www.chicago.gov/city/en/depts/cdot/provdrs/future_projects_andconcepts.html",
    "https://www.chicago.gov/city/en/sites/livable-streets-chicago/home.html",
    "https://www.chicago.gov/city/en/sites/invest_sw/home.html",
    "https://www.chicagoparkdistrict.com/about-us/news",
    "https://chicagoyimby.com/category/building/infrastructure",
    "https://news.wttw.com/2026/04/24/cta-kicks-construction-long-awaited-57b-red-line-extension-far-south-side",
    "https://chicagoyimby.com/2026/08/tower-crane-coming-down-from-ballys-casino-hotel.html",
]
SEARCHES = [
    "Chicago infrastructure project groundbreaking 2026",
    "CTA station construction 2026",
    "Chicago park project construction 2026",
    "Chicago streetscape project 2026",
    # Named catalysts from the brief that the generic queries may miss.
    "The 78 Chicago Quantum Park 1901 Project United Center construction 2026",
]
SEARCH_LIMIT = 5
MAX_PROJECTS = 40

TYPES = ("transit", "park", "streetscape", "civic", "other")
STATUSES = ("planned", "funded", "under_construction", "complete")
STATUS_RANK = {"under_construction": 0, "funded": 1, "planned": 2, "complete": 3}

SCHEMA = {
    "type": "object",
    "properties": {
        "projects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "type": {"type": "string", "enum": list(TYPES)},
                    "status": {"type": "string", "enum": list(STATUSES)},
                    "location_text": {"type": "string"},
                    "address_guess": {"type": ["string", "null"]},
                    "neighborhood": {"type": ["string", "null"]},
                    "budget_usd": {"type": ["number", "null"]},
                    "expected_completion": {"type": ["string", "null"]},
                    "description": {"type": "string"},
                    "source_url": {"type": ["string", "null"]},
                },
                "required": ["name", "type", "status", "location_text", "description"],
            },
        }
    },
    "required": ["projects"],
}
PROMPT = (
    "Extract physical public infrastructure and large catalyst development projects located in the City of Chicago "
    "(transit lines and stations, parks, streetscapes, civic buildings, and major developments such as casinos, "
    "stadium districts or tech campuses). Skip projects outside Chicago and skip policies, studies and events. "
    "For each project: name; type; status (planned, funded, under_construction or complete); location_text = the most "
    "specific location the page gives (street address, intersection, corridor or neighborhood); address_guess = if "
    "location_text is an intersection or corridor, the nearest Chicago street address in grid form like '100 E 103rd St', "
    "else null; neighborhood = the Chicago neighborhood or community area if known; budget_usd as a plain number in "
    "dollars or null; expected_completion as written (year, quarter or date) or null; description = one sentence; "
    "source_url = this page's URL. For the CTA Red Line Extension, list each new station (103rd St, 111th St, "
    "Michigan Ave/116th St, 130th St) as its own project. Use only facts stated on the page; never invent numbers."
)
FORMAT = {"type": "json", "schema": SCHEMA, "prompt": PROMPT}
# Changing the schema or prompt changes this, so cached responses are refreshed automatically.
CACHE_VERSION = hashlib.sha1(json.dumps(FORMAT, sort_keys=True).encode()).hexdigest()[:8]

CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
EARTH_MI = 3958.8


# ---------------------------------------------------------------- env + cache

def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for name in (".env", ".env.local"):
        p = ROOT / name
        if p.exists():
            for line in p.read_text().splitlines():
                m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
                if m and not line.lstrip().startswith("#"):
                    env.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))
    return env


def cache_path(kind: str, key: str) -> Path:
    h = hashlib.sha1(f"{CACHE_VERSION}|{kind}|{key}".encode()).hexdigest()[:16]
    slug = re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")[:60]
    return CACHE / f"{kind}-{slug}-{h}.json"


_client = None


def client():
    global _client
    if _client is None:
        key = load_env().get("FIRECRAWL_API_KEY")
        if not key:
            sys.exit("FIRECRAWL_API_KEY is missing from .env (needed because some responses aren't cached yet).")
        from firecrawl import Firecrawl
        _client = Firecrawl(api_key=key)
    return _client


def fetch(kind: str, key: str, call, refresh: bool) -> dict:
    """Run a Firecrawl call once and cache its JSON-able response."""
    path = cache_path(kind, key)
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    print(f"  firecrawl {kind}: {key}")
    try:
        resp = call(client())
        body = {"ok": True, "response": resp.model_dump(mode="json")}
    except Exception as e:  # cache failures too, so a blocked page doesn't burn credits every run
        body = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    body.update(kind=kind, key=key, fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, indent=1))
    return body


def scrape_source(url: str, refresh: bool) -> dict:
    return fetch("scrape", url, lambda fc: fc.scrape(url, formats=[FORMAT], only_main_content=False, timeout=120000), refresh)


def search_query(q: str, refresh: bool) -> dict:
    from firecrawl.v2.types import ScrapeOptions
    return fetch("search", q, lambda fc: fc.search(
        q, limit=SEARCH_LIMIT, tbs="qdr:y", scrape_options=ScrapeOptions(formats=[FORMAT], only_main_content=False),
    ), refresh)


# ---------------------------------------------------------------- extraction -> raw projects

def doc_projects(doc: dict, fallback_url: str, fetched_at: str) -> list[dict]:
    meta = doc.get("metadata") or {}
    page_url = meta.get("source_url") or meta.get("url") or doc.get("url") or fallback_url
    out = []
    for p in ((doc.get("json") or {}).get("projects") or []):
        p = dict(p)
        # The page the project came from is always the source; ignore whatever URL the model wrote.
        p["source_url"] = page_url
        p["_fetched_at"] = fetched_at
        out.append(p)
    return out


def collect(refresh: bool) -> tuple[list[dict], list[dict]]:
    projects, report = [], []
    for url in SOURCES:
        body = scrape_source(url, refresh)
        ps = doc_projects(body["response"], url, body["fetched_at"]) if body["ok"] else []
        report.append({"source": url, "ok": body["ok"], "projects": len(ps), "error": body.get("error")})
        projects += ps
    for q in SEARCHES:
        body = search_query(q, refresh)
        n = 0
        if body["ok"]:
            for doc in body["response"].get("web") or []:
                ps = doc_projects(doc, doc.get("url") or "", body["fetched_at"])
                n += len(ps)
                projects += ps
        report.append({"source": f"search: {q}", "ok": body["ok"], "projects": n, "error": body.get("error")})
    return projects, report


# ---------------------------------------------------------------- cleaning

def norm_enum(v, allowed, default):
    s = re.sub(r"[\s\-]+", "_", str(v or "").strip().lower())
    aliases = {"construction": "under_construction", "in_progress": "under_construction", "ongoing": "under_construction",
               "completed": "complete", "open": "complete", "opened": "complete", "proposed": "planned",
               "approved": "funded", "design": "planned", "in_design": "planned"}
    s = aliases.get(s, s)
    return s if s in allowed else default


def clean(p: dict) -> dict | None:
    name = " ".join(str(p.get("name") or "").split())
    if not name or not p.get("source_url"):
        return None
    budget = p.get("budget_usd")
    try:
        budget = float(budget) if budget not in (None, "") else None
        budget = None if budget is not None and (budget <= 0 or math.isnan(budget)) else budget
    except (TypeError, ValueError):
        budget = None
    desc = " ".join(str(p.get("description") or "").split())
    m = re.match(r"(.+?[.!?])(\s|$)", desc)  # first sentence
    desc = (m.group(1) if m else desc)[:240]
    exp = p.get("expected_completion")
    return {
        "name": name,
        "type": norm_enum(p.get("type"), TYPES, "other"),
        "status": norm_enum(p.get("status"), STATUSES, "planned"),
        "location_text": " ".join(str(p.get("location_text") or "").split()),
        "address_guess": (p.get("address_guess") or "").strip() or None,
        "neighborhood": (p.get("neighborhood") or "").strip() or None,
        "budget_usd": int(budget) if budget is not None else None,
        "expected_completion": str(exp).strip() if exp not in (None, "") else None,
        "description": desc,
        "source_url": p["source_url"],
        "retrieved_at": str(p.get("_fetched_at", ""))[:10] or date.today().isoformat(),
    }


# ---------------------------------------------------------------- geocoding

class Geocoder:
    def __init__(self, refresh: bool):
        self.path = CACHE / "geocode.json"
        self.cache = {} if refresh or not self.path.exists() else json.loads(self.path.read_text())
        fc = json.loads((DATA / "tracts.geojson").read_text())
        self.city = shapely.union_all([shape(f["geometry"]) for f in fc["features"]])
        shapely.prepare(self.city)
        nb = json.loads(NEIGHBORHOODS.read_text())
        entries = nb["nicknames"] + nb["community_areas"]
        self.names = sorted(
            ((n.lower(), e) for e in entries for n in [e["name"], *e.get("aliases", [])]),
            key=lambda x: -len(x[0]),
        )

    def save(self):
        CACHE.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.cache, indent=1, sort_keys=True))

    def inside(self, lat, lng) -> bool:
        return self.city.contains(Point(lng, lat))

    def census(self, text: str):
        if not text or not re.search(r"\d", text):  # Census needs a house number
            return None
        # Only a ", Chicago" after a comma is the city; "W Chicago Ave" is a street.
        q = text if re.search(r",\s*chicago\b|\billinois\b|,\s*il\b", text, re.I) else f"{text}, Chicago, IL"
        if q not in self.cache:
            try:
                r = requests.get(CENSUS_URL, params={"address": q, "benchmark": "Public_AR_Current", "format": "json"}, timeout=20)
                m = (r.json().get("result") or {}).get("addressMatches") or []
                self.cache[q] = [m[0]["coordinates"]["y"], m[0]["coordinates"]["x"]] if m else None
            except Exception:
                return None  # network hiccup: don't cache, try again next run
        return self.cache[q]

    def neighborhood(self, *texts):
        for t in texts:
            if not t:
                continue
            low = f" {t.lower()} "
            for name, e in self.names:
                if re.search(rf"(?<![a-z]){re.escape(name)}(?![a-z])", low):
                    return [e["lat"], e["lng"]], e["name"]
        return None, None

    def locate(self, p: dict):
        """Returns (lat, lng, method) inside Chicago, or None."""
        for method, text in (("address", p["location_text"]), ("address_guess", p["address_guess"])):
            ll = self.census(text)
            if ll and self.inside(*ll):
                return ll[0], ll[1], method
        ll, nb = self.neighborhood(p["neighborhood"], p["location_text"], p["name"])
        if ll and self.inside(*ll):
            return ll[0], ll[1], f"centroid:{nb}"
        return None


# ---------------------------------------------------------------- dedupe, rank, merge

def miles(a, b) -> float:
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dl, dg = p2 - p1, math.radians(b["lng"] - a["lng"])
    h = math.sin(dl / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dg / 2) ** 2
    return 2 * EARTH_MI * math.asin(math.sqrt(h))


def name_key(s: str) -> str:
    s = re.sub(r"[^a-z0-9 ]+", " ", s.lower())
    return " ".join(w for w in s.split() if w not in {"the", "project", "chicago", "cta", "new", "of", "and"})


def similar(a: str, b: str) -> bool:
    ka, kb = name_key(a), name_key(b)
    return bool(ka and kb) and (ka in kb or kb in ka or difflib.SequenceMatcher(None, ka, kb).ratio() >= 0.6)


def filled(p: dict) -> int:
    return sum(p.get(k) not in (None, "") for k in ("budget_usd", "expected_completion", "description", "location_text"))


def same_project(a: dict, b: dict) -> bool:
    if miles(a, b) >= 0.3 or not similar(a["name"], b["name"]):
        return False
    # Red Line Extension stations are separate points: different station numbers never merge.
    nums = lambda s: set(re.findall(r"\b(\d{2,3})(?:st|nd|rd|th)\b", s.lower()))
    na, nb = nums(a["name"]), nums(b["name"])
    return not (na and nb and na != nb)


def dedupe(ps: list[dict]) -> tuple[list[dict], list[tuple[dict, dict]]]:
    kept, merged = [], []
    for p in sorted(ps, key=lambda p: -filled(p)):
        dup = next((k for k in kept if same_project(k, p)), None)
        if dup:
            merged.append((p, dup))
        else:
            kept.append(p)
    return kept, merged


def rank_key(p: dict):
    return (STATUS_RANK[p["status"]], -(p["budget_usd"] or 0), p["name"])


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48]


def is_mock(old: list[dict]) -> bool:
    if not MOCK.exists():
        return False
    mock_ids = {m["id"]: m for m in json.loads(MOCK.read_text())}
    return any(o.get("id") in mock_ids and o.get("name") == mock_ids[o["id"]]["name"] for o in old)


def to_record(p: dict, ids: set[str]) -> dict:
    base, n = f"fc-{slug(p['name'])}", 2
    rid = base
    while rid in ids:
        rid, n = f"{base}-{n}", n + 1
    ids.add(rid)
    return {
        "id": rid, "name": p["name"], "type": p["type"], "status": p["status"],
        "lat": round(p["lat"], 6), "lng": round(p["lng"], 6),
        "budget_usd": p["budget_usd"], "expected_completion": p["expected_completion"],
        "description": p["description"], "source_url": p["source_url"],
        "source": "firecrawl", "retrieved_at": p["retrieved_at"],
    }


# ---------------------------------------------------------------- validation (contract §1.3)

def validate(rows: list[dict]) -> None:
    keys = ["id", "name", "type", "status", "lat", "lng", "budget_usd", "expected_completion", "description",
            "source_url", "source", "retrieved_at"]
    errs = []
    ids = set()
    for r in rows:
        k = r.get("id")
        if list(r) != keys: errs.append(f"{k}: keys {list(r)}")
        if not isinstance(k, str) or not k or k in ids: errs.append(f"{k}: id")
        ids.add(k)
        if r["type"] not in TYPES: errs.append(f"{k}: type")
        if r["status"] not in STATUSES: errs.append(f"{k}: status")
        if not (41.6 < r["lat"] < 42.1 and -88 < r["lng"] < -87.5): errs.append(f"{k}: coords")
        if r["budget_usd"] is not None and not isinstance(r["budget_usd"], (int, float)): errs.append(f"{k}: budget")
        if r["expected_completion"] is not None and not isinstance(r["expected_completion"], str): errs.append(f"{k}: completion")
        if not isinstance(r["description"], str): errs.append(f"{k}: description")
        if r["source_url"] is not None and not isinstance(r["source_url"], str): errs.append(f"{k}: source_url")
        if r["source"] == "firecrawl" and not r["source_url"]: errs.append(f"{k}: firecrawl record without source_url")
        if r["source"] not in ("firecrawl", "curated"): errs.append(f"{k}: source")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["retrieved_at"] or ""): errs.append(f"{k}: retrieved_at")
    if errs:
        sys.exit("VALIDATION FAILED:\n  " + "\n  ".join(errs[:30]))


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="ignore cached Firecrawl responses and geocodes")
    ap.add_argument("--keep-mock", action="store_true", help="keep the fake /mock projects if data/infrastructure.json is still the mock")
    ap.add_argument("--dry-run", action="store_true", help="print results without writing data/infrastructure.json")
    args = ap.parse_args()

    print(f"Firecrawl catalysts (cache {CACHE.relative_to(ROOT)}, schema {CACHE_VERSION})")
    raw, report = collect(args.refresh)
    print("\nSources:")
    for r in report:
        print(f"  {'ok ' if r['ok'] else 'ERR'} {r['projects']:>3} projects  {r['source']}" + (f"  ({r['error'][:80]})" if r["error"] else ""))

    geo = Geocoder(args.refresh)
    located, dropped = [], []
    for p in filter(None, map(clean, raw)):
        hit = geo.locate(p)
        if hit:
            p["lat"], p["lng"], p["method"] = hit
            located.append(p)
        else:
            dropped.append(p)
    geo.save()
    no_source = len(raw) - len(located) - len(dropped)

    kept, merged = dedupe(located)
    kept.sort(key=rank_key)
    over_cap = kept[MAX_PROJECTS:]
    kept = kept[:MAX_PROJECTS]

    old = json.loads(INFRA.read_text()) if INFRA.exists() else []
    old_is_mock = is_mock(old)
    ids: set[str] = set()
    new = [to_record(p, ids) for p in kept]
    curated_kept, replaced = [], []
    for o in old:
        if old_is_mock and not args.keep_mock:
            continue
        match = next((n for n in new if same_project(n, o)), None)
        if match:
            replaced.append((o, match))
            continue
        rec = {k: o.get(k) for k in ("id", "name", "type", "status", "lat", "lng", "budget_usd", "expected_completion",
                                       "description", "source_url")}
        rec["source"] = "curated"
        rec["retrieved_at"] = o.get("retrieved_at") or date.today().isoformat()
        curated_kept.append(rec)
        ids.add(rec["id"])
    rows = sorted(new + curated_kept, key=rank_key)
    validate(rows)

    # ---- report
    print(f"\n{len(raw)} extracted -> {no_source} without name/source, {len(dropped)} not geocodable in Chicago, "
          f"{len(merged)} duplicates merged, {len(over_cap)} over the {MAX_PROJECTS} cap -> {len(new)} Firecrawl projects")
    meth = {p["name"]: p for p in kept}
    print(f"\n{'name':<46} {'status':<18} {'source':<9} {'location_text':<34} {'lat,lng':<20} source_url")
    for r in rows:
        p = meth.get(r["name"], {})
        loc = (p.get("location_text") or "")[:33]
        how = p.get("method", "")
        print(f"{r['name'][:45]:<46} {r['status']:<18} {r['source']:<9} {loc:<34} {r['lat']:.4f},{r['lng']:.4f}"
              f"{'*' if how.startswith('centroid') else ' ':<4} {r['source_url'] or ''}")
    print("  * = located at a neighborhood centroid (no address on the page)")

    print("\nChanges vs old data/infrastructure.json:")
    if old_is_mock and not args.keep_mock:
        print(f"  old file was the /mock data ({len(old)} fake projects): all dropped (pass --keep-mock to keep them)")
    for o, n in replaced:
        diff = [k for k in ("name", "type", "status", "budget_usd", "expected_completion") if o.get(k) != n.get(k)]
        print(f"  changed  {o['name']} -> {n['name']}" + (f"  ({', '.join(diff)})" if diff else ""))
    old_names = {o["name"] for o in old}
    for n in new:
        if n["name"] not in old_names and not any(n is m for _, m in replaced):
            print(f"  added    {n['name']}  [{n['status']}]")
    for o in old:
        if not any(o is r for r, _ in replaced) and not any(o.get("id") == c["id"] for c in curated_kept):
            print(f"  dropped  {o['name']}" + ("  (mock)" if old_is_mock else ""))
    if dropped:
        print("\nNot geocodable inside Chicago (dropped):")
        for p in dropped:
            print(f"  {p['name'][:50]:<52} {p['location_text'][:50]}")
    for p, k in merged:
        print(f"  merged duplicate: {p['name']} -> {k['name']}")

    if args.dry_run:
        print("\n--dry-run: data/infrastructure.json not written")
        return
    INFRA.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(rows)} projects to data/infrastructure.json")


if __name__ == "__main__":
    main()
