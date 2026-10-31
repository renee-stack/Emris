# Illinois data audit (Day 0)

Checked 2026-10-31 against the live datasets. Save as `places/il/AUDIT.md`.
Items marked **VERIFY** still need a check by an agent with network access.

## 1. City of Chicago building permits

- Dataset: `ydr8-5enu` on `data.cityofchicago.org` (Socrata, same one the hackathon `scripts/score.py` uses)
- API: `https://data.cityofchicago.org/resource/ydr8-5enu.json` (SoQL, page with `$limit`/`$offset`)
- Fields confirmed on a live row: `id`, `permit_`, `permit_status`, `permit_milestone`, `permit_type`, `review_type`, `application_start_date`, `issue_date`, `processing_time`, `street_number`, `street_direction`, `street_name`, `work_type`, `work_description`, `reported_cost`, `total_fee`, `contact_1_type` … `contact_N_*`, `pin_list`, `community_area`, `census_tract`, `ward`, `latitude`, `longitude`, `location`
- `residential_unit_change` is selected by the hackathon code but was empty on the sampled row: **VERIFY** how often it is filled for new construction.

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
3. **census_tract is already on each permit** (6-digit tract code, county implied 17031). Useful as a cross-check on the spatial join.
4. Unit counts live mostly in `work_description` free text. Reuse the hackathon parser `scripts/units.py` as a custom hook referenced from config.

## 2. Cook County Assessor (datacatalog.cookcountyil.gov, Socrata)

| Dataset | ID | Covers | Key fields | Updates |
| --- | --- | --- | --- | --- |
| Residential Single and Multi-Family Improvement Characteristics | `x54s-btds` | Residential buildings with fewer than 7 units, one row per building per year, 1999 to present | `pin`, `year`, `char_yrblt` (year built), `class`, `township_code`. Units field not confirmed: **VERIFY** (likely an apartments-count field) | Semi-monthly |
| Commercial Valuation Data | `csik-bsws` | Commercial properties incl. 7+ unit apartments, 2021 to present | `keypin`, `year`, `address`, `class_es`, `sheet`, `tot_units`, `studiounits`, `_1brunits` … `_4brunits` | Annually |
| Parcel Universe (Current) | `pabr-t5kh` | Every Cook County parcel | `pin`, `lat`, `lon` (parcel centroid) + 120 geographic fields | Current year |
| Parcel Universe (Historical) | `nj4t-kc8j` | Same, all years | same | |

**Biggest gap: year built for 7+ unit buildings.** `csik-bsws` has unit counts but no year built field on its data page. **VERIFY** in this order:
1. Check the full column list of `csik-bsws` (76 columns) for any age or year-built field.
2. Check whether `x54s-btds` or the condo characteristics dataset (`3r7i-mrz4`) carries those PINs.
3. Fallback: the earliest new-construction permit on the PIN in `ydr8-5enu` (permits data reaches back decades), or ACS tract shares.

## 3. Collar counties

| County | Source | Year built? | Tier we can support today |
| --- | --- | --- | --- |
| DuPage | ArcGIS `gis.dupageco.org/arcgis/rest/services/Tyler/ParcelsRealEstateCCWGS84SR4326/MapServer/0` (also an open data hub) | **No.** 84 fields: PIN (10 char), property address, PROPCLASS, values, owner billing name; no year built or units | Baseline + parcels without age |
| Lake | Open data hub `data-lakecountyil.opendata.arcgis.com` + Tax Parcel Viewer | **VERIFY** | Baseline until checked |
| Will | GIS Division shapefile downloads; a third-party mirror lists year built in county building data | **VERIFY** in the county's own files | Baseline until checked |
| Kane | County GIS + historic parcel viewer | **VERIFY** | Baseline |
| McHenry | No county open data found; only paid resellers | Unlikely | Baseline |

Takeaway: outside Cook County, plan for Wayback to fall back to ACS tract-level age shares. Paid parcel data (Regrid, ReportAll) is the upgrade path, not a Day 1 task.

## 4. Census Building Permits Survey (baseline permits, every US place)

- `https://www.census.gov/construction/bps/` → place-level comma-delimited text files, monthly and annual
- Columns are grouped by building size (1 unit, 2 units, 3–4 units, **5+ units**), each with buildings, units and value
- Reported by permit-issuing place (town or county), **not by tract**: allocate to tracts by each tract's share of the place's housing units (ACS `B25001`)
- **VERIFY** the exact file name pattern and column header layout for the latest year

## 5. ACS 5-year (baseline age profile, every US tract)

- `B25001_001E` total housing units
- `B25034` Year structure built: `_001E` total, `_002E` 2020 or later, `_003E` 2010–2019, `_004E` 2000–2009, `_005E` 1990–1999, `_006E` 1980–1989, `_007E` 1970–1979, `_008E` 1960–1969, `_009E` 1950–1959, `_010E` 1940–1949, `_011E` 1939 or earlier
- Rehab age band (1976 to 2001) approximated as `_005E + _006E + half of _007E`

## 6. What each Illinois place can support today

| Place | Coverage tier | Missing |
| --- | --- | --- |
| Chicago | parcel | Year built for 7+ unit buildings (see 2) |
| Suburban Cook County | parcel_partial | Permit detail (municipal permits not open); use Census BPS counts |
| DuPage | county_gis | Year built, units |
| Lake, Will, Kane | baseline (upgrade after VERIFY) | Unconfirmed |
| McHenry and rest of state | baseline | Parcel data |

## Sources

- Chicago permits: live API queries on `ydr8-5enu`, 2026-10-31
- [Cook County Commercial Valuation Data](https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Commercial-Valuation-Data/csik-bsws)
- [Cook County Residential Improvement Characteristics](https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Residential-Single-and-Multi-Family-Impro/x54s-btds)
- [Cook County Parcel Universe (Current)](https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Parcel-Universe-Current-/pabr-t5kh)
- [ACS B25034 variables](https://api.census.gov/data/2023/acs/acs5/groups/B25034.json)
- [Census Building Permits Survey](https://www.census.gov/construction/bps/)
- [DuPage parcels layer](https://gis.dupageco.org/arcgis/rest/services/Tyler/ParcelsRealEstateCCWGS84SR4326/MapServer/0)
- [Lake County open data](https://data-lakecountyil.opendata.arcgis.com/), [Will County GIS data](https://willcounty.gov/County-Offices/Administration/GIS-Division/Data)
