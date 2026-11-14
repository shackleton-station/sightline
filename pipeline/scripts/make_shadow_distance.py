"""How far each listed site is from the nearest permanently shadowed ground.

Reads NASA's maps of permanent shadow at the south pole (PGDA product 69, the LPSR files; a
megabyte each, downloaded into cache/pgda on first use) and writes ``web/public/data/shadow.json``.

Usage (from pipeline/):
  uv run python scripts/make_shadow_distance.py           write the file and print the table
  uv run python scripts/make_shadow_distance.py --check   also print docs/VALIDATION.md's checks

For a site inside a map there are two answers, each the great-circle distance, on the Moon's
1737.4 km sphere, from the site to the centre of a pixel the map flags as permanently shadowed,
with that pixel's position and the size of the shadowed region it belongs to:

- ``patch``: the nearest shadowed pixel of any size. Near the pole it is often a speck, one or two
  pixels in a small crater a hundred metres away.
- ``region``: the nearest pixel of a shadowed region of at least 10 km², the size at which LROC's
  Permanently Shadowed Regions Atlas starts listing them: a crater floor a science team would name.

Each site is read on the finest map that holds it. An answer counts only if it is nearer than the
map's edge is; otherwise the next map out is read. A site outside every map gets no number: only
how far it is from the maps' edge.

The distance is along the reference sphere, not over the hills, and to a pixel's centre: the last
metres are the pixel's (60, 120 or 240 m).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Any

import numpy as np
import rasterio
from numpy.typing import NDArray
from pyproj import CRS
from rasterio import features

from clps import config, dem, export, shadow
from clps.geometry import FloatArray

OUT_PATH = config.WEB_DATA_DIR / "shadow.json"
#: The IAU's centre of Shackleton crater (planetarynames.wr.usgs.gov/Feature/5450): its floor is the
#: best known permanently shadowed ground, so a point there must read zero.
SHACKLETON = (-89.67, 129.78)
#: LROC's Permanently Shadowed Regions Atlas lists regions from 10 km² up (its smallest is
#: 10.001 km²; lroc.im-ldi.com/atlases/psr/list, read 2026-11-14).
REGION_MIN_KM2 = 10.0
WHAT = (
    "Permanently shadowed ground is ground that direct sunlight never reaches, in NASA's map of "
    "it computed from LOLA terrain. Such ground can stay cold enough to keep water ice."
)


@dataclass(frozen=True)
class LoadedMap:
    """A map in memory: which cells are in shadow, and where each of them is."""

    spec: shadow.ShadowMap
    cells: NDArray[np.bool_]
    grid: dem.DemWindow
    rows: NDArray[np.intp]
    cols: NDArray[np.intp]
    lats: FloatArray
    lons: FloatArray
    #: For each shadowed cell, whether its region may be ``REGION_MIN_KM2`` or more (by pixel count
    #: at the pixel's nominal size, which never undercounts; the true area is checked on use).
    sizeable: NDArray[np.bool_]


def load_map(spec: shadow.ShadowMap) -> LoadedMap:
    """Read a map (downloading it if missing) and place every shadowed cell's centre."""
    path = dem.download_raster(config.PGDA_DIR, shadow.PGDA_URL + spec.name, spec.size_bytes)
    with rasterio.open(path) as ds:
        raw = ds.read(1)
        if ds.transform.a != spec.pixel_m:
            raise ValueError(f"{spec.name}: pixels are {ds.transform.a} m, expected {spec.pixel_m}")
        # The label: DN * 0.000025 + 0.5 is the flag, 1 in permanent shadow and 0 out of it.
        flag = raw * float(ds.scales[0]) + float(ds.offsets[0])
        cells = flag > 0.5
        grid = dem.DemWindow(np.empty((1, 1)), ds.transform, CRS.from_wkt(ds.crs.to_wkt()))
        transform = ds.transform
    rows, cols = np.nonzero(cells)
    x = transform.c + (cols + 0.5) * transform.a
    y = transform.f + (rows + 0.5) * transform.e
    lats, lons = grid.xy_to_latlon(x, y)
    # Regions of fewer pixels than this are too small whatever their latitude.
    least = int(REGION_MIN_KM2 / (spec.pixel_m / 1000.0) ** 2)
    kept = features.sieve(cells.astype(np.uint8), size=least, connectivity=8).astype(bool)
    return LoadedMap(spec, cells, grid, rows, cols, lats, lons, (kept & cells)[rows, cols])


