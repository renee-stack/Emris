# Emris v2: 7-Day Build Plan

Oct 31, 2026 · @Renee

## Summary

In 7 days, Emris goes from a one-city demo to a system that can load any US place from configuration, starting with all of Illinois. It adds a 50-year **Wayback** view of what was built where (to find rehab candidates), and sells **paid reports** on top of a free map, the way Crexi gates its deeper data.

The hackathon build taught three things this plan fixes:

- **Chicago was hard-coded everywhere.** Scoring, geocoding, neighborhood names and permit parsing all assumed one city. v2 makes every place a config entry.
- **Static files won't scale.** One GeoJSON per city works for 800 tracts, not 20,000 across ten metros. v2 moves to Postgres + PostGIS, the stack already in the original architecture.
- **The free tool needs a paid layer.** Map and scores stay free to build trust. Property-level history, rehab scoring and the IC memo become the paid report.

**7-day goal:** all of Illinois loaded and scored at the deepest level each area's data allows, Wayback working wherever year-built data exists, a paid report a stranger can buy with a test card, and on Day 7 a second state added by config alone, to prove nothing is hard-coded.

## What to recalculate

The score itself can stay, but six assumptions in it only held because Chicago was the only city.

| What changes | Hackathon version | v2 version | Why |
| --- | --- | --- | --- |
| Percentile rank | Across all Chicago tracts | Within a configurable peer group (default: the metro area; rural counties grouped statewide), plus a statewide percentile | A 70 in Austin and a 70 in Chicago must mean the same thing: top 30% of their own market |
| Multifamily permit definition | Regex on Chicago description text for "DWELLING UNITS" | Each place's config maps its own permit types and unit field to one standard: new construction, 5+ units | Every city labels permits differently; some have a units field, some only text |
| Permit volume | Raw time-decayed count | Count per 1,000 existing housing units (ACS) | Big tracts and dense cities would otherwise always win |
| Momentum | Last 12 months vs prior 12 | Same, plus a minimum-activity floor and a pull toward the metro median for low-count tracts (keep your v2 fix) | Prevents a tract going from 1 to 3 permits from reading as +200% |
| Infrastructure proximity | Hand-curated list, fixed 0.25 to 1 mi decay | Firecrawl-extracted list per place; decay distance set in each place's config (tighter in dense cities, wider in sprawl metros) | A quarter mile means different things in Chicago and Phoenix |
| Geography | 2020 tracts in Chicago city limits | 2020 tracts statewide, loaded from config, so suburbs and small cities count | Developers chase suburban growth too |

**New signals to add now that the data model supports them:**

- **Building age profile** (from Wayback): share of a tract's multifamily stock built 1975 to 2000. Feeds the rehab view, kept out of the path-of-progress score at first.
- **Data completeness** per tract: which signals are present. This answers your open architecture question on partial data. A missing signal is excluded and its weight redistributed, and the UI shows "based on 2 of 3 signals."

**Re-validate the weights** (0.45 / 0.30 / 0.25) once all of Illinois is loaded and scored. A simple backtest: score each tract as of 2022 using only data available then, and check whether high scorers saw above-median permit or rent growth by 2025. That one chart is also your strongest pitch slide.

## Stronger scaffolding

Adding a place, whether an Illinois county or a city in another state, should mean writing a config file, not code. Illinois is simply the first set of configs loaded; no code path names a city, county or state.

&#91;embedded content: Emris v2 architecture · connectors and place configs, shared pipeline, one database, 4 consumers\]

The highlighted row is the only per-place work, and almost all of it is config. Everything below it runs the same for every place.

