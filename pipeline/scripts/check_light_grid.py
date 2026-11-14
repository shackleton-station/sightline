"""Check the light grid against the site tracks and NASA's long-run illumination maps.

Usage (from pipeline/):
  uv run python scripts/check_light_grid.py             # both checks, and the web test's fixture
  uv run python scripts/check_light_grid.py --fixture   # only the fixture
  uv run python scripts/check_light_grid.py --wide      # both checks for the wide grid
Needs `scripts/make_light_grid.py` and `scripts/run_all.py` to have run.
Writes web/public/data/light/validation.json and prints the tables in docs/VALIDATION.md §12. Also
writes web/src/lib/lightGrid.fixture.json: a few cells of one month as this code has them, which a
web test requires the browser's reader to reproduce exactly.

Two checks, each with a deliberately wrong sky as its control:

1. Hour by hour against the listed sites' own tracks (`<site>/<month>/track.json`), every year.
   First with the grid's code at the site's exact coordinates, which should agree almost always:
   it is the same terrain and method through different code. Then with the grid cell holding the
   site, whose center is up to 85 m away: how much a tapped cell can differ from a listed point.
   Controls: the sky turned 90° and 180° in azimuth, and the hours shifted by half a lunar day.
2. Every cell's long-run average against NASA's PGDA maps (60 m, 18.6 years), the mean of the four
   map pixels each cell covers. Controls: the sky turned 180°, and no terrain at all.

Measured on an Apple M4 Max (16 cores, 2026-11-12): 9 minutes.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from numpy.typing import NDArray
from rasterio.windows import Window

sys.path.insert(0, str(Path(__file__).parent))
import make_light_grid as grid  # noqa: E402

from clps import config, custom, export, lightgrid, nearby  # noqa: E402
from clps.ephemeris import to_et, utc_range  # noqa: E402
from clps.geometry import unit_vector  # noqa: E402
from clps.horizon import sample_distances_m  # noqa: E402
from clps.kernels import load_kernels  # noqa: E402

OUT_PATH: Path = config.WEB_DATA_DIR / "light" / "validation.json"
FIXTURE_PATH: Path = config.REPO_ROOT / "web" / "src" / "lib" / "lightGrid.fixture.json"
FIXTURE_MONTH: str = config.DEFAULT_MONTH
SPAN_WORDS: str = f"{config.YEARS[0]} to {config.YEARS[-1]}"
#: NASA's long-run maps, and the span and step of our own average (as in run_all.py).
PGDA_SUN = "AVGVISIB_85S_060M_201608.TIF"
PGDA_EARTH = "AVGVISIB_85S_060M_201608_EARTH.TIF"
PGDA_START_UTC = "2020-01-01T00:00:00"
PGDA_END_UTC = "2038-08-01T00:00:00"
PGDA_STEP_H = 6
WELL_LIT_PCT = 50.0
#: Half a lunar day (hours): keeps the season, puts the Sun on the other side of the sky.
OUT_OF_STEP_H = 354
#: A map pixel that reads 0 while most of the pixels around it read above this is taken for a gap
#: in NASA's map, not ground in permanent shadow (docs/VALIDATION.md, "Not checked").
GAP_NEIGHBOUR_PCT = 20.0


def site_flags(site_id: str) -> tuple[NDArray[np.bool_], NDArray[np.bool_]]:
    """A site's hourly Sun and Earth flags for every month, as the pipeline exported them."""
    sun: list[bool] = []
    earth: list[bool] = []
    for month in config.MONTHS:
        rows = json.loads((config.WEB_DATA_DIR / site_id / month / "track.json").read_text())
        sun += [row["sun_up"] for row in rows]
        earth += [row["earth_up"] for row in rows]
    return np.array(sun), np.array(earth)


def monthly_pct(flags: NDArray[np.bool_]) -> NDArray[np.float64]:
    """Share of each month's hours that are up (percent), in ``config.MONTHS`` order."""
    edges = np.cumsum([0] + [len(grid.month_hours(month)) for month in config.MONTHS])
    return np.array([100.0 * flags[a:b].mean() for a, b in zip(edges[:-1], edges[1:], strict=True)])


