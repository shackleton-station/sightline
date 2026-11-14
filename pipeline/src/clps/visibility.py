"""Sun/Earth visibility above the horizon mask: disk fractions, up/down windows, summary stats.

All functions are pure. Times are ``numpy.datetime64`` arrays (UTC) on a regular step; angles are
degrees.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray

FloatArray = NDArray[np.float64]
BoolArray = NDArray[np.bool_]
TimeArray = NDArray[np.datetime64]


def angular_radius_deg(dist_km: ArrayLike, body_radius_km: float) -> FloatArray:
    """Apparent angular radius (degrees) of a sphere of ``body_radius_km`` at ``dist_km``."""
    return np.degrees(np.arcsin(body_radius_km / np.asarray(dist_km, dtype=float)))


def horizon_el_at(
    az_deg: ArrayLike, mask_az_deg: FloatArray, mask_el_deg: FloatArray
) -> FloatArray:
    """Horizon elevation (degrees) at azimuth(s), linearly interpolated with 360° wrap-around."""
    xp = np.concatenate([mask_az_deg, [mask_az_deg[0] + 360.0]])
    fp = np.concatenate([mask_el_deg, [mask_el_deg[0]]])
    return np.interp(np.asarray(az_deg, dtype=float) % 360.0, xp, fp)


def visible_fraction(clearance_deg: ArrayLike, radius_deg: ArrayLike) -> FloatArray:
    """Fraction (0–1) of a disk visible above a locally flat horizon.

    ``clearance_deg`` = disk-center elevation minus horizon elevation (degrees);
    ``radius_deg`` = disk angular radius. Uses the circular-segment area (small-angle,
    flat-horizon approximation).
    """
    d = np.asarray(clearance_deg, dtype=float)
    r = np.broadcast_to(np.asarray(radius_deg, dtype=float), d.shape)
    x = np.clip(d / r, -1.0, 1.0)
    # Area of the part above the line, normalized by π r²: (acos(-x) + x·sqrt(1-x²)) / π.
    return (np.arccos(-x) + x * np.sqrt(1.0 - x * x)) / np.pi


def disk_fraction(
    az_deg: ArrayLike,
    el_deg: ArrayLike,
    dist_km: ArrayLike,
    body_radius_km: float,
    mask_az_deg: FloatArray,
    mask_el_deg: FloatArray,
) -> FloatArray:
    """Fraction (0–1) of a body's disk above the horizon mask at each sample."""
    clearance = np.asarray(el_deg, dtype=float) - horizon_el_at(az_deg, mask_az_deg, mask_el_deg)
    return visible_fraction(clearance, angular_radius_deg(dist_km, body_radius_km))


@dataclass(frozen=True)
class Window:
    """Interval [start, end) during which a body is up (UTC)."""

    start: np.datetime64
    end: np.datetime64


def runs(flags: BoolArray, value: bool) -> list[tuple[int, int]]:
    """Index ranges [i, j) of consecutive elements equal to ``value``."""
    f = np.asarray(flags, dtype=bool) == value
    edges = np.diff(np.concatenate([[0], f.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1), strict=True))


def windows(times: TimeArray, up: BoolArray) -> list[Window]:
    """Merge consecutive "up" samples into windows.

    A run of up samples from ``times[i]`` to ``times[j-1]`` becomes [times[i], times[j-1] + step);
    i.e. each sample represents the following step.
    """
    step = _step(times)
    return [Window(times[i], times[j - 1] + step) for i, j in runs(up, True)]


def longest_gap_h(times: TimeArray, up: BoolArray) -> float:
    """Longest run of "down" samples, in hours (runs touching the range edges are truncated)."""
    step_h = _step(times) / np.timedelta64(1, "h")
    return max(((j - i) * step_h for i, j in runs(up, False)), default=0.0)


@dataclass(frozen=True)
class Summary:
    """Range statistics for one site (percentages 0–100, gaps in hours)."""

    pct_sun: float
    pct_earth: float
    pct_both: float
    max_sun_gap_h: float
    max_earth_gap_h: float
    sun_windows: list[Window]
    earth_windows: list[Window]


def summarize(times: TimeArray, sun_up: BoolArray, earth_up: BoolArray) -> Summary:
    """Percent of samples with Sun / Earth / both up, longest gaps, and up windows."""
    sun_up = np.asarray(sun_up, dtype=bool)
    earth_up = np.asarray(earth_up, dtype=bool)
    return Summary(
        pct_sun=100.0 * float(sun_up.mean()),
        pct_earth=100.0 * float(earth_up.mean()),
        pct_both=100.0 * float((sun_up & earth_up).mean()),
        max_sun_gap_h=longest_gap_h(times, sun_up),
        max_earth_gap_h=longest_gap_h(times, earth_up),
        sun_windows=windows(times, sun_up),
        earth_windows=windows(times, earth_up),
    )


def _step(times: TimeArray) -> np.timedelta64:
    t = np.asarray(times, dtype="datetime64[s]")
    if len(t) < 2:
        raise ValueError("need at least two samples to infer the time step")
    steps = np.diff(t)
    if not (steps == steps[0]).all():
        raise ValueError("times must be regularly spaced")
    return steps[0]
