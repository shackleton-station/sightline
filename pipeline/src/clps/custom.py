"""Files that let the web app compute custom coordinates in the browser, and their accuracy.

Horizons need fine terrain only close to the observer, so the browser fetches small tiles around a
point and uses coarse maps for the rest:

- South polar region: 20 m within 5 km, 500 m beyond.
- Elsewhere: 237 m within 40 km, 7.6 km beyond.

``BrowserTerrain`` is the same logic in Python, so ``accuracy_by_band`` can measure the result
against the full pipeline and tests can require the browser to match it.
"""

from __future__ import annotations

import gzip
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import spiceypy
from numpy.typing import NDArray

from clps.dem import GlobalDem, HeightFn, bilinear
from clps.ephemeris import ABCORR, FRAME
from clps.geometry import MOON_RADIUS_M, FloatArray, unit_vector
from clps.horizon import HorizonMask, horizon_mask

#: Coarse global terrain, pixels per degree (7.6 km/px at the equator).
BROWSER_PPD: int = 4
BROWSER_OBS_HEIGHT_M: float = 2.0
#: Polar DEM half-width and pixel size (m), from LDEM_80S_20MPP_ADJ.TIF.
POLAR_HALF_M: float = 304_000.0
POLAR_RES_M: float = 20.0
POLAR_TILE_PX: int = 500
#: Heights in polar files are stored in units of this many meters, to fit 16 bits.
POLAR_QUANT_M: float = 0.25
#: The coarse polar map averages this many 20 m pixels per side (500 m/px).
POLAR_FAR_BLOCK: int = 25
GLOBAL_TILE_PX: int = 640
#: Fine terrain is used within these ground distances (m). They fall between sample distances.
NEAR_POLAR_M: float = 5_010.0
NEAR_GLOBAL_M: float = 40_010.0
#: Local north and east are undefined exactly at a pole.
MAX_ABS_LAT_DEG: float = 89.99


def browser_distances_m() -> FloatArray:
    """Ray sample distances (m) for the browser: 20 m to 5 km, 150 m to 40 km, 400 m to 200 km."""
    return np.concatenate(
        [
            np.arange(20.0, 5_000.0 + 1e-6, 20.0),
            np.arange(5_150.0, 40_000.0 + 1e-6, 150.0),
            np.arange(40_400.0, 200_000.0 + 1e-6, 400.0),
        ]
    )


def delta_encode(tile: NDArray[np.int16]) -> NDArray[np.int16]:
    """Differences between neighboring pixels, which compress far better than heights.

    16-bit wrap-around is fine: decoding wraps the same way.
    """
    out = tile.astype(np.int16).copy()
    out[:, 1:] = tile[:, 1:] - tile[:, :-1]
    out[1:, 0] = tile[1:, 0] - tile[:-1, 0]
    return out


def encode_tile(tile: NDArray[np.int16]) -> bytes:
    """A tile as gzipped little-endian differences; identical input gives identical bytes."""
    return gzip.compress(delta_encode(tile).astype("<i2").tobytes(), 6, mtime=0)


def quantize_polar(heights: NDArray[np.floating]) -> NDArray[np.int16]:
    """Polar heights (m) as 16-bit integers in units of ``POLAR_QUANT_M``."""
    return np.round(heights / POLAR_QUANT_M).astype(np.int16)


def downsample_global(world: GlobalDem, ppd: int = BROWSER_PPD) -> NDArray[np.int16]:
    """Mean of the global DEM in blocks: heights in whole meters, north to south, from 0° east."""
    factor = 128 // ppd
    lines, samples = world.shape
    rows = lines // factor
    cols = samples // factor
    out = np.zeros((rows, cols), np.int16)
    for row in range(rows):
        block = np.asarray(world.grid[row * factor : (row + 1) * factor, :])
        means = block.reshape(factor, cols, factor).mean(axis=(0, 2)) * world.scale
        out[row] = np.round(means).astype(np.int16)
    return out


def grid_height(grid: NDArray[np.int16], ppd: int = BROWSER_PPD) -> HeightFn:
    """Bilinear height (m) from a downsampled grid; matches the browser's calculation."""
    rows, cols = grid.shape

    def height_at(lat_deg: object, lon_deg: object) -> FloatArray:
        lat = np.asarray(lat_deg, float)
        lon = np.asarray(lon_deg, float) % 360.0
        line = (90.0 - lat) * ppd - 0.5
        sample = lon * ppd - 0.5
        r0 = np.clip(np.floor(line).astype(np.intp), 0, rows - 2)
        fr = np.clip(line - r0, 0.0, 1.0)
        floor = np.floor(sample).astype(np.intp)
        c0, c1 = floor % cols, (floor + 1) % cols
        fc = sample - floor
        top = grid[r0, c0] * (1 - fc) + grid[r0, c1] * fc
        bottom = grid[r0 + 1, c0] * (1 - fc) + grid[r0 + 1, c1] * fc
        return np.asarray(top * (1 - fr) + bottom * fr, float)

    return height_at


