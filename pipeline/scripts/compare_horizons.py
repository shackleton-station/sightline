"""Compare every hour the web app ships with JPL Horizons, site by site.

For each curated site, asks Horizons for the Sun's and Earth's apparent azimuth and elevation at
every hour of each year (one request per site, year and body: about 8,760 rows), compares them with
the rounded hourly angles in ``web/public/data/<site>/<month>/track.json``, and writes the largest
and the typical (median) gap per site to ``web/public/data/horizons.json``.

JPL's fair-use policy for its APIs (https://ssd-api.jpl.nasa.gov/doc/index.php, read 2026-11-13):
one request at a time, cache and reuse, back off on errors, and a User-Agent that names the
application. So requests run one after another with a pause, replies are kept in
``cache/horizons-hourly/`` (a second run asks for nothing), and a failure waits before one retry.
Set ``HORIZONS_USER_AGENT`` to name yourself and how to reach you.

Usage, from ``pipeline/``:

    uv run python scripts/compare_horizons.py                 every site, every year
    uv run python scripts/compare_horizons.py --sites im-2-athena --years 2027
    uv run python scripts/compare_horizons.py --sample        about one hour a month, all years

``--sample --height 10`` checks the set for another height above the ground the same way.
``--sample`` is the quick check after the range changes: one request per site and body for the
whole range, every 739 hours (not a multiple of a day, so the hour of the day drifts through all
24). It prints the gaps and writes nothing; ``horizons.json`` only ever holds the hourly comparison.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from clps import config, custom, dem, horizons, horizons_compare

HOURLY_DIR: Path = config.CACHE_DIR / "horizons-hourly"
ALTITUDES_PATH: Path = HOURLY_DIR / "altitudes.json"
OUT_PATH: Path = config.WEB_DATA_DIR / "horizons.json"
USER_AGENT = os.environ.get("HORIZONS_USER_AGENT", "lunar-visibility-check/1.0 (pipeline script)")
#: Seconds to wait before retrying a failed request, in turn; after the last, the run stops.
BACKOFF_S = (30.0, 120.0)
#: The sample's step: about one hour a month, and not a multiple of 24 h.
SAMPLE_STEP = "739h"


def site_altitudes_km(sites: tuple[config.Site, ...]) -> dict[str, float]:
    """Height of each site's observer above the 1737.4 km sphere (km), as ``run_all.py`` sets it.

    Read from the same LOLA terrain, then kept in the cache so a later run needs no terrain.
    """
    known: dict[str, float] = (
        json.loads(ALTITUDES_PATH.read_text()) if ALTITUDES_PATH.is_file() else {}
    )
    missing = [site for site in sites if site.id not in known]
    if missing:
        terrain = dem.read_window(dem.download_raster(), -90.0, 0.0, custom.POLAR_HALF_M)
        world = dem.load_global_dem()
        height_at = dem.composite_height(terrain.height_at, world.height_at)
        for site in missing:
            h_m = float(height_at(np.array([site.lat_deg]), np.array([site.lon_deg]))[0])
            known[site.id] = round((h_m + config.OBS_HEIGHT_M) / 1000.0, 6)
        ALTITUDES_PATH.parent.mkdir(parents=True, exist_ok=True)
        ALTITUDES_PATH.write_text(json.dumps(known, indent=1))
    return known


def fetch_slowly(params: dict[str, str], client: httpx.Client, pause_s: float) -> str:
    """One query's reply: from the cache, or from Horizons with a pause and a patient retry."""
    if horizons.cache_path(params, HOURLY_DIR).is_file():
        return horizons.fetch_cached(params, HOURLY_DIR, client)
    for wait_s in (*BACKOFF_S, None):
        try:
            text = horizons.fetch_cached(params, HOURLY_DIR, client)
            time.sleep(pause_s)
            return text
        except (httpx.HTTPError, ValueError) as error:
            if wait_s is None:
                raise
            print(f"    Horizons did not answer ({error!s:.120}); waiting {wait_s:.0f} s")
            time.sleep(wait_s)
    raise AssertionError("unreachable")


def compare_site(
    site: config.Site, alt_km: float, years: tuple[int, ...], client: httpx.Client, pause_s: float
) -> tuple[dict[str, Any], str | None]:
    """One site's gaps against Horizons, for both bodies together and each alone."""
    seps: dict[str, list[Any]] = {"sun": [], "earth": []}
    source: str | None = None
    for year in years:
        shipped = horizons_compare.shipped_year(config.WEB_DATA_DIR / site.id, year)
        for (body, az_key, el_key), body_id in zip(
            horizons_compare.BODIES, (horizons.SUN_ID, horizons.EARTH_ID), strict=True
        ):
            params = horizons_compare.year_params(body_id, site.lat_deg, site.lon_deg, alt_km, year)
            text = fetch_slowly(params, client, pause_s)
            source = horizons_compare.ephemeris_source(text) or source
            rows = horizons.parse_observer_table(text)
            seps[body].append(
                horizons_compare.compare_rows(rows, shipped["t"], shipped[az_key], shipped[el_key])
            )
    sun, earth = np.concatenate(seps["sun"]), np.concatenate(seps["earth"])
    both = np.concatenate([sun, earth])
    stats = horizons_compare.gap_stats(both)
    return (
        {
            "hours": int(sun.size),
            "max_deg": stats["max_deg"],
            "typical_deg": stats["typical_deg"],
            "sun": horizons_compare.gap_stats(sun),
            "earth": horizons_compare.gap_stats(earth),
            "alt_km": alt_km,
        },
        source,
    )


