"""The ground around a landing site: how Sun, Earth and slope change over a few kilometres.

Most functions are pure; ``scripts/run_all.py`` supplies the terrain and writes the files. Each map
is a square grid in the DEM's polar stereographic x/y, centered on the site, so its middle cell is
the site itself.
"""

from __future__ import annotations

import gzip
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray

from clps.ephemeris import EARTH_RADIUS_KM, SUN_RADIUS_KM
from clps.geometry import MOON_RADIUS_M, FloatArray, enu_basis, unit_vector, vector_to_latlon
from clps.horizon import HeightFn, HorizonMask
from clps.visibility import disk_fraction, horizon_el_at

#: Half-width of each map (m). Far enough to reach other ground a lander or rover could use.
HALF_WIDTH_M = 5_000.0
#: Spacing of the map (m). Measured: a month's Sun changes by 2–6 points at the 90th percentile over
#: 100 m, about the model's error against NASA's maps, and by 5–9 over 200 m.
STEP_M = 100.0
#: Slope is measured over two pixels each way of the 20 m DEM (m): half of the 40 m baseline.
POLAR_SLOPE_HALF_STEP_M = 20.0
#: Slope is stored in steps this size (degrees), in one byte.
SLOPE_QUANT_DEG = 0.5

#: Earth's center this far above the terrain (degrees), as well as the "any part visible" default.
#: Radio links need margin over terrain, and the right value depends on the antenna.
EARTH_CLEARANCES_DEG = (2.0, 5.0)
#: Heights above the ground compared for a taller mast (m). 0 m is left out: it isn't reliable on
#: well-lit ground (docs/VALIDATION.md §3).
MAST_HEIGHTS_M = (2.0, 5.0, 10.0)


def grid_offsets_m(half_width_m: float = HALF_WIDTH_M, step_m: float = STEP_M) -> FloatArray:
    """Offsets from the center along one side of the grid (m), always including 0."""
    cells = round(half_width_m / step_m)
    return step_m * np.arange(-cells, cells + 1, dtype=float)


def slope_at(height_at: HeightFn, lat_deg: float, lon_deg: float, half_step_m: float) -> float:
    """Ground slope at a point (degrees), from heights ``half_step_m`` away to each side.

    Steps are along local east and north on the reference sphere, so this works at any latitude
    except exactly at a pole.
    """
    east, north, up = enu_basis(lat_deg, lon_deg)
    delta = half_step_m / MOON_RADIUS_M

    def height(direction: FloatArray) -> float:
        lat, lon = vector_to_latlon(np.cos(delta) * up + np.sin(delta) * direction)
        return float(height_at(np.array([lat]), np.array([lon]))[0])

    d_east = (height(east) - height(-east)) / (2.0 * half_step_m)
    d_north = (height(north) - height(-north)) / (2.0 * half_step_m)
    return float(np.degrees(np.arctan(np.hypot(d_east, d_north))))


def slope_grid(
    height_xy: HeightFn, x_m: FloatArray, y_m: FloatArray, half_step_m: float
) -> FloatArray:
    """Ground slope (degrees) at projected points, from heights ``half_step_m`` away to each side.

    ``height_xy`` takes projected x and y (m). Polar stereographic scale is within 0.01% of 1 this
    close to the pole, so projected distance stands in for distance along the ground.
    """
    d_x = (height_xy(x_m + half_step_m, y_m) - height_xy(x_m - half_step_m, y_m)) / (
        2 * half_step_m
    )
    d_y = (height_xy(x_m, y_m + half_step_m) - height_xy(x_m, y_m - half_step_m)) / (
        2 * half_step_m
    )
    return np.degrees(np.arctan(np.hypot(d_x, d_y)))


def longest_false_run(up: NDArray[np.bool_]) -> int:
    """Length of the longest run of false values."""
    edges = np.flatnonzero(np.diff(np.concatenate(([1], up.astype(np.int8), [1]))))
    return int(np.max(edges[1::2] - edges[::2])) if edges.size else 0


def fractions_from_center(
    positions_km: NDArray[np.float32],
    lat_deg: float,
    lon_deg: float,
    site_radius_km: float,
    mask: HorizonMask,
) -> tuple[FloatArray, FloatArray]:
    """Visible Sun and Earth disk fractions, from positions relative to the Moon's center.

    The same shortcut as the browser's model: light time is taken at the center, which moves these
    bodies far less than the 0.05° we care about. Much faster than asking SPICE per observer.
    """
    site = site_radius_km * unit_vector(lat_deg, lon_deg)
    east, north, up = enu_basis(lat_deg, lon_deg)

    def fraction(offset: int, body_radius_km: float) -> FloatArray:
        rel = positions_km[:, offset : offset + 3].astype(float) - site
        dist = np.linalg.norm(rel, axis=1)
        unit = rel / dist[:, None]
        e, n, u = unit @ east, unit @ north, unit @ up
        az = np.degrees(np.arctan2(e, n)) % 360.0
        el = np.degrees(np.arctan2(u, np.hypot(e, n)))
        return disk_fraction(az, el, dist, body_radius_km, mask.az_deg, mask.el_deg)

    return fraction(0, SUN_RADIUS_KM), fraction(3, EARTH_RADIUS_KM)


def earth_clear_of_terrain(
    az_deg: ArrayLike, el_deg: ArrayLike, mask: HorizonMask, clearance_deg: float
) -> NDArray[np.bool_]:
    """Whether Earth's center is at least ``clearance_deg`` above the terrain at each sample."""
    horizon = horizon_el_at(az_deg, mask.az_deg, mask.el_deg)
    return np.asarray(el_deg, dtype=float) - horizon >= clearance_deg


