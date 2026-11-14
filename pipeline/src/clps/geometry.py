"""Spherical-Moon geometry helpers (pure functions).

Conventions: latitude/longitude in degrees (planetocentric, east-positive longitude), Moon-fixed
Cartesian vectors in meters in the ``MOON_ME`` frame, azimuth in degrees from local north, clockwise
(east = 90°). Local north at a south-pole site points toward the equator.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

#: Reference radius for LOLA heights (meters).
MOON_RADIUS_M: float = 1_737_400.0

FloatArray = NDArray[np.float64]


def unit_vector(lat_deg: ArrayLike, lon_deg: ArrayLike) -> FloatArray:
    """Unit vector(s) for planetocentric lat/lon (degrees); shape (..., 3)."""
    lat = np.radians(np.asarray(lat_deg, dtype=float))
    lon = np.radians(np.asarray(lon_deg, dtype=float))
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def vector_to_latlon(vec: ArrayLike) -> tuple[FloatArray, FloatArray]:
    """Planetocentric (lat_deg, lon_deg) of vector(s) of shape (..., 3); lon in (-180, 180]."""
    v = np.asarray(vec, dtype=float)
    lat = np.degrees(np.arctan2(v[..., 2], np.hypot(v[..., 0], v[..., 1])))
    lon = np.degrees(np.arctan2(v[..., 1], v[..., 0]))
    return lat, lon


def enu_basis(lat_deg: float, lon_deg: float) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Local (east, north, up) unit vectors at a site; rejects sites at a pole."""
    if abs(lat_deg) >= 90.0 - 1e-9:
        raise ValueError("local north/east are undefined exactly at a pole")
    up = unit_vector(lat_deg, lon_deg)
    east = np.cross([0.0, 0.0, 1.0], up)
    east /= np.linalg.norm(east)
    north = np.cross(up, east)
    return east, north, up


def az_el_deg(
    vec: ArrayLike, east: FloatArray, north: FloatArray, up: FloatArray
) -> tuple[FloatArray, FloatArray]:
    """Azimuth (0–360°, from north, clockwise) and elevation (°) of direction vector(s) (..., 3)."""
    v = np.asarray(vec, dtype=float)
    e, n, u = v @ east, v @ north, v @ up
    az = np.degrees(np.arctan2(e, n)) % 360.0
    el = np.degrees(np.arctan2(u, np.hypot(e, n)))
    return az, el
