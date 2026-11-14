"""The arithmetic behind the 1 m photo tiles (scripts/make_photo_tiles.py): which tiles of Moon
Trek's grid a disc of ground touches, and how a sharper picture is given a softer one's tone.

No files and no network here; the script does those.
"""

from __future__ import annotations

import math

import numpy as np

# Moon Trek's south-pole grid (web/src/lib/trekLayers.ts): level 0 is one tile 2,191,860 m wide,
# its top-left corner at (-1,095,930, 1,095,930); x points to 90 E and y to 0 E, as in the mosaic.
TREK_LEVEL0_WIDTH_M = 2_191_860.0
TILE_PX = 256
LEVEL = 13
# Moon Trek's finest tiles of the layer's own mosaic are two levels up: 4.18 m a pixel.
TREK_LEVEL = 11
STEP = LEVEL - TREK_LEVEL
TILE_M = TREK_LEVEL0_WIDTH_M / 2**LEVEL
HALF_M = TREK_LEVEL0_WIDTH_M / 2
# How broad "tone" is, in Trek's pixels: the blur's reach. About 100 m of ground.
TONE_RADIUS = 25


def tile_range(x_m: float, y_m: float, radius_m: float) -> tuple[int, int, int, int]:
    """The grid's columns and rows (first and last of each) that a square round a point touches."""
    col0 = math.floor((x_m - radius_m + HALF_M) / TILE_M)
    col1 = math.floor((x_m + radius_m + HALF_M) / TILE_M)
    row0 = math.floor((HALF_M - (y_m + radius_m)) / TILE_M)
    row1 = math.floor((HALF_M - (y_m - radius_m)) / TILE_M)
    return col0, col1, row0, row1


def touches_disc(col: int, row: int, x_m: float, y_m: float, radius_m: float) -> bool:
    """Whether a tile of the grid has any ground within ``radius_m`` of a point.

    The page asks for a tile by the same rule (web/src/lib/trekLayers.ts, ``inFinePhoto``).
    """
    left = col * TILE_M - HALF_M
    top = HALF_M - row * TILE_M
    nearest_x = min(max(x_m, left), left + TILE_M)
    nearest_y = min(max(y_m, top - TILE_M), top)
    return math.hypot(nearest_x - x_m, nearest_y - y_m) <= radius_m


def smooth(values: np.ndarray, radius: int) -> np.ndarray:
    """A soft blur: the mean over a square of side ``2 * radius + 1``, three times over."""
    out = values.astype(np.float32)
    width = 2 * radius + 1
    for _ in range(3):
        for axis in (0, 1):
            edges = [(radius + 1, radius) if a == axis else (0, 0) for a in (0, 1)]
            padded = np.pad(out, edges, mode="edge")
            summed = np.cumsum(padded, axis=axis, dtype=np.float64)
            upper = np.take(summed, range(width, summed.shape[axis]), axis=axis)
            lower = np.take(summed, range(0, summed.shape[axis] - width), axis=axis)
            out = ((upper - lower) / width).astype(np.float32)
    return out


def enlarge(values: np.ndarray, times: int) -> np.ndarray:
    """A smooth field drawn ``times`` larger each way, blended between its values."""
    out = np.repeat(np.repeat(values.astype(np.float32), times, axis=0), times, axis=1)
    half = times // 2
    width = 2 * half + 1
    # One pass of a small mean over the repeated values turns the steps into ramps.
    for axis in (0, 1):
        edges = [(half + 1, half) if a == axis else (0, 0) for a in (0, 1)]
        summed = np.cumsum(np.pad(out, edges, mode="edge"), axis=axis, dtype=np.float64)
        upper = np.take(summed, range(width, summed.shape[axis]), axis=axis)
        lower = np.take(summed, range(0, summed.shape[axis] - width), axis=axis)
        out = ((upper - lower) / width).astype(np.float32)
    return out


def match_tone(ours: np.ndarray, trek: np.ndarray) -> np.ndarray:
    """Our picture's fine detail on Moon Trek's broad brightness.

    ``ours`` is the ground at the fine level; ``trek`` the same ground from Moon Trek's tiles
    ``2 ** STEP`` times coarser. Everything broader than about ``2 * TONE_RADIUS`` of Trek's
    pixels takes Trek's brightness; everything finer is ours, its contrast scaled to Trek's
    (between 0.4 and 1.6 times). Ground this file has no picture of stays empty.
    """
    times = 2**STEP
    rows, cols = trek.shape
    coarse = ours.reshape(rows, times, cols, times).mean(axis=(1, 3), dtype=np.float32)
    ours_mean = smooth(coarse, TONE_RADIUS)
    trek_mean = smooth(trek, TONE_RADIUS)
    ours_spread = np.sqrt(smooth((coarse - ours_mean) ** 2, TONE_RADIUS))
    trek_spread = np.sqrt(smooth((trek - trek_mean) ** 2, TONE_RADIUS))
    gain = np.clip(trek_spread / np.maximum(ours_spread, 1.0), 0.4, 1.6)
    out = enlarge(trek_mean, times) + (ours - enlarge(ours_mean, times)) * enlarge(gain, times)
    out = np.clip(np.rint(out), 1, 255).astype(np.uint8)
    out[ours == 0] = 0
    return out
