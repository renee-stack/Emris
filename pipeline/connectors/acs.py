"""Census ACS 5-year estimates for every tract in a state.

Reads the keyless table-based summary files (one national file per table, cached under
data/raw/_acs/) rather than the data API, which now requires a key. Variable B25034_005E is
column B25034_E005 in table file acsdt5y<year>-b25034.dat; tract rows are 1400000US<geoid>.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from pipeline.core.http import RAW_DIR, download

kind = "acs"

BASE = "https://www2.census.gov/programs-surveys/acs/summary_file/{year}/table-based-SF/data/5YRData"


def _val(v: str) -> Optional[int]:
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None  # negative = "not available" sentinel


def _column(var: str) -> tuple[str, str]:
    """B25034_005E -> ("b25034", "B25034_E005")"""
    table, num = var[:-1].split("_")
    return table.lower(), f"{table}_E{num}"


def tract_table(src, *, state_fips: str, refresh: bool = False) -> dict[str, dict[str, Optional[int]]]:
    """{geoid: {alias: value}} for every tract in the state, aliases from `src.variables`."""
    by_table: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for alias, var in src.variables.items():
        t, col = _column(var)
        by_table[t].append((alias, col))
    prefix = f"1400000US{state_fips}"
    out: dict[str, dict[str, Optional[int]]] = defaultdict(dict)
    for table, wanted in by_table.items():
        name = f"acsdt5y{src.year}-{table}.dat"
        path = download(f"{BASE.format(year=src.year)}/{name}", RAW_DIR / "_acs" / name, refresh=refresh)
        with path.open(encoding="utf-8") as fh:
            head = fh.readline().rstrip("\n").split("|")
            idx = {h: i for i, h in enumerate(head)}
            missing = [c for _, c in wanted if c not in idx]
            if missing:
                raise ValueError(f"{name} has no column(s) {missing}")
            for line in fh:
                if not line.startswith(prefix):
                    continue
                r = line.rstrip("\n").split("|")
                g = r[0][len("1400000US"):]
                for alias, col in wanted:
                    out[g][alias] = _val(r[idx[col]])
    return dict(out)
