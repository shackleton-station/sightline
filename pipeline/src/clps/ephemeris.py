"""Topocentric Sun/Earth directions at a lunar surface site, from SPICE.

Vectors come from ``spkcpo`` (constant-position observer fixed in ``MOON_ME``) with light-time +
stellar aberration (``LT+S``), then are rotated into local east/north/up with the same convention
as the horizon mask (see ``geometry.py``). Kernels must be loaded first (``load_kernels``).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import spiceypy

from clps.geometry import FloatArray, az_el_deg, enu_basis, unit_vector

FRAME = "MOON_ME"
ABCORR = "LT+S"

#: Body radii (km) for apparent angular size: IAU nominal solar radius; Earth mean radius.
SUN_RADIUS_KM = 695_700.0
EARTH_RADIUS_KM = 6_371.0


@dataclass(frozen=True)
class Track:
    """Apparent direction of a target from the site at each time.

    Attributes:
        az_deg, el_deg: topocentric azimuth (from north, clockwise) and elevation, degrees.
        dist_km: observer–target distance, km.
        unit_me: unit vector site→target in ``MOON_ME``, shape (n, 3).
    """

    az_deg: FloatArray
    el_deg: FloatArray
    dist_km: FloatArray
    unit_me: FloatArray


def utc_range(start: str, end: str, step_h: int = 1) -> np.ndarray:
    """Regular UTC times in [start, end) as ``datetime64[s]`` (ISO-8601 strings in, UTC)."""
    t0, t1 = np.datetime64(start, "s"), np.datetime64(end, "s")
    return np.arange(t0, t1, np.timedelta64(step_h, "h"))


def to_et(times: np.ndarray) -> FloatArray:
    """Ephemeris time (TDB s past J2000) for UTC ``datetime64`` values (str2et assumes UTC)."""
    return np.array([spiceypy.str2et(t) for t in times.astype("datetime64[s]").astype(str)])


def site_position_km(lat_deg: float, lon_deg: float, radius_km: float) -> FloatArray:
    """Observer position in ``MOON_ME`` (km) at ``radius_km`` from the Moon's center."""
    return radius_km * unit_vector(lat_deg, lon_deg)


def body_track(
    target: str, lat_deg: float, lon_deg: float, radius_km: float, et: FloatArray
) -> Track:
    """Apparent topocentric track of ``target`` (e.g. ``"SUN"``, ``"EARTH"``) from a surface site.

    Args:
        target: SPICE body name.
        lat_deg, lon_deg: site (degrees, planetocentric, east-positive).
        radius_km: observer distance from the Moon center (ref. radius + terrain + eye height).
        et: ephemeris times (TDB seconds past J2000).
    """
    obspos = site_position_km(lat_deg, lon_deg, radius_km)

    def position_km(t: float) -> FloatArray:
        state, _ = spiceypy.spkcpo(target, t, FRAME, "OBSERVER", ABCORR, obspos, "MOON", FRAME)
        return np.asarray(state[:3])

    vec = np.array([position_km(float(t)) for t in np.atleast_1d(et)])
    dist = np.linalg.norm(vec, axis=1)
    unit = vec / dist[:, None]
    east, north, up = enu_basis(lat_deg, lon_deg)
    az, el = az_el_deg(unit, east, north, up)
    return Track(az_deg=az, el_deg=el, dist_km=dist, unit_me=unit)
