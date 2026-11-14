"""Horizon mask: maximum terrain elevation angle per azimuth, seen from a site.

Rays are marched along great circles in Moon-fixed 3D Cartesian coordinates, so lunar curvature is
handled exactly (see CLAUDE.md §3.4). Terrain heights come from a vectorized ``height_fn(lat, lon)``
returning meters above the 1737.4 km reference sphere, with NaN where there is no data.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from clps.geometry import MOON_RADIUS_M, FloatArray, enu_basis, vector_to_latlon

HeightFn = Callable[[FloatArray, FloatArray], FloatArray]


@dataclass(frozen=True)
class HorizonMask:
    """Horizon elevation per azimuth.

    Attributes:
        az_deg: azimuths (degrees from north, clockwise), shape (n,).
        el_deg: horizon elevation angle (degrees), shape (n,).
        dist_m: ground distance to the horizon-defining terrain point (meters), shape (n,).
        reach_m: farthest distance with valid terrain along each ray (meters), shape (n,);
            less than the requested range means the ray ran off the DEM.
    """

    az_deg: FloatArray
    el_deg: FloatArray
    dist_m: FloatArray
    reach_m: FloatArray


def sample_distances_m(
    max_range_m: float = 150_000.0,
    near_step_m: float = 20.0,
    near_range_m: float = 5_000.0,
    far_step_m: float = 150.0,
) -> FloatArray:
    """Ground distances (m) to sample along each ray: fine steps near the site, coarser far away."""
    near = np.arange(near_step_m, min(near_range_m, max_range_m) + 1e-6, near_step_m)
    far = np.arange(near_range_m + far_step_m, max_range_m + 1e-6, far_step_m)
    return np.concatenate([near, far])


def horizon_mask(
    lat_deg: float,
    lon_deg: float,
    height_fn: HeightFn,
    obs_height_m: float = 2.0,
    distances_m: FloatArray | None = None,
    az_step_deg: float = 0.5,
    radius_m: float = MOON_RADIUS_M,
) -> HorizonMask:
    """Compute the horizon mask at a site.

    Args:
        lat_deg, lon_deg: site location (degrees, planetocentric, east-positive).
        height_fn: terrain height (m above ``radius_m``) at lat/lon arrays (deg); NaN = no data.
        obs_height_m: observer eye height above the local surface (meters).
        distances_m: ground distances to sample along each ray (default: ``sample_distances_m()``).
        az_step_deg: azimuth spacing (degrees); default 0.5° → 720 rays.
        radius_m: reference sphere radius (meters).
    """
    dists = sample_distances_m() if distances_m is None else np.asarray(distances_m, float)
    east, north, up = enu_basis(lat_deg, lon_deg)
    site_h = float(height_fn(np.array([lat_deg]), np.array([lon_deg]))[0])
    if np.isnan(site_h):
        raise ValueError(f"no terrain height at the site ({lat_deg}, {lon_deg})")
    site = (radius_m + site_h + obs_height_m) * up

    az = np.arange(0.0, 360.0, az_step_deg)
    az_r = np.radians(az)
    delta = dists / radius_m  # central angle of each sample (rad)
    # Horizontal unit direction per azimuth, (n_az, 3); point directions (n_az, n_d, 3).
    horiz = np.cos(az_r)[:, None] * north + np.sin(az_r)[:, None] * east
    dirs = np.cos(delta)[None, :, None] * up + np.sin(delta)[None, :, None] * horiz[:, None, :]

    lat, lon = vector_to_latlon(dirs)
    h = height_fn(lat.ravel(), lon.ravel()).reshape(lat.shape)
    points = (radius_m + h)[..., None] * dirs
    rel = points - site
    rel_up = rel @ up
    rel_horiz = np.linalg.norm(rel - rel_up[..., None] * up, axis=-1)
    el = np.degrees(np.arctan2(rel_up, rel_horiz))

    valid = ~np.isnan(el)
    if not valid.any(axis=1).all():
        raise ValueError("some azimuths have no valid terrain samples")
    el_masked = np.where(valid, el, -np.inf)
    idx = np.argmax(el_masked, axis=1)
    rows = np.arange(len(az))
    reach_idx = len(dists) - 1 - np.argmax(valid[:, ::-1], axis=1)
    return HorizonMask(
        az_deg=az,
        el_deg=el_masked[rows, idx],
        dist_m=dists[idx],
        reach_m=dists[reach_idx],
    )
