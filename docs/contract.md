# Emris contract v2.0

The shared agreement between every agent and lane. Read it before building anything. **Never invent a field**: if you need one that is not here, stop and ask Renee, and the change lands here first.

- v1 (hackathon, one city, static files) is kept at `legacy/contract-v1.md`.
- Lives in `docs/` because its worked examples name real places, which the CI guardrail (§7) allows only in `places/`, `tests/fixtures/`, `docs/` and `legacy/`.

**The core rule:** code never names a city, county or state. Every place is a YAML file under `places/`. Adding a place means writing config, not code.

---

## 1. Place configs

### 1.1 Layout

```
places/
  _schema.py            pydantic models; the source of truth for this section
  <state>/              lowercase USPS code, e.g. il/
    _state.yaml         state defaults + baseline sources (one per state, required)
    <place>.yaml        one per city, county or county remainder
```

- A place belongs to the state of its folder. Values not set in a place file come from that state's `_state.yaml` (`defaults` block), then from the code defaults in `_schema.py`.
- File name = the part of `place_id` after the state: `places/il/<slug>.yaml` has `place_id: il-<slug>`.
- Validate everything with `python -m pipeline.validate` (§1.7). CI runs it on every push.

### 1.2 `_state.yaml`

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `state` | USPS code, 2 uppercase letters | yes | Must match the folder name |
| `state_fips` | string, 2 digits | yes | e.g. `"17"` |
| `name` | string | yes | Display name |
| `defaults.peer_group` | peer group (§1.5) | no | Peer group for places that don't set one. Usually `state:<fips>` for rural counties |
| `defaults.proximity_decay_mi` | `[full, zero]` miles | no | Code default `[0.25, 1.0]` |
| `defaults.coverage_tier` | tier (§1.4) | no | Code default `baseline` |
| `defaults.since_months` | int | no | Permit look-back. Code default `24` |
| `geography` | source | yes | Tract boundaries for the whole state (connector `tiger`) |
| `baseline.permits` | source | yes | Permit counts for every place (connector `census_bps`) |
| `baseline.housing` | source | yes | Housing units and year-built shares per tract (connector `acs`) |

Every tract in the state is scored at least at the baseline tier from these three sources, even if no place file covers it.

### 1.3 `<place>.yaml`

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `place_id` | `<state>-<slug>`, lowercase, `[a-z0-9-]` | yes | Stable id used in URLs, the DB and the API |
| `name` | string | yes | Display name |
| `state` | USPS code | yes | Must match the folder |
| `county_fips` | string, 5 digits | yes | The county that contains the place (first 2 digits = `state_fips`) |
| `census_place` | string, 7 digits | no | Census place code for a city. If set, the place covers only tracts whose centroid is inside that place. If unset, it covers the whole county minus any other place file in the same county |
| `peer_group` | peer group (§1.5) | no | Defaults from `_state.yaml` |
| `coverage_tier` | tier (§1.4) | yes | What this place's data supports today |
| `proximity_decay_mi` | `[full, zero]` miles, `full < zero` | no | Catalyst weight is 1 inside `full` and falls linearly to 0 at `zero` |
| `sources.permits` | permit source (§1.6.1) | no | Omitted means the place uses the state's baseline permits |
| `sources.parcels` | list of parcel sources (§1.6.2) | no | Omitted means Wayback falls back to ACS tract shares |
| `sources.catalysts` | catalyst source (§1.6.3) | no | Infrastructure projects |

### 1.4 Coverage tiers

| Tier | Permits | Year built and units | What users get |
| --- | --- | --- | --- |
| `parcel` | Address-level open data | Parcel-level | Tract scores, named properties, full Wayback |
| `parcel_partial` | Census BPS counts or partial open data | Parcel-level | Tract scores, Wayback, permit detail where available |
| `county_gis` | Census BPS counts | County GIS parcels, where they carry year built | Tract scores, Wayback where available |
| `baseline` | Census BPS counts | ACS tract shares | Tract scores only |

The tier is declared, not inferred. The UI shows it (as `coverage.tier`, §2.4).

### 1.5 Peer groups

The percentile is ranked within a peer group so that a 70 means "top 30% of its own market".

- `cbsa:<5-digit CBSA code>`: the metro area (default for metro places)
- `state:<2-digit FIPS>`: everything in the state not in a metro peer group (rural)

Every tract also gets a statewide percentile (`percentile_state`, §2.3).

### 1.6 Sources

Every source has a `connector` naming its source **type**. Connectors are written once in `pipeline/connectors/` and reused by every place.

