"""Browser-model helpers on small synthetic inputs."""

import gzip
from pathlib import Path

import numpy as np
import pytest

from clps import custom, dem


def _world(tmp_path: Path, grid: np.ndarray) -> dem.GlobalDem:
    img, lbl = tmp_path / "w.img", tmp_path / "w.lbl"
    grid.astype("<i2").tofile(img)
    lbl.write_text(
        f"""
LINES = {grid.shape[0]}
LINE_SAMPLES = {grid.shape[1]}
SAMPLE_TYPE = LSB_INTEGER
SAMPLE_BITS = 16
SCALING_FACTOR = 0.5
MAP_RESOLUTION = 128 <pix/deg>
A_AXIS_RADIUS = 1737.4 <km>
CENTER_LONGITUDE = 180 <deg>
MAP_SCALE = 236.9 <m/pix>
LINE_PROJECTION_OFFSET = 11519.5 <pix>
SAMPLE_PROJECTION_OFFSET = 23039.5 <pix>
"""
    )
    return dem.GlobalDem(img, lbl)


def test_downsample_averages_blocks_and_applies_scale(tmp_path: Path) -> None:
    raw = np.zeros((64, 128), np.int16)
    raw[:32, :32] = 100  # one 32×32 block, at factor 32 for 4 pixels per degree
    small = custom.downsample_global(_world(tmp_path, raw), ppd=4)
    assert small.shape == (2, 4)
    assert small[0, 0] == 50  # raw 100 × 0.5 m
    assert small[1, 3] == 0


def test_grid_height_reads_pixel_centers_and_wraps() -> None:
    grid = np.zeros((4, 8), np.int16)
    grid[:, 0] = 100
    grid[:, 7] = 300
    height = custom.grid_height(grid, ppd=1)
    # With 1 pixel per degree, sample 0's center is at 0.5°E, and the seam is at 0°.
    assert height(89.5, 0.5) == pytest.approx(100)
    assert height(89.5, 7.5) == pytest.approx(300)
    assert height(89.5, 0.0) == pytest.approx((100 + 300) / 2)  # halfway across the seam
    assert height(np.array([89.5, 89.5]), np.array([0.5, 7.5])) == pytest.approx([100, 300])


def test_browser_distances_step_up_with_range() -> None:
    d = custom.browser_distances_m()
    assert d[:2].tolist() == [20.0, 40.0]
    assert 5_000.0 in d and 5_150.0 in d and 40_400.0 in d
    assert d[-1] == 200_000.0
    assert (np.diff(d) > 0).all()


def test_near_limits_fall_between_samples() -> None:
    d = custom.browser_distances_m()
    assert custom.NEAR_POLAR_M not in d
    assert custom.NEAR_GLOBAL_M not in d


def test_tile_round_trip_with_wrap_around() -> None:
    tile = np.array([[0, 32000, -32000], [100, 0, 5]], np.int16)
    raw = gzip.decompress(custom.encode_tile(tile))
    deltas = np.frombuffer(raw, "<i2").reshape(tile.shape).copy()
    decoded = deltas.copy()
    decoded[1:, 0] = np.cumsum(deltas[:, 0], dtype=np.int16)[1:]
    decoded = np.cumsum(decoded, axis=1, dtype=np.int16)
    assert (decoded == tile).all()


def test_encoded_tiles_are_reproducible() -> None:
    tile = np.arange(16, dtype=np.int16).reshape(4, 4)
    assert custom.encode_tile(tile) == custom.encode_tile(tile.copy())


def test_quantize_uses_quarter_meters_and_fits_lunar_heights() -> None:
    assert custom.quantize_polar(np.array([1.0, -0.25, 7027.2, -7296.8])).tolist() == [
        4,
        -1,
        28109,
        -29187,
    ]


def _browser_terrain(polar_m: float, far_m: float, near_m: float, coarse_m: int):  # type: ignore[no-untyped-def]
    class World:
        def height_at(self, lat, lon):  # type: ignore[no-untyped-def]
            return np.full(np.shape(lat), near_m)

    polar = np.full((30400, 30400), int(polar_m / custom.POLAR_QUANT_M), np.int16)
    far = np.full((1216, 1216), int(far_m / custom.POLAR_QUANT_M), np.int16)
    coarse = np.full((720, 1440), coarse_m, np.int16)
    return custom.BrowserTerrain(polar, far, World(), coarse)  # type: ignore[arg-type]


def test_browser_terrain_picks_resolution_by_place_and_distance() -> None:
    terrain = _browser_terrain(100.0, 200.0, 300.0, 400)

    # Near the south pole: 20 m close by, 500 m beyond 5 km.
    at_pole = terrain.height_fn(-89.0, 0.0)
    assert at_pole(np.array([-89.0]), np.array([0.0])) == pytest.approx([100.0])
    assert at_pole(np.array([-88.5]), np.array([0.0])) == pytest.approx([200.0])

    # Far from the pole: 237 m within 40 km, coarse beyond.
    at_equator = terrain.height_fn(0.0, 0.0)
    assert at_equator(np.array([0.0]), np.array([0.5])) == pytest.approx([300.0])
    assert at_equator(np.array([0.0]), np.array([3.0])) == pytest.approx([400.0])

    # The north pole has no polar terrain.
    at_north = terrain.height_fn(89.0, 0.0)
    assert at_north(np.array([89.0]), np.array([0.0])) == pytest.approx([300.0])


def test_random_points_stay_in_the_band_in_both_hemispheres() -> None:
    lat, lon = custom.random_points(np.random.default_rng(1), 30.0, 50.0, 200)
    assert (np.abs(lat) >= 30).all() and (np.abs(lat) <= 50).all()
    assert (lat > 0).any() and (lat < 0).any()
    assert (np.abs(lon) <= 180).all()


def test_accuracy_is_zero_when_the_models_match() -> None:
    flat = lambda lat, lon: np.zeros(np.shape(lat))  # noqa: E731
    up = np.array([True, False, True])

    def observe(lat, lon, radius_km, mask):  # type: ignore[no-untyped-def]
        return up, up

    band = custom.accuracy_at_points(
        0.0,
        30.0,
        np.array([1.0, 2.0, 3.0]),
        np.array([1.0, 2.0, 3.0]),
        flat,
        custom.browser_distances_m(),
        lambda lat, lon: flat,
        observe,
    )
    assert band.n == 3
    assert band.sun_p90_error == 0
    assert band.earth_p90_error == 0
    assert band.hours_agree_p10_pct == 100
