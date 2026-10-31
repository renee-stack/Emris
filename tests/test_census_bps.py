from pathlib import Path

from pipeline.connectors.census_bps import issuer, parse

SAMPLE = Path(__file__).parent / "fixtures" / "il" / "bps_mw2025a_sample.txt"


def test_issuer_types():
    assert issuer("17", "031", "14000", "14000") == ("place:1714000", "place")
    assert issuer("17", "031", "99990", "00000") == ("county_rest:17031", "county_rest")
    assert issuer("17", "183", "00000", "30965") == ("cousub:1718330965", "cousub")
    assert issuer("17", "013", "00000", "00000") == ("county:17013", "county")


def test_parse_keeps_one_state_and_reads_size_columns():
    rows = parse(SAMPLE.read_text(encoding="latin-1"), state_fips="17", year=2025)
    assert len(rows) == 5  # the other state's row is dropped
    assert {r.issuer_type for r in rows} == {"place", "county_rest", "cousub", "county"}
    big = max(rows, key=lambda r: r.units_5plus)
    assert big.issuer_id.startswith("place:") and big.units_5plus > 1000 and big.bldgs_5plus > 0
    for r in rows:
        assert min(r.units_1, r.units_2, r.units_3_4, r.units_5plus, r.bldgs_5plus) >= 0
