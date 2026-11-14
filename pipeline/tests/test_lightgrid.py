"""The light grid on synthetic terrain: its kernels against the site pipeline and analytics."""

from __future__ import annotations

import numpy as np
import pytest
from pyproj import CRS
from rasterio.transform import Affine

from clps import dem, lightgrid
from clps.ephemeris import SUN_RADIUS_KM
from clps.geometry import MOON_RADIUS_M, enu_basis, unit_vector
from clps.horizon import horizon_mask, sample_distances_m
from clps.visibility import disk_fraction

MOON_SOUTH_POLAR = CRS.from_proj4(
    "+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
)
PIXEL_M = 100.0
HALF_M = 30_000.0
SUN_KM = 1.496e8


def make_terrain(heights: np.ndarray) -> tuple[lightgrid.Terrain, dem.DemWindow]:
    """The same synthetic square of ground for the compiled kernel and for the site pipeline."""
    grid = heights.astype(np.float32)
    plane = lightgrid.polar_plane(MOON_SOUTH_POLAR, check_reach_m=HALF_M)
    window = dem.DemWindow(grid, Affine(PIXEL_M, 0, -HALF_M, 0, -PIXEL_M, HALF_M), MOON_SOUTH_POLAR)
    return lightgrid.Terrain(grid, -HALF_M, HALF_M, PIXEL_M, plane), window


def pixel_centers() -> tuple[np.ndarray, np.ndarray]:
    side = round(2 * HALF_M / PIXEL_M)
    centers = -HALF_M + PIXEL_M * (np.arange(side) + 0.5)
    return np.meshgrid(centers, -centers)


def observer_at(terrain: lightgrid.Terrain, lat: float, lon: float, height_m: float = 2.0):
    up = unit_vector([lat], [lon])
    return lightgrid.observers(up, terrain.height_at(up), height_m)


def sky_position_km(lat: float, lon: float, az_deg: float, el_deg: float, dist_km: float = SUN_KM):
    """A point in the sky of a site, as a position from the Moon's center (km), shape (1, 3)."""
    east, north, up = enu_basis(lat, lon)
    az, el = np.radians(az_deg), np.radians(el_deg)
    toward = np.cos(el) * (np.cos(az) * north + np.sin(az) * east) + np.sin(el) * up
    return (dist_km * toward + MOON_RADIUS_M / 1000.0 * up)[None, :]


def test_closed_form_plane_matches_the_crs_and_round_trips() -> None:
    plane = lightgrid.polar_plane(MOON_SOUTH_POLAR)
    x = np.array([0.0, 1234.5, -60_000.0, 250_000.0])
    y = np.array([75.0, -9876.0, 60_000.0, -100_000.0])
    back_x, back_y = plane.project(plane.unproject(x, y))
    assert np.allclose(back_x, x, atol=1e-6) and np.allclose(back_y, y, atol=1e-6)
    # Map y points toward 0° east in this CRS, map x toward 90° east.
    assert plane.y_axis == pytest.approx((1.0, 0.0), abs=1e-12)
    assert plane.x_axis == pytest.approx((0.0, 1.0), abs=1e-12)


def test_a_plane_that_is_not_what_the_crs_says_is_refused() -> None:
    north_polar = CRS.from_proj4("+proj=stere +lat_0=90 +lon_0=0 +k=1 +R=1737400 +units=m +no_defs")
    with pytest.raises(ValueError, match="closed-form"):
        lightgrid.polar_plane(north_polar)


def test_grid_is_centered_with_row_zero_at_the_largest_y() -> None:
    x, y = lightgrid.grid_xy_m(4, 100.0)
    assert x[0].tolist() == [-150.0, -50.0, 50.0, 150.0]
    assert y[:, 0].tolist() == [150.0, 50.0, -50.0, -150.0]


def test_smooth_sphere_horizon_is_the_dip_of_the_eye_height() -> None:
    terrain, _ = make_terrain(np.zeros((600, 600)))
    at = observer_at(terrain, -89.9, 30.0)
    horizon = lightgrid.horizons(terrain, at, sample_distances_m(20_000.0))
    assert horizon.shape == (1, 720)
    assert np.allclose(horizon, -np.degrees(np.sqrt(2 * 2.0 / MOON_RADIUS_M)), atol=2e-3)


def test_kernel_matches_the_site_pipeline_on_rough_terrain() -> None:
    rng = np.random.default_rng(3)
    x, y = pixel_centers()
    heights = 400 * np.sin(x / 3000.0) * np.cos(y / 2100.0) + rng.normal(0, 15, x.shape)
    terrain, window = make_terrain(heights)
    distances = sample_distances_m(15_000.0)
    for lat, lon in ((-89.8, 12.0), (-89.95, -140.0), (-89.7, 100.0)):
        ours = lightgrid.horizons(terrain, observer_at(terrain, lat, lon), distances)[0]
        reference = horizon_mask(lat, lon, window.height_at, 2.0, distances)
        assert np.max(np.abs(ours - reference.el_deg)) < 1e-4


