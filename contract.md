# Emris — Shared Contract (v2.2)

Emris scores Chicago census tracts on permit and infrastructure activity to surface the "path of progress" before it shows up in prices.

**This file is the source of truth.** Four builders work in parallel against it. If code and this file disagree, this file wins. Changes need sign-off from all four builders; bump the version in the title when it changes.

TypeScript types for everything below live in `lib/data.ts`. Import them from there (`import type { ... } from "@/lib/data"`); don't redefine them.

---

## 1. Data files

The app reads data from these files at runtime. Today they hold copies of `/mock`; the data agent replaces them with real data in the same shapes.

| File | Read by | Written by |
|---|---|---|
| `data/tracts.geojson` | server (`getTracts`) | data agent |
| `data/permits.json` | server (`getPermits`) | data agent |
| `data/infrastructure.json` | server (`getProjects`) | data agent |
| `public/tracts.geojson` | browser, fetched as `/tracts.geojson` (optional — `/api/tracts` returns the same thing) | data agent, byte-identical copy of `data/tracts.geojson` |
| `public/permits.json`, `public/infrastructure.json` | nobody should depend on these; mock copies only | data agent |

General rules for all files:
- Plain UTF-8 JSON, no comments.
- Coordinates are WGS84 decimal degrees, max 6 decimals. GeoJSON order is `[lng, lat]`; everywhere else fields are named `lat` / `lng`.
- Dates are ISO 8601 date strings, `"YYYY-MM-DD"`.
- Fields marked nullable are present with value `null`, never omitted.

### 1.1 `data/tracts.geojson`

A GeoJSON `FeatureCollection`. One feature per Chicago census tract (2020 tracts). Geometry is `Polygon` or `MultiPolygon`.

```jsonc
{
  "type": "FeatureCollection",
  "as_of": "2026-10-30",            // date the scores were computed; all time decay is relative to this
  "features": [
    {
      "type": "Feature",
      "properties": {
        "geoid": "17031221500",       // string, exactly 11 digits: state 17 + county 031 + 6-digit tract
        "name": "Logan Square · Tract 2215",  // "<Community Area> · Tract <tract number without trailing .00>", e.g. "Pilsen · Tract 3101.02"
        "score": 87,                  // int 0-100, see §3
        "percentile": 84,             // int 0-100, see §3
        "momentum": "up",             // "up" | "flat" | "down"
        "momentum_pct": 50.0,         // number, 1 decimal, see §3
        "signals": {
          "mf_permits": 92,           // int 0-100
          "permit_momentum": 75,      // int 0-100
          "infra_proximity": 60       // int 0-100
        },
        "permit_count_24mo": 4,       // int ≥ 0
        "units_24mo": 210             // int ≥ 0 (null units count as 0)
      },
      "geometry": { "type": "Polygon", "coordinates": [[[-87.72, 41.92], ...]] }
    }
  ]
}
```

Features have no top-level `id`. Map libraries should use `promoteId: "geoid"`.

### 1.2 `data/permits.json`

Array of building permits for **new construction** in Chicago (source: City of Chicago building permits, `permit_type = "PERMIT - NEW CONSTRUCTION"`), issued in the 24 months before `as_of`.

```jsonc
[
  {
    "id": "100987654",              // string, city permit number
    "address": "2318 N Kedzie Ave", // string, street address without city/state
    "lat": 41.92381,                // number
    "lng": -87.70712,               // number
    "issue_date": "2026-03-14",     // ISO date
    "units": 48,                    // int | null (null = not reported)
    "description": "Erect a 6-story, 48-unit residential building with ground-floor retail",
    "geoid": "17031221500"          // string, tract containing the point; must match a tract in tracts.geojson
  }
]
```

Permits outside every Chicago tract are dropped. Sorted by `issue_date` descending.

### 1.3 `data/infrastructure.json`

Array of public infrastructure and catalyst projects. Built by `scripts/fetch_catalysts.py` (Firecrawl extraction from public pages, geocoded inside Chicago, max 40 Firecrawl projects), merged with any hand-curated entries.

```jsonc
[
  {
    "id": "infra-001",                    // string, unique, stable
    "name": "Milwaukee Ave Streetscape",  // string
    "type": "streetscape",                // "transit" | "park" | "streetscape" | "civic" | "other"
    "status": "under_construction",       // "planned" | "funded" | "under_construction" | "complete"
    "lat": 41.9231,                       // number, a single representative point
    "lng": -87.7004,                      // number
    "budget_usd": 18500000,               // number | null
    "expected_completion": "2027",        // string | null, free form: "2027", "2027-Q3", "2027-06-30"
    "description": "Wider sidewalks, protected bike lanes and bus bulbs from Logan Blvd to Diversey.",
    "source_url": "https://www.transitchicago.com/rle/",  // string | null (always set when source = "firecrawl")
    "source": "firecrawl",                // optional: "firecrawl" | "curated"
    "retrieved_at": "2026-10-30"          // optional: ISO date the source was fetched or curated
  }
]
```

`source` and `retrieved_at` are optional: readers must not require them. `id`s from Firecrawl start with `fc-`.

---

