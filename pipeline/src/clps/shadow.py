"""How far a site is from the nearest permanently shadowed ground, from NASA's maps.

NASA's LOLA team publishes, for each pole, maps that flag every pixel in permanent shadow: ground
that direct sunlight never reaches, computed from LOLA terrain (Mazarico et al. 2011; PGDA product
69, the "LPSR" files). Three maps cover the south pole, each finer and smaller than the last. Such
ground is where water ice could survive, so its distance from a landing site is the first thing a
science team asks of it.

Pure helpers; ``scripts/make_shadow_distance.py`` reads the maps and writes the result.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray

from clps.geometry import MOON_RADIUS_M, FloatArray

PGDA_URL = "https://pgda.gsfc.nasa.gov/data/MoonIllumination/"
PGDA_PAGE = "https://pgda.gsfc.nasa.gov/products/69"


@dataclass(frozen=True)
class ShadowMap:
    """One of NASA's maps of permanent shadow: its file, pixel size and how far north it reaches."""

    name: str
    size_bytes: int
    pixel_m: float
    #: The map is a square in polar stereographic projection that holds every point south of this
    #: latitude (degrees); its corners reach farther, but only this cap is counted as covered.
    edge_lat_deg: float


#: The south pole's maps, finest first.
SOUTH_MAPS: tuple[ShadowMap, ...] = (
    ShadowMap("LPSR_85S_060M_201608.TIF", 656_183, 60.0, -85.0),
    ShadowMap("LPSR_75S_120M_201608.TIF", 1_046_706, 120.0, -75.0),
    ShadowMap("LPSR_65S_240M_201608.TIF", 582_074, 240.0, -65.0),
)
#: The maps of both poles stop at this latitude, north or south (degrees).
COVERED_FROM_LAT_DEG: float = 65.0


def ground_distance_km(
    lat_deg: float, lon_deg: float, lats_deg: ArrayLike, lons_deg: ArrayLike
) -> FloatArray:
    """Great-circle distance (km) on the Moon's 1737.4 km sphere from a point to each of many."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    lats, lons = np.radians(np.asarray(lats_deg, float)), np.radians(np.asarray(lons_deg, float))
    hav = np.sin((lats - lat) / 2) ** 2 + np.cos(lat) * np.cos(lats) * np.sin((lons - lon) / 2) ** 2
    out: FloatArray = 2 * MOON_RADIUS_M / 1000.0 * np.arcsin(np.sqrt(np.clip(hav, 0.0, 1.0)))
    return out


def edge_distance_km(lat_deg: float, edge_lat_deg: float) -> float:
    """Ground distance (km) from a latitude to a parallel, along a meridian."""
    return abs(lat_deg - edge_lat_deg) * np.pi / 180.0 * MOON_RADIUS_M / 1000.0


def covered_by(lat_deg: float, maps: tuple[ShadowMap, ...] = SOUTH_MAPS) -> ShadowMap | None:
    """The finest south-pole map whose covered cap holds this latitude; None if none does."""
    return next((m for m in maps if lat_deg <= m.edge_lat_deg), None)


def outside_km(lat_deg: float) -> float:
    """Ground distance (km) from a site outside both poles' maps to the nearer map's edge."""
    return edge_distance_km(abs(lat_deg), COVERED_FROM_LAT_DEG)


def pixel_area_km2(pixel_m: float, r_m: ArrayLike) -> FloatArray:
    """True ground area (km²) of map pixels at distance ``r_m`` from the pole on the map plane.

    The maps are polar stereographic with true scale at the pole: away from it a pixel covers less
    ground than its nominal size, by the square of ``1 + (r / 2R)²``.
    """
    scale = 1.0 + (np.asarray(r_m, float) / (2.0 * MOON_RADIUS_M)) ** 2
    out: FloatArray = (pixel_m / 1000.0) ** 2 / scale**2
    return out


def region_cells(shadow: NDArray[np.bool_], row: int, col: int) -> NDArray[np.intp]:
    """The cells of the shadowed region holding a cell, as (row, col) pairs.

    A region is cells that touch, sides or corners. Raises if the cell itself is not shadowed.
    """
    if not shadow[row, col]:
        raise ValueError("the cell is not in shadow")
    rows, cols = shadow.shape
    seen = {(row, col)}
    todo = deque([(row, col)])
    while todo:
        r, c = todo.popleft()
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                step = (r + dr, c + dc)
                if (
                    0 <= step[0] < rows
                    and 0 <= step[1] < cols
                    and step not in seen
                    and shadow[step]
                ):
                    seen.add(step)
                    todo.append(step)
    return np.array(sorted(seen), dtype=np.intp)
