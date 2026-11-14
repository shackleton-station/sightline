"""Where the Sun is on Earth, so the app can compare a day there with a day on the Moon.

SPICE gives the Sun's direction in an Earth-fixed frame, which fixes the point with the Sun straight
overhead. The Sun's height anywhere on Earth then follows from one formula, also used in the browser
(``web/src/lib/earthSun.ts``). It treats the Sun as infinitely far away, which is off by at most
0.003°, and ignores the atmosphere: refraction lifts the Sun about 0.5° near the horizon, so real
sunsets on Earth come a few minutes later. ``scripts/run_all.py`` checks it against JPL Horizons.
"""

from __future__ import annotations

import numpy as np
import spiceypy

from clps.geometry import FloatArray

EARTH_FRAME = "IAU_EARTH"
ABCORR = "LT+S"


def subsolar_points(et: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Latitude and east longitude (degrees) with the Sun overhead, at each ephemeris time.

    Kernels must be loaded first. Latitude is defined by the Sun's direction, so with
    ``sun_elevation_deg`` it gives elevation above the geodetic horizon.
    """

    def direction(t: float) -> FloatArray:
        position, _ = spiceypy.spkpos("SUN", t, EARTH_FRAME, ABCORR, "EARTH")
        return np.asarray(position)

    vec = np.array([direction(float(t)) for t in np.atleast_1d(et)])
    unit = vec / np.linalg.norm(vec, axis=1)[:, None]
    return np.degrees(np.arcsin(unit[:, 2])), np.degrees(np.arctan2(unit[:, 1], unit[:, 0]))


def sun_elevation_deg(
    lat_deg: float, lon_deg: float, sub_lat_deg: FloatArray, sub_lon_deg: FloatArray
) -> FloatArray:
    """Sun's elevation (degrees) at a geodetic place on Earth, given the point it's overhead."""
    lat, sub_lat = np.radians(lat_deg), np.radians(sub_lat_deg)
    hour_angle = np.radians(lon_deg - sub_lon_deg)
    sine = np.sin(lat) * np.sin(sub_lat) + np.cos(lat) * np.cos(sub_lat) * np.cos(hour_angle)
    return np.degrees(np.arcsin(np.clip(sine, -1.0, 1.0)))