## 2. API routes

All routes are Next.js route handlers under `app/api`. All responses are `Content-Type: application/json`.

**Errors** (every route): non-2xx status with body `{ "error": string }`.
- `400` bad or missing input
- `404` tract or place not found
- `500` anything else

Shared shapes used below:
- `TractProps` = the `properties` object from §1.1
- `Permit` = one row from §1.2
- `ProjectWithDistance` = one row from §1.3 plus `"distance_mi": number` (2 decimals)

Distances are great-circle (haversine, Earth radius 3958.8 mi).

### 2.1 `GET /api/tracts`

Response `200`: the full `data/tracts.geojson` object, unchanged.

### 2.2 `GET /api/tract/[geoid]`

`geoid` must be 11 digits, else `400`. Unknown geoid → `404`.

Response `200`:
```jsonc
{
  "tract": { /* TractProps */ },
  "top_permits": [ /* Permit[]: permits with this geoid, issue_date newest first, max 10 */ ],
  "nearby_projects": [ /* ProjectWithDistance[]: within 1.0 mi of the tract centroid (§3.4), distance ascending, all statuses */ ]
}
```

### 2.3 `GET /api/near?q=<text>&radius_mi=0.25`

- `q` (required): an address ("2400 N Milwaukee Ave") or a neighborhood name ("Pilsen"). Missing/empty → `400`. Can't be located → `404`.
- `radius_mi` (optional): number, default `0.25`, clamped to `[0.05, 2]`.
- Geocoding approach is up to the API agent. Results must be inside Chicago.

Response `200`:
```jsonc
{
  "place": { "label": "2400 N Milwaukee Ave, Chicago", "lat": 41.9248, "lng": -87.6990 },
  "tract": { /* TractProps of the tract containing place, or null */ },
  "permits": [ /* Permit[]: within radius_mi of place, issue_date newest first, max 25 */ ],
  "projects": [ /* ProjectWithDistance[]: within radius_mi of place, distance ascending */ ]
}
```

### 2.4 `POST /api/memo`

Request: `{ "geoid": "17031221500" }`. Bad geoid → `400`; unknown → `404`.

Response `200`:
```jsonc
{
  "geoid": "17031221500",
  "title": "Logan Square · Tract 2215 — Path of Progress Memo",
  "memo_markdown": "## Summary\n..."
}
```

`memo_markdown` is GitHub-flavored markdown with these `##` sections in order: **Summary**, **Signals**, **Recent Permits**, **Infrastructure Nearby**, **Risks & Unknowns**. It may only cite facts from `/api/tract/[geoid]` data (no invented numbers).

### 2.5 `POST /api/ask`

Request: `{ "question": "where is multifamily heating up on the south side?" }`. Missing/empty → `400`.

Response `200`:
```jsonc
{
  "reply": "Bronzeville tract 3511 is scoring 91, up 60% in permits year over year...",
  "url": "/?tract=17031351100"
}
```
- `reply`: plain text, **under 600 characters**, no markdown, no URLs inside the text (the iMessage agent sends `url` separately).
- `url`: a relative deep link, exactly one of:
  - `/?tract=<geoid>` — opens the app focused on that tract
  - `/?lat=<lat>&lng=<lng>&z=<zoom>` — lat/lng with up to 5 decimals, z an int (use `15` for a street-level view)
- The iMessage agent makes it absolute by prefixing `APP_BASE_URL`.

### 2.6 Deep links (UI must support)

The home page `/` reads these query params on load:
- `?tract=<geoid>` → fit the map to that tract and open its detail panel
- `?lat=&lng=&z=` → center the map there at that zoom
- `tract` wins if both are present.

### 2.7 `/api/redline/*`

A proxy to the Redline service in `services/redline`, which answers building permit correction letters. Redline deploys on its own server, because its agent runtime can't run on Vercel. The proxy holds the service key and forwards only these routes. It returns `503` if `REDLINE_API_URL` or `REDLINE_API_KEY` isn't set, `502` if the service doesn't respond, and `413` if a body is over 4 MB.

| Route | Purpose |
|---|---|
| `GET offer` | Payments on or off, price, covered places |
| `POST start/extract` | `{ text }` or `{ pdf_base64 }` → `{ comments, jurisdiction, permit_number }` |
| `POST start/run` | `{ comments, jurisdiction, permit_number, chicago_2026 }` → `202 { job_id }` |
| `GET job/[id]` | `{ status: "running" }` or `{ status: "done", result }`. `result` is a report, or `{ stop, message }` for a place or code edition Redline doesn't cover |
| `GET report/[id]` | The report. The service withholds locked drafts and citations |
| `POST report/[id]/unlock` | Returns `{ checkout_url }` if payments are on. Otherwise, with `{ design_partner: true }`, returns the unlocked report |
| `POST report/[id]/review`, `POST report/[id]/optin` | Sign-off decisions, and consent to learn from them. Need an unlocked report, else `402` |
| `GET report/[id]/export` | Word draft. Needs an unlocked report, else `402` |
| `POST waitlist` | `{ email, place, reason }` for places not covered |
| `GET paid` | `?session_id=` → `{ report_id }`, after checking the session with Stripe |

