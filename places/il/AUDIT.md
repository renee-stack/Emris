# Illinois data audit (Day 0)

Checked 2026-10-31 against the live datasets. Every item first marked **VERIFY** was
resolved the same day with live API queries; each answer is marked **Resolved** with its source.

## 1. City of Chicago building permits

- Dataset: `ydr8-5enu` on `data.cityofchicago.org` (Socrata, same one the hackathon `scripts/score.py` uses)
- API: `https://data.cityofchicago.org/resource/ydr8-5enu.json` (SoQL, page with `$limit`/`$offset`)
- Fields confirmed on a live row: `id`, `permit_`, `permit_status`, `permit_milestone`, `permit_type`, `review_type`, `application_start_date`, `issue_date`, `processing_time`, `street_number`, `street_direction`, `street_name`, `work_type`, `work_description`, `reported_cost`, `total_fee`, `contact_1_type` … `contact_N_*`, `pin_list`, `community_area`, `census_tract`, `ward`, `latitude`, `longitude`, `location`
- `residential_unit_change`: **Resolved.** Filled on 94% of recent new construction, but only since 2024 (see below). Use it first and fall back to the text parser.

### residential_unit_change on PERMIT - NEW CONSTRUCTION

Last 24 months (`issue_date >= 2024-10-31`), SoQL counts on `ydr8-5enu`:

| Measure | Permits |
| --- | --- |
| Total | 2,997 |
| Non-null | 2,832 (94%) |
| > 0 | 1,498 (50%) |
| >= 5 (would be `new_mf`) | 213 |

- **Filled only from 2024.** Every new-construction permit from 2006 to 2023 has it null; 2024 and 2025 are 100% filled.
- **Nulls are recent.** All 165 nulls were issued 2026-10-01 to 2026-10-30, so the field looks to be filled in after issue. Re-pull the last month on each run.
- **0 is a real value, not "unknown".** Zero rows are garages and phased permits (caisson-only, foundation-only); the unit count sits on the later full-building permit. For example, a foundation permit for "a 5 story, 72 dwelling unit building" carries 0. Of 1,331 zeros, 42 mention dwelling units or apartments in the text, nearly all phase permits. Counting 0 on phase permits avoids double counting a building, so don't fall back to the text parser when the field is 0.
- Largest values look right: 493, 464, 386, 287, 199 units on full-building permits for high-rises.

### permit_type values (all years, row counts)

| permit_type | rows | Emris class |
| --- | --- | --- |
| PERMIT – EXPRESS PERMIT PROGRAM | 326,498 | split by `work_type`, see below |
| PERMIT - EASY PERMIT PROCESS | 207,651 | other (mostly pre-2024) |
| PERMIT - RENOVATION/ALTERATION | 168,306 | `alteration` |
| PERMIT - SIGNS | 55,297 | other |
| PERMIT - NEW CONSTRUCTION | 32,158 | `new_mf` when units >= 5 |
| PERMIT - ELEVATOR EQUIPMENT | 22,458 | `major_mep` (candidate) |
| PERMIT - WRECKING/DEMOLITION | 22,015 | `demolition` (suggest adding this class) |
| PERMIT - SCAFFOLDING | 8,965 | other |
| PERMIT - REINSTATE REVOKED PMT | 5,387 | other |
| PERMIT - PORCH CONSTRUCTION | 3,096 | other |
| PERMIT - FOR EXTENSION OF PMT | 58 | other |

### Express Permit Program work_type values (2024 to date, top)

Electrical Work 16,322 · Masonry Work 5,619 · Small-Scale Solar PV System 5,595 · Administrative Change 5,128 · Monthly Maintenance Permit 4,301 · Fire Alarm System 3,419 · **Reroofing 3,126** · Nonstructural Interior Work 2,880 · Fence or Trash Enclosure 2,763 · Detached Frame Garage 2,004 · **Plumbing Work 1,987** · Porch/Deck/Balcony/Fire Escape 1,351 · Other Work 1,225 · **Mechanical Work 1,192** · Exterior Windows/Doors Replacement 879

Suggested mapping: Reroofing → `roof`; Electrical, Plumbing, Mechanical → `major_mep` only above a cost floor (many are one-outlet jobs). Starting floor in config: `reported_cost >= 25000` (Renee to tune).

### Gotchas

