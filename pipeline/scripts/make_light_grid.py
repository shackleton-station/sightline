"""Build the light grids: hourly Sun and Earth visibility at every pixel near the south pole.

There are two, both 1,024 pixels square and centered on the pole: the fine grid (120 m pixels,
61 km each way) and the wide grid (300 m pixels, 154 km each way, to 85° S).

Round each south-pole ridge site there can also be a patch: the same calculation at the terrain's
own 20 m, over the fine grid's cells within about 3 km of the site (306 pixels square). Patches are
built only when asked for.

Usage (from pipeline/):
  uv run python scripts/make_light_grid.py              # everything, both grids
  uv run python scripts/make_light_grid.py --horizons   # only each pixel's horizon (the slow part)
  uv run python scripts/make_light_grid.py --months     # only the month files, from cached horizons
  uv run python scripts/make_light_grid.py --maps       # only the close-up slope maps
  uv run python scripts/make_light_grid.py --wide ...   # only the wide grid (or --fine)
  uv run python scripts/make_light_grid.py --patches    # only the 20 m patches round ridge sites
  uv run python scripts/make_light_grid.py --patches --horizons   # one stage of them, as above

Input: the LOLA south-polar DEM and, for the wide grid, the LOLA whole-Moon DEM (both in
cache/dem), and the SPICE kernels (see REFERENCES.md). A ray from the wide grid can run off the
polar DEM; the whole-Moon one is read there, as for a listed site.
Outputs:
  cache/light/horizons.npy                    float32, one 720-azimuth horizon per pixel (3 GB)
  cache/light/horizons_wide.npy               the same for the wide grid
  web/public/tiles/light/<month>.bin.gz       the month's Sun and Earth flips, fine grid
  web/public/tiles/light/wide/<month>.bin.gz  the same for the wide grid
  cache/light/horizons_patch_<site>.npy       each patch's horizons (270 MB)
  web/public/tiles/light/patch/<site>/<month>.bin.gz   the same for a patch
  web/public/tiles/light/slope_x.jpg          terrain slopes of the fine square, for close-ups
  web/public/tiles/light/slope_y.jpg
  web/public/data/light/meta.json             the grids, the months and what was counted
The tiles folder is not in Git: `cd web && npm run upload-light` copies it to the assets bucket.

Measured on an Apple M4 Max (16 cores, 2026-11-12): horizons 31 min a grid, 48 months 4 min.
The horizons don't depend on the dates: a longer range only adds months.
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from numpy.typing import NDArray
from pyproj import CRS
from rasterio.shutil import copy as copy_raster

from clps import config, custom, dem, export, lightgrid, slopes
from clps.ephemeris import EARTH_RADIUS_KM, SUN_RADIUS_KM, to_et, utc_range
from clps.geometry import unit_vector
from clps.horizon import sample_distances_m
from clps.kernels import load_kernels

CACHE_DIR: Path = config.CACHE_DIR / "light"
HORIZONS_PATH: Path = CACHE_DIR / "horizons.npy"
TILES_DIR: Path = config.WEB_TILES_DIR / "light"
META_PATH: Path = config.WEB_DATA_DIR / "light" / "meta.json"
#: The same reach as a listed site's horizon (meters).
MAX_RANGE_M: float = 200_000.0
#: Pixels per batch: small enough to show progress, large enough to keep every core busy.
BATCH: int = 16_384
#: The close-up slope maps: the grid's square at 30 m a pixel.
SLOPE_MAP_SIZE: int = 4096
SLOPE_JPEG_QUALITY: int = 90


@dataclass(frozen=True)
class Grid:
    """A grid: its name, pixels along a side and pixel size (meters).

    The fine and wide grids are centered on the pole. A patch is a square somewhere else: it says
    where, as ``patch``.
    """

    name: str
    size: int
    pixel_m: float
    patch: lightgrid.Patch | None = None

    @property
    def half_m(self) -> float:
        """Half the grid's width (meters)."""
        return self.size * self.pixel_m / 2.0

    @property
    def horizons_path(self) -> Path:
        """Where the grid's horizons are cached."""
        return CACHE_DIR / ("horizons.npy" if self.name == "fine" else f"horizons_{self.name}.npy")

    def xy_m(self) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        """Map x and y (meters) of every pixel center, each of shape (size, size)."""
        if self.patch:
            return lightgrid.patch_xy_m(self.patch)
        return lightgrid.grid_xy_m(self.size, self.pixel_m)

    @property
    def tiles_dir(self) -> Path:
        """Where the grid's month files go."""
        if self.patch:
            return TILES_DIR / "patch" / self.name.removeprefix("patch_")
        return TILES_DIR if self.name == "fine" else TILES_DIR / self.name

    @property
    def needs_far_terrain(self) -> bool:
        """Whether a ray of ``MAX_RANGE_M`` from a corner pixel can leave the polar DEM."""
        # A patch lies inside the fine grid, so its rays reach no farther than that grid's.
        half_m = FINE.half_m if self.patch else self.half_m
        return half_m * 2**0.5 + MAX_RANGE_M > custom.POLAR_HALF_M