| `connector` | Reads | Typical use |
| --- | --- | --- |
| `socrata` | Socrata SODA API (`domain`, `dataset`) | City permits, county assessor data |
| `arcgis` | ArcGIS REST feature layer (`url`) | County parcel GIS |
| `csv` | A CSV at `url` or a repo path | One-off feeds |
| `shovels` | Shovels permits API | Paid national permits (later) |
| `census_bps` | Census Building Permits Survey place files | Baseline permits |
| `acs` | Census ACS 5-year API | Housing units, year-built shares |
| `tiger` | Census TIGER/Line tract shapefiles | Tract boundaries |
| `firecrawl` | Firecrawl JSON extraction from `urls` | Catalysts |

**Field mapping.** Each `fields` map is `<standard field>: <source column>`. A list of columns is joined with single spaces (e.g. an address split over three columns). The standard field names are those in §2.

**Hooks.** Wherever a value can't be read from a column, a config may name a Python function: `{ hook: custom.<module> }` resolves to `pipeline/custom/<module>.py`. Hooks must pass the same fixture tests as connectors.

**`TODO`.** Any scalar value may be the string `TODO` (optionally followed by a note, e.g. `TODO confirm field`). Validation passes but lists every TODO. The pipeline refuses to run a source that still contains one.

#### 1.6.1 Permit source

| Key | Meaning |
| --- | --- |
| `connector`, `domain`, `dataset` / `url` | Where to read |
| `since_months` | Look-back, default from state |
| `fields` | Maps onto `StandardPermit` (§2.1). Required: `permit_id`, `issued`. Also available: `status`, `permit_type`, `work_type`, `text`, `cost`, `parcel_ids`, `lat`, `lng`, `address`, `tract_hint` |
| `parcel_id_format` | `{ pad_right: "<chars>", length: <int> }` to bring permit parcel ids to the assessor's format |
| `normalize_dashes` | If true, en and em dashes in `permit_type`/`work_type` become `-` before matching |
| `units.field` | Column holding a unit count |
| `units.from_text` | A regex with one capture group, or `{ hook: ... }`. Used when `units.field` is empty |
| `classes` | Rules that put every permit into one class (below) |

**Permit classes.** `new_mf`, `alteration`, `demolition`, `roof`, `major_mep`, `other`. Each rule is a map of conditions, all of which must hold:

- `permit_type`: string or list (exact match after dash normalization)
- `work_type`: list
- `min_units`: int (uses the parsed units)
- `min_cost`: number (uses the `cost` field)
- `any_of`: a list of rule maps, any of which may match
- `default: true`: matches everything (allowed only on `other`, which must have it)

Rules are tried in the order `new_mf`, `demolition`, `alteration`, `roof`, `major_mep`, `other`. The first match wins. A class may be left out. "Last major permit" in Wayback means the newest permit in `alteration`, `roof` or `major_mep`.

#### 1.6.2 Parcel source

A list, because one place often needs several datasets (e.g. one for small buildings, one for large ones, one for geometry).

| Key | Meaning |
| --- | --- |
| `name` | Unique within the place, `[a-z0-9_]` |
| `connector` + location | As above |
| `role` | `characteristics` (default) or `geometry` (supplies only points for parcel ids) |
| `latest_year_only` | For yearly datasets: keep only the newest `year` per parcel |
| `fields` | Maps onto `StandardProperty` (§2.2). `parcel_id` is required. Also available: `year`, `address`, `lat`, `lng`, `year_built`, `units`, `stories`, `land_use`, `owner_name` |
| `filter` | Equality filters on standard or source fields, e.g. `{ county_fips: "17031" }` |

When several sources describe one parcel, earlier entries in the list win field by field.

#### 1.6.3 Catalyst source

| Key | Meaning |
| --- | --- |
| `connector` | `firecrawl` (or `csv`) |
| `urls` | Pages to extract projects from |
| `seed_file` | Hand-curated JSON in the v1 `Project` shape, loaded with `source: curated` |

### 1.7 Validation

```
python -m pipeline.validate            # every file under places/
python -m pipeline.validate places/il  # one folder or file
```

- **Fails (exit 1)** on any schema error, printing `file: dotted.field.path: message`.
- Also fails on cross-file errors: a missing `_state.yaml`, a duplicate `place_id`, or `state`/`county_fips` not matching the folder's state.
- **Passes (exit 0)** with TODOs, listing each one as `file: field.path: TODO note`.

### 1.8 Worked example: `places/il/chicago.yaml`