def check_sites(
    terrain: lightgrid.Terrain,
    cells: lightgrid.Observers,
    horizon: NDArray[np.float32],
    spec: grid.Grid = grid.FINE,
    skip: frozenset[str] = frozenset(),
) -> list[dict[str, Any]]:
    """The grid's method and the grid's cells against each listed site inside the square.

    ``skip`` leaves sites out by id: for the wide grid, the ones the fine grid already holds.
    """
    times = utc_range(config.DATA_START_UTC, config.DATA_END_UTC)
    positions = custom.moon_centered_positions_km(to_et(times)).astype(np.float64)
    out = []
    for site, col, row in site_cells(terrain, spec):
        if site.id in skip:
            continue
        up = unit_vector([site.lat_deg], [site.lon_deg])
        x, y = terrain.plane.project(up)
        theirs = dict(zip(("sun", "earth"), site_flags(site.id), strict=True))
        here = lightgrid.observers(up, terrain.height_at(up), config.OBS_HEIGHT_M)
        skyline = lightgrid.horizons(terrain, here, sample_distances_m(grid.MAX_RANGE_M))
        index = row * spec.size + col
        cell = grid.part(cells, slice(index, index + 1))
        cell_x, cell_y = lightgrid.grid_xy_m(spec.size, spec.pixel_m)
        offset_m = float(np.hypot(cell_x[row, col] - x[0], cell_y[row, col] - y[0]))
        entry: dict[str, Any] = {"site": site.id, "cell_center_offset_m": round(offset_m)}
        for body, start, radius_km in grid.BODIES:
            where = positions[:, start : start + 3]
            same = lightgrid.up_flags(skyline, here, where, radius_km)[0]
            in_cell = lightgrid.up_flags(np.ascontiguousarray(horizon[index : index + 1]), cell,
                                         where, radius_km)[0]  # fmt: skip
            month_gap = np.abs(monthly_pct(in_cell) - monthly_pct(theirs[body]))
            entry[body] = {
                "same_point": lightgrid.agreement(same, theirs[body]),
                "cell": lightgrid.agreement(in_cell, theirs[body])
                | {
                    "month_pct_typical_diff": round(float(np.median(month_gap)), 1),
                    "month_pct_largest_diff": round(float(month_gap.max()), 1),
                },
                "control_turned_90": lightgrid.agreement(
                    lightgrid.up_flags(skyline, here, where, radius_km, 90.0)[0], theirs[body]
                ),
                "control_turned_180": lightgrid.agreement(
                    lightgrid.up_flags(skyline, here, where, radius_km, 180.0)[0], theirs[body]
                ),
                "control_out_of_step": lightgrid.agreement(
                    np.roll(same, OUT_OF_STEP_H), theirs[body]
                ),
            }
        out.append(entry)
        print(f"  {site.id}: {json.dumps(entry)}")
    return out


def pgda_cells(name: str, spec: grid.Grid = grid.FINE) -> tuple[NDArray[np.float64], int]:
    """NASA's map averaged onto a grid's cells (percent, NaN where unusable), and gaps found.

    A cell covers a whole number of the map's 60 m pixels each way (two for the fine grid, five
    for the wide one); this checks that it does. Where the grid reaches past the map's edge (the
    wide grid's outermost cells), there is nothing to compare with.
    """
    half_m = spec.half_m
    with rasterio.open(config.PGDA_DIR / name) as ds:
        t = ds.transform
        col0, row0 = (-half_m - t.c) / t.a, (t.f - half_m) / t.a
        side = 2 * half_m / t.a
        per_cell = spec.pixel_m / t.a
        aligned = t.a == -t.e and per_cell % 1 == 0 and col0 % 1 == 0 and row0 % 1 == 0
        if not aligned:
            raise ValueError(f"{name} does not line up with the grid: {t}")
        # One pixel more all round, so every pixel has neighbours to be judged against.
        window = Window(int(col0) - 1, int(row0) - 1, int(side) + 2, int(side) + 2)
        raw = ds.read(1, window=window, boundless=True, fill_value=ds.nodata)
        values = 100.0 * (raw.astype(float) * float(ds.scales[0]) + float(ds.offsets[0]))
        values[raw == ds.nodata] = np.nan
    around = np.stack(
        [values[1 + dr : values.shape[0] - 1 + dr, 1 + dc : values.shape[1] - 1 + dc]
         for dr in (-1, 0, 1) for dc in (-1, 0, 1) if (dr, dc) != (0, 0)]
    )  # fmt: skip
    inner = values[1:-1, 1:-1].copy()
    gap = (inner == 0) & (np.nanmedian(around, axis=0) > GAP_NEIGHBOUR_PCT)
    inner[gap] = np.nan
    n = int(per_cell)
    return inner.reshape(spec.size, n, spec.size, n).mean(axis=(1, 3)).ravel(), int(gap.sum())