1. **Two different dashes.** The Express Program label uses an en dash (`PERMIT – EXPRESS`), every other type uses a hyphen (`PERMIT - NEW`). Match on the exact strings in config, or normalize dashes in the connector.
2. **PIN length.** `pin_list` holds 10-digit PINs (e.g. `1314431007`); the Assessor uses 14 digits. Pad with `0000` to join. `pin_list` can hold several PINs.
5. **How far back.** The dataset starts 2006-01-03 (all permit types and new construction alike), so permits can't date anything built before 2006.
3. **census_tract is already on each permit** (6-digit tract code, county implied 17031). Useful as a cross-check on the spatial join.
4. Unit counts live mostly in `work_description` free text. Reuse the hackathon parser `scripts/units.py` as a custom hook referenced from config.

## 2. Cook County Assessor (datacatalog.cookcountyil.gov, Socrata)

| Dataset | ID | Covers | Key fields | Updates |
| --- | --- | --- | --- | --- |
| Residential Single and Multi-Family Improvement Characteristics | `x54s-btds` | Residential buildings with fewer than 7 units, one row per building (`card`) per year, 1999 to 2026 | `pin`, `year`, `card`, `char_yrblt` (year built), `char_apts` (units, see below), `class`, `township_code` (44 columns) | Semi-monthly |
| Commercial Valuation Data | `csik-bsws` | Commercial properties incl. 7+ unit apartments, 2021 to 2025 | `keypin`, `pins`, `year`, `address`, `class_es`, `sheet`, `tot_units`, `studiounits`, `_1brunits` … `_4brunits`, **`yearbuilt`**, `stories` (76 columns) | Annually |
| Residential Condominium Unit Characteristics | `3r7i-mrz4` | Condo units, one row per unit PIN | `pin`, `pin10`, `year`, `char_yrblt`, `char_building_pins`, `char_building_non_units` (25 columns) | |
| Parcel Universe (Current) | `pabr-t5kh` | Every Cook County parcel | `pin`, `lat`, `lon` (parcel centroid) + 120 geographic fields | Current year |
| Parcel Universe (Historical) | `nj4t-kc8j` | Same, all years | same | |

**Year built for 7+ unit buildings: Resolved, no gap.** The data page doesn't show it, but the full column list (`/api/views/csik-bsws.json`) ends with `yearbuilt`. Fill rate on rows with `tot_units >= 7`:

| Assessment year | Triad | Rows | `yearbuilt` filled | Range |
| --- | --- | --- | --- | --- |
| 2021 | City | 2,021 | 2,005 | 1866 to 2021 |
| 2022 | North | 216 | 213 | 1921 to 2022 |
| 2023 | South/West | 2,136 | 2,129 | 1855 to 2023 |
| 2024 | City | 10,324 | 10,320 (3 below 1800, incl. `0`) | up to 2025 |
| 2025 | North (partial so far) | 169 | 169 | 1930 to 2025 |

12,817 distinct `keypin`s with 7+ units. Values come as text with a decimal (`"1908.0"`); treat `< 1800` as null.

Gotchas for the connector:
1. **One triad per year.** Cook reassesses a third of the county each year (City 2021 and 2024, North 2022 and 2025, South/West 2023). `latest_year_only` must mean newest year *per parcel*, not the newest year in the file, or the suburbs drop out.
2. **PIN format.** `keypin` and `pins` are dashed (`20-03-111-016-0000`); `x54s-btds` and `pabr-t5kh` use 14 bare digits (`14083170170000`). Strip dashes to join.
3. **Multi-PIN buildings.** `pins` lists every PIN in the building, comma-separated (2,594 of the 7+ unit rows). Join on `keypin`; use `pins` to tie permits on secondary PINs back to the building.
4. `stories` is almost empty (20 of 14,866 rows). Don't map it.

The fallback isn't needed: `x54s-btds` (fewer than 7 units) and condos (`3r7i-mrz4`, its own `char_yrblt`) don't carry these PINs, and permits start in 2006 (section 1). Keep "earliest NEW CONSTRUCTION permit on the PIN" only for the few rows with no `yearbuilt` built since 2006 (`year_built_source: permit`); match `pin_list` padded with `0000` against `keypin` with dashes stripped.

**Units in `x54s-btds`: Resolved.** The field is `char_apts`, and it is a **word, not a number**. 2025 counts: `None` 932,563 (single-family; read as 1), `Two` 96,832, `Three` 35,792, `Four` 14,755, `Five` 3,236, `Six` 11,031, null 8,838. It is filled for classes 211 and 212 (2 to 6 unit apartments). The connector needs a word-to-number map; the schema has no value-map key yet. There is one row per building `card`, so sum over cards for a PIN.

