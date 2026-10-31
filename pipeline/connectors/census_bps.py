"""Census Building Permits Survey place files: permits by permit-issuing jurisdiction.

The comma-delimited file has two header rows, a blank row, then one row per issuer.
Columns 18-29 are imputed estimates grouped by building size (1, 2, 3-4, 5+ units), each
as buildings, units, value. Columns 30-41 repeat them for reported-only counts (unused).
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date
from typing import Optional

import requests

from pipeline.core.http import RAW_DIR, get

kind = "census_bps"

NOT_A_PLACE = {"", "00000", "99990"}  # 99990 = county unincorporated remainder


@dataclass(frozen=True)
class BpsRow:
    year: int
    issuer_id: str  # place:<7>, cousub:<10>, county_rest:<5>, county:<5>
    issuer_type: str
    name: str
    county_fips: str
    units_1: int
    units_2: int
    units_3_4: int
    units_5plus: int
    bldgs_5plus: int


def _int(v: str) -> int:
    try:
        return int(float(v.strip() or 0))
    except ValueError:
        return 0


def issuer(state_fips: str, county: str, fips_place: str, fips_mcd: str) -> tuple[str, str]:
    """Which geography a row covers. Order matters: a township row has no place code."""
    county_fips = state_fips + county
    if fips_place not in NOT_A_PLACE:
        return f"place:{state_fips}{fips_place}", "place"
    if fips_place == "99990":
        return f"county_rest:{county_fips}", "county_rest"
    if fips_mcd not in ("", "00000"):
        return f"cousub:{county_fips}{fips_mcd}", "cousub"
    return f"county:{county_fips}", "county"


def parse(text: str, *, state_fips: str, year: int) -> list[BpsRow]:
    out: dict[str, BpsRow] = {}
    for r in csv.reader(io.StringIO(text)):
        if len(r) < 29 or not r[0].strip().isdigit() or r[1].strip().zfill(2) != state_fips:
            continue
        county, fplace, fmcd = r[3].strip().zfill(3), r[5].strip(), r[6].strip()
        iid, itype = issuer(state_fips, county, fplace, fmcd)
        row = BpsRow(
            year=year, issuer_id=iid, issuer_type=itype, name=r[16].strip(), county_fips=state_fips + county,
            units_1=_int(r[18]), units_2=_int(r[21]), units_3_4=_int(r[24]),
            units_5plus=_int(r[27]), bldgs_5plus=_int(r[26]),
        )
        if iid in out:  # one issuer split over rows: add them up
            o = out[iid]
            row = BpsRow(year, iid, itype, o.name, o.county_fips, o.units_1 + row.units_1, o.units_2 + row.units_2,
                         o.units_3_4 + row.units_3_4, o.units_5plus + row.units_5plus, o.bldgs_5plus + row.bldgs_5plus)
        out[iid] = row
    return list(out.values())


def _text(src, year: int, state: str, refresh: bool) -> Optional[str]:
    url = src.url.format(year=year)
    try:
        raw = get(url, cache=RAW_DIR / "_state" / state.lower() / url.rsplit("/", 1)[-1], refresh=refresh, retries=2)
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            return None
        raise
    return raw.decode("latin-1")


def fetch(src, *, state_fips: str, state: str, refresh: bool = False, newest: Optional[int] = None) -> list[BpsRow]:
    """The newest `src.years` annual files that exist (looking back from last year)."""
    start = newest or date.today().year
    rows: list[BpsRow] = []
    got = 0
    for year in range(start, start - 8, -1):
        text = _text(src, year, state, refresh)
        if text is None:
            continue
        rows += parse(text, state_fips=state_fips, year=year)
        got += 1
        if got == src.years:
            break
    if got < src.years:
        raise RuntimeError(f"found only {got} of {src.years} BPS annual files at {src.url}")
    return rows