FINE = Grid("fine", lightgrid.GRID_SIZE, lightgrid.PIXEL_M)
#: 300 m is five pixels of NASA's 60 m map, and 1,024 of them reach 85° S, where that map ends.
WIDE = Grid("wide", 1024, 300.0)

#: The sites that get a patch: the south-pole ridge sites, which all lie inside the fine grid.
PATCH_GROUP: str = "South pole ridges"


def patch_grids(terrain: lightgrid.Terrain) -> list[Grid]:
    """A 20 m patch round each ridge site, named for it: whole cells of the fine grid."""
    grids = []
    for site in config.SITES:
        if site.group != PATCH_GROUP:
            continue
        x, y = terrain.plane.project(unit_vector([site.lat_deg], [site.lon_deg]))
        patch = lightgrid.patch_around(float(x[0]), float(y[0]))
        grids.append(Grid(f"patch_{site.id}", patch.size, patch.pixel_m, patch))
    return grids


#: Each body, where its position starts in a row of ``custom.moon_centered_positions_km``, and
#: its radius (km).
BODIES: tuple[tuple[str, int, float], ...] = (
    ("sun", 0, SUN_RADIUS_KM),
    ("earth", 3, EARTH_RADIUS_KM),
)


def load_terrain(with_far: bool = False) -> tuple[lightgrid.Terrain, CRS]:
    """The whole polar DEM in memory (3.7 GB), with its map plane read from the file.

    ``with_far`` also loads the southern part of the whole-Moon DEM, for rays that leave it.
    """
    path = dem.download_raster()
    with rasterio.Env(GDAL_CACHEMAX=dem.GDAL_CACHE_MB), rasterio.open(path) as ds:
        t = ds.transform
        if not (t.b == 0 and t.d == 0 and t.a == -t.e and t.a > 0):
            raise ValueError(f"polar DEM is not north-up with square pixels: {t}")
        if float(ds.scales[0]) != 1.0 or float(ds.offsets[0]) != 0.0:
            raise ValueError("polar DEM heights need a scale or offset this script doesn't apply")
        if ds.nodata is not None and not np.isnan(ds.nodata):
            raise ValueError("polar DEM marks missing data with a number; expected NaN")
        heights = ds.read(1)
        crs = CRS.from_wkt(ds.crs.to_wkt())
    if heights.dtype != np.float32:
        raise ValueError(f"polar DEM is {heights.dtype}, expected float32")
    plane = lightgrid.polar_plane(crs)
    if not with_far:
        return lightgrid.Terrain(heights, t.c, t.f, t.a, plane), crs
    world = dem.load_global_dem()
    far, far_geom = lightgrid.far_terrain(world.grid, world.geometry())
    return lightgrid.Terrain(heights, t.c, t.f, t.a, plane, far, far_geom), crs


def grid_observers(terrain: lightgrid.Terrain, grid: Grid = FINE) -> lightgrid.Observers:
    """An observer at every pixel center of a grid, ``config.OBS_HEIGHT_M`` above the ground."""
    x, y = grid.xy_m()
    up = terrain.plane.unproject(x.ravel(), y.ravel())
    ground = terrain.height_at(up)
    if np.isnan(ground).any():
        raise ValueError("the grid reaches outside the DEM")
    return lightgrid.observers(up, ground, config.OBS_HEIGHT_M)


def part(at: lightgrid.Observers, rows: slice) -> lightgrid.Observers:
    """Some of the observers."""
    return lightgrid.Observers(at.up[rows], at.east[rows], at.north[rows], at.radius_m[rows])