## 3. Collar counties

| County | Source | Year built? | Tier we can support today |
| --- | --- | --- | --- |
| DuPage | ArcGIS `gis.dupageco.org/arcgis/rest/services/Tyler/ParcelsRealEstateCCWGS84SR4326/MapServer/0` (also an open data hub) | **No.** 84 fields: PIN (10 char), property address, PROPCLASS, values, owner billing name; no year built or units | Baseline + parcels without age |
| Lake | ArcGIS `maps.lakecountyil.gov/arcgis/rest/services/GISMapping/WABParcels/MapServer/12` ("Tax Parcel Information", 215 fields, 279,079 parcels) | **Yes, residential only. No units.** See below | `county_gis` |
| Will | ArcGIS `gis.willcountyillinois.com/server/rest/services/Eagleview/Parcels_25/MapServer/0` (27 fields) | **No.** PIN, tax code, `Property_Class`, `Equalized_Value`, site address; no year built or units. The `ParcelFabric` and `Basemap/Parcels_LY` services need a token | Baseline |
| Kane | ArcGIS `gistech.countyofkane.org/arcgis/rest/services/KanePINList/MapServer/0` (`Kane.DBO.Parcels_v2025`, 49 fields, 187,438 parcels) | **No.** PIN, `UseCode`/`UseCodeDescription`, site and mailing address, tax districts; no year built or units | Baseline |
| McHenry | No county open data found; only paid resellers. `mchenrycountygis.org/.../parcelsfull/MapServer/0` returned no JSON, and an ArcGIS Online `Parcels` layer needs a token | Not found | Baseline |

**Lake details (Resolved).** Fields on `WABParcels/MapServer/12`:
- `PIN` (10 characters), `situs_addr_line_1`, `INSIDE_X` / `INSIDE_Y` (already lon/lat in WGS84)
- `improve_year_built`, `improve_eff_year_built`, `stories` (text, e.g. `2 STORY`)
- `prop_class_pardat` (`RES`, `COM` …), `land_use_code` (e.g. `40-Residential Improvements`), `taxpayer_name`
- No units field. `housetypecode` holds undocumented numeric style codes, not unit counts.

Year built is filled on 216,928 of 222,587 parcels coded `40-Residential Improvements` (97%), but only 413 of 8,525 `60-Commercial Improvements` (5%). Larger apartment complexes are usually assessed as commercial, so Lake's Wayback will mostly cover houses, townhomes and small multifamily. Max 1,000 records per query, so page with `resultOffset`.

**DuPage, rechecked:** 96 fields now, still no year built or units (`PROPAPT` and `BILLAPT` are address apartment numbers, not counts). With no year built or units, the layer can't feed Wayback, so DuPage drops to `baseline` (section 6).

Takeaway: outside Cook County only Lake publishes year built, and only for residential parcels. Plan for Wayback to fall back to ACS tract-level age shares everywhere else. Paid parcel data (Regrid, ReportAll) is the upgrade path, not a Day 1 task.

## 4. Census Building Permits Survey (baseline permits, every US place)

- `https://www.census.gov/construction/bps/` → place-level comma-delimited text files, monthly and annual
- Columns are grouped by building size (1 unit, 2 units, 3–4 units, **5+ units**), each with buildings, units and value
- Reported by permit-issuing place (town or county), **not by tract**: allocate to tracts by each tract's share of the place's housing units (ACS `B25001`)
- **Resolved: file pattern.** Files sit in one folder per Census region; Illinois is in the Midwest:
  - Annual: `https://www2.census.gov/econ/bps/Place/Midwest%20Region/mw{year}a.txt`, 1980 to 2025. `mw2025a.txt` was posted 2026-05-14 (1.1 MB, 995 Illinois rows).
  - Monthly: `mw{yymm}c.txt` (that month) and `mw{yymm}y.txt` (year to date), latest `mw2609`. These use a **2-digit** year, which the schema's `{yyyymm}` placeholder can't express, so `_state.yaml` uses the annual file.
