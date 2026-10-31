"""Generic Socrata (SODA 2.1) connector. Everything comes from the source config:
domain, dataset, the columns its field map names, equality filters, a look-back on a date
column, and the newest-year window for yearly datasets. Raw pages are cached under
data/raw/<place_id>/<source name>/ so reruns don't re-download.

Set SOCRATA_APP_TOKEN in .env to raise Socrata's rate limits (optional).
"""
from __future__ import annotations

import os
import re
from datetime import date
from typing import Iterable, Iterator, Optional, Union

from pipeline.core.http import RAW_DIR, cache_key, get_json

PAGE_SIZE = 50_000

Scalar = Union[str, int, float, bool]


def columns_of(fields) -> list[str]:
    """Source columns named by a field map (a pydantic model or dict), in order, de-duplicated."""
    items = fields.model_dump(exclude_none=True).values() if hasattr(fields, "model_dump") else fields.values()
    out: list[str] = []
    for ref in items:
        for c in ref if isinstance(ref, list) else [ref]:
            if c not in out:
                out.append(c)
    return out


def _lit(v: Scalar) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    return "'" + str(v).replace("'", "''") + "'"


def where_clause(
    filters: dict[str, Union[Scalar, list[Scalar]]],
    *,
    since: Optional[date] = None,
    since_column: Optional[str] = None,
    min_year: Optional[int] = None,
    year_column: Optional[str] = None,
) -> Optional[str]:
    parts = []
    for col, val in filters.items():
        if isinstance(val, list):
            parts.append(f"{col} in ({', '.join(_lit(v) for v in val)})")
        else:
            parts.append(f"{col} = {_lit(val)}")
    if since and since_column:
        parts.append(f"{since_column} >= '{since.isoformat()}T00:00:00'")
    if min_year is not None and year_column:
        parts.append(f"{year_column} >= '{min_year}'")
    return " AND ".join(parts) or None


class Socrata:
    kind = "socrata"

    def __init__(self, domain: str, dataset: str, *, cache_dir_name: str, place_id: str, refresh: bool = False):
        self.base = f"https://{domain}/resource/{dataset}.json"
        self.cache_dir = RAW_DIR / place_id / cache_dir_name
        self.refresh = refresh
        token = os.environ.get("SOCRATA_APP_TOKEN")
        self.headers = {"X-App-Token": token} if token else None

    def _get(self, params: dict, tag: str):
        path = self.cache_dir / f"{tag}-{cache_key(self.base, params)}.json"
        return get_json(self.base, params, cache=path, refresh=self.refresh, headers=self.headers)

    def max_value(self, column: str, where: Optional[str]) -> Optional[float]:
        params = {"$select": f"max({column}) as m"}
        if where:
            params["$where"] = where
        rows = self._get(params, "max")
        v = rows[0].get("m") if rows else None
        return float(v) if v not in (None, "") else None

    def rows(self, columns: Iterable[str], where: Optional[str], *, limit: Optional[int] = None) -> Iterator[dict]:
        """All matching rows, paged in a stable order. `limit` stops early (fixtures, tests)."""
        cols = list(columns)
        offset, n = 0, 0
        while True:
            size = PAGE_SIZE if limit is None else min(PAGE_SIZE, limit - n)
            params = {"$select": ", ".join(cols), "$order": ":id", "$limit": size, "$offset": offset}
            if where:
                params["$where"] = where
            page = self._get(params, f"page{offset // PAGE_SIZE:04d}")
            for row in page:
                yield row
            n += len(page)
            offset += len(page)
            if len(page) < size or (limit is not None and n >= limit):
                return


def fetch_permits(src, *, place_id: str, since: date, refresh: bool = False, limit: Optional[int] = None) -> Iterator[dict]:
    """Rows from a permit source issued on or after `since`."""
    api = Socrata(src.domain, src.dataset, cache_dir_name="permits", place_id=place_id, refresh=refresh)
    cols = columns_of(src.fields)
    for c in re.findall(r"\{(\w+)\}", src.record_url or ""):  # record_url placeholders are source columns
        if c not in cols:
            cols.append(c)
    issued = src.fields.issued if isinstance(src.fields.issued, str) else src.fields.issued[0]
    where = where_clause({}, since=since, since_column=issued)
    return api.rows(cols, where, limit=limit)


def fetch_parcels(src, *, place_id: str, refresh: bool = False, limit: Optional[int] = None) -> Iterator[dict]:
    """Rows from a parcel source. For latest_year_only sources, only the newest `years_back`
    years are read (the normalize step keeps each parcel's newest row)."""
    api = Socrata(src.domain, src.dataset, cache_dir_name=src.name, place_id=place_id, refresh=refresh)
    cols = columns_of(src.fields)
    base = where_clause(src.filter)
    min_year = None
    if src.latest_year_only:
        year_col = src.fields.year if isinstance(src.fields.year, str) else src.fields.year[0]
        top = api.max_value(year_col, base)
        if top is not None:
            min_year = int(top) - src.years_back + 1
        where = where_clause(src.filter, min_year=min_year, year_column=year_col)
    else:
        where = base
    return api.rows(cols, where, limit=limit)