The file in the repo is canonical; this excerpt shows each construct.

```yaml
place_id: il-chicago
name: Chicago
state: IL
county_fips: "17031"
census_place: "1714000"          # only tracts inside the city
peer_group: cbsa:16980
coverage_tier: parcel
proximity_decay_mi: [0.25, 1.0]

sources:
  permits:
    connector: socrata
    domain: data.cityofchicago.org
    dataset: ydr8-5enu
    since_months: 24
    fields:
      permit_id: permit_
      issued: issue_date
      permit_type: permit_type
      work_type: work_type
      text: work_description
      cost: reported_cost
      parcel_ids: pin_list
      lat: latitude
      lng: longitude
      address: [street_number, street_direction, street_name]   # joined with spaces
      tract_hint: census_tract
    parcel_id_format: { pad_right: "0000", length: 14 }         # 10-digit PIN -> 14
    normalize_dashes: true
    units:
      field: residential_unit_change
      from_text: { hook: custom.units_from_text }
    classes:
      new_mf: { permit_type: "PERMIT - NEW CONSTRUCTION", min_units: 5 }
      major_mep:
        any_of:
          - permit_type: "PERMIT - EXPRESS PERMIT PROGRAM"
            work_type: ["Electrical Work", "Plumbing Work", "Mechanical Work"]
            min_cost: 25000
          - permit_type: "PERMIT - ELEVATOR EQUIPMENT"
      other: { default: true }

  parcels:
    - name: commercial_incl_7plus_apartments
      connector: socrata
      domain: datacatalog.cookcountyil.gov
      dataset: csik-bsws
      latest_year_only: true
      fields: { parcel_id: keypin, year: year, address: address, land_use: class_es, units: tot_units }
    - name: locations
      connector: socrata
      domain: datacatalog.cookcountyil.gov
      dataset: pabr-t5kh
      role: geometry
      fields: { parcel_id: pin, lat: lat, lng: lon }

  catalysts:
    connector: firecrawl
    urls: []
    seed_file: legacy/data/infrastructure.json
```

---

## 2. Standard records

Connectors turn every source into these shapes. Field names are fixed; nothing downstream reads a source's own column names.

### 2.1 StandardPermit

| Field | Type | Notes |
| --- | --- | --- |
| `permit_id` | string | Unique within `place_id` |
| `place_id` | string | |
| `issued_date` | `YYYY-MM-DD` | |
| `address` | string or null | Single line, uppercase as published |
| `lat`, `lng` | number or null | WGS84. Null if the source has no point and geocoding failed |
| `parcel_ids` | string[] | In the assessor's format after `parcel_id_format`. Empty if none |
| `permit_class` | `new_mf` \| `alteration` \| `demolition` \| `roof` \| `major_mep` \| `other` | From the place's `classes` |
| `units` | int or null | Dwelling units added. Null = unknown, which is not the same as 0 |
| `cost` | number or null | Reported cost, USD |
| `description` | string | Source work description, may be empty |
| `source_url` | string | A link a human can open to see this permit or its dataset |

Baseline places have no StandardPermits. Census BPS counts go straight to tract signals (allocated by housing-unit share).

### 2.2 StandardProperty

| Field | Type | Notes |
| --- | --- | --- |
| `parcel_id` | string | Assessor format. Unique within `place_id` |
| `place_id` | string | |
| `address` | string or null | |
| `lat`, `lng` | number or null | Parcel centroid |
| `year_built` | int or null | |
| `year_built_source` | `assessor` \| `county_gis` \| `permit` \| `acs_estimate` \| null | `permit` = earliest new-construction permit on the parcel |
| `units` | int or null | Dwelling units |
| `stories` | number or null | |
| `land_use` | string or null | Source class code, as published |
| `owner_name` | string or null | Only where the public record shows it. No contact details, ever |
| `source` | string | `<connector>:<dataset or name>`, e.g. `socrata:csik-bsws` |

### 2.3 Tract (API shape)

| Field | Type | Notes |
| --- | --- | --- |
| `geoid` | string, 11 digits | 2020 tract |
| `place_id` | string | The place the tract is scored under |
| `name` | string | `"<neighborhood or place> · Tract <number>"` |
| `score` | int 0–100 | Path-of-progress composite |
| `percentile` | int 0–100 | Within `peer_group` |
| `percentile_state` | int 0–100 | Within the state |
| `momentum` | `up` \| `flat` \| `down` | |
| `momentum_pct` | number, 1 decimal | |
| `signals.mf_permits` | int 0–100 or null | Null = signal missing for this tract |
| `signals.permit_momentum` | int 0–100 or null | |
| `signals.infra_proximity` | int 0–100 or null | |
| `permit_count_24mo` | int or null | Null at baseline tier |
| `units_24mo` | int or null | |
| `coverage` | Coverage (§2.4) | |
| `as_of` | `YYYY-MM-DD` | Date of the score snapshot |

