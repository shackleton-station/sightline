"""Build all site data into web/public/data/: horizon, tracks, summary, validation.

Usage (from pipeline/): uv run python scripts/run_all.py
Downloads anything missing into cache/, then regenerates every output from cache/.
"""

from __future__ import annotations

import multiprocessing
import sys
import time
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from export_features import build_features
from numpy.typing import NDArray

from clps import config, custom, dem, earth_sun, export, horizons, lroc, maps, nearby, validate
from clps.ephemeris import to_et, utc_range
from clps.geometry import MOON_RADIUS_M
from clps.horizon import HorizonMask, horizon_mask, sample_distances_m
from clps.kernels import load_kernels
from clps.observation import Observation, observe, select
from clps.visibility import Summary, summarize

MAX_RANGE_M = 200_000.0
SENSITIVITY_RANGES_M = (50_000.0, 100_000.0, 150_000.0)
#: Long-run span for the PGDA comparison: one 18.6-year nutation cycle, matching PGDA's averaging.
PGDA_START_UTC = "2020-01-01T00:00:00"
PGDA_END_UTC = "2038-08-01T00:00:00"
PGDA_STEP_H = 2
#: Observer heights compared with PGDA, which does not state a height for its maps.
PGDA_OBS_HEIGHTS_M = (0.0, config.OBS_HEIGHT_M)
#: Random-pixel comparison with the PGDA maps, within this distance of the pole (m).
GRID_RADIUS_M = 50_000.0
GRID_MIN_RADIUS_M = 1_000.0
GRID_N_EACH = 40
GRID_HIGH_SUN_PCT = 50.0
GRID_STEP_H = 6
GRID_SEED = 20261102
#: Spot checks in four Mays: the first and last years of the data, since the Moon's orientation
#: drifts over the years, and the two the first four years of data were checked at.
HORIZONS_YEARS = tuple(
    sorted({config.YEARS[0], config.CHECK_YEARS[0], config.CHECK_YEARS[-1], config.YEARS[-1]})
)
HORIZONS_SPANS = tuple(
    (f"{year}-05-01 00:00", f"{year}-05-29 00:01")
    for year in HORIZONS_YEARS
    if year in config.YEARS
)
HORIZONS_STEP = "7d"
#: Earth places for checking the Sun's height there: not a multiple of a day, so hours vary.
EARTH_CHECK_PLACES = ((40.0, 0.0), (0.0, 0.0), (-89.5, 0.0))
EARTH_CHECK_START = "2027-01-01 00:00"
EARTH_CHECK_STOP = "2030-12-31 00:00"
EARTH_CHECK_STEP = "2339h"


@dataclass(frozen=True)
class PgdaMaps:
    """One resolution of PGDA's maps: the finest covering a site's latitude is used."""

    min_abs_lat_deg: float
    resolution_m: float
    sun: tuple[str, int]
    earth: tuple[str, int]


PGDA_MAPS = (
    PgdaMaps(
        85.0,
        60.0,
        ("AVGVISIB_85S_060M_201608.TIF", 33_994_464),
        ("AVGVISIB_85S_060M_201608_EARTH.TIF", 24_862_958),
    ),
    PgdaMaps(
        75.0,
        120.0,
        ("AVGVISIB_75S_120M_201608.TIF", 83_052_039),
        ("AVGVISIB_75S_120M_201608_EARTH.TIF", 43_148_153),
    ),
    PgdaMaps(
        65.0,
        240.0,
        ("AVGVISIB_65S_240M_201608.TIF", 60_394_652),
        ("AVGVISIB_65S_240M_201608_EARTH.TIF", 22_963_503),
    ),
)
PGDA_URL = "https://pgda.gsfc.nasa.gov/data/MoonIllumination/"
POLE_LAT_DEG = -90.0
#: The polar close-up: half-width (m) and averaging block over 20 m pixels.
MAP_POLE_HALF_WIDTH_M = 60_000.0
MAP_POLE_BLOCK = 8
#: Browser model vs full pipeline: random points per absolute-latitude band.
CUSTOM_BANDS = [
    (0.0, 30.0),
    (30.0, 60.0),
    (60.0, 70.0),
    (70.0, 80.0),
    (80.0, 85.0),
    (85.0, 90.0),
]
CUSTOM_N_PER_BAND = 30
CUSTOM_SEED = 20261103
CUSTOM_ACCURACY_STEP_H = 2
CUSTOM_FIXTURE_HOUR = 3000
CUSTOM_RIDGE_MIN_SUN = 0.5
#: Extra test points: tiles across the 0° seam, the north polar region, just outside the polar DEM.
FIXTURE_POINTS = [
    ("seam", 5.0, 0.4),
    ("north-polar", 86.0, -40.0),
    ("polar-edge", -79.5, 120.0),
]
#: Sites with a map of nearby ground: the ones inside NASA's 60 m maps, so the map can be checked.
NEARBY_GROUP = "South pole ridges"
NEARBY_WORKERS = max((multiprocessing.cpu_count() or 2) - 2, 1)
#: NASA pixels compared within each map: uniform, plus well-lit ground, where a mission would look.
NEARBY_N_UNIFORM = 300
NEARBY_N_WELL_LIT = 200
NEARBY_CHECK_STEP_H = 6
NEARBY_SEED = 20261103
#: NASA's 5 m tile holding each ridge site, for its terrain, slope and uncertainty clones.
RIDGE_TILES = {
    "connecting-ridge": "Site01",
    "shackleton-rim": "Site04",
    "peak-near-shackleton": "Site07",
    "de-gerlache-rim": "Site11",
}
TILE_DIR = config.CACHE_DIR / "lola5m"
TILE_NEAR_RANGE_M = 8_000.0
#: How far around a site to show the numbers changing (m): about how close landers come to a
#: target (Blue Ghost Mission 1 landed within a 100 m target).
SPREAD_RADIUS_M = 100.0
SPREAD_STEP_M = 20.0
CLONE_HEIGHTS_M = (1.0, 2.0, 5.0)
N_CLONES = 100
LROC_MAP = "WAC_POLE_ILL_TWI_SOUTH_100M.IMG"
LROC_URL = (
    "https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/"
    "lro-l-lroc-5-rdr/LROLRC_2001/DATA/BDR/WAC_POLE/WAC_POLE_ILL_TWI_SOUTH/" + LROC_MAP
)
LROC_N_EACH = 150
LROC_WELL_LIT_PCT = 50.0
LROC_MAX_RADIUS_M = 55_000.0
LROC_STEP_H = 2
LROC_SEED = 20261104


def site_mask(
    site: config.Site, height_at: dem.HeightFn, obs_height_m: float, max_range_m: float
) -> HorizonMask:
    """Horizon mask at a site for one observer height and maximum range."""
    return horizon_mask(
        site.lat_deg,
        site.lon_deg,
        height_at,
        obs_height_m=obs_height_m,
        distances_m=sample_distances_m(max_range_m),
    )


