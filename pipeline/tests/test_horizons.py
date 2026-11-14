"""Horizons query/parse, tested on a recorded response (no network in tests)."""

from pathlib import Path

import httpx
import numpy as np
import pytest

from clps import horizons

FIXTURE = Path(__file__).parent / "fixtures" / "horizons_sun_im2_20270101.txt"


def test_query_params_use_api_names() -> None:
    p = horizons.query_params("10", -84.7906, 29.1957, 0.0, "2027-01-01 00:00", "2027-01-01 02:00")
    assert p["SITE_COORD"] == "'29.1957,-84.7906,0.0'"
    assert p["CENTER"] == "'coord@301'"
    assert p["ANG_FORMAT"] == "'DEG'"
    assert "ANGLE_FORMAT" not in p


def test_query_params_can_observe_from_earth() -> None:
    p = horizons.query_params(
        "10", 40.0, 0.0, 0.0, "2027-01-01 00:00", "2027-01-01 02:00", "1h", horizons.EARTH_ID
    )
    assert p["CENTER"] == "'coord@399'"
    assert p["SITE_COORD"] == "'0.0,40.0,0.0'"


def test_parse_recorded_sun_table() -> None:
    rows = horizons.parse_observer_table(FIXTURE.read_text())
    assert [str(r.t) for r in rows] == [
        "2027-01-01T00:00:00",
        "2027-01-01T01:00:00",
        "2027-01-01T02:00:00",
    ]
    assert rows[0].az_deg == pytest.approx(233.958170)
    assert rows[0].el_deg == pytest.approx(-2.053957)
    assert np.all(np.diff([r.el_deg for r in rows]) < 0)


def test_error_response_raises() -> None:
    with pytest.raises(ValueError):
        horizons.parse_observer_table("API ERROR: HTTP code 400")


def test_cache_key_changes_with_the_query(tmp_path: Path) -> None:
    jan = horizons.query_params("10", -89.0, 10.0, 0.0, "2027-01-01 00:00", "2027-01-02 00:00")
    may = horizons.query_params("10", -89.0, 10.0, 0.0, "2027-05-01 00:00", "2027-05-02 00:00")
    assert horizons.cache_path(jan, tmp_path) != horizons.cache_path(may, tmp_path)


def test_fetch_cached_reads_without_network_and_stores_only_valid_tables(tmp_path: Path) -> None:
    params = {"COMMAND": "'10'"}
    good = FIXTURE.read_text()
    bad = httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text="API ERROR"))
    )
    with pytest.raises(ValueError):
        horizons.fetch_cached(params, tmp_path, bad)
    assert not horizons.cache_path(params, tmp_path).exists()
    ok = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=good)))
    assert horizons.fetch_cached(params, tmp_path, ok) == good
    unused = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(500)))
    assert horizons.fetch_cached(params, tmp_path, unused) == good