Report IDs are unguessable, and a report link gives access to that report.

---

## 3. Scoring method

All signal values are computed per tract, then **percentile-ranked across all Chicago tracts** into ints 0-100.

### 3.1 Percentile rank

For a value `x` in a list of `n` values, with `below` = count of values `< x` and `equal` = count of values `== x` (including `x`):

```
pctRank(x) = round(100 * (below + (equal - 1) / 2) / (n - 1))
```

The lowest value gets 0, the highest gets 100, ties get the same number.

### 3.2 Signals (raw values)

Let `age_years = (as_of - issue_date) in days / 365.25`.

- **mf_permits**: `Σ 0.5 ^ age_years` over the tract's permits with `units >= 5` (12-month half-life). Permits with `units = null` are excluded.
- **permit_momentum**: `L` = tract permits with `units >= 5` and `age_years < 1`; `P` = tract permits with `units >= 5` and `1 <= age_years < 2`. Permits with `units = null` are excluded.
  raw = `(L - P) / (P + 2)` if `n >= MIN_ACTIVITY`, else `0` (see §3.3 for `n`).
- **infra_proximity**: `Σ weight(status) × decay(d)` over all projects, where `d` = distance in miles from the tract centroid to the project.
  - weight: `under_construction 1.0`, `funded 0.8`, `planned 0.5`, `complete 0` (already priced in)
  - decay: `1` if `d <= 0.25`; `(1 - d) / 0.75` if `0.25 < d < 1`; `0` if `d >= 1`

Each raw value goes through `pctRank` → `signals.*`.

### 3.3 Composite, score, percentile, momentum

Let `n` = the tract's permits with `units >= 5` and `age_years < 2`, and `MIN_ACTIVITY = 3`. A tract with fewer than 3 known multifamily permits has its permit signals pulled toward the citywide median, so one permit can't put it at the top. Infrastructure is not pulled.

```
permit_part = 0.45 * signals.mf_permits + 0.30 * signals.permit_momentum
k           = min(1, n / MIN_ACTIVITY)
composite   = median(permit_part over all tracts) + (permit_part - median) * k
              + 0.25 * signals.infra_proximity
              + units_24mo * 1e-6                       // tie-break only
score       = pctRank(composite)
percentile  = round(100 * (count of tracts with composite < this composite) / N)   // N = tract count; "beats X% of Chicago tracts"
momentum_pct = round to 1 decimal of 100 * (L - P) / max(P, 1)                      // L, P as in permit_momentum
momentum    = "flat" if n < MIN_ACTIVITY; else "up" if momentum_pct > 10, "down" if momentum_pct < -10, else "flat"
permit_count_24mo = count of tract permits with age_years < 2 (all unit counts, including null)
units_24mo        = sum of units (null → 0) for those same permits
```

### 3.4 Tract centroid

The mean of the outer-ring vertices, excluding each ring's closing point. For `MultiPolygon`, use the vertices of every polygon's outer ring.

---

## 4. Folder ownership

Each builder works in their own git worktree and branch and merges into `main`.

| Builder | Branch / worktree | Owns |
|---|---|---|
| Data agent | `data` → `../emris-data` | `/scripts`, `/data`, `public/tracts.geojson`, `public/permits.json`, `public/infrastructure.json` |
| API agent | `api` → `../emris-api` | `/app/api`, `/lib` |
| iMessage agent | `imessage` → `../emris-imessage` | `/imessage` |
| Redline | `services/redline` subtree | `/services/redline`, `/app/api/redline`, `/app/(marketing)/redline`, `/components/redline` |
| UI (Cursor) | `ui` → `../emris-ui` | `/app/(pages)`, `/components`, `app/layout.tsx`, `app/globals.css` (move `app/page.tsx` into `app/(pages)/page.tsx`) |

Rules:
- **Nobody edits outside their folders.** Need something from another folder? Ask its owner.
- `contract.md` and `/mock` change only with sign-off from all four.
- `lib/data.ts` is owned by the API agent, but its exported types must match this file. Others import from it read-only.
- Adding an npm dependency is fine; say so in the team chat. On `package-lock.json` conflicts, take `main`'s and re-run `npm install`.

## 5. Environment variables

Put these in `.env.local` (never commit it).

| Name | Used by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | API agent (`/api/memo`, `/api/ask`) | LLM calls |
| `APP_BASE_URL` | iMessage agent | Prefix for `url` from `/api/ask`, e.g. `http://localhost:3000` |
| `REDLINE_API_URL` | `/api/redline/*` | Base URL of the Redline service |
| `REDLINE_API_KEY` | `/api/redline/*` | Shared secret. Must match the service's `REDLINE_API_KEY` |

## 6. Mocks

`/mock` has hand-generated fake data in the exact shapes above (25 rectangular tracts across Logan Square, Humboldt Park, West Loop, Pilsen and Bronzeville; 40 permits; 10 projects). Scores in the mock were computed with the v1 formula over just those 25 tracts, so they show the right shapes but not v2 scoring. Regenerate with `node mock/generate.mjs`. None of the mock data is real.
