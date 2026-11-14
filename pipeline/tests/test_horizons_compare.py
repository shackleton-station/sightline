"""The hour-for-hour comparison with Horizons, on synthetic inputs and a recorded reply."""

import gzip
import json
from pathlib import Path

import numpy as np
import pytest

from clps import horizons, horizons_compare

FIXTURE = Path(__file__).parent / "fixtures" / "horizons_sun_im2_20270101.txt"


def test_separations_match_the_scalar_formula() -> None:
    seps = horizons_compare.separations_deg(
        np.array([359.5, 10.0]), np.array([0.0, 2.0]), np.array([0.5, 10.0]), np.array([0.0, -1.0])
    )
    assert seps == pytest.approx([1.0, 3.0])


def test_gap_stats_give_the_largest_and_the_median() -> None:
    stats = horizons_compare.gap_stats(np.array([0.001, 0.002, 0.009]))
    assert stats == {"hours": 3, "max_deg": 0.009, "typical_deg": 0.002}


def test_year_params_cover_every_hour_of_the_year() -> None:
    p = horizons_compare.year_params("10", -89.45, -137.31, 1.5, 2028)
    assert p["START_TIME"] == "'2028-01-01 00:00'"
    assert p["STOP_TIME"] == "'2028-12-31 23:00'"
    assert p["STEP_SIZE"] == "'1h'"
    # East longitude, 0 to 360.
    assert p["SITE_COORD"] == "'222.69,-89.45,1.5'"


def test_ephemeris_source_is_read_from_the_reply() -> None:
    assert (
        horizons_compare.ephemeris_source("Center body name: Moon (301) {source: DE441}") == "DE441"
    )
    assert horizons_compare.ephemeris_source("no such line") is None
    assert horizons_compare.ephemeris_source(FIXTURE.read_text()) is not None


def test_compare_rows_refuses_missing_hours() -> None:
    rows = horizons.parse_observer_table(FIXTURE.read_text())
    times = np.array([row.t for row in rows], dtype="datetime64[s]")
    az = np.array([row.az_deg for row in rows])
    el = np.array([row.el_deg for row in rows])
    assert horizons_compare.compare_rows(rows, times, az, el) == pytest.approx(np.zeros(len(rows)))
    with pytest.raises(ValueError, match="hours differ"):
        horizons_compare.compare_rows(rows, times[:-1], az[:-1], el[:-1])


def test_shipped_year_reads_twelve_months(tmp_path: Path) -> None:
    for month in range(1, 13):
        folder = tmp_path / f"2027-{month:02d}"
        folder.mkdir()
        row = {
            "t": f"2027-{month:02d}-01T00:00:00Z",
            "sun_az": 10.0 + month,
            "sun_el": 1.0,
            "earth_az": 20.0,
            "earth_el": -2.0,
        }
        (folder / "track.json").write_text(json.dumps([row]))
    year = horizons_compare.shipped_year(tmp_path, 2027)
    assert year["t"].size == 12
    assert year["t"][1] == np.datetime64("2027-02-01T00:00:00")
    assert year["sun_az"][11] == 22.0
    assert year["earth_el"][0] == -2.0


def test_shipped_at_picks_hours_from_the_months_they_fall_in(tmp_path: Path) -> None:
    for month, days in (("2027-01", 31), ("2027-02", 28)):
        start = np.datetime64(f"{month}-01T00:00:00", "s")
        rows = [
            {
                "t": f"{start + np.timedelta64(h, 'h')}Z",
                "sun_az": float(h),
                "sun_el": 1.0,
                "earth_az": 2.0,
                "earth_el": float(-h),
            }
            for h in range(24 * days)
        ]
        (tmp_path / month).mkdir()
        (tmp_path / month / "track.json").write_text(json.dumps(rows))
    times = np.array(["2027-02-01T05:00:00", "2027-01-31T23:00:00"], "datetime64[s]")
    out = horizons_compare.shipped_at(tmp_path, times)
    assert list(out["sun_az"]) == [5.0, 743.0]
    assert list(out["earth_el"]) == [-5.0, -743.0]
    assert np.array_equal(out["t"], times)


def test_shipped_at_reads_a_gzipped_track_where_there_is_no_plain_one(tmp_path: Path) -> None:
    start = np.datetime64("2027-01-01T00:00:00", "s")
    rows = [
        {
            "t": f"{start + np.timedelta64(h, 'h')}Z",
            "sun_az": float(h),
            "sun_el": 1.0,
            "earth_az": 2.0,
            "earth_el": 3.0,
        }
        for h in range(24 * 31)
    ]
    (tmp_path / "2027-01").mkdir()
    (tmp_path / "2027-01" / "track.json.gz").write_bytes(gzip.compress(json.dumps(rows).encode()))
    out = horizons_compare.shipped_at(tmp_path, np.array(["2027-01-02T03:00:00"], "datetime64[s]"))
    assert list(out["sun_az"]) == [27.0]