def pgda_window(
    file: tuple[str, int], lat_deg: float, lon_deg: float, radius_m: float
) -> dem.DemWindow:
    """Open a window of a PGDA map (values are fractions 0–1), downloading it if missing."""
    name, size = file
    path = dem.download_raster(config.PGDA_DIR, PGDA_URL + name, size)
    return dem.read_window(path, lat_deg, lon_deg, radius_m)


def pgda_value(
    file: tuple[str, int], resolution_m: float, site: config.Site
) -> tuple[float, list[float]]:
    """PGDA map value at the site pixel and the min/max of its 3×3 neighborhood, in percent."""
    window = pgda_window(file, site.lat_deg, site.lon_deg, 4 * resolution_m)
    cells = window.neighborhood_at(site.lat_deg, site.lon_deg)
    nearby = [100.0 * float(np.nanmin(cells)), 100.0 * float(np.nanmax(cells))]
    return 100.0 * window.nearest_at(site.lat_deg, site.lon_deg), nearby


def pgda_site_map(site: config.Site) -> dict[str, Any] | None:
    """NASA's map values at a site, from the finest map covering it; None if none reaches it."""
    if site.lat_deg > 0:
        return None
    maps = (m for m in PGDA_MAPS if abs(site.lat_deg) >= m.min_abs_lat_deg)
    chosen = next(maps, None)
    if chosen is None:
        return None
    sun_pct, sun_nearby = pgda_value(chosen.sun, chosen.resolution_m, site)
    earth_pct, earth_nearby = pgda_value(chosen.earth, chosen.resolution_m, site)
    return {
        "resolution_m": chosen.resolution_m,
        "sun_pct": round(sun_pct, 2),
        "earth_pct": round(earth_pct, 2),
        "sun_nearby_pct": [round(v, 2) for v in sun_nearby],
        "earth_nearby_pct": [round(v, 2) for v in earth_nearby],
    }


def grid_comparison(terrain: dem.DemWindow) -> list[dict[str, Any]]:
    """Compare our long-run averages with the PGDA maps at random pixels near the pole."""
    finest = PGDA_MAPS[0]
    sun_map = pgda_window(finest.sun, POLE_LAT_DEG, 0.0, GRID_RADIUS_M)
    earth_map = pgda_window(finest.earth, POLE_LAT_DEG, 0.0, GRID_RADIUS_M)
    sun_pct = 100.0 * sun_map.heights_m
    earth_pct = 100.0 * earth_map.heights_m
    t = sun_map.transform
    rows, cols = np.indices(sun_pct.shape)
    x = t.c + (cols + 0.5) * t.a
    y = t.f + (rows + 0.5) * t.e
    dist = np.hypot(x, y)
    eligible = (
        np.isfinite(sun_pct)
        & np.isfinite(earth_pct)
        & (dist >= GRID_MIN_RADIUS_M)
        & (dist <= GRID_RADIUS_M)
    )
    rng = np.random.default_rng(GRID_SEED)
    pick_r, pick_c = validate.stratified_pixels(
        eligible, sun_pct, rng, GRID_N_EACH, GRID_HIGH_SUN_PCT
    )
    lats, lons = sun_map.xy_to_latlon(x[pick_r, pick_c], y[pick_r, pick_c])
    map_sun, map_earth = (
        sun_pct[pick_r, pick_c].astype(float),
        earth_pct[pick_r, pick_c].astype(float),
    )

    span = utc_range(PGDA_START_UTC, PGDA_END_UTC, GRID_STEP_H)
    ours: dict[float, list[dict[str, float]]] = {h: [] for h in PGDA_OBS_HEIGHTS_M}
    for lat, lon in zip(lats, lons, strict=True):
        h_m = float(terrain.height_at(lat, lon))
        for height_m in PGDA_OBS_HEIGHTS_M:
            mask = horizon_mask(
                float(lat),
                float(lon),
                terrain.height_at,
                obs_height_m=height_m,
                distances_m=sample_distances_m(MAX_RANGE_M),
            )
            radius_km = (MOON_RADIUS_M + h_m + height_m) / 1000.0
            obs = observe(span, float(lat), float(lon), radius_km, mask)
            ours[height_m].append(validate.long_run_stats(obs.sun_frac, obs.earth_frac))

    high = map_sun >= GRID_HIGH_SUN_PCT
    out: list[dict[str, Any]] = []
    for height_m, stats in ours.items():
        for quantity, reference in (
            ("sun_any_pct", map_sun),
            ("sun_mean_disk_pct", map_sun),
            ("earth_any_pct", map_earth),
        ):
            values = np.array([s[quantity] for s in stats])
            for sample, keep in (("all", np.ones_like(high)), ("high_sun", high)):
                result = validate.comparison_stats(values[keep], reference[keep])
                out.append(
                    {
                        "quantity": quantity,
                        "obs_height_m": height_m,
                        "sample": sample,
                        "n": int(np.sum(keep)),
                    }
                    | {k: round(v, 3) for k, v in result.items()}
                )
    return out


def horizons_checks(
    site: config.Site, alt_km: float, times: np.ndarray, sun: Any, earth: Any
) -> list[validate.SpotCheck]:
    """Compare our tracks with Horizons at weekly timestamps (responses cached in cache/)."""
    checks: list[validate.SpotCheck] = []
    for body, body_id, track in (
        ("sun", horizons.SUN_ID, sun),
        ("earth", horizons.EARTH_ID, earth),
    ):
        for start, stop in HORIZONS_SPANS:
            params = horizons.query_params(
                body_id,
                site.lat_deg,
                site.lon_deg % 360.0,
                alt_km,
                start,
                stop,
                HORIZONS_STEP,
            )
            rows = horizons.parse_observer_table(horizons.fetch_cached(params, config.HORIZONS_DIR))
            checks += validate.spot_checks(body, rows, times, track)
    return checks


def month_edges(month: str) -> tuple[np.datetime64, np.datetime64]:
    """UTC start and exclusive end of a ``YYYY-MM`` month."""
    start = np.datetime64(month, "M")
    end = start + np.timedelta64(1, "M")
    return start.astype("datetime64[s]"), end.astype("datetime64[s]")


def year_summaries(obs: Observation) -> dict[int, Summary]:
    """Headline numbers for each calendar year of an observation."""
    years: dict[int, Summary] = {}
    for year in config.YEARS:
        start, _ = month_edges(f"{year}-01")
        _, end = month_edges(f"{year}-12")
        keep = (obs.times >= start) & (obs.times < end)
        years[year] = summarize(obs.times[keep], obs.sun_frac[keep] > 0, obs.earth_frac[keep] > 0)
    return years


#: Writes one JSON file: ``export.write_json``, or ``export.write_json_gz`` for the bucket.
JsonWriter = Callable[[Path, object], None]


