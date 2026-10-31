"""Connector rows -> StandardPermit / StandardProperty, using only config rules:
field map, dash normalization, parcel id format, units (field, then text), value maps,
per-parcel aggregation and permit classes. No source or place is named here.
"""
from __future__ import annotations

import importlib
import math
import re
from collections import defaultdict
from datetime import date
from typing import Any, Callable, Iterable, Optional

from pipeline.core.records import StandardPermit, StandardProperty
from places._schema import ClassRule, Hook, ParcelIdFormat, ParcelSource, PermitSource

DASHES = re.compile(r"[‐-―−]")  # hyphen variants, en/em dash, minus
SPACES = re.compile(r"\s+")


# ---------- small parsers ----------


def column(row: dict, ref) -> Optional[str]:
    """A field-map value: one column, or several joined with single spaces."""
    if ref is None:
        return None
    vals = [row.get(c) for c in (ref if isinstance(ref, list) else [ref])]
    text = " ".join(str(v).strip() for v in vals if v not in (None, "") and str(v).strip())
    return SPACES.sub(" ", text) or None


def number(v: Any) -> Optional[float]:
    """'1908.0' -> 1908.0, '$1,200' -> 1200.0; anything else -> None."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return None if isinstance(v, float) and math.isnan(v) else float(v)
    s = str(v).strip().replace(",", "").replace("$", "")
    try:
        return float(s)
    except ValueError:
        return None


def whole(v: Any) -> Optional[int]:
    n = number(v)
    return int(round(n)) if n is not None else None


def iso_date(v: Any) -> Optional[date]:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def dashes(s: Optional[str]) -> Optional[str]:
    return DASHES.sub("-", s) if s else s


def coord(v: Any, lo: float, hi: float) -> Optional[float]:
    n = number(v)
    return n if n is not None and n != 0 and lo <= n <= hi else None


def parcel_ids(raw: Optional[str], fmt: Optional[ParcelIdFormat]) -> tuple[str, ...]:
    if not raw:
        return ()
    parts = raw.split(fmt.separator) if fmt and fmt.separator else [raw]
    out: list[str] = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if fmt:
            for ch in fmt.strip:
                p = p.replace(ch, "")
            if fmt.pad_right and fmt.length:
                while len(p) < fmt.length:
                    p += fmt.pad_right[: fmt.length - len(p)]
            if fmt.length and len(p) != fmt.length:
                continue  # malformed id; dropped rather than mis-joined
        if p and p not in out:
            out.append(p)
    return tuple(out)


_hooks: dict[str, Callable] = {}


def hook(h: Hook) -> Callable:
    if h.hook not in _hooks:
        mod = importlib.import_module(f"pipeline.custom.{h.module}")
        _hooks[h.hook] = getattr(mod, h.function)
    return _hooks[h.hook]


def fill(template: str, row: dict) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: str(row.get(m.group(1), "")), template)


# ---------- permits ----------


def _rule_matches(rule: ClassRule, *, ptype: Optional[str], wtype: Optional[str], units: Optional[int],
                  cost: Optional[float], nd: bool) -> bool:
    if rule.default:
        return True
    if rule.any_of is not None and not any(
        _rule_matches(r, ptype=ptype, wtype=wtype, units=units, cost=cost, nd=nd) for r in rule.any_of
    ):
        return False
    if rule.permit_type is not None:
        allowed = rule.permit_type if isinstance(rule.permit_type, list) else [rule.permit_type]
        if (dashes(ptype) if nd else ptype) not in [dashes(a) if nd else a for a in allowed]:
            return False
    if rule.work_type is not None:
        if (dashes(wtype) if nd else wtype) not in [dashes(a) if nd else a for a in rule.work_type]:
            return False
    if rule.min_units is not None and (units is None or units < rule.min_units):
        return False
    if rule.min_cost is not None and (cost is None or cost < rule.min_cost):
        return False
    return True


def classify(src: PermitSource, *, ptype, wtype, units, cost) -> str:
    for name, rule in src.classes.rules():
        if _rule_matches(rule, ptype=ptype, wtype=wtype, units=units, cost=cost, nd=src.normalize_dashes):
            return name
    return "other"  # unreachable: `other` is required to be default: true


def permit_units(src: PermitSource, row: dict, text: Optional[str]) -> Optional[int]:
    if src.units is None:
        return None
    if src.units.field:
        n = whole(row.get(src.units.field))
        if n is not None and n >= 0:
            return n  # 0 is a real answer, not "unknown"
    ft = src.units.from_text
    if ft is None or not text:
        return None
    if isinstance(ft, Hook):
        return hook(ft)(text)
    m = re.search(ft, text, re.I)
    return whole(m.group(1)) if m else None


def default_record_url(src: PermitSource, row: dict) -> str:
    if src.record_url:
        return fill(src.record_url, row)
    if src.connector == "socrata":
        return f"https://{src.domain}/resource/{src.dataset}.json"
    return src.url or ""


def normalize_permit(src: PermitSource, row: dict, place_id: str) -> Optional[StandardPermit]:
    f = src.fields
    pid = column(row, f.permit_id)
    issued = iso_date(column(row, f.issued))
    if not pid or not issued:
        return None
    text = column(row, f.text) or ""
    ptype = column(row, f.permit_type)
    wtype = column(row, f.work_type)
    cost = number(column(row, f.cost))
    cost = cost if cost is not None and cost >= 0 else None
    units = permit_units(src, row, text)
    addr = column(row, f.address)
    return StandardPermit(
        permit_id=pid,
        place_id=place_id,
        issued_date=issued,
        address=addr.upper() if addr else None,
        lat=coord(column(row, f.lat), -90, 90),
        lng=coord(column(row, f.lng), -180, 180),
        parcel_ids=parcel_ids(column(row, f.parcel_ids), src.parcel_id_format),
        permit_class=classify(src, ptype=ptype, wtype=wtype, units=units, cost=cost),
        units=units,
        cost=cost,
        description=text,
        source_url=default_record_url(src, row),
    )


def normalize_permits(src: PermitSource, rows: Iterable[dict], place_id: str) -> list[StandardPermit]:
    """Normalized permits, one per permit_id (a later row replaces an earlier one)."""
    out: dict[str, StandardPermit] = {}
    for row in rows:
        p = normalize_permit(src, row, place_id)
        if p is not None:
            out[p.permit_id] = p
    return list(out.values())


# ---------- properties ----------

_NUMERIC = {"year_built", "units", "stories", "lat", "lng"}


def _value(src: ParcelSource, field: str, row: dict) -> Any:
    raw = column(row, getattr(src.fields, field))
    if raw is None:
        return None
    mapped = src.value_maps.get(field, {}).get(raw, raw)
    if field not in _NUMERIC:
        return mapped
    if field == "stories" and isinstance(mapped, str):
        m = re.search(r"\d+(?:\.\d+)?", mapped)  # "2 STORY" -> 2
        return float(m.group()) if m else None
    return number(mapped)


def _combine(how: str, vals: list):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    if how == "sum":
        return sum(vals)
    if how == "min":
        return min(vals)
    if how == "max":
        return max(vals)
    return vals[0]


FIELDS = ("address", "lat", "lng", "year_built", "units", "stories", "land_use", "owner_name")


def parcel_rows(src: ParcelSource, rows: Iterable[dict]) -> dict[str, dict]:
    """One merged dict per parcel id for a single source: newest year only (if
    latest_year_only), then rows for the same parcel combined per `aggregate`."""
    by_parcel: dict[str, list[tuple[float, dict]]] = defaultdict(list)
    for row in rows:
        ids = parcel_ids(column(row, src.fields.parcel_id), src.parcel_id_format)
        if not ids:
            continue
        year = number(column(row, src.fields.year)) if src.fields.year else None
        by_parcel[ids[0]].append((year if year is not None else -1, row))
    out: dict[str, dict] = {}
    for pid, items in by_parcel.items():
        if src.latest_year_only:
            top = max(y for y, _ in items)
            items = [(y, r) for y, r in items if y == top]
        rec = {}
        for fld in FIELDS:
            if getattr(src.fields, fld) is None:
                continue
            rec[fld] = _combine(src.aggregate.get(fld, "first"), [_value(src, fld, r) for _, r in items])
        out[pid] = rec
    return out


def normalize_properties(sources: list[tuple[ParcelSource, Iterable[dict]]], place_id: str,
                         universe: Optional[set] = None) -> list[StandardProperty]:
    """Merge parcel sources into one StandardProperty per parcel.

    - Characteristics sources define which parcels exist; earlier sources win field by field.
    - Geometry sources add points, and (if any is configured) also define the place: a parcel
      without a point from a geometry source is outside the place and dropped.
    - `universe`, if given, is filled with every parcel id a geometry source lists.
    """
    chars: list[tuple[ParcelSource, dict[str, dict]]] = []
    geoms: list[dict[str, dict]] = []
    for src, rows in sources:
        merged = parcel_rows(src, rows)
        if src.role == "geometry":
            geoms.append(merged)
        else:
            chars.append((src, merged))

    inside: Optional[set[str]] = set().union(*[g.keys() for g in geoms]) if geoms else None
    if universe is not None and inside:
        universe.update(inside)
    props: dict[str, dict] = {}
    for src, merged in chars:
        for pid, rec in merged.items():
            if inside is not None and pid not in inside:
                continue
            cur = props.setdefault(pid, {"source": f"{src.connector}:{src.dataset or src.name}"})
            for k, v in rec.items():
                if cur.get(k) is None and v is not None:
                    cur[k] = v
                    if k == "year_built":
                        cur["year_built_source"] = src.year_built_source
    for g in geoms:
        for pid, rec in g.items():
            if pid in props:
                for k in ("lat", "lng", "address"):
                    if props[pid].get(k) is None and rec.get(k) is not None:
                        props[pid][k] = rec[k]

    out = []
    for pid, r in props.items():
        yb = whole(r.get("year_built"))
        yb = yb if yb is not None and 1700 <= yb <= 2100 else None
        units = whole(r.get("units"))
        lat, lng = coord(r.get("lat"), -90, 90), coord(r.get("lng"), -180, 180)
        addr = r.get("address")
        out.append(StandardProperty(
            parcel_id=pid,
            place_id=place_id,
            address=SPACES.sub(" ", str(addr)).strip().upper() if addr else None,
            lat=lat if lng is not None else None,
            lng=lng if lat is not None else None,
            year_built=yb,
            year_built_source=r.get("year_built_source") if yb is not None else None,
            units=units if units is not None and units >= 0 else None,
            stories=r.get("stories") if (r.get("stories") or 0) >= 0 else None,
            land_use=str(r["land_use"]) if r.get("land_use") is not None else None,
            owner_name=r.get("owner_name"),
            source=r["source"],
        ))
    return out