### 2.4 Coverage

Every data response carries one. The UI always shows `label`.

```json
{
  "tier": "parcel",
  "signals": { "mf_permits": true, "permit_momentum": true, "infra_proximity": false },
  "signals_present": 2,
  "signals_total": 3,
  "building_age": "parcel",
  "label": "Based on 2 of 3 signals"
}
```

- `building_age`: `parcel` (from properties), `acs` (tract shares only) or `none`.
- A missing signal is left out of the score and its weight is spread proportionally over the present ones (`docs/PLAN.md`, partial-data rule).
- `label` at baseline tier: `"Baseline data only"`.
- On a collection (`/api/tracts`), the top-level `coverage` describes the place, and each feature has its own.

### 2.5 Catalyst

The v1 `Project` shape (`legacy/contract-v1.md` §1.3) plus `place_id`. `source` is required: `firecrawl` or `curated`. `source_url` is shown whenever it is not null.

---

## 3. API

All routes live under `web/app/api/` and return JSON. Errors are `{ "error": "<message>", "code": "<code>" }` with these codes:

| HTTP | `code` |
| --- | --- |
| 400 | `bad_request` |
| 401 | `auth_required` |
| 402 | `payment_required` |
| 404 | `not_found` |
| 409 | `already_entitled` |
| 429 | `limit_reached` |
| 500 | `internal` |

**Access is enforced on the server.** Fields a viewer is not entitled to are left out of the response, never just hidden in the UI. A response that left fields out lists them in `locked: string[]`.

| Viewer | Gets |
| --- | --- |
| Signed out | `/api/places`, `/api/tracts`, catalysts on `/api/tract/[geoid]` |
| Free account | The above, plus permits on `/api/tract/[geoid]`, plus `/api/near` (3 searches per rolling 7 days) |
| Paid (entitlement) | `/api/report` for the purchased target |

The viewer comes from the Supabase Auth session cookie (`@supabase/ssr`).

### 3.1 `GET /api/places`

```json
{
  "places": [
    {
      "place_id": "il-chicago",
      "name": "Chicago",
      "state": "IL",
      "coverage_tier": "parcel",
      "bounds": [-87.94, 41.64, -87.52, 42.02],
      "center": [-87.68, 41.84],
      "tract_count": 796,
      "as_of": "2026-10-30"
    }
  ]
}
```

`bounds` is `[west, south, east, north]`. The map fits to it; the web app never hard-codes a view.

### 3.2 `GET /api/tracts?place_id=<id>`

`place_id` is required (400 without it; 404 if unknown).

```json
{
  "type": "FeatureCollection",
  "place_id": "il-chicago",
  "as_of": "2026-10-30",
  "coverage": { "...": "Coverage, §2.4" },
  "features": [{ "type": "Feature", "properties": { "...": "Tract, §2.3" }, "geometry": { "type": "MultiPolygon", "coordinates": [] } }]
}
```

### 3.3 `GET /api/tract/[geoid]`

```json
{
  "tract": { "...": "Tract, §2.3" },
  "coverage": { "...": "§2.4" },
  "top_permits": [ "StandardPermit, newest first, max 10, classes new_mf + demolition" ],
  "nearby_catalysts": [ "Catalyst + distance_mi, within proximity_decay_mi[1] of the centroid, nearest first" ],
  "locked": ["top_permits"]
}
```

- Signed out: `top_permits` is left out and `locked` is `["top_permits"]`.
- 400 if `geoid` is not 11 digits. 404 if not scored.

### 3.4 `GET /api/near?q=<text>&radius_mi=<n>&place_id=<id>`

- Free account required (401 otherwise).
- `radius_mi` defaults to 0.25, clamped to 0.05–2.
- `place_id` is optional and biases geocoding.
- Each successful call counts one search. The 4th in a rolling 7 days returns 429 with `resets_at`.

```json
{
  "place": { "label": "2400 W DIVISION ST", "lat": 41.9030, "lng": -87.6870, "place_id": "il-chicago" },
  "tract": { "...": "Tract or null" },
  "permits": [ "StandardPermit within radius, newest first, max 25" ],
  "catalysts": [ "Catalyst + distance_mi within radius" ],
  "coverage": { "...": "§2.4" },
  "usage": { "used": 2, "limit": 3, "resets_at": "2026-11-04T18:00:00Z" }
}
```