def test_a_ridge_at_a_known_bearing_gives_the_expected_angle() -> None:
    # A long wall 5 km toward +x from the pole, 300 m high, across y. Seen from next to the pole.
    x, _ = pixel_centers()
    terrain, _ = make_terrain(np.where(np.abs(x - 5000.0) < 150.0, 300.0, 0.0))
    lat, lon = -89.999, 0.0
    at = observer_at(terrain, lat, lon)
    horizon = lightgrid.horizons(terrain, at, sample_distances_m(20_000.0))[0]
    # From near the pole, map +x (90° east) is local east: azimuth 90°. A long wall is nearly as
    # high a few degrees either side, so the peak is looked for loosely and its height exactly.
    east_az = int(np.argmax(horizon)) * lightgrid.AZ_STEP_DEG
    assert abs(east_az - 90.0) <= 10.0
    assert horizon[round(90.0 / lightgrid.AZ_STEP_DEG)] == pytest.approx(horizon.max(), abs=0.02)
    # The wall's top starts at the pixel center 4950 m out; the ground curves away below it.
    top_m = 4950.0
    rise_m = 300.0 - 2.0 - top_m**2 / (2 * MOON_RADIUS_M)
    assert horizon.max() == pytest.approx(np.degrees(np.arctan2(rise_m, top_m)), abs=0.03)
    # The other way there is nothing but the smooth ground.
    assert horizon[round(270.0 / lightgrid.AZ_STEP_DEG)] < 0.0


def test_the_sun_behind_the_ridge_is_down_and_in_the_open_is_up() -> None:
    x, _ = pixel_centers()
    terrain, _ = make_terrain(np.where(np.abs(x - 5000.0) < 150.0, 300.0, 0.0))
    lat, lon = -89.999, 0.0
    at = observer_at(terrain, lat, lon)
    horizon = lightgrid.horizons(terrain, at, sample_distances_m(20_000.0))
    behind = sky_position_km(lat, lon, 90.0, 1.5)
    in_the_open = sky_position_km(lat, lon, 270.0, 1.5)
    over_the_top = sky_position_km(lat, lon, 90.0, 5.0)
    positions = np.concatenate([behind, in_the_open, over_the_top])
    flags = lightgrid.up_flags(horizon, at, positions, SUN_RADIUS_KM)
    assert flags.tolist() == [[False, True, True]]
    # A deliberately wrong sky, turned half way round, gets the first two the other way about.
    wrong = lightgrid.up_flags(horizon, at, positions, SUN_RADIUS_KM, az_shift_deg=180.0)
    assert wrong.tolist() == [[True, False, True]]


def test_flags_match_the_site_pipelines_disk_fraction() -> None:
    rng = np.random.default_rng(5)
    x, y = pixel_centers()
    terrain, window = make_terrain(300 * np.sin(x / 2500.0) * np.cos(y / 1800.0))
    lat, lon = -89.85, 47.0
    distances = sample_distances_m(15_000.0)
    at = observer_at(terrain, lat, lon)
    horizon = lightgrid.horizons(terrain, at, distances)
    mask = horizon_mask(lat, lon, window.height_at, 2.0, distances)
    az = rng.uniform(0, 360, 400)
    el = rng.uniform(-3, 6, 400)
    positions = np.concatenate(
        [sky_position_km(lat, lon, a, e) for a, e in zip(az, el, strict=True)]
    )
    flags = lightgrid.up_flags(horizon, at, positions, SUN_RADIUS_KM)[0]
    dist = np.full(400, SUN_KM)
    fraction = disk_fraction(az, el, dist, SUN_RADIUS_KM, mask.az_deg, mask.el_deg)
    # The Sun's direction from the site differs from the one aimed at by the site's own offset
    # from the Moon's center over 1 AU: far below anything that could move a flag here.
    assert np.array_equal(flags, fraction > 0)
    any_part, disk = lightgrid.averages_pct(horizon, at, positions, SUN_RADIUS_KM)
    assert any_part[0] == pytest.approx(100.0 * np.mean(fraction > 0), abs=1e-3)
    assert disk[0] == pytest.approx(100.0 * np.mean(fraction), abs=1e-2)


def test_flips_round_trip() -> None:
    rng = np.random.default_rng(7)
    hours = 744
    flags = np.zeros((50, hours), bool)
    for row in flags:
        edges = np.sort(rng.choice(hours, rng.integers(0, 9), replace=False))
        for start, end in zip(edges[::2], edges[1::2], strict=False):
            row[start:end] = True
        if len(edges) % 2:
            row[edges[-1] :] = True
    kept, found, changed = lightgrid.flips(flags, 8)
    assert kept.dtype == np.uint16 and kept.shape == (50, 8)
    assert np.array_equal(lightgrid.flags_from_flips(kept, hours), flags)
    assert not changed.any()
    assert found.max() <= 8