def region_km2(held: LoadedMap, row: int, col: int) -> tuple[float, NDArray[np.intp]]:
    """The true ground area (km²) of the shadowed region holding a cell, and the region's cells."""
    region = shadow.region_cells(held.cells, row, col)
    t = held.grid.transform
    r_m = np.hypot(t.c + (region[:, 1] + 0.5) * t.a, t.f + (region[:, 0] + 0.5) * t.e)
    return float(shadow.pixel_area_km2(held.spec.pixel_m, r_m).sum()), region


def nearest(
    lat_deg: float, lon_deg: float, held: LoadedMap, min_km2: float = 0.0
) -> dict[str, Any]:
    """The nearest shadowed cell of one map to a point: distance, position and its region's size.

    With ``min_km2``, the nearest cell of a region at least that large.
    """
    wanted = held.sizeable.copy() if min_km2 > 0 else np.ones(held.rows.size, bool)
    km = shadow.ground_distance_km(lat_deg, lon_deg, held.lats, held.lons)
    while True:
        i = int(np.flatnonzero(wanted)[np.argmin(km[wanted])])
        area_km2, region = region_km2(held, int(held.rows[i]), int(held.cols[i]))
        if area_km2 >= min_km2:
            break
        # Large enough by pixel count but not on the ground: leave the whole region out.
        in_region = np.zeros(held.cells.shape, bool)
        in_region[region[:, 0], region[:, 1]] = True
        wanted &= ~in_region[held.rows, held.cols]
    return {
        "distance_km": round(float(km[i]), 2),
        "lat": round(float(held.lats[i]), 4),
        "lon": round(float(held.lons[i]), 4),
        "region_km2": round(area_km2, 4 if area_km2 < 1 else 1),
        "map": held.spec.name,
        "pixel_m": held.spec.pixel_m,
    }


def answer(
    lat_deg: float, lon_deg: float, maps: dict[str, LoadedMap], min_km2: float = 0.0
) -> dict[str, Any]:
    """A site's answer: found (with the number), none inside the map, or outside the maps."""
    spec = shadow.covered_by(lat_deg)
    if spec is None:
        return {"status": "outside_map", "map_edge_km": round(shadow.outside_km(lat_deg))}
    for candidate in shadow.SOUTH_MAPS[shadow.SOUTH_MAPS.index(spec) :]:
        found = nearest(lat_deg, lon_deg, maps[candidate.name], min_km2)
        edge_km = shadow.edge_distance_km(lat_deg, candidate.edge_lat_deg)
        # Nearer than the map's edge: nothing outside the map can be nearer still.
        if found["distance_km"] <= edge_km:
            return {"status": "found"} | found
    # Even the widest map's nearest shadow is farther than its edge: all that is known is that
    # none lies within that edge's distance.
    return {"status": "none_within", "within_km": round(edge_km), "map": candidate.name}


def site_entry(lat_deg: float, lon_deg: float, maps: dict[str, LoadedMap]) -> dict[str, Any]:
    """Both answers for a site: the nearest shadowed patch, and the nearest sizeable region."""
    return {
        "patch": answer(lat_deg, lon_deg, maps),
        "region": answer(lat_deg, lon_deg, maps, REGION_MIN_KM2),
    }


def build() -> tuple[dict[str, Any], dict[str, LoadedMap]]:
    """Every site's answer and what the file says about itself."""
    maps = {spec.name: load_map(spec) for spec in shadow.SOUTH_MAPS}
    sites = {s.id: site_entry(s.lat_deg, s.lon_deg, maps) for s in config.SITES}
    return (
        {
            "what": WHAT,
            "unit": "km",
            "measure": (
                "Great-circle distance on the Moon's 1737.4 km sphere from the site to the centre "
                "of the nearest map pixel in permanent shadow. Not a route over the terrain."
            ),
            "source": {
                "name": "NASA GSFC PGDA, LOLA maps of permanently shadowed regions (LPSR)",
                "url": shadow.PGDA_PAGE,
                "cite": "Mazarico et al. (2011), Icarus 211, doi:10.1016/j.icarus.2010.10.030",
            },
            "patch": "The nearest shadowed pixel, whatever the size of the shadow it is part of.",
            "region": (
                f"The nearest pixel of a shadowed region of at least {REGION_MIN_KM2:g} km², the "
                "size at which LROC's Permanently Shadowed Regions Atlas starts listing them."
            ),
            "region_min_km2": REGION_MIN_KM2,
            "maps": [
                {"file": m.name, "pixel_m": m.pixel_m, "south_of_lat": m.edge_lat_deg}
                for m in shadow.SOUTH_MAPS
            ],
            "covered_from_lat": shadow.COVERED_FROM_LAT_DEG,
            "sites": sites,
        },
        maps,
    )


