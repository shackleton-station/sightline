"""Horizon mask against analytic cases on synthetic terrain."""

import math

import numpy as np
import pytest

from clps.geometry import MOON_RADIUS_M, unit_vector
from clps.horizon import horizon_mask, sample_distances_m

SITE = (-89.0, 0.0)


def flat(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    return np.zeros_like(lat)


def test_smooth_sphere_dip_angle() -> None:
    h = 2.0
    mask = horizon_mask(*SITE, flat, obs_height_m=h, distances_m=sample_distances_m(20_000))
    expected = -math.degrees(math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + h)))  # ≈ -0.0870°
    assert expected == pytest.approx(-math.degrees(math.sqrt(2 * h / MOON_RADIUS_M)), abs=1e-4)
    assert len(mask.az_deg) == 720
    np.testing.assert_allclose(mask.el_deg, expected, atol=0.002)


def _ridge(az0_deg: float, dist_m: float, height_m: float, depth_m: float = 1_000.0):
    """Plateau of ``height_m`` starting ``dist_m`` from SITE, ±5° of bearing around ``az0_deg``."""
    site = unit_vector(*SITE)
    east = np.cross([0, 0, 1.0], site)
    east /= np.linalg.norm(east)
    north = np.cross(site, east)

    def height(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        p = unit_vector(lat, lon)
        d = np.arccos(np.clip(p @ site, -1, 1)) * MOON_RADIUS_M
        az = np.degrees(np.arctan2(p @ east, p @ north)) % 360
        daz = (az - az0_deg + 180) % 360 - 180
        inside = (d >= dist_m) & (d <= dist_m + depth_m) & (np.abs(daz) <= 5)
        return np.where(inside, height_m, 0.0)

    return height


def test_ridge_peak_at_known_bearing_and_angle() -> None:
    az0, dist, height, obs = 120.0, 3_000.0, 300.0, 2.0
    mask = horizon_mask(*SITE, _ridge(az0, dist, height), obs_height_m=obs)

    theta = dist / MOON_RADIUS_M
    r_top, r_obs = MOON_RADIUS_M + height, MOON_RADIUS_M + obs
    expected = math.degrees(math.atan2(r_top * math.cos(theta) - r_obs, r_top * math.sin(theta)))

    i = int(np.argmax(mask.el_deg))
    assert abs(mask.az_deg[i] - az0) <= 5.0
    at_az0 = mask.el_deg[np.searchsorted(mask.az_deg, az0)]
    assert at_az0 == pytest.approx(expected, abs=0.02)
    assert mask.dist_m[np.searchsorted(mask.az_deg, az0)] == pytest.approx(dist, abs=20.0)
    # Away from the ridge the horizon is the smooth-sphere dip.
    assert mask.el_deg[np.searchsorted(mask.az_deg, 300.0)] < 0


def test_reach_reports_dem_edge() -> None:
    def clipped(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        return np.where(lat < -88.5, 0.0, np.nan)  # DEM ends ~15 km toward the equator

    mask = horizon_mask(*SITE, clipped, distances_m=sample_distances_m(50_000))
    north_reach = mask.reach_m[0]
    south_reach = mask.reach_m[360]
    assert north_reach < 16_000
    assert south_reach == pytest.approx(50_000, abs=150)