def build_horizons(terrain: lightgrid.Terrain, at: lightgrid.Observers, grid: Grid = FINE) -> None:
    """Compute every pixel's horizon into the grid's cache file, resuming a stopped run."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    n = at.up.shape[0]
    n_az = round(360.0 / lightgrid.AZ_STEP_DEG)
    path = grid.horizons_path
    done_path = path.with_suffix(".done")
    done = int(done_path.read_text()) if done_path.is_file() and path.is_file() else 0
    out = np.lib.format.open_memmap(
        path, mode="r+" if done else "w+", dtype=np.float32, shape=(n, n_az)
    )
    distances = sample_distances_m(MAX_RANGE_M)
    t0 = time.perf_counter()
    for start in range(done, n, BATCH):
        rows = slice(start, min(start + BATCH, n))
        out[rows] = lightgrid.horizons(terrain, part(at, rows), distances)
        out.flush()
        done_path.write_text(str(rows.stop))
        rate = (rows.stop - done) / (time.perf_counter() - t0)
        left_min = (n - rows.stop) / rate / 60
        print(f"  {grid.name} horizons {rows.stop}/{n} pixels, {left_min:.1f} min left", flush=True)
    if np.isnan(out).any():
        raise ValueError("some horizons have no terrain along a ray")


def month_hours(month: str) -> NDArray[np.datetime64]:
    """Every hour of a month (UTC), as the site tracks have them."""
    start = np.datetime64(f"{month}-01T00:00:00", "s")
    end = (start.astype("datetime64[M]") + 1).astype("datetime64[s]")
    return utc_range(str(start), str(end))


def build_months(at: lightgrid.Observers, grid: Grid = FINE) -> dict[str, object]:
    """Write one file of Sun and Earth flips per month; returns what was counted along the way."""
    horizon = np.load(grid.horizons_path, mmap_mode="r")
    n = at.up.shape[0]
    grid.tiles_dir.mkdir(parents=True, exist_ok=True)
    merged = {"sun": 0, "earth": 0}
    over = {"sun": 0, "earth": 0}
    most = {"sun": 0, "earth": 0}
    total_hours = 0
    total_bytes = 0
    t0 = time.perf_counter()
    for month in config.MONTHS:
        times = month_hours(month)
        positions = custom.moon_centered_positions_km(to_et(times)).astype(np.float64)
        kept = {
            "sun": np.empty((n, lightgrid.SUN_SLOTS), np.uint16),
            "earth": np.empty((n, lightgrid.EARTH_SLOTS), np.uint16),
        }
        for start in range(0, n, 4 * BATCH):
            rows = slice(start, min(start + 4 * BATCH, n))
            here = part(at, rows)
            skyline = np.ascontiguousarray(horizon[rows])
            for body, offset, radius_km in BODIES:
                where = positions[:, offset : offset + 3]
                flags = lightgrid.up_flags(skyline, here, where, radius_km)
                slots = kept[body].shape[1]
                kept[body][rows], found, changed = lightgrid.flips(flags, slots)
                merged[body] += int(changed.sum())
                over[body] += int(np.sum(found > slots))
                most[body] = max(most[body], int(found.max()))
        blob = lightgrid.encode_month(kept["sun"], kept["earth"], grid.size)
        export.write_bytes(grid.tiles_dir / f"{month}.bin.gz", blob)
        total_hours += len(times) * n
        total_bytes += len(blob)
        took_s = time.perf_counter() - t0
        print(f"  {grid.name} {month}: {len(blob) / 1e6:.1f} MB, {took_s:.0f} s so far", flush=True)
    # The months are named by their first and last, not listed: the file the app reads first stays
    # the same size however long the range is, and a month's hours follow from the calendar.
    return {
        "first_month": config.MONTHS[0],
        "last_month": config.MONTHS[-1],
        "bytes_per_month": round(total_bytes / len(config.MONTHS)),
        "merged": {
            body: {
                "most_flips_in_a_pixel_month": most[body],
                "pixel_months_over_slots_pct": round(
                    100.0 * over[body] / (n * len(config.MONTHS)), 4
                ),
                "pixel_hours_changed_pct": round(100.0 * merged[body] / total_hours, 5),
            }
            for body in ("sun", "earth")
        },
    }


def build_slope_maps(terrain: lightgrid.Terrain) -> None:
    """The grid's square as two slope images, sharper than the whole-cap ones the globe has."""
    half_m = lightgrid.GRID_SIZE * lightgrid.PIXEL_M / 2.0
    col0 = round((-half_m - terrain.x_left_m) / terrain.pixel_m)
    row0 = round((terrain.y_top_m - half_m) / terrain.pixel_m)
    side = round(2 * half_m / terrain.pixel_m)
    heights = terrain.heights_m[row0 : row0 + side, col0 : col0 + side]
    pixel_m = 2 * half_m / SLOPE_MAP_SIZE
    small = slopes.area_mean(heights, SLOPE_MAP_SIZE, SLOPE_MAP_SIZE)
    pair = slopes.grid_slopes(small, pixel_m)
    TILES_DIR.mkdir(parents=True, exist_ok=True)
    profile = {"driver": "GTiff", "count": 1, "dtype": "uint8"}
    profile |= {"width": SLOPE_MAP_SIZE, "height": SLOPE_MAP_SIZE}
    for name, slope in zip(("slope_x.jpg", "slope_y.jpg"), pair, strict=True):
        path = TILES_DIR / name
        with rasterio.MemoryFile() as memory:
            with memory.open(**profile) as tmp:
                tmp.write(slopes.encode_slope(slope), 1)
                copy_raster(tmp, path, driver="JPEG", QUALITY=SLOPE_JPEG_QUALITY)
        path.with_name(f"{name}.aux.xml").unlink(missing_ok=True)
        clamped = slopes.clamped_fraction(slope)
        print(f"  {name}: {path.stat().st_size / 1e6:.1f} MB, {clamped:.4%} of pixels clamped")