def picture(lat_deg: float, lon_deg: float, held: LoadedMap, half: int = 12, block: int = 1) -> str:
    """The map around a point, in characters: # shadow, . lit, S the point's own place.

    A character is ``block`` pixels on a side, and is shadow if any pixel in it is.
    """
    x, y = held.grid.latlon_to_xy(lat_deg, lon_deg)
    t = held.grid.transform
    col, row = int((float(x) - t.c) // t.a), int((float(y) - t.f) // t.e)
    lines = []
    for i in range(-half, half + 1):
        line = ""
        for j in range(-half, half + 1):
            r, c = row + i * block - block // 2, col + j * block - block // 2
            shaded = held.cells[r : r + block, c : c + block].any()
            line += "S" if (i, j) == (0, 0) else "#" if shaded else "."
        lines.append(line)
    return "\n".join(lines)


def flat_check(
    lat_deg: float, lon_deg: float, held: LoadedMap, sizeable: bool = False
) -> tuple[float, int, int]:
    """The same answer by another road: nearest shadowed pixel on the flat map, in km.

    Straight-line distance on the map plane, shrunk by the projection's scale at the site. No
    great circle and no latitudes: only the pixel grid and the map's own formula.
    """
    radius_m = 1_737_400.0
    colat = np.radians(90.0 + lat_deg)
    r_m = 2.0 * radius_m * np.tan(colat / 2.0)
    x, y = r_m * np.sin(np.radians(lon_deg)), r_m * np.cos(np.radians(lon_deg))
    t = held.grid.transform
    rows, cols = (
        (held.rows[held.sizeable], held.cols[held.sizeable]) if sizeable else (held.rows, held.cols)
    )
    px = t.c + (cols + 0.5) * t.a
    py = t.f + (rows + 0.5) * t.e
    flat_m = np.hypot(px - x, py - y)
    i = int(np.argmin(flat_m))
    scale = 1.0 + (r_m / (2.0 * radius_m)) ** 2
    return float(flat_m[i] / scale / 1000.0), int(rows[i]), int(cols[i])


def checks(out: dict[str, Any], maps: dict[str, LoadedMap]) -> None:
    """Print the hand check at a ridge site and the near-zero cases."""
    fine = maps[shadow.SOUTH_MAPS[0].name]
    site = next(s for s in config.SITES if s.id == "shackleton-rim")
    entry = out["sites"][site.id]
    flat_km, _, _ = flat_check(site.lat_deg, site.lon_deg, fine)
    print(f"\nHand check, {site.name}: file says {entry['patch']['distance_km']} km to the")
    print(f"nearest patch; on the flat map, nearest shadowed pixel {flat_km:.3f} km away.")
    print("The map around the site, 60 m a character, 1.5 km across (# shadow, . lit, S the site):")
    print(picture(site.lat_deg, site.lon_deg, fine))
    flat_region_km, _, _ = flat_check(site.lat_deg, site.lon_deg, fine, sizeable=True)
    print(f"\nTo the nearest region of {REGION_MIN_KM2:g} km2 or more: file says")
    print(f"{entry['region']['distance_km']} km, a region of {entry['region']['region_km2']} km2;")
    print(f"on the flat map {flat_region_km:.3f} km. The map 9 km across, 300 m a character:")
    print(picture(site.lat_deg, site.lon_deg, fine, 15, 5))
    inside = nearest(*SHACKLETON, fine)
    print(f"\nInside Shackleton crater, at the IAU centre {SHACKLETON}: {inside}")
    cell = entry["patch"]
    on_cell = nearest(cell["lat"], cell["lon"], fine)
    print(f"At the centre of the cell nearest {site.name}: {on_cell['distance_km']} km")
    for name, held in maps.items():
        share = 100.0 * held.cells.mean()
        print(f"{name}: {held.cells.sum()} shadowed pixels, {share:.2f}% of the map")


def main() -> None:
    """Write shadow.json and print each site's line."""
    out, maps = build()
    export.write_json(OUT_PATH, out)
    for site in config.SITES:
        print(f"{site.id}: {out['sites'][site.id]}")
    if "--check" in sys.argv:
        checks(out, maps)


if __name__ == "__main__":
    main()
