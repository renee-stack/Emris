"""Parse dwelling-unit counts out of free-text permit work descriptions.

Ported unchanged from the hackathon scripts/units.py (only this docstring changed).
Referenced from place configs as the hook `custom.units_from_text`.
"""
import re

WORDS = {
    "ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5, "SIX": 6, "SEVEN": 7, "EIGHT": 8,
    "NINE": 9, "TEN": 10, "ELEVEN": 11, "TWELVE": 12, "SINGLE": 1,
}
NUM = r"\b(\d{1,4}|" + "|".join(WORDS) + r")"
SEP = r"[\s,\-()]*"

# Explicit totals win: "31 TOTAL UNITS", "TOTAL OF 48 UNITS"
TOTAL = [
    re.compile(NUM + SEP + r"TOTAL" + SEP + r"(?:DWELLING|RESIDENTIAL|APARTMENT)?" + SEP + r"UNITS?\b"),
    re.compile(r"TOTAL\s+OF\s+" + NUM + SEP + r"(?:DWELLING|RESIDENTIAL|APARTMENT)?" + SEP + r"UNITS?\b"),
]
# "48 DWELLING UNITS", "6 DWELLING, UNIT", "3 D.U.", "2-UNIT", "40 RESIDENTIAL UNITS", "12 APARTMENT UNITS", "24 APARTMENTS"
UNIT = [
    re.compile(NUM + SEP + r"(?:NEW\s+)?(?:DWELLING|RESIDENTIAL|APARTMENT|RENTAL|AFFORDABLE|CONDO(?:MINIUM)?)" + SEP + r"UNITS?\b"),
    re.compile(NUM + SEP + r"D\.?\s?U\.?(?=[\s,.;)]|S\b|$)"),
    re.compile(NUM + SEP + r"UNITS?\b"),
    re.compile(NUM + SEP + r"(?:APARTMENTS|DWELLINGS)\b"),
]
TOWNHOUSES = re.compile(NUM + SEP + r"(?:NEW\s+)?(?:\d-?\s?STORY\s+)?(?:TOWNHOUSES|TOWNHOMES|ROWHOUSES|SINGLE[\s\-]*FAMILY\s+(?:HOMES|RESIDENCES|HOUSES))\b")
COACH_HOUSE = re.compile(r"COACH[\s\-]*HOUSE|\bADU\b|(?:ADDITIONAL|ACCESSORY)\s+DWELLING\s+UNIT")
FLAT = re.compile(r"\b" + NUM + r"[\s\-]*FLAT\b")
SINGLE_FAMILY = re.compile(r"\bSINGLE[\s\-]*FAMILY\b|\bS\.?F\.?R\b|\bSFH\b")

# Not a dwelling: these permits have 0 units when nothing residential is mentioned.
ACCESSORY = re.compile(
    r"\b(GARAGE|CRANE|STAGE|TENT|FENCE|PORCH|DECK|SHED|CARPORT|PARKING\s+PAD|SIGN|CANOPY|TRAILER|BLEACHER|"
    r"PAVILION|GAZEBO|PERGOLA|SCAFFOLD|BILLBOARD|ANTENNA|TOWER|DUMPSTER|FOUNDATION\s+ONLY\s+FOR\s+(?:A\s+)?CRANE)\b"
)
RESIDENTIAL_HINT = re.compile(r"RESIDEN|DWELLING|APARTMENT|\bD\.?U\b|UNIT|FLAT|CONDO|SINGLE[\s\-]*FAMILY|HOUSING|MIXED|HOTEL")

# "UNIT" hits that are not dwellings
NOT_DWELLING = re.compile(r"(?:EFFICIENCY|STORAGE|COMMERCIAL|RETAIL|HVAC|AC|A/C|ROOFTOP|MECHANICAL|CONDENSING|HEATING)\s*UNITS?\b")


def _n(tok: str) -> int:
    return int(tok) if tok.isdigit() else WORDS[tok]


def parse_units(desc: str | None) -> int | None:
    """Dwelling units described, 0 for accessory-only structures, None if unknown."""
    if not desc:
        return None
    d = desc.upper()
    for rx in TOTAL:
        m = rx.search(d)
        if m:
            return _n(m.group(1))
    if COACH_HOUSE.search(d) and not re.search(r"\bNEW\b[^.]{0,60}\b(?:BUILDING|RESIDENCE)\b(?![^.]{0,40}COACH)", d):
        return 1
    m = TOWNHOUSES.search(d)
    if m:
        return _n(m.group(1))
    cleaned = NOT_DWELLING.sub(" ", d)
    for rx in UNIT:
        hits = [_n(m.group(1)) for m in rx.finditer(cleaned)]
        hits = [h for h in hits if 0 < h < 3000]
        if hits:
            return max(hits)
    m = FLAT.search(d)
    if m:
        return _n(m.group(1))
    if SINGLE_FAMILY.search(d):
        return 1
    if ACCESSORY.search(d) and not RESIDENTIAL_HINT.search(d):
        return 0
    return None


# Permits that are not a new project: revisions of earlier permits and temporary event structures.
NOT_A_PROJECT = re.compile(r"REVISION\s+TO\s+PERMIT|REVISIONS?\s+(?:ONLY\s+)?TO\s+(?:PERMIT|THE\s+PERMIT)|ERECTION\s+STARTS|\bDAY\s+EVENT\b|REINSTATE|BUILD[\s\-]?OUT\b")


def is_new_project(desc: str | None) -> bool:
    return not (desc and NOT_A_PROJECT.search(desc.upper()))