def write_years(
    site: config.Site,
    obs: Observation,
    out: Path,
    obs_height_m: float = config.OBS_HEIGHT_M,
    write: JsonWriter = export.write_json,
) -> None:
    """Write each month's track and summary, and each year's headline numbers by month and year."""
    months: dict[str, Summary] = {}
    for month in config.MONTHS:
        start, end = month_edges(month)
        part = select(obs, (obs.times >= start) & (obs.times < end))
        months[month] = summarize(part.times, part.sun_frac > 0, part.earth_frac > 0)
        write(out / month / "track.json", export.track_rows(part))
        write(
            out / month / "summary.json",
            export.summary_dict(months[month], start, end, 1, obs_height_m),
        )
    years = year_summaries(obs)
    for year, stats in years.items():
        print(
            f"  {site.id} {year}: Sun {stats.pct_sun:.1f}%, "
            f"Earth {stats.pct_earth:.1f}%, both {stats.pct_both:.1f}%, "
            f"gaps {stats.max_sun_gap_h} h / {stats.max_earth_gap_h} h"
        )
    for year, stats in years.items():
        in_year = {m: s for m, s in months.items() if m.startswith(f"{year}-")}
        write(
            out / f"year-{year}.json",
            export.year_dict(in_year, {year: stats}, config.DEFAULT_MONTH),
        )


def build_site(
    site: config.Site,
    height_at: dem.HeightFn,
    terrain_resolution_m: float,
    grid_stats: list[dict[str, Any]],
) -> SiteFlags:
    """Compute and write every output for one site; returns its hourly flags for the overview."""
    t0 = time.perf_counter()
    site_h_m = float(height_at(np.array([site.lat_deg]), np.array([site.lon_deg]))[0])
    print(f"{site.id}: {terrain_resolution_m:.0f} m/px near the site, height {site_h_m:.1f} m")

    t1 = time.perf_counter()
    mask = site_mask(site, height_at, config.OBS_HEIGHT_M, MAX_RANGE_M)
    print(f"  horizon mask: {time.perf_counter() - t1:.1f} s")
    short = int(np.sum(mask.reach_m < sample_distances_m(MAX_RANGE_M)[-1]))
    if short:
        print(f"  WARNING: {short} rays ended before {MAX_RANGE_M / 1000:.0f} km (DEM edge)")
    sensitivity = [
        {
            "range_km": r / 1000.0,
            "max_diff_deg": round(
                validate.mask_max_diff_deg(
                    site_mask(site, height_at, config.OBS_HEIGHT_M, r), mask
                ),
                3,
            ),
        }
        for r in SENSITIVITY_RANGES_M
    ]
    print(f"  horizon range sensitivity vs {MAX_RANGE_M / 1000:.0f} km: {sensitivity}")

    radius_km = (MOON_RADIUS_M + site_h_m + config.OBS_HEIGHT_M) / 1000.0
    times = utc_range(config.DATA_START_UTC, config.DATA_END_UTC)
    obs = observe(times, site.lat_deg, site.lon_deg, radius_km, mask)

    alt_km = (site_h_m + config.OBS_HEIGHT_M) / 1000.0
    checks = horizons_checks(site, alt_km, times, obs.sun, obs.earth)
    max_sep = max(c.sep_deg for c in checks)
    print(f"  Horizons: {len(checks)} checks, max separation {max_sep:.5f} deg")

    span = utc_range(PGDA_START_UTC, PGDA_END_UTC, PGDA_STEP_H)
    ours: list[dict[str, float]] = []
    for height_m in PGDA_OBS_HEIGHTS_M:
        long_mask = site_mask(site, height_at, height_m, MAX_RANGE_M)
        radius = (MOON_RADIUS_M + site_h_m + height_m) / 1000.0
        long_obs = observe(span, site.lat_deg, site.lon_deg, radius, long_mask)
        stats = validate.long_run_stats(long_obs.sun_frac, long_obs.earth_frac)
        ours.append({"obs_height_m": height_m} | {k: round(v, 2) for k, v in stats.items()})
    site_map = pgda_site_map(site)
    print(f"  PGDA map: {site_map}")
    print(f"  ours: {ours}")

    out = config.WEB_DATA_DIR / site.id
    export.write_json(out / "horizon.json", export.horizon_rows(mask))
    write_years(site, obs, out)
    by_height: dict[float, dict[int, Summary]] = {config.OBS_HEIGHT_M: year_summaries(obs)}
    for height_m in nearby.MAST_HEIGHTS_M:
        if height_m != config.OBS_HEIGHT_M:
            radius = (MOON_RADIUS_M + site_h_m + height_m) / 1000.0
            taller = site_mask(site, height_at, height_m, MAX_RANGE_M)
            by_height[height_m] = year_summaries(
                observe(times, site.lat_deg, site.lon_deg, radius, taller)
            )
    export.write_json(out / "heights.json", export.mast_heights_rows(by_height))
    export.write_json(
        out / "validation.json",
        {
            "terrain_resolution_m": terrain_resolution_m,
            "horizons": {
                "checks": validate.checks_as_dicts(checks),
                "max_sep_deg": round(max_sep, 4),
            },
            "pgda": {
                "span": {
                    "start": export.iso(span[0]),
                    "end": export.iso(np.datetime64(PGDA_END_UTC)),
                    "step_h": PGDA_STEP_H,
                },
                "map": site_map,
                "ours": ours,
                "grid": {
                    "step_h": GRID_STEP_H,
                    "high_sun_pct": GRID_HIGH_SUN_PCT,
                    "stats": grid_stats,
                },
            },
            "horizon_range": sensitivity,
        },
    )
    print(f"  done in {time.perf_counter() - t0:.1f} s")
    earth_above = {
        clearance: nearby.earth_clear_of_terrain(
            obs.earth.az_deg, obs.earth.el_deg, mask, clearance
        )
        for clearance in nearby.EARTH_CLEARANCES_DEG
    }
    return obs.sun_frac > 0, obs.earth_frac > 0, earth_above


SiteFlags = tuple[NDArray[np.bool_], NDArray[np.bool_], dict[float, NDArray[np.bool_]]]


def write_overview(
    times: NDArray[np.datetime64],
    flags: dict[str, SiteFlags],
    out: Path = config.WEB_DATA_DIR,
    obs_height_m: float = config.OBS_HEIGHT_M,
    write: JsonWriter = export.write_json,
) -> None:
    """Write every site's hourly Sun and Earth flags, one file per calendar year."""
    for year in config.YEARS:
        start, _ = month_edges(f"{year}-01")
        _, end = month_edges(f"{year}-12")
        keep = (times >= start) & (times < end)
        in_year = {
            site_id: (sun[keep], earth[keep], {k: v[keep] for k, v in above.items()})
            for site_id, (sun, earth, above) in flags.items()
        }
        write(
            out / "overview" / f"{year}.json",
            export.overview_dict(times[keep][0], int(keep.sum()), obs_height_m, in_year),
        )