def check_pgda(
    cells: lightgrid.Observers, horizon: NDArray[np.float32], spec: grid.Grid = grid.FINE
) -> dict[str, Any]:
    """Every cell's 18.6-year average against NASA's maps, with two wrong skies as controls."""
    times = utc_range(PGDA_START_UTC, PGDA_END_UTC, PGDA_STEP_H)
    positions = custom.moon_centered_positions_km(to_et(times)).astype(np.float64)
    n = cells.up.shape[0]
    no_terrain = np.zeros((1, 2), np.float32)

    def averages(body: int, radius_km: float, wrong: str | None) -> tuple[Any, Any]:
        any_part, disk = np.empty(n, np.float32), np.empty(n, np.float32)
        where = positions[:, body : body + 3]
        for start in range(0, n, 4 * grid.BATCH):
            rows = slice(start, min(start + 4 * grid.BATCH, n))
            here = grid.part(cells, rows)
            if wrong == "no_terrain":
                skyline = np.repeat(no_terrain, rows.stop - rows.start, axis=0)
            else:
                skyline = np.ascontiguousarray(horizon[rows])
            shift = 180.0 if wrong == "turned_180" else 0.0
            any_part[rows], disk[rows] = lightgrid.averages_pct(
                skyline, here, where, radius_km, shift
            )
        return any_part, disk

    map_sun, sun_gaps = pgda_cells(PGDA_SUN, spec)
    map_earth, earth_gaps = pgda_cells(PGDA_EARTH, spec)
    well_lit = map_sun >= WELL_LIT_PCT
    out: dict[str, Any] = {
        "start": PGDA_START_UTC,
        "end": PGDA_END_UTC,
        "step_h": PGDA_STEP_H,
        "samples": len(times),
        "cells": int(n),
        "map_pixels_taken_as_gaps": {"sun": sun_gaps, "earth": earth_gaps},
        "well_lit_pct": WELL_LIT_PCT,
    }

    def both(ours: NDArray[np.float32], theirs: NDArray[np.float64]) -> dict[str, Any]:
        return {
            "all": lightgrid.comparison(ours, theirs),
            "well_lit": lightgrid.comparison(ours[well_lit], theirs[well_lit]),
        }

    for wrong in (None, "turned_180", "no_terrain"):
        t0 = time.perf_counter()
        sun_any, sun_disk = averages(0, grid.BODIES[0][2], wrong)
        earth_any, _ = averages(3, grid.BODIES[1][2], wrong)
        out[wrong or "ours"] = {
            "sun_mean_disk": both(sun_disk, map_sun),
            "sun_any_part": both(sun_any, map_sun),
            "earth_any_part": both(earth_any, map_earth),
        }
        took_s = time.perf_counter() - t0
        print(f"  {wrong or 'ours'} ({took_s:.0f} s): {json.dumps(out[wrong or 'ours'])}")
    return out