def test_always_up_and_always_down_rows() -> None:
    flags = np.array([[True] * 10, [False] * 10])
    kept, found, _ = lightgrid.flips(flags, 2)
    assert kept.tolist() == [[0, 10], [10, 10]]
    assert found.tolist() == [1, 0]


def test_too_many_flips_merge_the_shortest_runs_and_count_the_hours_changed() -> None:
    #        up 0-9, down 10, up 11-19, down 20-39, up 40-41, down 42-59
    flags = np.zeros((1, 60), bool)
    flags[0, 0:10] = True
    flags[0, 11:20] = True
    flags[0, 40:42] = True
    kept, found, changed = lightgrid.flips(flags, 2)
    assert found[0] == 6
    decoded = lightgrid.flags_from_flips(kept, 60)
    # The one-hour gap is filled, then the two-hour run is dropped: three hours differ.
    assert kept[0].tolist() == [0, 20]
    assert changed[0] == 3 == int(np.sum(decoded != flags))
    with pytest.raises(ValueError, match="even"):
        lightgrid.flips(flags, 3)


def test_month_file_round_trips() -> None:
    rng = np.random.default_rng(9)
    sun = rng.integers(0, 745, (16, 8)).astype(np.uint16)
    earth = rng.integers(0, 745, (16, 4)).astype(np.uint16)
    blob = lightgrid.encode_month(sun, earth, 4)
    assert blob == lightgrid.encode_month(sun, earth, 4)
    back_sun, back_earth = lightgrid.decode_month(blob, 4, 8, 4)
    assert np.array_equal(back_sun, sun) and np.array_equal(back_earth, earth)
    with pytest.raises(ValueError, match="grid"):
        lightgrid.decode_month(blob, 4, 8, 2)


def test_comparison_and_agreement() -> None:
    ours, theirs = np.array([10.0, 20.0, np.nan, 40.0]), np.array([12.0, 20.0, 5.0, 36.0])
    stats = lightgrid.comparison(ours, theirs)
    assert stats == {"n": 3, "bias": 0.67, "mean_abs": 2.0, "rmse": 2.58, "r": 1.0}
    theirs = np.array([True] * 9 + [False])
    always_up = np.ones(10, bool)
    scores = lightgrid.agreement(always_up, theirs)
    assert scores == {"hours": 10, "agree_pct": 90.0, "balanced_pct": 50.0}


FAR_LABEL = """
LINES                 = 720
LINE_SAMPLES          = 1440
SAMPLE_TYPE           = LSB_INTEGER
SAMPLE_BITS           = 16
SCALING_FACTOR        = 0.5
MAP_RESOLUTION               = 4 <pix/deg>
A_AXIS_RADIUS                = 1737.4 <km>
CENTER_LONGITUDE             = 180 <deg>
MAP_SCALE                    = 7580.0 <m/pix>
LINE_PROJECTION_OFFSET       = 359.5 <pix>
SAMPLE_PROJECTION_OFFSET     = 719.5 <pix>
"""


def test_rays_that_leave_the_polar_dem_read_the_whole_moon_map_as_a_site_does(tmp_path) -> None:
    # A whole-Moon map of rolling ground, four pixels to a degree, as a PDS file and its label.
    lat = 90.0 - (np.arange(720) + 0.5) / 4.0
    lon = (np.arange(1440) + 0.5) / 4.0
    rolling = 900 * np.sin(np.radians(3 * lon))[None, :] * np.cos(np.radians(8 * lat))[:, None]
    img, lbl = tmp_path / "g.img", tmp_path / "g.lbl"
    np.round(rolling / 0.5).astype("<i2").tofile(img)
    lbl.write_text(FAR_LABEL)
    world = dem.GlobalDem(img, lbl)

    # The polar DEM is a 60 km square of flat ground; rays of 150 km run well off it.
    terrain, window = make_terrain(np.zeros((600, 600)))
    far, far_geom = lightgrid.far_terrain(world.grid, world.geometry())
    both = lightgrid.Terrain(
        terrain.heights_m, terrain.x_left_m, terrain.y_top_m, terrain.pixel_m, terrain.plane,
        far, far_geom,
    )  # fmt: skip
    assert far.shape == (122, 1440)  # the rows south of 60° S, and one more
    distances = sample_distances_m(150_000.0)
    composite = dem.composite_height(window.height_at, world.height_at)
    for site_lat, site_lon in ((-89.7, 20.0), (-89.2, -160.0)):
        at = observer_at(both, site_lat, site_lon)
        ours = lightgrid.horizons(both, at, distances)[0]
        reference = horizon_mask(site_lat, site_lon, composite, 2.0, distances)
        assert np.max(np.abs(ours - reference.el_deg)) < 1e-4
        # Without the whole-Moon map the far hills are missing, so the two must differ.
        alone = lightgrid.horizons(terrain, observer_at(terrain, site_lat, site_lon), distances)[0]
        assert np.max(np.abs(alone - reference.el_deg)) > 0.05
