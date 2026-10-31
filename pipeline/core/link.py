"""Link permits to properties (parcel id first, then normalized street address) and put
permits and properties into tracts. Generic US address rules only."""
from __future__ import annotations

import re
from typing import Optional

from pipeline.core.geo import StateGeography
from pipeline.core.records import StandardPermit, StandardProperty

SUFFIX = {
    "STREET": "ST", "AVENUE": "AVE", "AV": "AVE", "BOULEVARD": "BLVD", "ROAD": "RD", "DRIVE": "DR",
    "PLACE": "PL", "COURT": "CT", "LANE": "LN", "PARKWAY": "PKWY", "TERRACE": "TER", "HIGHWAY": "HWY",
}
DIRECTION = {"NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W"}
SUFFIXES = set(SUFFIX.values()) | {"WAY", "SQ", "CIR", "TRL", "ROW", "PLZ"}


def address_key(addr: Optional[str]) -> Optional[str]:
    """'1234  W. Division Street, Springfield' -> '1234 W DIVISION'. House number + street name,
    without suffix, unit or city, so permit and assessor spellings meet."""
    if not addr:
        return None
    s = addr.upper().split(",")[0]
    s = re.sub(r"[.#]", " ", s)
    toks = s.split()
    if len(toks) < 2 or not re.match(r"^\d+[A-Z]?$", toks[0]):
        return None
    out = [toks[0]]
    for t in toks[1:]:
        t = DIRECTION.get(t, SUFFIX.get(t, t))
        if t in SUFFIXES or t in ("UNIT", "APT", "STE"):
            break
        out.append(t)
    return " ".join(out) if len(out) > 1 else None


def link_permits(permits: list[StandardPermit], props: list[StandardProperty]) -> dict[str, Optional[str]]:
    """permit_id -> parcel_id of the linked property (or None)."""
    by_parcel = {p.parcel_id for p in props}
    by_addr: dict[str, str] = {}
    for p in props:
        k = address_key(p.address)
        if k and k not in by_addr:
            by_addr[k] = p.parcel_id
    out: dict[str, Optional[str]] = {}
    for pm in permits:
        hit = next((pid for pid in pm.parcel_ids if pid in by_parcel), None)
        if hit is None:
            k = address_key(pm.address)
            hit = by_addr.get(k) if k else None
        out[pm.permit_id] = hit
    return out


def tracts_for(geo: StateGeography, records) -> list[Optional[str]]:
    return geo.tracts.locate([r.lat for r in records], [r.lng for r in records])