- **Resolved: layout.** Comma-delimited, **two header rows** then one blank row, then data. Fields are space-padded. 41 columns:
  - 1 to 17: `Survey Date`, `State Code`, `6-Digit ID`, `County Code`, `Census Place Code`, `FIPS Place Code`, `FIPS MCD Code`, `Pop`, `CSA Code`, `CBSA Code`, `Footnote Code`, `Central City`, `Zip Code`, `Region Code`, `Division Code`, `Number of Months Rep`, `Place Name`
  - 18 to 29: `Bldgs`, `Units`, `Value` for each of `1-unit`, `2-units`, `3-4 units`, `5+ units` (imputed totals)
  - 30 to 41: the same 12 again, `… rep`: reported only, without imputation
- Join to Census places on `State Code` + `FIPS Place Code` (e.g. `17` + `14000` = `1714000`). `FIPS Place Code` `99990` is a county's unincorporated area (e.g. "Boone County Unincorporated Area").
- A place appears once, under one `County Code`, even if it spans counties (Chicago is `031`).
- 160 of 995 Illinois places reported 0 months in 2025, so their numbers are fully imputed. Use columns 18 to 29, not the `rep` set.
- Example: Chicago 2025, 5+ units = 103 buildings, 2,899 units, $709.0M.

## 5. ACS 5-year (baseline age profile, every US tract)

- `B25001_001E` total housing units
- `B25034` Year structure built: `_001E` total, `_002E` 2020 or later, `_003E` 2010–2019, `_004E` 2000–2009, `_005E` 1990–1999, `_006E` 1980–1989, `_007E` 1970–1979, `_008E` 1960–1969, `_009E` 1950–1959, `_010E` 1940–1949, `_011E` 1939 or earlier
- Rehab age band (1976 to 2001) approximated as `_005E + _006E + half of _007E`

## 6. What each Illinois place can support today

| Place | Coverage tier | Missing |
| --- | --- | --- |
| Chicago (`chicago.yaml`) | parcel | Units before 2024 come from permit text only (see 1) |
| Suburban Cook County (`cook-suburban.yaml`) | parcel_partial | Permit detail (municipal permits not open); use Census BPS counts |
| DuPage (`dupage.yaml`) | baseline | Year built, units (county layer has neither, see 3) |
| Lake (`lake.yaml`) | county_gis | Units; year built for commercial-class apartments (see 3) |
| Will (`will.yaml`), Kane (`kane.yaml`) | baseline | Year built, units (county layers have neither, see 3) |
| McHenry (`mchenry.yaml`) and rest of state | baseline | Parcel data |

## Sources

- Chicago permits: live API queries on `ydr8-5enu`, 2026-10-31
- Cook County column lists: `https://datacatalog.cookcountyil.gov/api/views/<id>.json` for `csik-bsws`, `x54s-btds`, `3r7i-mrz4`, `pabr-t5kh`, plus SoQL counts, 2026-10-31
- [Cook County Residential Condominium Unit Characteristics](https://datacatalog.cookcountyil.gov/d/3r7i-mrz4)
- [Cook County Commercial Valuation Data](https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Commercial-Valuation-Data/csik-bsws)
- [Cook County Residential Improvement Characteristics](https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Residential-Single-and-Multi-Family-Impro/x54s-btds)
- [Cook County Parcel Universe (Current)](https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Parcel-Universe-Current-/pabr-t5kh)
- [ACS B25034 variables](https://api.census.gov/data/2023/acs/acs5/groups/B25034.json)
- [Census Building Permits Survey](https://www.census.gov/construction/bps/), [Midwest place files](https://www2.census.gov/econ/bps/Place/Midwest%20Region/)
- [DuPage parcels layer](https://gis.dupageco.org/arcgis/rest/services/Tyler/ParcelsRealEstateCCWGS84SR4326/MapServer/0)
- [Lake County open data](https://data-lakecountyil.opendata.arcgis.com/), [Will County GIS data](https://willcounty.gov/County-Offices/Administration/GIS-Division/Data)
- [Lake tax parcel information layer](https://maps.lakecountyil.gov/arcgis/rest/services/GISMapping/WABParcels/MapServer/12)
- [Will parcels 2025 layer](https://gis.willcountyillinois.com/server/rest/services/Eagleview/Parcels_25/MapServer/0), [Will portal search](https://gis.willcountyillinois.com/portal/sharing/rest/search?q=parcels%20AND%20access:public&f=json)
- [Kane parcels layer](https://gistech.countyofkane.org/arcgis/rest/services/KanePINList/MapServer/0)
