"""Validation helpers on synthetic inputs."""

import numpy as np
import pytest

from clps import validate
from clps.ephemeris import Track
from clps.horizon import HorizonMask
from clps.horizons import HorizonsRow


def test_separation_handles_azimuth_wraparound_and_elevation() -> None:
    assert validate.separation_deg(359.5, 0.0, 0.5, 0.0) == pytest.approx(1.0)
    assert validate.separation_deg(10.0, 2.0, 10.0, -1.0) == pytest.approx(3.0)
    assert validate.separation_deg(0.0, 90.0, 180.0, 90.0) == pytest.approx(0.0, abs=1e-6)


def test_spot_checks_match_by_timestamp() -> None:
    times = np.array(["2027-05-01T00:00:00", "2027-05-01T01:00:00"], dtype="datetime64[s]")
    track = Track(
        az_deg=np.array([10.0, 20.0]),
        el_deg=np.array([1.0, 2.0]),
        dist_km=np.ones(2),
        unit_me=np.zeros((2, 3)),
    )
    rows = [HorizonsRow(np.datetime64("2027-05-01T01:00", "s"), 20.0, 2.5)]
    [check] = validate.spot_checks("sun", rows, times, track)
    assert (check.body, check.our_az, check.horizons_el) == ("sun", 20.0, 2.5)
    assert check.sep_deg == pytest.approx(0.5)


def test_spot_check_with_a_missing_time_raises() -> None:
    times = np.array(["2027-05-01T00:00:00"], dtype="datetime64[s]")
    track = Track(np.zeros(1), np.zeros(1), np.ones(1), np.zeros((1, 3)))
    rows = [HorizonsRow(np.datetime64("2030-01-01T00:00", "s"), 0.0, 0.0)]
    with pytest.raises(KeyError):
        validate.spot_checks("sun", rows, times, track)


def test_long_run_stats_definitions_differ_on_partial_disk() -> None:
    stats = validate.long_run_stats(np.array([1.0, 0.5, 0.0, 0.0]), np.array([1.0, 0.0, 0.0, 0.0]))
    assert stats == {"sun_mean_disk_pct": 37.5, "sun_any_pct": 50.0, "earth_any_pct": 25.0}


def test_mask_max_diff() -> None:
    az = np.array([0.0, 180.0])
    a = HorizonMask(az, np.array([1.0, 2.0]), np.ones(2), np.ones(2))
    b = HorizonMask(az, np.array([1.5, -1.0]), np.ones(2), np.ones(2))
    assert validate.mask_max_diff_deg(a, b) == pytest.approx(3.0)


def test_stratified_pixels_respect_eligibility_and_high_stratum() -> None:
    sun = np.zeros((10, 10))
    sun[0, :5] = 80.0
    eligible = np.ones((10, 10), dtype=bool)
    eligible[0, 0] = False
    rows, cols = validate.stratified_pixels(eligible, sun, np.random.default_rng(1), 3, 50.0)
    assert len(rows) == 6
    assert eligible[rows, cols].all()
    assert (sun[rows[3:], cols[3:]] >= 50.0).all()


def test_stratified_pixels_cap_at_what_exists() -> None:
    sun = np.zeros((4, 4))
    sun[1, 1] = 90.0
    rows, _ = validate.stratified_pixels(
        np.ones((4, 4), dtype=bool), sun, np.random.default_rng(1), 3, 50.0
    )
    assert len(rows) == 4


def test_comparison_stats() -> None:
    result = validate.comparison_stats(np.array([1.0, 2.0, 3.0]), np.array([0.0, 1.0, 2.0]))
    assert result["bias"] == pytest.approx(1.0)
    assert result["median"] == pytest.approx(1.0)
    assert result["mae"] == pytest.approx(1.0)
    assert result["rmse"] == pytest.approx(1.0)
    assert result["r"] == pytest.approx(1.0)
