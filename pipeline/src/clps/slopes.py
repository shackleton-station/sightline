"""Terrain slopes as 8-bit images, for the web app's terrain lighting.

A slope here is rise over run (dimensionless), positive when the ground rises in the named
direction. Heights are first averaged down to the image's grid, then differenced, so a slope
describes the terrain at the scale of one image pixel.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray

from clps.geometry import MOON_RADIUS_M, FloatArray

#: Slope (rise over run) that maps to the ends of the 8-bit range; steeper slopes are clamped.
SLOPE_MAX: float = 1.0
#: Smallest share of an output pixel (in input pixels) that must hold data for a mean to exist.
_MIN_WEIGHT: float = 1e-6


def area_sum(values: NDArray[np.floating], n_out: int, axis: int) -> FloatArray:
    """Sum ``values`` into ``n_out`` equal bins along ``axis``, for any size ratio.

    An input cell that straddles a bin edge is split between the two bins by overlap, so the result
    is the exact integral of the piecewise-constant input over each bin.
    """
    moved = np.moveaxis(np.asarray(values, float), axis, -1)
    n_in = moved.shape[-1]
    running = np.concatenate([np.zeros((*moved.shape[:-1], 1)), np.cumsum(moved, axis=-1)], axis=-1)
    edges = np.arange(n_out + 1) * (n_in / n_out)
    below = np.minimum(np.floor(edges).astype(np.intp), n_in - 1)
    part = edges - below
    at_edges = running[..., below] * (1.0 - part) + running[..., below + 1] * part
    return np.moveaxis(np.diff(at_edges, axis=-1), -1, axis)


def area_mean(heights_m: NDArray[np.floating], out_rows: int, out_cols: int) -> FloatArray:
    """Area-weighted mean height (meters) on a coarser ``out_rows`` x ``out_cols`` grid.

    NaN cells are left out of the mean; an output pixel with no data at all is NaN.
    """
    heights = np.asarray(heights_m, float)
    valid = np.isfinite(heights)

    def shrink(values: NDArray[np.floating]) -> FloatArray:
        return area_sum(area_sum(values, out_cols, axis=1), out_rows, axis=0)

    total = shrink(np.where(valid, heights, 0.0))
    weight = shrink(valid.astype(float))
    has_data = weight > _MIN_WEIGHT
    return np.where(has_data, total / np.where(has_data, weight, 1.0), np.nan)


def area_mean_by_strips(
    read_rows: Callable[[int, int], NDArray[np.floating]],
    in_rows: int,
    out_rows: int,
    out_cols: int,
    strip_rows: int = 512,
) -> FloatArray:
    """``area_mean`` of a raster too large to hold in memory, read a strip of rows at a time.

    ``read_rows(start, stop)`` returns the heights (meters) of input rows ``start`` to ``stop - 1``.
    Strips are cut only where an input row edge and an output row edge coincide, so the result is
    the same as ``area_mean`` of the whole raster. ``strip_rows`` is the rough strip height.
    """
    shared = math.gcd(in_rows, out_rows)
    unit_in, unit_out = in_rows // shared, out_rows // shared
    units_per_strip = max(1, strip_rows // unit_in)
    out = np.empty((out_rows, out_cols))
    for first in range(0, shared, units_per_strip):
        last = min(first + units_per_strip, shared)
        strip = read_rows(first * unit_in, last * unit_in)
        out[first * unit_out : last * unit_out] = area_mean(
            strip, (last - first) * unit_out, out_cols
        )
    return out


def sphere_slopes(
    heights_m: NDArray[np.floating],
    radius_m: float = MOON_RADIUS_M,
    min_east_step_m: float = 0.0,
) -> tuple[FloatArray, FloatArray]:
    """East and north slopes (rise over run) of a whole-globe equirectangular height grid.

    ``heights_m`` (meters) has rows north to south and columns west to east, covering 180° by 360°
    with pixel centers half a pixel in from the edges, and an even number of columns. Central
    differences: east slope = dh / (R cos(lat) dλ), wrapping in longitude; north slope =
    dh / (R dφ). The neighbor beyond a pole row is the same row half a turn away, so no row is
    one-sided.

    Pixel centers never sit on a pole, so cos(lat) is never zero. But near a pole one column is
    only meters wide, far finer than the terrain data, and differencing neighbors there mostly
    measures noise. So where a column is narrower than ``min_east_step_m`` (meters), the east
    difference reaches as many columns each way as it takes to span that distance (at most a
    quarter turn); elsewhere it is the plain one-column central difference.
    """
    heights = np.asarray(heights_m, float)
    rows, cols = heights.shape
    if cols % 2:
        raise ValueError("a whole-globe grid needs an even number of columns")
    row_rad = np.pi / rows
    lat_rad = np.pi / 2 - (np.arange(rows) + 0.5) * row_rad
    column_m = radius_m * np.cos(lat_rad) * (2 * np.pi / cols)
    reach = np.clip(np.ceil(min_east_step_m / column_m), 1, max(cols // 4, 1)).astype(np.intp)
    east = np.empty_like(heights)
    for columns in np.unique(reach):
        at = reach == columns
        ahead = np.roll(heights[at], -columns, axis=1)
        behind = np.roll(heights[at], columns, axis=1)
        east[at] = (ahead - behind) / (2 * columns * column_m[at, None])
    over_north_pole = np.roll(heights[:1], cols // 2, axis=1)
    over_south_pole = np.roll(heights[-1:], cols // 2, axis=1)
    to_north = np.vstack([over_north_pole, heights[:-1]])
    to_south = np.vstack([heights[1:], over_south_pole])
    north = (to_north - to_south) / (2 * radius_m * row_rad)
    return east, north


def grid_slopes(heights_m: NDArray[np.floating], pixel_m: float) -> tuple[FloatArray, FloatArray]:
    """Slopes (rise over run) along map x and map y of a north-up square grid.

    ``heights_m`` (meters) has row 0 at the largest map y and column 0 at the smallest map x, with
    square pixels ``pixel_m`` (meters) wide. The x slope is dh/dx toward increasing x (toward the
    last column); the y slope is dh/dy toward increasing y (toward row 0). Central differences,
    one-sided at the image edges. A pixel that is NaN, or whose difference would use a NaN neighbor,
    is treated as flat (slope 0), so missing data never leaks into the slopes.
    """
    heights = np.asarray(heights_m, float)
    known = np.isfinite(heights)
    filled = np.where(known, heights, 0.0)
    rise_rows, rise_cols = np.gradient(filled, pixel_m)
    usable_rows = known & _neighbors_known(known, axis=0)
    usable_cols = known & _neighbors_known(known, axis=1)
    slope_x = np.where(usable_cols, rise_cols, 0.0)
    slope_y = np.where(usable_rows, -rise_rows, 0.0)  # rows run toward decreasing y
    return slope_x, slope_y


def encode_slope(slope: NDArray[np.floating], slope_max: float = SLOPE_MAX) -> NDArray[np.uint8]:
    """Slope to 8 bits: ``round(128 + 127 * clamp(slope / slope_max, -1, 1))``, so 1 to 255.

    128 is flat. Anything that is not a finite number is written as flat.
    """
    scaled = np.clip(np.nan_to_num(np.asarray(slope, float), nan=0.0) / slope_max, -1.0, 1.0)
    return np.rint(128.0 + 127.0 * scaled).astype(np.uint8)


def decode_slope(value: NDArray[np.integer], slope_max: float = SLOPE_MAX) -> FloatArray:
    """The slope an 8-bit value stands for: ``(value - 128) / 127 * slope_max``."""
    return (np.asarray(value, float) - 128.0) / 127.0 * slope_max


def clamped_fraction(slope: NDArray[np.floating], slope_max: float = SLOPE_MAX) -> float:
    """Share of pixels (0–1) whose slope is steeper than ``slope_max`` and so gets clamped."""
    return float(np.mean(np.abs(np.asarray(slope, float)) > slope_max))


def _neighbors_known(known: NDArray[np.bool_], axis: int) -> NDArray[np.bool_]:
    """True where both cells that ``np.gradient`` reads along ``axis`` hold data.

    Inside the grid those are the cells before and after; on an edge, the edge cell and the one
    next to it.
    """
    moved = np.moveaxis(known, axis, 0)
    before = np.concatenate([moved[:1], moved[:-1]])
    after = np.concatenate([moved[1:], moved[-1:]])
    return np.moveaxis(before & after, 0, axis)