def site_cells(
    terrain: lightgrid.Terrain, spec: grid.Grid = grid.FINE
) -> list[tuple[config.Site, int, int]]:
    """Each listed site inside a grid, with the column and row of the cell that holds it."""
    half_m = spec.half_m
    found = []
    for site in config.SITES:
        x, y = terrain.plane.project(unit_vector([site.lat_deg], [site.lon_deg]))
        if site.lat_deg < -80 and max(abs(float(x[0])), abs(float(y[0]))) < half_m:
            col = int((float(x[0]) + half_m) // spec.pixel_m)
            row = int((half_m - float(y[0])) // spec.pixel_m)
            found.append((site, col, row))
    return found


def write_fixture(
    terrain: lightgrid.Terrain, cells: lightgrid.Observers, horizon: NDArray[np.float32]
) -> None:
    """One month at the sites' cells: the flips in the month file, and the hours they stand for.

    The hours and percentages are counted here from the flags themselves, before they are packed
    into flips, so the web test covers the packing, the file and the browser's reading of it.
    """
    times = grid.month_hours(FIXTURE_MONTH)
    positions = custom.moon_centered_positions_km(to_et(times)).astype(np.float64)
    blob = (grid.TILES_DIR / f"{FIXTURE_MONTH}.bin.gz").read_bytes()
    packed = dict(
        zip(
            ("sun", "earth"),
            lightgrid.decode_month(
                blob, lightgrid.GRID_SIZE, lightgrid.SUN_SLOTS, lightgrid.EARTH_SLOTS
            ),
            strict=True,
        )
    )
    rows = []
    for site, col, row in site_cells(terrain):
        index = row * lightgrid.GRID_SIZE + col
        here = grid.part(cells, slice(index, index + 1))
        skyline = np.ascontiguousarray(horizon[index : index + 1])
        up = {
            body: lightgrid.up_flags(skyline, here, positions[:, start : start + 3], radius_km)[0]
            for body, start, radius_km in grid.BODIES
        }
        rows.append(
            {
                "site": site.id,
                "lat": site.lat_deg,
                "lon": site.lon_deg,
                "col": col,
                "row": row,
                "sun_flips": packed["sun"][index].tolist(),
                "earth_flips": packed["earth"][index].tolist(),
                "sun": "".join("1" if flag else "0" for flag in up["sun"]),
                "earth": "".join("1" if flag else "0" for flag in up["earth"]),
                "pct_sun": round(100.0 * float(up["sun"].mean()), 6),
                "pct_earth": round(100.0 * float(up["earth"].mean()), 6),
                "pct_both": round(100.0 * float((up["sun"] & up["earth"]).mean()), 6),
                "sun_gap_h": nearby.longest_false_run(up["sun"]),
                "earth_gap_h": nearby.longest_false_run(up["earth"]),
            }
        )
    export.write_json(FIXTURE_PATH, {"month": FIXTURE_MONTH, "hours": len(times), "cells": rows})
    print(f"wrote {FIXTURE_PATH.name}: {len(rows)} cells of {FIXTURE_MONTH}")


def main() -> None:
    """Run both checks and write validation.json, or only the web test's fixture."""
    load_kernels()
    known = json.loads(OUT_PATH.read_text()) if OUT_PATH.is_file() else {}
    if "--wide" in sys.argv:
        # The wide grid's rays can leave the polar DEM, so the whole-Moon one is loaded too.
        terrain, _ = grid.load_terrain(with_far=True)
        cells = grid.grid_observers(terrain, grid.WIDE)
        horizon = np.load(grid.WIDE.horizons_path, mmap_mode="r")
        in_fine = frozenset(site.id for site, _, _ in site_cells(terrain, grid.FINE))
        print(f"Wide grid against the site tracks, {SPAN_WORDS}, hour by hour:")
        sites = check_sites(terrain, cells, horizon, grid.WIDE, skip=in_fine)
        print("Wide grid against NASA's long-run maps, every cell:")
        pgda = check_pgda(cells, horizon, grid.WIDE)
        wide = {"pixel_m": grid.WIDE.pixel_m, "sites": sites, "pgda": pgda}
        export.write_json(OUT_PATH, known | {"wide": wide})
        return
    terrain, _ = grid.load_terrain()
    cells = grid.grid_observers(terrain)
    horizon = np.load(grid.HORIZONS_PATH, mmap_mode="r")
    write_fixture(terrain, cells, horizon)
    if "--fixture" in sys.argv:
        return
    print(f"Against the site tracks, {SPAN_WORDS}, hour by hour:")
    sites = check_sites(terrain, cells, horizon)
    print("Against NASA's long-run maps, every cell:")
    pgda = check_pgda(cells, horizon)
    export.write_json(
        OUT_PATH,
        known
        | {
            "obs_height_m": config.OBS_HEIGHT_M,
            "pixel_m": lightgrid.PIXEL_M,
            "out_of_step_h": OUT_OF_STEP_H,
            "sites": sites,
            "pgda": pgda,
        },
    )


if __name__ == "__main__":
    main()