def build_earth_sun() -> None:
    """Write where the Sun is overhead on Earth each hour, and check it against JPL Horizons."""
    out = config.WEB_DATA_DIR / "earth-sun"
    times = utc_range(config.DATA_START_UTC, config.DATA_END_UTC)
    sub_lat, sub_lon = earth_sun.subsolar_points(to_et(times))
    for month in config.MONTHS:
        start, end = month_edges(month)
        keep = (times >= start) & (times < end)
        export.write_json(
            out / f"{month}.json", export.earth_sun_month(sub_lat[keep], sub_lon[keep])
        )
    differences: list[float] = []
    for lat_deg, lon_deg in EARTH_CHECK_PLACES:
        params = horizons.query_params(
            horizons.SUN_ID,
            lat_deg,
            lon_deg % 360.0,
            0.0,
            EARTH_CHECK_START,
            EARTH_CHECK_STOP,
            EARTH_CHECK_STEP,
            horizons.EARTH_ID,
        )
        rows = horizons.parse_observer_table(horizons.fetch_cached(params, config.HORIZONS_DIR))
        hours = np.searchsorted(times, np.array([row.t for row in rows]))
        ours = earth_sun.sun_elevation_deg(lat_deg, lon_deg, sub_lat[hours], sub_lon[hours])
        theirs = np.array([row.el_deg for row in rows])
        differences += [float(d) for d in np.abs(ours - theirs)]
    export.write_json(
        out / "validation.json",
        {"checks": len(differences), "max_diff_deg": round(max(differences), 3)},
    )
    print(f"Earth Sun: {len(differences)} Horizons checks, max {max(differences):.3f} deg")


def write_tiles(polar: NDArray[np.int16], world: dem.GlobalDem) -> dict[str, int]:
    """Write fine terrain tiles for the browser. Not in Git: `npm run upload-tiles` copies them."""
    out = config.WEB_TILES_DIR
    counts = {"polar": 0, "global": 0}
    size = polar.shape[0]
    step = custom.POLAR_TILE_PX
    for row in range(0, size, step):
        for col in range(0, size, step):
            name = f"polar/{row // step}_{col // step}.bin.gz"
            export.write_bytes(
                out / name, custom.encode_tile(polar[row : row + step, col : col + step])
            )
            counts["polar"] += 1
    lines, samples = world.shape
    step = custom.GLOBAL_TILE_PX
    for row in range(0, lines, step):
        for col in range(0, samples, step):
            tile = np.asarray(world.grid[row : row + step, col : col + step])
            name = f"global/{row // step}_{col // step}.bin.gz"
            export.write_bytes(out / name, custom.encode_tile(tile))
            counts["global"] += 1
    export.write_json(out / "manifest.json", counts)
    return counts


def fixture_row(
    site_id: str, lat: float, lon: float, terrain: custom.BrowserTerrain, times: np.ndarray
) -> dict[str, Any]:
    """The browser model's expected results at a point, for the web test."""
    height_at = terrain.height_fn(lat, lon)
    mask = horizon_mask(
        lat,
        lon,
        height_at,
        obs_height_m=custom.BROWSER_OBS_HEIGHT_M,
        distances_m=custom.browser_distances_m(),
    )
    h_m = float(height_at(np.array([lat]), np.array([lon]))[0])
    radius_km = (MOON_RADIUS_M + h_m + custom.BROWSER_OBS_HEIGHT_M) / 1000.0
    obs = observe(times, lat, lon, radius_km, mask)
    i = CUSTOM_FIXTURE_HOUR
    earth_above = {
        export.clearance_key(k): round(
            100.0
            * float(
                np.mean(nearby.earth_clear_of_terrain(obs.earth.az_deg, obs.earth.el_deg, mask, k))
            ),
            3,
        )
        for k in nearby.EARTH_CLEARANCES_DEG
    }
    return {
        "id": site_id,
        "lat": lat,
        "lon": lon,
        "height_m": round(h_m, 3),
        "mask_el": [round(float(e), 4) for e in mask.el_deg[::60]],
        "pct_sun": round(100.0 * float(np.mean(obs.sun_frac > 0)), 3),
        "pct_earth": round(100.0 * float(np.mean(obs.earth_frac > 0)), 3),
        "pct_earth_above": earth_above,
        "slope_20m_deg": round(
            nearby.slope_at(height_at, lat, lon, nearby.POLAR_SLOPE_HALF_STEP_M), 2
        ),
        "hour": i,
        "sun_az": round(float(obs.sun.az_deg[i]), 4),
        "sun_el": round(float(obs.sun.el_deg[i]), 4),
        "earth_az": round(float(obs.earth.az_deg[i]), 4),
        "earth_el": round(float(obs.earth.el_deg[i]), 4),
    }


