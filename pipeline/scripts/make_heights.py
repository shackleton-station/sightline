"""Hourly Sun and Earth visibility at other heights above the ground, for the listed sites.

Everything the app ships is for a point ``config.OBS_HEIGHT_M`` (2 m) above the ground. A solar
panel on a mast, or an antenna on a lander's top deck, stands higher and sees over more of the
terrain. This writes, for each other height in ``config.OTHER_HEIGHTS``, the same files the app has
at 2 m: each site's horizon at that height, its hourly track and summary for every month, its
headline numbers for every year, and every site's hourly flags year by year. Only the height
changes: the same terrain, kernels, hours and code as ``run_all.py``.

Usage (from pipeline/):
  uv run python scripts/make_heights.py                       every height in config.OTHER_HEIGHTS
  uv run python scripts/make_heights.py --heights 5           some heights only
  uv run python scripts/make_heights.py --heights 2 --out /tmp/base
      the 2 m set again, somewhere else: gunzipped, every file must equal web/public/data's
      (scripts/check_heights.py --base /tmp/base does that comparison)

Output, in web/public/tiles/light/heights/ (not in Git; `cd web && npm run upload-light` copies the
light folder, this one included, to the assets bucket), one folder per height, named "5m", "10m":
  meta.json                              the heights, why each was chosen, and how to read a set
  <h>m/<site>/horizon.json.gz            as web/public/data/<site>/horizon.json
  <h>m/<site>/<month>/track.json.gz      as <site>/<month>/track.json
  <h>m/<site>/<month>/summary.json.gz    as <site>/<month>/summary.json
  <h>m/<site>/year-<year>.json.gz        as <site>/year-<year>.json
  <h>m/overview/<year>.json.gz           as overview/<year>.json
Each is the gzip of exactly the JSON the 2 m file would hold, so one reader serves both. They are
gzipped because nothing compresses a bucket file on its way out: a page unpacks it itself, as it
does a terrain tile.

The light grids, the nearby maps and custom points stay at 2 m.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import run_all  # noqa: E402

from clps import config, custom, dem, export, nearby  # noqa: E402
from clps.ephemeris import utc_range  # noqa: E402
from clps.geometry import MOON_RADIUS_M  # noqa: E402
from clps.kernels import load_kernels  # noqa: E402
from clps.observation import observe  # noqa: E402


def height_name(height_m: float) -> str:
    """The folder a height's files are in: "5m", "10m", "2.5m"."""
    return f"{height_m:g}m"


def build_height(height_m: float, height_at: dem.HeightFn, out: Path) -> None:
    """Write every site's files for one height above the ground into ``out``."""
    times = utc_range(config.DATA_START_UTC, config.DATA_END_UTC)
    flags: dict[str, run_all.SiteFlags] = {}
    for site in config.SITES:
        t0 = time.perf_counter()
        ground_m = float(height_at(np.array([site.lat_deg]), np.array([site.lon_deg]))[0])
        mask = run_all.site_mask(site, height_at, height_m, run_all.MAX_RANGE_M)
        radius_km = (MOON_RADIUS_M + ground_m + height_m) / 1000.0
        obs = observe(times, site.lat_deg, site.lon_deg, radius_km, mask)
        site_dir = out / site.id
        export.write_json_gz(site_dir / "horizon.json", export.horizon_rows(mask))
        run_all.write_years(site, obs, site_dir, height_m, export.write_json_gz)
        flags[site.id] = (
            obs.sun_frac > 0,
            obs.earth_frac > 0,
            {
                clearance: nearby.earth_clear_of_terrain(
                    obs.earth.az_deg, obs.earth.el_deg, mask, clearance
                )
                for clearance in nearby.EARTH_CLEARANCES_DEG
            },
        )
        print(f"  {height_name(height_m)} {site.id}: {time.perf_counter() - t0:.0f} s", flush=True)
    run_all.write_overview(times, flags, out, height_m, export.write_json_gz)


def meta(heights_m: list[float]) -> dict[str, object]:
    """``meta.json``: which heights there are, why, and how the files are laid out."""
    times = utc_range(config.DATA_START_UTC, config.DATA_END_UTC)
    chosen = {h.height_m: h for h in config.OTHER_HEIGHTS}
    return {
        "base_height_m": config.OBS_HEIGHT_M,
        "base": "The app's own files (web/public/data) are the set for this height.",
        "heights": [
            {
                "height_m": height_m,
                "folder": height_name(height_m),
                "why": chosen[height_m].why if height_m in chosen else None,
                "sources": list(chosen[height_m].sources) if height_m in chosen else [],
            }
            for height_m in heights_m
        ],
        "range": export.range_dict(times[0], len(times), config.YEARS, config.DEFAULT_MONTH),
        "sites": [site.id for site in config.SITES],
        "files": {
            "encoding": "each file is the gzip of the JSON the 2 m file of the same name holds",
            "horizon": "<folder>/<site>/horizon.json.gz",
            "track": "<folder>/<site>/<YYYY-MM>/track.json.gz",
            "summary": "<folder>/<site>/<YYYY-MM>/summary.json.gz",
            "year": "<folder>/<site>/year-<YYYY>.json.gz",
            "overview": "<folder>/overview/<YYYY>.json.gz",
        },
    }


def main() -> None:
    """Build the heights named on the command line, or every one in the configuration."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--heights", default="", help="meters, comma separated (default: all)")
    parser.add_argument("--out", default=str(config.WEB_HEIGHTS_DIR), help="where to write")
    args = parser.parse_args()
    heights_m = [float(h) for h in filter(None, args.heights.split(","))] or [
        h.height_m for h in config.OTHER_HEIGHTS
    ]
    out = Path(args.out)
    load_kernels()
    terrain = dem.read_window(dem.download_raster(), run_all.POLE_LAT_DEG, 0.0, custom.POLAR_HALF_M)
    world = dem.load_global_dem()
    height_at = dem.composite_height(terrain.height_at, world.height_at)
    for height_m in heights_m:
        t0 = time.perf_counter()
        build_height(height_m, height_at, out / height_name(height_m))
        print(f"{height_name(height_m)}: {time.perf_counter() - t0:.0f} s", flush=True)
    if out == config.WEB_HEIGHTS_DIR:
        export.write_json(out / "meta.json", meta([h.height_m for h in config.OTHER_HEIGHTS]))


if __name__ == "__main__":
    main()
