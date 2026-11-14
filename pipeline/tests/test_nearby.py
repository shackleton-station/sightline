"""Nearby-ground maps: grid, slope, monthly numbers and how they're stored."""

from __future__ import annotations

import gzip

import numpy as np
import pytest

from clps import nearby
from clps.geometry import MOON_RADIUS_M, unit_vector
from clps.horizon import HorizonMask


def test_grid_has_an_odd_size_with_the_site_in_the_middle() -> None:
    offsets = nearby.grid_offsets_m(500.0, 100.0)
    assert offsets.tolist() == [-500, -400, -300, -200, -100, 0, 100, 200, 300, 400, 500]
    assert nearby.grid_offsets_m().size == 101


def test_slope_grid_measures_a_tilted_plane() -> None:
    def height_xy(x, y):
        return np.tan(np.radians(10.0)) * x

    slope = nearby.slope_grid(height_xy, np.array([0.0, 500.0]), np.array([0.0, -300.0]), 20.0)
    assert slope == pytest.approx([10.0, 10.0])


def test_slope_at_is_flat_on_a_sphere_and_measures_a_tilt_at_any_latitude() -> None:
    lat, lon = -85.0, 40.0

    def flat(lat_deg, lon_deg):
        return np.zeros_like(lat_deg)

    assert nearby.slope_at(flat, lat, lon, 20.0) == pytest.approx(0.0)

    east = np.array([-np.sin(np.radians(lon)), np.cos(np.radians(lon)), 0.0])

    def tilted(lat_deg, lon_deg):
        point = unit_vector(lat_deg, lon_deg) * MOON_RADIUS_M
        return np.tan(np.radians(12.0)) * (point @ east)

    assert nearby.slope_at(tilted, lat, lon, 20.0) == pytest.approx(12.0, abs=0.01)


def test_longest_false_run() -> None:
    assert nearby.longest_false_run(np.array([True, True])) == 0
    assert nearby.longest_false_run(np.array([False, False])) == 2
    assert nearby.longest_false_run(np.array([False, True, False, False, True, False])) == 2


def test_cell_months_splits_by_month_and_cuts_gaps_at_the_edge() -> None:
    sun = np.array([True, False, False, False, True, True])
    earth = np.array([True, True, True, False, False, True])
    out = nearby.cell_months(sun, earth, np.array([0, 2, 6]))
    assert out.pct_sun.tolist() == [50, 50]
    assert out.pct_earth.tolist() == [100, 50]
    assert out.pct_both.tolist() == [50, 25]
    assert out.sun_gap_h.tolist() == [1, 2]


def test_earth_clearance_uses_the_center_of_earth_above_the_terrain() -> None:
    mask = HorizonMask(
        az_deg=np.array([0.0, 180.0]),
        el_deg=np.array([1.0, 3.0]),
        dist_m=np.zeros(2),
        reach_m=np.zeros(2),
    )
    clear = nearby.earth_clear_of_terrain([0.0, 0.0, 90.0], [3.0, 2.9, 4.0], mask, 2.0)
    assert clear.tolist() == [True, False, True]


def test_month_encoding_is_repeatable_with_a_known_layout() -> None:
    sun, earth, both = (np.array(v, np.uint8) for v in ([1, 2], [3, 4], [5, 6]))
    gap = np.array([7, 300], np.uint16)
    encoded = nearby.encode_month(sun, earth, both, gap)
    assert encoded == nearby.encode_month(sun, earth, both, gap)
    assert gzip.decompress(encoded) == bytes([1, 2, 3, 4, 5, 6, 7, 0, 44, 1])


def test_slope_encoding_rounds_and_caps() -> None:
    encoded = nearby.encode_slope(np.array([0.2, 10.3, 500.0]))
    assert list(gzip.decompress(encoded)) == [0, 21, 255]


def test_ranking_stats_report_the_bias_of_the_best_looking_spots() -> None:
    map_pct = np.arange(100, dtype=float)
    ours = map_pct.copy()
    ours[-10:] += 5.0
    out = nearby.ranking_stats(ours, map_pct)
    assert out["n"] == 100
    assert out["rank_r"] == pytest.approx(1.0)
    assert out["top_bias"] == pytest.approx(5.0)
    assert out["bias"] == pytest.approx(0.5)
    assert out["top_map_percentile"] == pytest.approx(94.5, abs=0.6)


def test_positions_from_the_center_put_a_body_overhead_in_full_view() -> None:
    lat, lon = -89.0, 10.0
    up = unit_vector(lat, lon)
    positions = np.zeros((1, 6), np.float32)
    positions[0, :3] = (up * 1.5e8).astype(np.float32)
    positions[0, 3:] = (-up * 3.8e5).astype(np.float32)
    mask = HorizonMask(
        az_deg=np.arange(0.0, 360.0, 0.5),
        el_deg=np.zeros(720),
        dist_m=np.zeros(720),
        reach_m=np.zeros(720),
    )
    sun, earth = nearby.fractions_from_center(positions, lat, lon, 1737.4, mask)
    assert sun[0] == pytest.approx(1.0)
    assert earth[0] == pytest.approx(0.0)


def test_period_numbers_are_per_period() -> None:
    sun = np.array([True, False, False, True])
    earth = np.array([True, True, False, False])
    out = nearby.period_numbers(sun, earth, np.array([0, 2, 4]))
    assert out.tolist() == [[50.0, 100.0, 50.0, 1.0, 0.0], [50.0, 0.0, 0.0, 1.0, 2.0]]


def test_spread_row_gives_low_and_high_of_each_number() -> None:
    numbers = np.array([[10.0, 20.0, 5.0, 100.0, 7.0], [30.0, 10.0, 6.0, 50.0, 7.0]])
    out = nearby.spread_row(numbers)
    assert out["pct_sun"] == [10.0, 30.0]
    assert out["max_sun_gap_h"] == [50.0, 100.0]
    assert set(out) == set(nearby.SPREAD_KEYS)


def test_error_stats() -> None:
    out = nearby.error_stats(np.arange(100.0))
    assert out["mean"] == 49.5
    assert out["low"] < out["high"]


def test_circle_offsets_start_at_the_center_and_stay_inside() -> None:
    points = nearby.circle_offsets_m(100.0, 20.0)
    assert points[0].tolist() == [0.0, 0.0]
    assert np.max(np.hypot(points[:, 0], points[:, 1])) <= 100.0
    assert points.shape == (81, 2)