@dataclass(frozen=True)
class CellMonths:
    """One map cell's numbers per month; each array has one value per month."""

    pct_sun: NDArray[np.uint8]
    pct_earth: NDArray[np.uint8]
    pct_both: NDArray[np.uint8]
    sun_gap_h: NDArray[np.uint16]


def cell_months(
    sun_up: NDArray[np.bool_], earth_up: NDArray[np.bool_], month_edges: NDArray[np.intp]
) -> CellMonths:
    """A cell's whole-percent shares and longest Sun gap for months bounded by ``month_edges``."""
    n = len(month_edges) - 1
    pct_sun = np.zeros(n, np.uint8)
    pct_earth = np.zeros(n, np.uint8)
    pct_both = np.zeros(n, np.uint8)
    sun_gap = np.zeros(n, np.uint16)
    both = sun_up & earth_up
    for i in range(n):
        first, last = month_edges[i], month_edges[i + 1]
        pct_sun[i] = round(100.0 * float(np.mean(sun_up[first:last])))
        pct_earth[i] = round(100.0 * float(np.mean(earth_up[first:last])))
        pct_both[i] = round(100.0 * float(np.mean(both[first:last])))
        sun_gap[i] = longest_false_run(sun_up[first:last])
    return CellMonths(pct_sun, pct_earth, pct_both, sun_gap)


def encode_month(
    pct_sun: NDArray[np.uint8],
    pct_earth: NDArray[np.uint8],
    pct_both: NDArray[np.uint8],
    sun_gap_h: NDArray[np.uint16],
) -> bytes:
    """One month of a map, gzipped: three byte planes, then the gap as little-endian uint16."""
    raw = (
        pct_sun.astype(np.uint8).tobytes()
        + pct_earth.astype(np.uint8).tobytes()
        + pct_both.astype(np.uint8).tobytes()
        + sun_gap_h.astype("<u2").tobytes()
    )
    return gzip.compress(raw, 6, mtime=0)


def encode_slope(slope_deg: FloatArray) -> bytes:
    """A map's slope, gzipped, in one byte per cell (steps of ``SLOPE_QUANT_DEG``)."""
    steps = np.clip(np.round(slope_deg / SLOPE_QUANT_DEG), 0, 255).astype(np.uint8)
    return gzip.compress(steps.tobytes(), 6, mtime=0)


def ranking_stats(ours_pct: FloatArray, map_pct: FloatArray) -> dict[str, float]:
    """How well our values pick out the same good ground as a map (percentage points).

    A map invites people to choose its best spots, and the best-looking values are also the ones
    most likely to be too high, so this measures that group directly.
    """
    difference = ours_pct - map_pct
    top = ours_pct >= np.quantile(ours_pct, 0.9)

    def ranks(values: FloatArray) -> FloatArray:
        return np.argsort(np.argsort(values)).astype(float)

    percentile = np.mean([np.mean(map_pct < value) for value in map_pct[top]])
    return {
        "n": int(ours_pct.size),
        "bias": round(float(np.mean(difference)), 1),
        "rmse": round(float(np.sqrt(np.mean(difference**2))), 1),
        "rank_r": round(float(np.corrcoef(ranks(ours_pct), ranks(map_pct))[0, 1]), 3),
        "top_ours": round(float(np.mean(ours_pct[top])), 1),
        "top_map": round(float(np.mean(map_pct[top])), 1),
        "top_bias": round(float(np.mean(difference[top])), 1),
        "top_map_percentile": round(100.0 * float(percentile)),
    }


def period_numbers(
    sun_up: NDArray[np.bool_], earth_up: NDArray[np.bool_], edges: NDArray[np.intp]
) -> FloatArray:
    """Sun %, Earth %, both %, longest Sun gap (h) and longest Earth gap (h), per period.

    Periods are bounded by ``edges`` (sample indices); shape is (periods, 5). Samples are hourly.
    """
    both = sun_up & earth_up
    rows = []
    for first, last in zip(edges[:-1], edges[1:], strict=True):
        rows.append(
            [
                100.0 * float(np.mean(sun_up[first:last])),
                100.0 * float(np.mean(earth_up[first:last])),
                100.0 * float(np.mean(both[first:last])),
                longest_false_run(sun_up[first:last]),
                longest_false_run(earth_up[first:last]),
            ]
        )
    return np.array(rows, float)


SPREAD_KEYS = ("pct_sun", "pct_earth", "pct_both", "max_sun_gap_h", "max_earth_gap_h")


def spread_row(numbers: FloatArray) -> dict[str, list[float]]:
    """Lowest and highest of each number across points, for one period; shape (points, 5) in."""
    return {
        key: [round(float(np.min(numbers[:, i])), 1), round(float(np.max(numbers[:, i])), 1)]
        for i, key in enumerate(SPREAD_KEYS)
    }


def error_stats(values: FloatArray) -> dict[str, float]:
    """Mean, spread and middle 95% of a value across NASA's terrain clones (percent)."""
    return {
        "mean": round(float(np.mean(values)), 1),
        "sd": round(float(np.std(values, ddof=1)), 1),
        "low": round(float(np.percentile(values, 2.5)), 1),
        "high": round(float(np.percentile(values, 97.5)), 1),
    }


def circle_offsets_m(radius_m: float, step_m: float) -> FloatArray:
    """Offsets (x, y) on a square grid, within a circle; the first is the center. Shape (n, 2)."""
    cells = round(radius_m / step_m)
    axis = step_m * np.arange(-cells, cells + 1, dtype=float)
    x, y = np.meshgrid(axis, axis)
    inside = np.hypot(x, y) <= radius_m + 1e-6
    points = np.column_stack([x[inside], y[inside]])
    order = np.argsort(np.hypot(points[:, 0], points[:, 1]), kind="stable")
    return points[order]