429 body: `{ "error": "...", "code": "limit_reached", "resets_at": "<ISO>" }`.

### 3.5 `POST /api/report`

Request: `{ "report_type": "area" | "property", "target_id": "<id>" }`

`target_id` takes one of these forms:
- area report on a tract: an 11-digit `geoid`
- area report on a drawn circle: `radius:<lat>,<lng>,<miles>`
- property report: `<place_id>:<parcel_id>`

Responses:
- **200:** the user has an entitlement for exactly this `report_type` and `target_id`.
  ```json
  { "report_id": "<uuid>", "status": "ready" | "building", "pdf_url": "<signed url or null>", "report": { "...": "report JSON, defined in v2.1 with the reports lane" } }
  ```
- **402:** signed in without an entitlement: `{ "error", "code": "payment_required", "preview": { "title", "first_section_markdown" } }`. The UI offers checkout.
- **401:** signed out.

### 3.6 `POST /api/checkout`

Request: `{ "report_type": "area" | "property", "target_id": "<id>" }` (validated as in §3.5).

- **200:** `{ "url": "https://checkout.stripe.com/..." }`. The UI redirects to it. The Stripe Checkout Session carries:
  - `client_reference_id` = Emris user id
  - `metadata` = `{ report_type, target_id }`
  - success and cancel URLs back to the report page
- **401:** signed out.
- **409:** already entitled. The UI goes straight to the report.

### 3.7 `POST /api/stripe/webhook`

Called by Stripe only.

- Verifies the `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET` against the **raw** body. 400 on failure.
- On `checkout.session.completed` with `payment_status: paid`, inserts an `entitlements` row keyed on the Stripe session id. A repeated delivery hits the unique key and does nothing.
- Returns 200 `{ "received": true }` for every verified event, including types it ignores.

### 3.8 v1 routes still in the tree

`/api/tracts`, `/api/tract/[geoid]`, `/api/near` and `/api/memo` in `web/app/api/` still serve the v1 shapes from `legacy/data/` until the database lane replaces them. `/api/ask` (the iMessage agent's route) is removed in v2. The IC memo moves into the area and property reports.

---

## 4. Database

Postgres with PostGIS (Supabase). The schema is `db/migrations/001_init.sql`. Migrations are numbered and append-only. Never edit one that has been applied; add the next number.

- All geometry is SRID 4326.
- Radius and point-in-tract queries run in SQL (`ST_DWithin` on `geography`, `ST_Contains`), not in JavaScript.
- Every pipeline run writes dated rows to `score_snapshots`. "Current" means the newest `as_of` per place.

---

## 5. Environment

One `.env` at the repo root, never committed (`.gitignore` has `.env*`).
- Next.js reads it through the symlink `web/.env.local -> ../.env`.
- The pipeline loads it with `python-dotenv` from the repo root.

| Variable | Used by |
| --- | --- |
| `DATABASE_URL` | pipeline (direct Postgres connection) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | pipeline, server routes (never sent to the browser) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser auth |
| `ANTHROPIC_API_KEY` | IC memo |
| `FIRECRAWL_API_KEY` | catalysts connector |
| `CENSUS_API_KEY` | `acs` connector (optional, raises rate limits) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `/api/checkout`, `/api/stripe/webhook` |

---

## 6. Ownership

| Lane | Owns |
| --- | --- |
| Data + scoring | `pipeline/`, `places/`, `tests/fixtures/` |
| Database + API | `db/`, `web/app/api/` |
| Web app (Cursor) | `web/` except `web/app/api/` |
| Reports + payments | `web/app/api/checkout/`, `web/app/api/report/`, `web/app/api/stripe/` (with the API lane), PDF generation |
| Everyone (through Renee) | `docs/contract.md`, `docs/PLAN.md` |

---

## 7. CI guardrails

`.github/workflows/guardrails.yml` runs on every push and pull request:

1. `scripts/check_place_names.sh` fails if any of these appear as whole words in a tracked file outside `places/`, `tests/fixtures/`, `docs/` and `legacy/` (case-insensitive): `chicago`, `cook`, `illinois`, `dupage`, `lake county`, `will county`, `kane`, `mchenry`.
   - The script itself is exempt.
   - Extend the list as states are added.
2. `python -m pipeline.validate` must pass.