def build_custom(
    terrain: dem.DemWindow,
    world: dem.GlobalDem,
    full_height: dem.HeightFn,
    grid_stats: list[dict[str, Any]],
) -> None:
    """Write the browser's terrain and positions, and measure how well it matches the full model."""
    t0 = time.perf_counter()
    out = config.WEB_DATA_DIR / "custom"
    grid = custom.downsample_global(world)
    rows = grid.shape[0]
    export.write_bytes(out / "terrain-north.bin", grid[: rows // 2].astype("<i2").tobytes())
    export.write_bytes(out / "terrain-south.bin", grid[rows // 2 :].astype("<i2").tobytes())

    polar = custom.quantize_polar(terrain.heights_m)
    polar_far = custom.quantize_polar(maps.block_mean(terrain.heights_m, custom.POLAR_FAR_BLOCK))
    export.write_bytes(out / "polar-far.bin.gz", custom.encode_tile(polar_far))
    counts = write_tiles(polar, world)
    print(f"tiles: {counts}, {time.perf_counter() - t0:.0f} s")
    browser = custom.BrowserTerrain(polar, polar_far, world, grid)

    for year in config.YEARS:
        year_times = utc_range(f"{year}-01-01T00:00:00", f"{year + 1}-01-01T00:00:00")
        positions = custom.moon_centered_positions_km(to_et(year_times))
        export.write_bytes(out / f"ephemeris-{year}.bin", positions.astype("<f4").tobytes())

    # The web test's expected results cover the check years, not the whole range: the test then
    # needs four years of positions however long the range grows, and its numbers stay put.
    all_times = utc_range(config.DATA_START_UTC, config.DATA_END_UTC)
    check_times = utc_range(config.CHECK_START_UTC, config.CHECK_END_UTC)
    points = [
        fixture_row(site.id, site.lat_deg, site.lon_deg, browser, check_times)
        for site in config.SITES
    ]
    points += [
        fixture_row(point_id, lat, lon, browser, check_times)
        for point_id, lat, lon in FIXTURE_POINTS
    ]
    export.write_json(
        out / "fixture.json",
        {
            "start": export.iso(check_times[0]),
            "hours": len(check_times),
            "years": list(config.CHECK_YEARS),
            "points": points,
        },
    )

    # Accuracy against the full model is measured over the first check year: more years wouldn't
    # change how well the coarser terrain matches, only the cost of measuring it.
    first = config.CHECK_YEARS[0]
    times = utc_range(f"{first}-01-01T00:00:00", f"{first + 1}-01-01T00:00:00")

    every_other = times[::CUSTOM_ACCURACY_STEP_H]

    def flags(lat: float, lon: float, radius_km: float, mask: HorizonMask) -> Any:
        obs = observe(every_other, lat, lon, radius_km, mask)
        return obs.sun_frac > 0, obs.earth_frac > 0

    rng = np.random.default_rng(CUSTOM_SEED)
    full_distances = sample_distances_m(MAX_RANGE_M)
    bands = []
    for low, high in CUSTOM_BANDS:
        lats, lons = custom.random_points(rng, low, high, CUSTOM_N_PER_BAND)
        band = custom.accuracy_at_points(
            low, high, lats, lons, full_height, full_distances, browser.height_fn, flags
        )
        bands.append(band)
        print(f"  {band}")

    # Well-lit polar pixels: the terrain where resolution matters most.
    sun_map = pgda_window(PGDA_MAPS[0].sun, POLE_LAT_DEG, 0.0, 150_000.0)
    lit = np.flatnonzero(np.nan_to_num(sun_map.heights_m) >= CUSTOM_RIDGE_MIN_SUN)
    picks = rng.choice(lit, CUSTOM_N_PER_BAND, replace=False)
    row_i, col_i = np.unravel_index(picks, sun_map.heights_m.shape)
    t = sun_map.transform
    ridge_lats, ridge_lons = sun_map.xy_to_latlon(
        t.c + (col_i + 0.5) * t.a, t.f + (row_i + 0.5) * t.e
    )
    ridges = custom.accuracy_at_points(
        85.0, 90.0, ridge_lats, ridge_lons, full_height, full_distances, browser.height_fn, flags
    )
    print(f"  ridges: {ridges}")

    def rmse(quantity: str) -> float:
        return next(
            row["rmse"]
            for row in grid_stats
            if row["quantity"] == quantity
            and row["obs_height_m"] == config.OBS_HEIGHT_M
            and row["sample"] == "all"
        )

    geometry = world.geometry()
    export.write_json(
        out / "meta.json",
        {
            "ppd": custom.BROWSER_PPD,
            "rows": int(grid.shape[0]),
            "cols": int(grid.shape[1]),
            "start": export.iso(all_times[0]),
            "hours": len(all_times),
            "obs_height_m": custom.BROWSER_OBS_HEIGHT_M,
            "max_abs_lat": custom.MAX_ABS_LAT_DEG,
            "near_polar_m": custom.NEAR_POLAR_M,
            "near_global_m": custom.NEAR_GLOBAL_M,
            "polar": {
                "half_m": custom.POLAR_HALF_M,
                "res_m": custom.POLAR_RES_M,
                "size": int(polar.shape[0]),
                "tile_px": custom.POLAR_TILE_PX,
                "quant_m": custom.POLAR_QUANT_M,
                "far_res_m": custom.POLAR_RES_M * custom.POLAR_FAR_BLOCK,
                "far_size": int(polar_far.shape[0]),
            },
            "global": geometry | {"tile_px": custom.GLOBAL_TILE_PX},
            "model_error": {
                "sun_rmse": rmse("sun_mean_disk_pct"),
                "sun_any_rmse": rmse("sun_any_pct"),
                "earth_rmse": rmse("earth_any_pct"),
            },
            "bands": [asdict(b) for b in bands],
            "polar_ridges": asdict(ridges),
        },
    )
    print(f"custom coordinates files: {time.perf_counter() - t0:.0f} s")


def build_maps(terrain: dem.DemWindow, world: dem.GlobalDem) -> None:
    """Write the shaded-relief images behind the app's map."""
    out = config.WEB_DATA_DIR / "maps"
    relief = maps.global_relief(custom.downsample_global(world), custom.BROWSER_PPD)
    export.write_bytes(out / "moon.png", maps.png_gray(relief))

    half_px = int(MAP_POLE_HALF_WIDTH_M / abs(terrain.transform.a))
    center = terrain.heights_m.shape[0] // 2
    crop = terrain.heights_m[
        center - half_px : center + half_px, center - half_px : center + half_px
    ]
    small = maps.block_mean(crop, MAP_POLE_BLOCK)
    pixel_m = abs(terrain.transform.a) * MAP_POLE_BLOCK
    export.write_bytes(out / "pole.png", maps.png_gray(maps.hillshade(small, pixel_m, pixel_m)))
    export.write_json(
        out / "meta.json",
        {
            "moon": {"width": int(relief.shape[1]), "height": int(relief.shape[0])},
            "pole": {
                "width": int(small.shape[1]),
                "height": int(small.shape[0]),
                "half_width_m": half_px * abs(terrain.transform.a),
            },
        },
    )
    print(f"maps: moon {relief.shape}, pole {small.shape}")


#: What forked workers read for a nearby map, set just before they start. Not passed per task: the
#: terrain is gigabytes, and forked workers share it without copying.
_nearby_terrain: dem.DemWindow | None = None
_nearby_positions: NDArray[np.float32] | None = None
_nearby_edges: NDArray[np.intp] | None = None


def _point_fractions(lat: float, lon: float, positions: NDArray[np.float32]) -> Any:
    """Sun and Earth disk fractions at a point, using the full model's terrain and rays."""
    assert _nearby_terrain is not None
    h_m = float(_nearby_terrain.height_at(np.array([lat]), np.array([lon]))[0])
    mask = horizon_mask(
        lat,
        lon,
        _nearby_terrain.height_at,
        obs_height_m=config.OBS_HEIGHT_M,
        distances_m=sample_distances_m(MAX_RANGE_M),
    )
    radius_km = (MOON_RADIUS_M + h_m + config.OBS_HEIGHT_M) / 1000.0
    return nearby.fractions_from_center(positions, lat, lon, radius_km, mask)


def _nearby_cell(point: tuple[float, float]) -> nearby.CellMonths:
    assert _nearby_positions is not None and _nearby_edges is not None
    sun, earth = _point_fractions(point[0], point[1], _nearby_positions)
    return nearby.cell_months(sun > 0, earth > 0, _nearby_edges)


def _nearby_long_run(point: tuple[float, float]) -> tuple[float, float]:
    assert _nearby_positions is not None
    sun, earth = _point_fractions(point[0], point[1], _nearby_positions)
    return 100.0 * float(np.mean(sun)), 100.0 * float(np.mean(earth > 0))


def _nearby_pool() -> ProcessPoolExecutor:
    return ProcessPoolExecutor(NEARBY_WORKERS, mp_context=multiprocessing.get_context("fork"))


def nearby_check(site: config.Site, rng: np.random.Generator) -> dict[str, Any]:
    """Compare a map's ground with NASA's long-run maps, at NASA's own pixels (18.6 years)."""
    global _nearby_positions
    span = utc_range(PGDA_START_UTC, PGDA_END_UTC, NEARBY_CHECK_STEP_H)
    _nearby_positions = custom.moon_centered_positions_km(to_et(span))
    finest = PGDA_MAPS[0]
    reach = nearby.HALF_WIDTH_M + 2 * finest.resolution_m
    sun_map = pgda_window(finest.sun, site.lat_deg, site.lon_deg, reach)
    earth_map = pgda_window(finest.earth, site.lat_deg, site.lon_deg, reach)
    t = sun_map.transform
    rows, cols = np.indices(sun_map.heights_m.shape)
    x = t.c + (cols + 0.5) * t.a
    y = t.f + (rows + 0.5) * t.e
    center_x, center_y = sun_map.latlon_to_xy(site.lat_deg, site.lon_deg)
    eligible = (
        (np.abs(x - center_x) <= nearby.HALF_WIDTH_M)
        & (np.abs(y - center_y) <= nearby.HALF_WIDTH_M)
        & np.isfinite(sun_map.heights_m)
        & np.isfinite(earth_map.heights_m)
    )
    any_pixel = rng.choice(np.flatnonzero(eligible), NEARBY_N_UNIFORM, replace=False)
    lit_pixels = np.flatnonzero(eligible & (sun_map.heights_m * 100.0 >= GRID_HIGH_SUN_PCT))
    lit_pixel = rng.choice(lit_pixels, min(NEARBY_N_WELL_LIT, lit_pixels.size), replace=False)

    def compare(pixels: NDArray[np.intp]) -> dict[str, Any]:
        lats, lons = sun_map.xy_to_latlon(x.flat[pixels], y.flat[pixels])
        with _nearby_pool() as pool:
            ours = np.array(
                list(
                    pool.map(
                        _nearby_long_run,
                        zip(lats.tolist(), lons.tolist(), strict=True),
                        chunksize=4,
                    )
                )
            )
        return {
            "sun": nearby.ranking_stats(
                ours[:, 0], 100.0 * sun_map.heights_m.flat[pixels].astype(float)
            ),
            "earth": nearby.ranking_stats(
                ours[:, 1], 100.0 * earth_map.heights_m.flat[pixels].astype(float)
            ),
        }

    return {
        "span": {
            "start": export.iso(span[0]),
            "end": export.iso(np.datetime64(PGDA_END_UTC)),
            "step_h": NEARBY_CHECK_STEP_H,
        },
        "map_resolution_m": finest.resolution_m,
        "uniform": compare(any_pixel),
        "well_lit": compare(lit_pixel),
    }


def build_nearby(terrain: dem.DemWindow) -> None:
    """Write a map of the ground around each ridge site: Sun, Earth and slope, month by month."""
    global _nearby_terrain, _nearby_positions, _nearby_edges
    _nearby_terrain = terrain
    times = utc_range(config.DATA_START_UTC, config.DATA_END_UTC)
    positions = custom.moon_centered_positions_km(to_et(times))
    edges = [np.searchsorted(times, month_edges(month)[0]) for month in config.MONTHS]
    _nearby_edges = np.array([*edges, len(times)], np.intp)
    offsets = nearby.grid_offsets_m()
    size = offsets.size
    rng = np.random.default_rng(NEARBY_SEED)

    def height_xy(x_m: Any, y_m: Any) -> Any:
        lat, lon = terrain.xy_to_latlon(x_m, y_m)
        return terrain.height_at(lat, lon)

    for site in (s for s in config.SITES if s.group == NEARBY_GROUP):
        t0 = time.perf_counter()
        out = config.WEB_DATA_DIR / "nearby" / site.id
        center_x, center_y = terrain.latlon_to_xy(site.lat_deg, site.lon_deg)
        x_grid, y_grid = np.meshgrid(center_x + offsets, center_y - offsets)
        lats, lons = terrain.xy_to_latlon(x_grid.ravel(), y_grid.ravel())

        _nearby_positions = positions
        with _nearby_pool() as pool:
            cells = list(
                pool.map(_nearby_cell, zip(lats.tolist(), lons.tolist(), strict=True), chunksize=32)
            )
        for i, month in enumerate(config.MONTHS):
            export.write_bytes(
                out / f"{month}.bin.gz",
                nearby.encode_month(
                    np.array([c.pct_sun[i] for c in cells], np.uint8),
                    np.array([c.pct_earth[i] for c in cells], np.uint8),
                    np.array([c.pct_both[i] for c in cells], np.uint8),
                    np.array([c.sun_gap_h[i] for c in cells], np.uint16),
                ),
            )
        half_step = nearby.POLAR_SLOPE_HALF_STEP_M
        slope = nearby.slope_grid(height_xy, x_grid.ravel(), y_grid.ravel(), half_step)
        export.write_bytes(out / "slope.bin.gz", nearby.encode_slope(slope))
        check = nearby_check(site, rng)
        export.write_json(
            out / "meta.json",
            {
                "site_id": site.id,
                "half_width_m": nearby.HALF_WIDTH_M,
                "step_m": nearby.STEP_M,
                "size": size,
                "center_x_m": round(float(center_x), 3),
                "center_y_m": round(float(center_y), 3),
                "corner": {"lat": round(float(lats[0]), 6), "lon": round(float(lons[0]), 6)},
                "slope_baseline_m": 2 * half_step,
                "slope_quant_deg": nearby.SLOPE_QUANT_DEG,
                "obs_height_m": config.OBS_HEIGHT_M,
                "check": check,
            },
        )
        print(f"nearby {site.id}: {time.perf_counter() - t0:.0f} s; {check['uniform']['sun']}")


#: What forked workers read for the accuracy work, set just before they start.
_accuracy_height: dem.HeightFn | None = None
_accuracy_base: dem.HeightFn | None = None
_accuracy_positions: NDArray[np.float32] | None = None
_accuracy_edges: NDArray[np.intp] | None = None
#: One site's terrain clones. Read before forking: GDAL isn't safe to start in a forked worker.
_accuracy_clones: list[dem.DemWindow] = []
_FINE_DISTANCES = sample_distances_m(MAX_RANGE_M, near_step_m=5.0, near_range_m=TILE_NEAR_RANGE_M)


def _site_fractions(
    lat: float,
    lon: float,
    height_fn: dem.HeightFn,
    height_m: float,
    positions: NDArray[np.float32],
    distances: Any,
) -> Any:
    h_m = float(height_fn(np.array([lat]), np.array([lon]))[0])
    mask = horizon_mask(lat, lon, height_fn, obs_height_m=height_m, distances_m=distances)
    radius_km = (MOON_RADIUS_M + h_m + height_m) / 1000.0
    return nearby.fractions_from_center(positions, lat, lon, radius_km, mask)


def _spread_point(point: tuple[float, float]) -> Any:
    assert _accuracy_height is not None and _accuracy_positions is not None
    assert _accuracy_edges is not None
    sun, earth = _site_fractions(
        point[0],
        point[1],
        _accuracy_height,
        config.OBS_HEIGHT_M,
        _accuracy_positions,
        _FINE_DISTANCES,
    )
    return nearby.period_numbers(sun > 0, earth > 0, _accuracy_edges)


def _clone_job(job: tuple[int, float, float]) -> list[tuple[float, float]]:
    assert _accuracy_base is not None and _accuracy_positions is not None
    index, lat, lon = job
    height_fn = dem.composite_height(_accuracy_clones[index].height_at, _accuracy_base)
    out = []
    for height_m in CLONE_HEIGHTS_M:
        sun, earth = _site_fractions(
            lat, lon, height_fn, height_m, _accuracy_positions, _FINE_DISTANCES
        )
        out.append((100.0 * float(np.mean(sun > 0)), 100.0 * float(np.mean(earth > 0))))
    return out


def download_ridge_tiles() -> None:
    """Fetch NASA's 5 m terrain, slope and clones for the ridge sites (about 16 GB) if missing."""
    base = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp"
    wanted = []
    for tile in RIDGE_TILES.values():
        for kind in ("surf", "slp", "slperr"):
            name = f"{tile}_final_adj_5mpp_{kind}.tif"
            wanted.append((TILE_DIR / name, f"{base}/{tile}/{name}"))
        for clone in range(1, N_CLONES + 1):
            name = f"{tile}_final_adj_5mpp_{clone:04d}_err.tif"
            wanted.append((TILE_DIR / "clones" / name, f"{base}/{tile}/Clones/{name}"))
    missing = [(path, url) for path, url in wanted if not path.exists()]
    if missing:
        print(f"downloading {len(missing)} of {len(wanted)} 5 m files")
    with httpx.Client(follow_redirects=True, timeout=300) as client:
        for path, url in missing:
            response = client.get(url)
            response.raise_for_status()
            export.write_bytes(path, response.content)


def _accuracy_pool() -> ProcessPoolExecutor:
    return ProcessPoolExecutor(NEARBY_WORKERS, mp_context=multiprocessing.get_context("fork"))


def build_spread(height_at: dem.HeightFn) -> None:
    """Write how each ridge site's numbers change within 100 m, and with NASA's terrain error."""
    global _accuracy_height, _accuracy_base, _accuracy_positions, _accuracy_edges, _accuracy_clones
    download_ridge_tiles()
    _accuracy_base = height_at
    times = utc_range(config.DATA_START_UTC, config.DATA_END_UTC)
    positions = custom.moon_centered_positions_km(to_et(times))
    month_starts = [np.searchsorted(times, month_edges(m)[0]) for m in config.MONTHS]
    year_starts = [np.searchsorted(times, month_edges(f"{y}-01")[0]) for y in config.YEARS]
    edges = np.array([*month_starts, len(times)], np.intp)
    year_edges = np.array([*year_starts, len(times)], np.intp)
    long_span = utc_range(PGDA_START_UTC, PGDA_END_UTC, NEARBY_CHECK_STEP_H)
    long_positions = custom.moon_centered_positions_km(to_et(long_span))
    for site in config.SITES:
        tile = RIDGE_TILES.get(site.id)
        if tile is None:
            continue
        t0 = time.perf_counter()
        window = dem.read_whole(TILE_DIR / f"{tile}_final_adj_5mpp_surf.tif")
        _accuracy_height = dem.composite_height(window.height_at, height_at)
        center_x, center_y = window.latlon_to_xy(site.lat_deg, site.lon_deg)
        offsets = nearby.circle_offsets_m(SPREAD_RADIUS_M, SPREAD_STEP_M)
        lats, lons = window.xy_to_latlon(center_x + offsets[:, 0], center_y + offsets[:, 1])
        points = list(zip(lats.tolist(), lons.tolist(), strict=True))

        rows_by_edges = {}
        for name, period_edges in (("months", edges), ("years", year_edges)):
            _accuracy_positions, _accuracy_edges = positions, period_edges
            with _accuracy_pool() as pool:
                rows_by_edges[name] = np.array(list(pool.map(_spread_point, points, chunksize=2)))

        _accuracy_positions = long_positions
        clones = sorted((TILE_DIR / "clones").glob(f"{tile}_final_adj_5mpp_*_err.tif"))
        _accuracy_clones = [dem.read_whole(c) for c in clones]
        jobs = [(i, site.lat_deg, site.lon_deg) for i in range(len(clones))]
        with _accuracy_pool() as pool:
            by_clone = np.array(list(pool.map(_clone_job, jobs)))
        export.write_json(
            config.WEB_DATA_DIR / site.id / "spread.json",
            {
                "radius_m": SPREAD_RADIUS_M,
                "step_m": SPREAD_STEP_M,
                "n_points": len(points),
                "terrain_resolution_m": 5.0,
                "obs_height_m": config.OBS_HEIGHT_M,
                "months": [
                    {"month": month} | nearby.spread_row(rows_by_edges["months"][:, i])
                    for i, month in enumerate(config.MONTHS)
                ],
                "years": [
                    {"year": year} | nearby.spread_row(rows_by_edges["years"][:, i])
                    for i, year in enumerate(config.YEARS)
                ],
                "terrain_error": {
                    "n_clones": len(clones),
                    "span": {
                        "start": export.iso(long_span[0]),
                        "end": export.iso(np.datetime64(PGDA_END_UTC)),
                        "step_h": NEARBY_CHECK_STEP_H,
                    },
                    "by_height": [
                        {
                            "obs_height_m": height_m,
                            "sun_any_pct": nearby.error_stats(by_clone[:, h, 0]),
                            "earth_any_pct": nearby.error_stats(by_clone[:, h, 1]),
                        }
                        for h, height_m in enumerate(CLONE_HEIGHTS_M)
                    ],
                },
            },
        )
        print(
            f"spread {site.id}: {len(points)} points, {len(clones)} clones, "
            f"{time.perf_counter() - t0:.0f} s; clones at 2 m: "
            f"{nearby.error_stats(by_clone[:, 1, 0])}"
        )


_lroc_terrain: dem.HeightFn | None = None
_lroc_positions: NDArray[np.float32] | None = None


def _lroc_point(job: tuple[float, float, float]) -> float:
    """Average share of the Sun's disk in view at a point over the period, in percent."""
    assert _lroc_terrain is not None and _lroc_positions is not None
    lat, lon, height_m = job
    sun, _ = _site_fractions(
        lat, lon, _lroc_terrain, height_m, _lroc_positions, sample_distances_m(MAX_RANGE_M)
    )
    return 100.0 * float(np.mean(sun))


def build_lroc_check(terrain: dem.DemWindow, height_at: dem.HeightFn) -> None:
    """Compare the model and NASA's map with LROC's map of how often real photos show sunlight."""
    global _lroc_terrain, _lroc_positions
    _lroc_terrain = height_at
    path = config.CACHE_DIR / "lroc" / LROC_MAP
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(httpx.get(LROC_URL, follow_redirects=True, timeout=120).content)
    layout, photos = lroc.read_image(path)
    span = utc_range(lroc.WAC_TWI_START_UTC, lroc.WAC_TWI_END_UTC, LROC_STEP_H)
    _lroc_positions = custom.moon_centered_positions_km(to_et(span))
    nasa = pgda_window(PGDA_MAPS[0].sun, POLE_LAT_DEG, 0.0, LROC_MAX_RADIUS_M + 500.0)
    offsets = np.array([(a, b) for a in lroc.PATCH_OFFSETS_M for b in lroc.PATCH_OFFSETS_M])

    def patch_mean(x_m: float, y_m: float, height_m: float) -> float:
        lats, lons = terrain.xy_to_latlon(x_m + offsets[:, 0], y_m + offsets[:, 1])
        return float(np.mean(_lroc_values(lats, lons, height_m)))

    rows, cols = np.indices(photos.shape)
    x, y = layout.center_xy(rows, cols)
    distance = np.hypot(x, y)
    usable = np.isfinite(photos) & (distance >= GRID_MIN_RADIUS_M) & (distance <= LROC_MAX_RADIUS_M)
    rng = np.random.default_rng(LROC_SEED)
    samples = {}
    for label, pixels in (
        ("all_ground", np.flatnonzero(usable)),
        ("well_lit", np.flatnonzero(usable & (photos >= LROC_WELL_LIT_PCT))),
    ):
        picks = rng.choice(pixels, LROC_N_EACH, replace=False)
        xs, ys = x.flat[picks], y.flat[picks]
        seen = photos.flat[picks]
        lats, lons = terrain.xy_to_latlon(xs[:, None] + offsets[:, 0], ys[:, None] + offsets[:, 1])
        measured = {}
        for name, height_m in (("ours_ground", 0.0), ("ours_2m", config.OBS_HEIGHT_M)):
            values = _lroc_values(lats.ravel(), lons.ravel(), height_m)
            measured[name] = lroc.agreement(values.reshape(lats.shape).mean(axis=1), seen)
        map_lat, map_lon = terrain.xy_to_latlon(xs, ys)
        map_values = np.array(
            [
                100.0 * nasa.nearest_at(float(a), float(b))
                for a, b in zip(map_lat, map_lon, strict=True)
            ]
        )
        keep = np.isfinite(map_values)
        measured["nasa_map"] = lroc.agreement(map_values[keep], seen[keep])
        samples[label] = measured
        print(f"LROC {label}: {measured}")

    sites = {}
    for site in config.SITES:
        if site.id in RIDGE_TILES:
            center_x, center_y = terrain.latlon_to_xy(site.lat_deg, site.lon_deg)
            row, col = layout.pixel(np.array([center_x]), np.array([center_y]))
            px, py = layout.center_xy(row[0], col[0])
            sites[site.id] = {
                "photo_pct": round(float(photos[row[0], col[0]]), 1),
                "ours_ground_pct": round(patch_mean(float(px), float(py), 0.0), 1),
                "ours_2m_pct": round(patch_mean(float(px), float(py), config.OBS_HEIGHT_M), 1),
                "nasa_map_pct": round(100.0 * nasa.nearest_at(site.lat_deg, site.lon_deg), 1),
            }
    print(f"LROC sites: {sites}")
    export.write_json(
        config.WEB_DATA_DIR / "lroc-check.json",
        {
            "map": LROC_MAP.removesuffix(".IMG"),
            "period": {
                "start": export.iso(span[0]),
                "end": export.iso(np.datetime64(lroc.WAC_TWI_END_UTC)),
                "step_h": LROC_STEP_H,
            },
            "samples": samples,
            "sites": sites,
        },
    )


def _lroc_values(lats: Any, lons: Any, height_m: float) -> Any:
    jobs = [(float(a), float(b), height_m) for a, b in zip(lats, lons, strict=True)]
    with _accuracy_pool() as pool:
        return np.array(list(pool.map(_lroc_point, jobs, chunksize=8)))


def write_sites(terrain: dem.DemWindow, world: dem.GlobalDem, height_at: dem.HeightFn) -> None:
    """Write ``sites.json``, with the ground slope at each site and which have a nearby map.

    Ridge sites use NASA's own 5 m slope and its uncertainty. Elsewhere it's measured from our
    terrain, over a much longer distance.
    """
    rows = []
    for site in config.SITES:
        half_m = nearby.HALF_WIDTH_M if site.group == NEARBY_GROUP else None
        tile = RIDGE_TILES.get(site.id)
        if tile is not None:
            slope_map = dem.read_whole(TILE_DIR / f"{tile}_final_adj_5mpp_slp.tif")
            err_map = dem.read_whole(TILE_DIR / f"{tile}_final_adj_5mpp_slperr.tif")
            slope = slope_map.nearest_at(site.lat_deg, site.lon_deg)
            err = err_map.nearest_at(site.lat_deg, site.lon_deg)
            rows.append(export.site_row(site, slope, 5, half_m, err))
            print(f"  slope at {site.id}: {slope:.1f} +/- {err:.1f} deg over 5 m (NASA)")
            continue
        polar = bool(np.isfinite(terrain.height_at(site.lat_deg, site.lon_deg)))
        half_step = nearby.POLAR_SLOPE_HALF_STEP_M if polar else world.resolution_m
        slope = nearby.slope_at(height_at, site.lat_deg, site.lon_deg, half_step)
        rows.append(export.site_row(site, slope, round(2 * half_step), half_m))
        print(f"  slope at {site.id}: {slope:.1f} deg over {2 * half_step:.0f} m")
    export.write_json(config.WEB_DATA_DIR / "sites.json", rows)


def main() -> None:
    """Build everything, or only images (``--maps-only``) or nearby maps (``--nearby-only``)."""
    load_kernels()
    dem_path = dem.download_raster()
    terrain = dem.read_window(dem_path, POLE_LAT_DEG, 0.0, custom.POLAR_HALF_M)
    world = dem.load_global_dem()
    height_at = dem.composite_height(terrain.height_at, world.height_at)
    if "--nearby-only" in sys.argv:
        build_nearby(terrain)
        return
    if "--accuracy-only" in sys.argv:
        build_spread(height_at)
        build_lroc_check(terrain, height_at)
        write_sites(terrain, world, height_at)
        export.write_contract(config.WEB_CONTRACT_TS)
        return
    build_maps(terrain, world)
    if "--maps-only" in sys.argv:
        return
    t0 = time.perf_counter()
    grid_stats = grid_comparison(terrain)
    print(f"PGDA grid comparison: {time.perf_counter() - t0:.0f} s")
    for row in grid_stats:
        print(f"  {row}")
    flags: dict[str, SiteFlags] = {}
    for site in config.SITES:
        polar = bool(np.isfinite(terrain.height_at(site.lat_deg, site.lon_deg)))
        resolution_m = 20.0 if polar else world.resolution_m
        flags[site.id] = build_site(site, height_at, resolution_m, grid_stats)
    times = utc_range(config.DATA_START_UTC, config.DATA_END_UTC)
    write_overview(times, flags)
    export.write_json(
        config.WEB_DATA_DIR / "range.json",
        export.range_dict(times[0], len(times), config.YEARS, config.DEFAULT_MONTH),
    )
    build_earth_sun()
    build_custom(terrain, world, height_at, grid_stats)
    build_nearby(terrain)
    build_spread(height_at)
    build_lroc_check(terrain, height_at)
    write_sites(terrain, world, height_at)
    build_features()
    export.write_contract(config.WEB_CONTRACT_TS)


if __name__ == "__main__":
    main()