**The adapter contract** (Python; the hackathon's `contract.md` grows into this):

```yaml
# places/il/chicago.yaml  (field names in <> are filled in on Day 1)
place_id: il-chicago
state: IL
county_fips: "17031"
census_place: "1714000"
peer_group: cbsa:16980          # percentile group
coverage_tier: parcel
proximity_decay_mi: [0.25, 1.0]
sources:
  permits:
    connector: socrata
    domain: data.cityofchicago.org
    dataset: <permits dataset id>
    fields: { issued: <field>, address: <field>, lat: <field>, lng: <field>, text: <field> }
    units: { from_text: '(\d+)\s+DWELLING UNITS' }
    classes:
      new_mf: { permit_type: <value>, min_units: 5 }
      alteration: { permit_type: <value> }
  parcels:
    connector: socrata
    domain: datacatalog.cookcountyil.gov
    dataset: x54s-btds
    fields: { pin: <field>, year_built: <field>, units: <field> }
  catalysts:
    connector: firecrawl
    urls: [ ... ]
```

```python
class Connector(Protocol):   # one per source TYPE, never per place
    kind: str                # socrata | arcgis | csv | shovels | census_bps | firecrawl
    def fetch(self, cfg: SourceConfig, since: date | None) -> Iterable[dict]: ...
```

**Three layers, so code never names a place**

1. **Connectors**, one per source type (Socrata, ArcGIS, CSV, Shovels, Census, Firecrawl). Written once, reused by every place that publishes that way.
2. **Place configs**, one YAML per county or city, validated against a schema on load. A typo fails loudly instead of silently scoring wrong.
3. **Custom hooks**, rare Python functions referenced from a config for feeds no connector handles. They must pass the same fixture tests.

**A guardrail in CI:** the build fails if a place name like "chicago", "cook" or "illinois" appears anywhere outside `places/` and `tests/fixtures/`. That turns "nothing hard-coded" from an intention into a rule the agents can't break.

**Repo layout**

```
emris/
  pipeline/
    connectors/      socrata.py  arcgis.py  csv.py  shovels.py  census_bps.py  firecrawl.py
    core/            ingest.py  normalize.py  link.py  score.py  rehab.py  publish.py
    custom/          rare hooks, referenced from config
  places/
    _schema.py       validates every config
    il/              _state.yaml  chicago.yaml  cook-suburban.yaml  dupage.yaml  ...
  tests/fixtures/    sample rows per place
  db/migrations/
  web/               Next.js app + API routes
```

**What makes it sturdier than the hackathon build**

- **One database instead of static files.** Hosted Postgres with PostGIS (Supabase is the fastest path, and its auth covers login too). Radius and point-in-tract queries run in the database, not in JavaScript.
- **Dated score snapshots.** Every run writes `score_snapshots` with a date, which gives you momentum history, "score over time" charts in paid reports, and the backtest.
- **Contract tests per adapter.** Each adapter must turn its fixture rows into valid standard records before it can merge. A broken city feed fails one test, not the demo.
- **Pipeline runs as a scheduled job** (a GitHub Action or a cron on Railway) instead of by hand, so data refreshes nightly.
- **Same agent split as the hackathon** (data, API, UI), plus a lane for payments and reports.

## Data sources

Use free city and county open data for the hackathon, and treat paid national feeds as the post-hackathon upgrade path. No single free source covers every US city, which is exactly why the adapter model matters.

| Need | Free source (hackathon) | Paid national option (later) | Watch out for |
| --- | --- | --- | --- |
| Building permits | City open data portals (Socrata/ArcGIS): Chicago, NYC DOB, LA, Seattle, Austin, SF | [Shovels](https://sacra.com/c/shovels/): 178M+ permits, 2,770+ jurisdictions, \~85% of US population; free tier 500 records/month, paid from $599/month | Unit counts are often in free text, not a field |
| Year built, units (Wayback) | NYC [PLUTO](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/PLUTODD.pdf): YearBuilt, YearAlter1/2, UnitsRes, NumFloors, OwnerName. Cook County [Assessor improvement characteristics](https://catalog.data.gov/dataset/assessor-single-and-multi-family-improvement-characteristics) (updated semi-monthly) | [Regrid](https://app.regrid.com/pages/parcels) parcels: owner on Basic; land use, footprints, vacancy on Premium; bulk licenses $25K to $65K/year | Cook County's residential file covers only buildings under 7 units; 7+ unit apartments sit in the Assessor's commercial data. Chicago's [building footprints](https://data.cityofchicago.org/d/hz9b-7nh8) have stories and status but no year built |
| Tract boundaries, housing stock, demographics | Census TIGER tracts + ACS 5-year (free API) | n/a | ACS lags about 2 years |
| Infrastructure catalysts | Firecrawl extraction from transit agency, city capital plan and local news pages | Same, at higher volume | Needs human QA on status and location |
| Geocoding | US Census Geocoder | Mapbox or Google | Census Geocoder is slow in bulk; cache results |

**Illinois first, at the depth each area's data allows.** Places publish very different amounts of open data, so each config declares a coverage tier and the UI says which tier it is showing.

| Tier | Illinois examples | Permits | Year built and units | What users get |
| --- | --- | --- | --- | --- |
| Parcel level | Chicago | City permits with addresses | Cook County Assessor | Tract scores, named properties, full Wayback |
| Parcel, partial permits | Suburban Cook County | Shovels where covered, else Census Building Permits Survey counts by town | Cook County Assessor | Tract scores, Wayback, permit detail where available |
| County GIS | DuPage, Lake, Will, Kane, McHenry | Shovels or the Census survey | County parcel GIS where it carries year built (check each on Day 1) | Tract scores, Wayback where available |
| Baseline | Rest of the state | Census Building Permits Survey (units authorized by town, including 5+ unit buildings) | ACS year-built shares by tract | Tract-level scores only |

The baseline tier runs on free federal data that exists for every US county. Any new state loads at least at that level on its first day, then deepens as county and city configs are added.

## Wayback: 50 years of building, and what needs a rehab

Wayback is a time slider from 1976 to today that shows what was built where, and flags multifamily buildings old enough to need work but sitting in areas that are now improving. That pairing, an aging building on a rising path of progress, is the value-add thesis.

**What the user sees**

1. A decade slider on the map (1976, 1986, 1996, 2006, 2016, today). Moving it fades in buildings by year built, so you watch a neighborhood fill in.
2. A "Rehab candidates" toggle that highlights qualifying buildings in orange.
3. Click a building: year built, units, stories, last major alteration permit, years since that permit, and the tract's current Emris score.

**Rehab candidate score (0 to 100), first version**

| Factor | Rule | Weight |
| --- | --- | --- |
| Age | Built 1976 to 2001 (25 to 50 years old); peaks around 35 to 45 years | 35% |
| Time since last major permit | No alteration, rehab or major mechanical permit in 15+ years | 30% |
| Multifamily size | 5+ units; more weight for 20 to 150 units, the typical value-add range | 15% |
| Location momentum | The tract's path-of-progress score | 20% |

These weights are a starting point for you to tune with your own underwriting judgment, the same way you corrected the v1 top 15.

**How the data fits together**

- One `properties` table per parcel: parcel ID, address, point, year built, year altered, units, stories, land use, owner (where public).
- One `permits` table, linked to `properties` by parcel ID when the permit record has one, otherwise by normalized address.
- "Last major permit" = the newest permit classed as alteration, renovation, or major mechanical, electrical, plumbing or roofing. Each place's config maps its own permit types into those classes.

**Free vs paid split:** the slider and tract-level age shading are free. The list of named rehab candidates, with addresses, owners and permit history, is paid (next section).

## Paid reports

Without an account, visitors can only look at the map and tract scores; everything else needs a free account, and anything at the level of a specific property or a decision-ready document is paid. Sell two report types, one-off first, subscription after.

|  | Free, no account | Free account | Paid report (one-off) | Pro subscription (after hackathon) |
| --- | --- | --- | --- | --- |
| Tract scores, map, catalyst pins | Yes | Yes | Yes | Yes |
| Wayback slider, tract age shading | No | Yes | Yes | Yes |
| Search + nearby permits | No | 3 a week | Yes | Yes |
| Permit addresses and descriptions | No | Yes | Yes | Yes |
| Named rehab candidates with owner + permit history | No | Blurred list | Yes, for the report's area | Yes, all places |
| IC memo (PDF) | No | Preview of first section | Yes | Unlimited |
| Watchlists + email alerts | No | 1 area | No | Yes |

The blurred rehab list is enforced on the server. A free account receives the count and the first row only. The other rows are never sent. A signed-out visitor does not receive the list.

These people use the columns above:

| Person | Column |
| --- | --- |
| Signed out | Free, no account |
| Free account | Free account. Search is 3 in a rolling 7 days. Alerts are 1 area. |
| Free account that has already used 3 searches | Free account, and the next search is refused until the window resets |
| One-off report buyer | Paid report, and only for the report they bought |
| Pro, a founding member, a team owner, or a team member, while the subscription is trialing, active, canceled but still inside the paid period, or past due inside the 7-day grace period | Pro subscription |
| The same person after a failed payment is past the 7-day grace period | Free account |

Pro, founding, and team are the same paid column. Founding memberships are capped at 25. A team plan includes 5 seats. The owner and each member have the Pro column. A one-off purchase does not include every place, export, or alerts.

**Two reports**

1. **Area report** (a tract or a drawn radius): score history and momentum, every multifamily permit in 24 months, catalysts with sources, building age profile, top 10 rehab candidates, comparable tracts in the same metro, and the IC memo.
2. **Property report** (one address): year built, units, alteration history, all permits on the parcel, rehab score with each factor explained, owner of record where public, the surrounding tract's path-of-progress story, and the IC memo framed around that property.

**Price:** an open decision for you. Test one price point per report during the hackathon (Stripe makes changing it a dashboard setting), and ask judges and developers what they'd pay.

**How purchase works**

1. A signed-in user clicks "Get full report" on a tract or property.
2. The Emris API creates a Stripe Checkout session (test mode during the hackathon) with the Emris user ID as `client_reference_id` and the report type and target in metadata.
3. Stripe calls Emris's webhook (`/api/stripe/webhook`, signature verified). It records the purchase in an `entitlements` table, keyed on the Stripe session ID so a repeated webhook never double-records.
4. Emris builds the report, renders the PDF and emails the link.
5. The report page checks entitlements on the server. Paid fields never reach users without access; blurring in CSS alone is easy to bypass.

**Why this way:** everything lives in code and accounts you own: Stripe holds payments and products, Emris's Postgres holds who bought what. Nothing to migrate later.

**Accounts:** Supabase Auth (email magic link), which comes with the database. Users live in Emris's own Postgres from day one. Enforce the 3-searches-a-week limit in the Emris API against the user ID, not in the browser.

## 7-day schedule

The order is data first, product second, proof last: Illinois must be scored end to end by the end of Day 3, features freeze after Day 5, and Day 7 adds a second state with config only.

&#91;embedded content: 7-day plan · 5 workstreams, 2 gates, portability test on Day 7\]

**How to split the agents** (same pattern as the hackathon, each in its own git worktree):

- **Data + scoring:** connectors, Illinois configs, linking, scoring, rehab score, backtest, Firecrawl catalysts. Owns `pipeline/` and `places/`.
- **Database + API:** schema, migrations, place-aware routes, report API. Owns `db/` and `web/app/api/`.
- **Web app (Cursor):** map for any place, Wayback slider, rehab view, report pages. Owns `web/` outside the API.
- **Reports + payments:** auth, Stripe Checkout and webhook, entitlements, PDF generation.

**Day 1 starts with the contract, as before:** the place config schema, the standard permit and property records, and the API shapes, committed before any agent builds. **Day 7's test:** pick a state (a different one from Illinois), write its `_state.yaml` plus one city config, run the pipeline, and show it on the map without touching code. If anything in code has to change, that is the bug list for after the hackathon.

## Risks and open decisions

| Risk | Likelihood | Fallback |
| --- | --- | --- |
| A county's data is missing year built or units | High | Load that county without Wayback and show "based on 2 of 3 signals" honestly |
| Linking permits to parcels by address is messy | High | Match on parcel ID where the city provides it; accept a match rate under 100% and show it |
| Scope creep across three big features | High | Day 5 cutoff: whatever isn't working is cut, not patched |
| Payments bugs in the demo | Medium | Stripe test mode only; one rehearsed purchase path |
| Firecrawl extraction errors (wrong status or place) | Medium | Human QA step per place; source link always shown |
| Owner names on paid reports | Low | Show only what public records already show, with the source; no contact details |

**Decisions only you can make**

- [ ] Which second state to load on Day 7 as the portability test
- [ ] Report prices to test
- [ ] Rehab score weights after reviewing the first Chicago list
- [ ] The partial-data rule above (exclude and reweight) as the official answer to your open architecture question
