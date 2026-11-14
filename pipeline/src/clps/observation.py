"""Sun and Earth seen from a site over a time range: tracks and disk fractions above the horizon."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from clps.ephemeris import EARTH_RADIUS_KM, SUN_RADIUS_KM, Track, body_track, to_et
from clps.geometry import FloatArray
from clps.horizon import HorizonMask
from clps.visibility import disk_fraction


@dataclass(frozen=True)
class Observation:
    """Tracks and visible disk fractions (0–1) at each UTC time."""

    times: np.ndarray
    sun: Track
    earth: Track
    sun_frac: FloatArray
    earth_frac: FloatArray


def observe(
    times: np.ndarray, lat_deg: float, lon_deg: float, site_radius_km: float, mask: HorizonMask
) -> Observation:
    """Compute Sun/Earth tracks and visibility; kernels must be loaded.

    Args:
        times: UTC ``datetime64`` values.
        lat_deg, lon_deg: site (degrees, planetocentric, east-positive).
        site_radius_km: observer distance from the Moon's center (km).
        mask: horizon mask computed for the same observer.
    """
    et = to_et(times)
    sun = body_track("SUN", lat_deg, lon_deg, site_radius_km, et)
    earth = body_track("EARTH", lat_deg, lon_deg, site_radius_km, et)
    return Observation(
        times=times,
        sun=sun,
        earth=earth,
        sun_frac=_fraction(sun, SUN_RADIUS_KM, mask),
        earth_frac=_fraction(earth, EARTH_RADIUS_KM, mask),
    )


def select(obs: Observation, keep: NDArray[np.bool_]) -> Observation:
    """The samples of an observation where ``keep`` is true."""
    return Observation(
        times=obs.times[keep],
        sun=_select_track(obs.sun, keep),
        earth=_select_track(obs.earth, keep),
        sun_frac=obs.sun_frac[keep],
        earth_frac=obs.earth_frac[keep],
    )


def _select_track(track: Track, keep: NDArray[np.bool_]) -> Track:
    return Track(track.az_deg[keep], track.el_deg[keep], track.dist_km[keep], track.unit_me[keep])


def _fraction(track: Track, body_radius_km: float, mask: HorizonMask) -> FloatArray:
    return disk_fraction(
        track.az_deg, track.el_deg, track.dist_km, body_radius_km, mask.az_deg, mask.el_deg
    )
