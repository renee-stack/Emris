"""Config-rule behavior of the normalize step on synthetic rows (no real place)."""
from pipeline.core.link import address_key
from pipeline.core.normalize import normalize_permit, normalize_properties, parcel_ids
from places._schema import ParcelIdFormat, ParcelSource, PermitSource

PERMITS = PermitSource.model_validate({
    "connector": "csv", "path": "x.csv",
    "fields": {"permit_id": "id", "issued": "d", "permit_type": "t", "work_type": "w", "text": "desc",
               "cost": "c", "parcel_ids": "pins", "lat": "y", "lng": "x"},
    "parcel_id_format": {"separator": "|", "pad_right": "0", "length": 6},
    "normalize_dashes": True,
    "units": {"field": "u", "from_text": r"(\d+) UNITS"},
    "classes": {
        "new_mf": {"permit_type": "NEW - BUILD", "min_units": 5},
        "major_mep": {"any_of": [{"work_type": ["Electrical"], "min_cost": 1000}]},
        "other": {"default": True},
    },
})


def row(**kw):
    base = {"id": "1", "d": "2026-01-02T00:00:00.000", "t": "NEW – BUILD", "desc": "", "y": "41.9", "x": "-87.6"}
    return {**base, **kw}


def test_dash_normalization_and_units_from_text():
    p = normalize_permit(PERMITS, row(desc="ERECT 12 UNITS"), "xx-test")
    assert p.permit_class == "new_mf" and p.units == 12


def test_units_field_wins_and_zero_is_real():
    p = normalize_permit(PERMITS, row(u="0", desc="ERECT 12 UNITS"), "xx-test")
    assert p.units == 0 and p.permit_class == "other"


def test_any_of_and_cost_floor():
    assert normalize_permit(PERMITS, row(t="X", w="Electrical", c="999"), "xx-test").permit_class == "other"
    assert normalize_permit(PERMITS, row(t="X", w="Electrical", c="1000"), "xx-test").permit_class == "major_mep"


def test_parcel_id_format():
    assert parcel_ids("1234 | 56789|", ParcelIdFormat(separator="|", pad_right="0", length=6)) == ("123400", "567890")
    assert parcel_ids("12-34-56", ParcelIdFormat(strip="-", length=6)) == ("123456",)
    assert parcel_ids("12-34", ParcelIdFormat(strip="-", length=6)) == ()  # wrong length: dropped


def test_bad_coordinates_become_none():
    p = normalize_permit(PERMITS, row(y="0", x="0"), "xx-test")
    assert p.lat is None and p.lng is None


def test_value_maps_aggregate_and_latest_year():
    chars = ParcelSource.model_validate({
        "name": "res", "connector": "csv", "path": "x.csv", "latest_year_only": True,
        "fields": {"parcel_id": "pin", "year": "yr", "units": "apts", "year_built": "yb"},
        "value_maps": {"units": {"Two": 2, "None": 1}}, "aggregate": {"units": "sum", "year_built": "min"},
    })
    rows = [
        {"pin": "A", "yr": "2025", "apts": "Two", "yb": "1990.0"},
        {"pin": "A", "yr": "2025", "apts": "None", "yb": "1985.0"},  # second building card
        {"pin": "A", "yr": "2024", "apts": "Two", "yb": "1700"},  # older year: ignored
    ]
    (p,) = normalize_properties([(chars, rows)], "xx-test")
    assert p.units == 3 and p.year_built == 1985 and p.year_built_source == "assessor"


def test_address_key():
    assert address_key("1234  W. Division Street, Springfield") == "1234 W DIVISION"
    assert address_key("1234 WEST DIVISION ST UNIT 2") == "1234 W DIVISION"
    assert address_key("DIVISION ST") is None