def write_meta(
    terrain: lightgrid.Terrain, grid: Grid = FINE, counted: dict[str, object] | None = None
) -> None:
    """The small file the web app reads first: where the grids are and how to read a month.

    The fine grid's numbers are at the top level and the wide grid's under ``wide``. A grid built
    on its own keeps what the file already says about the other.
    """
    rad_to_deg = 180.0 / np.pi
    x_axis, y_axis = terrain.plane.x_axis, terrain.plane.y_axis
    known = json.loads(META_PATH.read_text()) if META_PATH.is_file() else {}
    # Written by earlier versions: every month and its hours, which grew with the range.
    known.pop("hours", None)
    known.get("wide", {}).pop("hours", None)
    if grid.patch:
        # A patch says where it is in the fine grid; its months are the fine grid's.
        patch = grid.patch
        where = {"size": grid.size, "pixel_m": grid.pixel_m, "col": patch.col, "row": patch.row}
        where |= {"cells": patch.cells, "sub": patch.sub}
        site = grid.name.removeprefix("patch_")
        patches = known.get("patches", {}) | {site: where | (counted or {})}
        export.write_json(META_PATH, known | {"patches": patches})
        return
    shape = {"size": grid.size, "pixel_m": grid.pixel_m, "half_width_m": grid.half_m}
    if grid.name != "fine":
        export.write_json(META_PATH, known | {grid.name: shape | (counted or {})})
        return
    export.write_json(
        META_PATH,
        known
        | shape
        | {
            "radius_m": int(terrain.plane.radius_m),
            "x_axis_lon_deg": round(float(np.arctan2(x_axis[1], x_axis[0])) * rad_to_deg, 6) + 0.0,
            "y_axis_lon_deg": round(float(np.arctan2(y_axis[1], y_axis[0])) * rad_to_deg, 6) + 0.0,
            "obs_height_m": config.OBS_HEIGHT_M,
            "az_step_deg": lightgrid.AZ_STEP_DEG,
            "range_km": MAX_RANGE_M / 1000.0,
            "sun_slots": lightgrid.SUN_SLOTS,
            "earth_slots": lightgrid.EARTH_SLOTS,
            "slope_map_size": SLOPE_MAP_SIZE,
            "slope_max": slopes.SLOPE_MAX,
            "dem": dem.DEM_FILENAME,
        }
        | (counted or {}),
    )


def main() -> None:
    """Build the stages and grids named on the command line, or all of them."""
    named = {arg.lstrip("-") for arg in sys.argv[1:]}
    stages = named & {"horizons", "months", "maps"} or {"horizons", "months", "maps"}
    grids = [grid for grid in (FINE, WIDE) if grid.name in named]
    # Patches are extra: built when asked for, never by a run that names nothing.
    if not grids and "patches" not in named:
        grids = [FINE, WIDE]
    load_kernels()
    terrain, _ = load_terrain(with_far=any(grid.needs_far_terrain for grid in grids))
    if "patches" in named:
        grids += patch_grids(terrain)
    if "maps" in stages and FINE in grids:
        build_slope_maps(terrain)
    for grid in grids:
        at = grid_observers(terrain, grid)
        if "horizons" in stages:
            build_horizons(terrain, at, grid)
        if "months" in stages:
            write_meta(terrain, grid, build_months(at, grid))


if __name__ == "__main__":
    main()