def sample_site(
    site: config.Site,
    alt_km: float,
    client: httpx.Client,
    pause_s: float,
    data_dir: Path = config.WEB_DATA_DIR,
) -> dict[str, Any]:
    """One site's gaps against Horizons at about one hour a month across the whole range."""
    seps: dict[str, Any] = {}
    for (body, az_key, el_key), body_id in zip(
        horizons_compare.BODIES, (horizons.SUN_ID, horizons.EARTH_ID), strict=True
    ):
        params = horizons.query_params(
            body_id,
            site.lat_deg,
            site.lon_deg % 360.0,
            alt_km,
            f"{config.YEARS[0]}-01-01 00:00",
            f"{config.YEARS[-1]}-12-31 23:00",
            SAMPLE_STEP,
        )
        rows = horizons.parse_observer_table(fetch_slowly(params, client, pause_s))
        shipped = horizons_compare.shipped_at(
            data_dir / site.id, np.array([row.t for row in rows], "datetime64[s]")
        )
        seps[body] = horizons_compare.compare_rows(
            rows, shipped["t"], shipped[az_key], shipped[el_key]
        )
    both = np.concatenate([seps["sun"], seps["earth"]])
    return horizons_compare.gap_stats(both) | {
        "years": len({str(row.t)[:4] for row in rows}),
        "sun": horizons_compare.gap_stats(seps["sun"]),
        "earth": horizons_compare.gap_stats(seps["earth"]),
    }


def main() -> None:
    """Run the comparison and write ``horizons.json``; sites not asked for keep their old entry."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sites", default="", help="site ids, comma separated (default: all)")
    parser.add_argument("--years", default="", help="years, comma separated (default: all)")
    parser.add_argument("--pause", type=float, default=3.0, help="seconds between requests")
    parser.add_argument("--sample", action="store_true", help="about one hour a month, all years")
    parser.add_argument(
        "--height",
        type=float,
        default=config.OBS_HEIGHT_M,
        help="with --sample: metres above ground",
    )
    args = parser.parse_args()
    wanted = set(filter(None, args.sites.split(",")))
    sites = tuple(site for site in config.SITES if not wanted or site.id in wanted)
    years = tuple(int(y) for y in filter(None, args.years.split(","))) or config.YEARS
    altitudes = site_altitudes_km(sites)

    if args.sample:
        # A set for another height (scripts/make_heights.py): the observer stands that much higher.
        other = args.height != config.OBS_HEIGHT_M
        data_dir = config.WEB_HEIGHTS_DIR / f"{args.height:g}m" if other else config.WEB_DATA_DIR
        raised_km = (args.height - config.OBS_HEIGHT_M) / 1000.0
        worst, hours = 0.0, 0
        with httpx.Client(timeout=120.0, headers={"User-Agent": USER_AGENT}) as client:
            for site in sites:
                alt_km = round(altitudes[site.id] + raised_km, 6)
                entry = sample_site(site, alt_km, client, args.pause, data_dir)
                worst, hours = max(worst, entry["max_deg"]), hours + entry["hours"]
                print(
                    f"{site.id}: {entry['hours']} comparisons in {entry['years']} years, largest "
                    f"{entry['max_deg']} deg (Sun {entry['sun']['max_deg']}, Earth "
                    f"{entry['earth']['max_deg']}), typical {entry['typical_deg']} deg"
                )
        print(f"Sample, every {SAMPLE_STEP}: {hours} comparisons, largest gap {worst} deg")
        return

    whole = years == config.YEARS
    out: dict[str, Any] = json.loads(OUT_PATH.read_text()) if OUT_PATH.is_file() else {}
    results: dict[str, Any] = out.get("sites", {})
    source: str | None = out.get("ephemeris")
    with httpx.Client(timeout=120.0, headers={"User-Agent": USER_AGENT}) as client:
        for site in sites:
            entry, seen = compare_site(site, altitudes[site.id], years, client, args.pause)
            source = seen or source
            print(
                f"{site.id}: {entry['hours']} h, largest {entry['max_deg']} deg, "
                f"typical {entry['typical_deg']} deg"
            )
            if whole:
                results[site.id] = entry
    if not whole:
        print("Not every year was asked for, so horizons.json is left as it was.")
        return
    OUT_PATH.write_text(
        json.dumps(
            {
                "service": "JPL Horizons API",
                "url": horizons.HORIZONS_URL,
                "ephemeris": source,
                "made": datetime.date.today().isoformat(),
                "range": {"start": config.DATA_START_UTC, "end": config.DATA_END_UTC, "step_h": 1},
                "shipped_rounding_deg": 0.01,
                "sites": {site.id: results[site.id] for site in config.SITES if site.id in results},
            },
            indent=1,
        )
        + "\n"
    )
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
