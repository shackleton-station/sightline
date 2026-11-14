"""Slope maps on small synthetic terrain: no DEM needed."""

import numpy as np
import pytest

from clps import slopes
from clps.geometry import MOON_RADIUS_M


def _globe_lat_lon_deg(rows: int, cols: int) -> tuple[np.ndarray, np.ndarray]:
    """Pixel-center latitudes (north to south) and longitudes (-180° to 180°) of a globe grid."""
    lat = 90.0 - (np.arange(rows) + 0.5) * 180.0 / rows
    lon = -180.0 + (np.arange(cols) + 0.5) * 360.0 / cols
    return lat, lon


def test_plane_tilted_east_has_constant_east_slope_and_no_north_slope() -> None:
    rows, cols, tilt = 180, 360, 0.2
    lat, lon = _globe_lat_lon_deg(rows, cols)
    # Rising 0.2 m per meter of eastward travel along the equator, the same at every latitude.
    heights = np.tile(tilt * MOON_RADIUS_M * np.radians(lon), (rows, 1))
    east, north = slopes.sphere_slopes(heights)
    # Columns 0 and -1 see the jump where +180° wraps to -180°; the pole rows look across the pole.
    inner = (slice(1, -1), slice(1, -1))
    assert north[inner] == pytest.approx(0.0, abs=1e-9)
    # A meridian step is shorter by cos(lat) away from the equator, so the slope is steeper there.
    expected = np.broadcast_to(tilt / np.cos(np.radians(lat))[:, None], (rows, cols))
    assert east[inner] == pytest.approx(expected[inner], rel=1e-9)
    at_equator = east[rows // 2 - 1 : rows // 2 + 1, 1:-1]
    assert at_equator == pytest.approx(tilt, rel=1e-4)
    assert np.ptp(at_equator) < 1e-9


def test_east_slope_wraps_in_longitude() -> None:
    rows, cols = 90, 180
    _, lon = _globe_lat_lon_deg(rows, cols)
    heights = np.tile(1000.0 * np.cos(np.radians(lon)), (rows, 1))  # smooth across the ±180° seam
    east, _ = slopes.sphere_slopes(heights)
    row = rows // 2
    step_m = MOON_RADIUS_M * np.cos(np.radians(1.0)) * np.radians(2.0)
    assert east[row, 0] == pytest.approx((heights[row, 1] - heights[row, -1]) / (2 * step_m))
    assert east[row, 0] == pytest.approx(-east[row, -1])


def test_height_falling_toward_the_south_is_a_positive_north_slope() -> None:
    rows, cols, tilt = 180, 360, 0.1
    lat, _ = _globe_lat_lon_deg(rows, cols)
    heights = np.tile((tilt * MOON_RADIUS_M * np.radians(lat))[:, None], (1, cols))
    east, north = slopes.sphere_slopes(heights)
    assert east == pytest.approx(0.0, abs=1e-9)
    assert north[1:-1] == pytest.approx(tilt, rel=1e-9)


def test_slopes_stay_finite_at_the_poles() -> None:
    rng = np.random.default_rng(7)
    east, north = slopes.sphere_slopes(rng.normal(scale=500.0, size=(64, 128)))
    assert np.isfinite(east).all()
    assert np.isfinite(north).all()


def test_minimum_east_step_tames_the_pole_rows_and_leaves_smooth_terrain_alone() -> None:
    rows, cols = 64, 128
    rng = np.random.default_rng(11)
    noise = rng.normal(scale=1.0, size=(rows, cols))
    step_m = 20_000.0  # wider than one column poleward of about 76°, on this coarse grid
    plain, _ = slopes.sphere_slopes(noise)
    widened, north = slopes.sphere_slopes(noise, min_east_step_m=step_m)
    assert np.abs(widened).max() <= np.ptp(noise) / (2 * step_m)
    assert np.abs(plain[0]).max() > 3 * np.abs(widened[0]).max()
    near_equator = slice(rows // 2 - 8, rows // 2 + 8)
    assert (widened[near_equator] == plain[near_equator]).all()
    assert (north == slopes.sphere_slopes(noise)[1]).all()
    # A steady rise toward the east reads the same however far the difference reaches.
    lat, lon = _globe_lat_lon_deg(rows, cols)
    ramp = np.tile(0.2 * MOON_RADIUS_M * np.radians(lon), (rows, 1))
    east, _ = slopes.sphere_slopes(ramp, min_east_step_m=step_m)
    # In the pole row the difference reaches 10 columns each way: skip those near the seam.
    assert east[0, 10:-10] == pytest.approx(0.2 / np.cos(np.radians(lat[0])), rel=1e-9)


def test_pole_rows_look_across_the_pole() -> None:
    rows, cols = 4, 8
    heights = np.zeros((rows, cols))
    heights[0, 6] = 100.0  # directly across the north pole from column 2
    _, north = slopes.sphere_slopes(heights)
    row_m = MOON_RADIUS_M * np.pi / rows
    assert north[0, 2] == pytest.approx(100.0 / (2 * row_m))


def test_cone_on_a_square_grid_has_the_right_signs() -> None:
    size, pixel_m, steepness = 101, 50.0, 0.3
    half = (size - 1) / 2 * pixel_m
    x = np.linspace(-half, half, size)[None, :]
    y = np.linspace(half, -half, size)[:, None]  # row 0 is the largest y
    radius = np.hypot(x, y)
    slope_x, slope_y = slopes.grid_slopes(steepness * radius, pixel_m)  # a pit: lowest at center
    # Central differences round off the tip, and the image edges use coarser one-sided steps.
    away = radius > 10 * pixel_m
    away[[0, -1], :] = False
    away[:, [0, -1]] = False
    expected_x = np.broadcast_to(steepness * x / np.maximum(radius, 1.0), radius.shape)
    expected_y = np.broadcast_to(steepness * y / np.maximum(radius, 1.0), radius.shape)
    assert slope_x[away] == pytest.approx(expected_x[away], abs=3e-3)
    assert slope_y[away] == pytest.approx(expected_y[away], abs=3e-3)
    middle = size // 2
    # Right of center the ground rises toward +x; left of center it falls toward +x.
    assert slope_x[middle, -10] == pytest.approx(steepness)
    assert slope_x[middle, 10] == pytest.approx(-steepness)
    # Row 10 is near the top (large y): the ground rises toward +y there, and falls near the bottom.
    assert slope_y[10, middle] == pytest.approx(steepness)
    assert slope_y[-10, middle] == pytest.approx(-steepness)


def test_missing_data_is_flat_and_does_not_leak() -> None:
    heights = np.tile(np.arange(7.0) * 10.0, (7, 1))  # rises 10 m per 10 m pixel toward +x
    heights[3, 3] = np.nan
    slope_x, slope_y = slopes.grid_slopes(heights, 10.0)
    assert np.isfinite(slope_x).all() and np.isfinite(slope_y).all()
    assert slope_x[3, 2:5].tolist() == [0.0, 0.0, 0.0]  # the hole and its two x neighbors
    assert slope_y[2:5, 3].tolist() == [0.0, 0.0, 0.0]  # the hole and its two y neighbors
    assert slope_x[3, 1] == pytest.approx(1.0)
    assert slope_x[2, 3] == pytest.approx(1.0)
    all_missing = slopes.grid_slopes(np.full((5, 5), np.nan), 10.0)
    assert not all_missing[0].any() and not all_missing[1].any()


def test_encoding_round_trips_within_half_a_step() -> None:
    slope = np.linspace(-1.0, 1.0, 2001)
    encoded = slopes.encode_slope(slope)
    assert encoded.dtype == np.uint8
    assert np.abs(slopes.decode_slope(encoded) - slope).max() <= 0.5 / 127 + 1e-12
    assert slopes.encode_slope(np.array([0.0, 1.0, -1.0, 0.5])).tolist() == [128, 255, 1, 192]
    every_value = np.arange(1, 256, dtype=np.uint8)
    assert (slopes.encode_slope(slopes.decode_slope(every_value)) == every_value).all()


def test_encoding_clamps_and_writes_missing_as_flat() -> None:
    steep = np.array([5.0, -5.0, np.inf, -np.inf, np.nan])
    assert slopes.encode_slope(steep).tolist() == [255, 1, 255, 1, 128]
    assert slopes.encode_slope(np.array([0.5]), slope_max=0.5).tolist() == [255]
    assert slopes.clamped_fraction(np.array([0.2, 1.0, 1.5, -2.0])) == 0.5


def test_area_mean_splits_cells_that_straddle_an_edge() -> None:
    row = np.array([[0.0, 3.0, 6.0]])
    # Two output pixels over three cells: each takes one whole cell and half of the middle one.
    assert slopes.area_mean(row, 1, 2).tolist() == [[1.0, 5.0]]
    rng = np.random.default_rng(3)
    grid = rng.normal(size=(12, 20))
    assert slopes.area_mean(grid, 3, 5) == pytest.approx(grid.reshape(3, 4, 5, 4).mean(axis=(1, 3)))
    assert slopes.area_mean(grid, 5, 7).mean() == pytest.approx(grid.mean())


def test_area_mean_ignores_missing_data() -> None:
    grid = np.array([[1.0, np.nan, 5.0, 5.0], [3.0, 2.0, np.nan, np.nan]])
    assert slopes.area_mean(grid, 1, 2).tolist() == [[2.0, 5.0]]
    assert np.isnan(slopes.area_mean(np.full((4, 4), np.nan), 2, 2)).all()


def test_area_mean_by_strips_matches_the_whole_raster() -> None:
    rng = np.random.default_rng(5)
    grid = rng.normal(size=(90, 40))
    grid[10:14, 5:9] = np.nan
    calls: list[tuple[int, int]] = []

    def read_rows(start: int, stop: int) -> np.ndarray:
        calls.append((start, stop))
        return grid[start:stop]

    by_strips = slopes.area_mean_by_strips(read_rows, 90, 8, 6, strip_rows=45)
    assert by_strips == pytest.approx(slopes.area_mean(grid, 8, 6))
    assert calls == [(0, 45), (45, 90)]