class BrowserTerrain:
    """Terrain exactly as the browser reads it. Heights are in meters; NaN never occurs."""

    def __init__(
        self,
        polar: NDArray[np.int16],
        polar_far: NDArray[np.int16],
        world: GlobalDem,
        coarse: NDArray[np.int16],
    ) -> None:
        self._polar = polar
        self._polar_far = polar_far
        self._world = world
        self._coarse = grid_height(coarse)

    def height_fn(self, site_lat_deg: float, site_lon_deg: float) -> HeightFn:
        """Height function for rays from a site; resolution depends on distance from it."""
        site = unit_vector(site_lat_deg, site_lon_deg)

        def height_at(lat_deg: object, lon_deg: object) -> FloatArray:
            lat = np.atleast_1d(np.asarray(lat_deg, float))
            lon = np.atleast_1d(np.asarray(lon_deg, float))
            dist_m = MOON_RADIUS_M * np.arccos(np.clip(unit_vector(lat, lon) @ site, -1.0, 1.0))
            rho = 2 * MOON_RADIUS_M * np.tan(np.radians(90.0 + lat) / 2)
            x = rho * np.sin(np.radians(lon))
            y = rho * np.cos(np.radians(lon))
            south = lat < 0

            col = (x + POLAR_HALF_M) / POLAR_RES_M - 0.5
            row = (POLAR_HALF_M - y) / POLAR_RES_M - 0.5
            size = self._polar.shape[0]
            in_fine = south & (col >= 0) & (col <= size - 1) & (row >= 0) & (row <= size - 1)
            use_fine = in_fine & (dist_m <= NEAR_POLAR_M)

            far_res = POLAR_RES_M * POLAR_FAR_BLOCK
            far_col = (x + POLAR_HALF_M) / far_res - 0.5
            far_row = (POLAR_HALF_M - y) / far_res - 0.5
            far_size = self._polar_far.shape[0]
            in_far = (
                south
                & (far_col >= 0)
                & (far_col <= far_size - 1)
                & (far_row >= 0)
                & (far_row <= far_size - 1)
            )
            use_far = in_far & ~use_fine
            use_global = ~in_far & ~use_fine & (dist_m <= NEAR_GLOBAL_M)
            use_coarse = ~use_fine & ~use_far & ~use_global

            out = np.zeros(lat.shape)
            if use_fine.any():
                out[use_fine] = bilinear(self._polar, col[use_fine], row[use_fine]) * POLAR_QUANT_M
            if use_far.any():
                out[use_far] = (
                    bilinear(self._polar_far, far_col[use_far], far_row[use_far]) * POLAR_QUANT_M
                )
            if use_global.any():
                out[use_global] = self._world.height_at(lat[use_global], lon[use_global])
            if use_coarse.any():
                out[use_coarse] = self._coarse(lat[use_coarse], lon[use_coarse])
            return out

        return height_at


def moon_centered_positions_km(et: FloatArray) -> NDArray[np.float32]:
    """Sun and Earth positions from the Moon's center in ``MOON_ME`` (km), shape (n, 6)."""
    rows = np.zeros((len(et), 6), np.float32)
    for i, t in enumerate(et):
        rows[i, :3] = spiceypy.spkpos("SUN", float(t), FRAME, ABCORR, "MOON")[0]
        rows[i, 3:] = spiceypy.spkpos("EARTH", float(t), FRAME, ABCORR, "MOON")[0]
    return rows


@dataclass(frozen=True)
class BandAccuracy:
    """Browser model vs full pipeline in one absolute-latitude band (percentage points)."""

    min_abs_lat: float
    max_abs_lat: float
    n: int
    sun_median_error: float
    sun_p90_error: float
    earth_median_error: float
    earth_p90_error: float
    hours_agree_median_pct: float
    hours_agree_p10_pct: float


def random_points(
    rng: np.random.Generator, min_abs_lat: float, max_abs_lat: float, n: int
) -> tuple[FloatArray, FloatArray]:
    """Points spread evenly by area within a band of absolute latitude, in both hemispheres."""
    sin_low, sin_high = np.sin(np.radians([min_abs_lat, max_abs_lat]))
    lat = np.degrees(np.arcsin(rng.uniform(sin_low, sin_high, n))) * rng.choice([-1.0, 1.0], n)
    return lat, rng.uniform(-180.0, 180.0, n)


def accuracy_at_points(
    low: float,
    high: float,
    lats: FloatArray,
    lons: FloatArray,
    full_height: HeightFn,
    full_distances_m: FloatArray,
    terrain: Callable[[float, float], HeightFn],
    observe_flags: Callable[
        [float, float, float, HorizonMask], tuple[NDArray[np.bool_], NDArray[np.bool_]]
    ],
) -> BandAccuracy:
    """Compare the browser's terrain with the full pipeline at the given points."""
    sun_errors, earth_errors, agree = [], [], []
    for lat, lon in zip(lats, lons, strict=True):
        outcomes = []
        for height_at, distances in (
            (full_height, full_distances_m),
            (terrain(float(lat), float(lon)), browser_distances_m()),
        ):
            mask = horizon_mask(
                float(lat),
                float(lon),
                height_at,
                obs_height_m=BROWSER_OBS_HEIGHT_M,
                distances_m=distances,
            )
            h_m = float(height_at(np.array([lat]), np.array([lon]))[0])
            radius_km = (MOON_RADIUS_M + h_m + BROWSER_OBS_HEIGHT_M) / 1000.0
            outcomes.append(observe_flags(float(lat), float(lon), radius_km, mask))
        (sun_full, earth_full), (sun_small, earth_small) = outcomes
        sun_errors.append(abs(100.0 * (sun_small.mean() - sun_full.mean())))
        earth_errors.append(abs(100.0 * (earth_small.mean() - earth_full.mean())))
        agree.append(100.0 * np.mean((sun_small == sun_full) & (earth_small == earth_full)))
    return BandAccuracy(
        min_abs_lat=low,
        max_abs_lat=high,
        n=len(lats),
        sun_median_error=round(float(np.median(sun_errors)), 2),
        sun_p90_error=round(float(np.percentile(sun_errors, 90)), 2),
        earth_median_error=round(float(np.median(earth_errors)), 2),
        earth_p90_error=round(float(np.percentile(earth_errors, 90)), 2),
        hours_agree_median_pct=round(float(np.median(agree)), 2),
        hours_agree_p10_pct=round(float(np.percentile(agree, 10)), 2),
    )
