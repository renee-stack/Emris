"""Every tests/fixtures/<place_id>/ folder must normalize into valid standard records using
only that place's config. Folders are discovered, so no place is named here."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.core.config import load_place
from pipeline.core.normalize import column, normalize_permits, normalize_properties, parcel_ids
from pipeline.core.records import StandardPermit, StandardProperty

FIX = Path(__file__).parent / "fixtures"
PLACE_DIRS = sorted(d for d in FIX.iterdir() if (d / "meta.json").is_file())


def _rows(d: Path, name: str) -> list[dict]:
    return json.loads((d / f"{name}.json").read_text())


@pytest.fixture(params=PLACE_DIRS, ids=[d.name for d in PLACE_DIRS])
def place_dir(request):
    return request.param


def test_fixture_folders_exist():
    assert PLACE_DIRS, "no tests/fixtures/<place_id>/meta.json found"


def test_meta_matches_files(place_dir):
    meta = json.loads((place_dir / "meta.json").read_text())
    assert meta["place_id"] == place_dir.name
    for name, n in meta["files"].items():
        assert len(json.loads((place_dir / name).read_text())) == n


def test_permits_normalize(place_dir):
    place = load_place(place_dir.name)
    src = place.config.sources.permits
    if src is None or not (place_dir / "permits.json").is_file():
        pytest.skip("place has no permit source")
    rows = _rows(place_dir, "permits")
    permits = normalize_permits(src, rows, place.place_id)
    ids = {column(r, src.fields.permit_id) for r in rows}
    assert len(permits) == len(ids), "every fixture row should become a permit"
    for p in permits:
        StandardPermit.model_validate(p.model_dump())  # round-trips as a valid record
        assert p.place_id == place.place_id
        assert p.source_url
        if src.parcel_id_format and src.parcel_id_format.length:
            assert all(len(i) == src.parcel_id_format.length for i in p.parcel_ids)
    classes = {p.permit_class for p in permits}
    assert len(classes) >= 3, f"fixture should cover several permit classes, got {classes}"
    # rows that carry a unit count in the configured field keep it exactly
    if src.units and src.units.field:
        for r, p in zip(rows, permits):
            v = r.get(src.units.field)
            if v not in (None, ""):
                assert p.units == int(float(v))


def test_properties_normalize(place_dir):
    place = load_place(place_dir.name)
    srcs = place.config.sources.parcels
    if not srcs:
        pytest.skip("place has no parcel sources")
    parts = [(s, _rows(place_dir, s.name)) for s in srcs if (place_dir / f"{s.name}.json").is_file()]
    universe: set = set()
    props = normalize_properties(parts, place.place_id, universe=universe)
    assert props, "fixture parcels should produce properties"
    for p in props:
        StandardProperty.model_validate(p.model_dump())
        assert p.place_id == place.place_id
        assert (p.year_built is None) == (p.year_built_source is None)
    ids = [p.parcel_id for p in props]
    assert len(ids) == len(set(ids)), "one property per parcel"
    geo = [s for s, _ in parts if s.role == "geometry"]
    if geo:
        # a geometry source defines the place: every property has a point and is in it
        assert all(p.lat is not None and p.lng is not None for p in props)
        assert set(ids) <= universe
        expected = set()
        for s, rows in parts:
            if s.role == "characteristics":
                expected |= {parcel_ids(column(r, s.fields.parcel_id), s.parcel_id_format)[0] for r in rows
                             if parcel_ids(column(r, s.fields.parcel_id), s.parcel_id_format)}
        assert set(ids) == expected & universe
    assert sum(p.year_built is not None for p in props) >= len(props) // 2
