"""Pipeline configuration: site list, time range, paths and observer parameters."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

#: Repository root (pipeline/src/clps/config.py → three parents up from this file's directory).
REPO_ROOT: Path = Path(__file__).resolve().parents[3]

#: Git-ignored cache for large inputs (kernels, DEM, PGDA maps).
CACHE_DIR: Path = REPO_ROOT / "cache"
KERNEL_DIR: Path = CACHE_DIR / "kernels"
DEM_DIR: Path = CACHE_DIR / "dem"
PGDA_DIR: Path = CACHE_DIR / "pgda"
HORIZONS_DIR: Path = CACHE_DIR / "horizons"

#: Small derived JSON outputs consumed by the web app, and their generated TypeScript types.
WEB_DATA_DIR: Path = REPO_ROOT / "web" / "public" / "data"
#: Fine terrain tiles for the browser: too large for Git, so generated here and uploaded at deploy.
WEB_TILES_DIR: Path = REPO_ROOT / "web" / "public" / "tiles"
WEB_CONTRACT_TS: Path = REPO_ROOT / "web" / "src" / "data" / "contract.ts"

#: Default observer height above the local surface (meters).
OBS_HEIGHT_M: float = 2.0
#: Hourly sets for other heights, for choosing the solar panel's and the antenna's height
#: separately (``scripts/make_heights.py``). In the assets bucket, not in Git, and not read by the
#: app yet: the app's own data stays at ``OBS_HEIGHT_M``. They sit under the light grids' folder
#: because that is a part of the bucket the load balancer already serves and the co-pilot can
#: already read (infra/assets.tf, infra/copilot.tf): using them needs no change to either.
WEB_HEIGHTS_DIR: Path = WEB_TILES_DIR / "light" / "heights"


@dataclass(frozen=True)
class ObserverHeight:
    """A height above the ground that hourly data is also computed for, and where it comes from."""

    height_m: float
    why: str
    sources: tuple[str, ...]


#: The other heights, each from real hardware or from NASA's own studies (REFERENCES.md has the
#: wording quoted from each page). Not round numbers picked for the look of them:
#: - 2 m, the app's own height, is about the height of a small lander (Blue Ghost Mission 1);
#: - the paper behind NASA's polar illumination maps (Mazarico et al. 2011) speaks of height gains
#:   of about 10 m, and NASA's vertical solar arrays stand that high;
#: - a panel spans a range of heights, so the middle of such a mast says more than its top;
#: - an antenna sits at the top of its lander, and two of the listed sites are Nova-C landings.
OTHER_HEIGHTS: tuple[ObserverHeight, ...] = (
    ObserverHeight(
        4.0,
        "The top of a Nova-C class lander, where its antennas are. NASA describes the IM-1 and "
        "IM-2 landers as about 14 feet (4.3 m) tall; a NASA technical memorandum gives 3.9 m.",
        (
            "https://www.nasa.gov/podcasts/houston-we-have-a-podcast/im-1/",
            "https://ntrs.nasa.gov/citations/20250010290",
        ),
    ),
    ObserverHeight(
        5.0,
        "The middle of a vertical solar array on a 32-foot (9.8 m) mast. Also a height NASA's "
        "study of south pole sites uses (PGDA product 78, where the ridge sites come from).",
        (
            "https://www.nasa.gov/technology/nasa-industry-to-mature-vertical-solar-array-technologies-for-lunar-surface/",
            "https://pgda.gsfc.nasa.gov/products/78",
        ),
    ),
    ObserverHeight(
        10.0,
        "The top of a vertical solar array: NASA's arrays deploy up to 32 feet (9.8 m) high. "
        "Mazarico et al. (2011) report what height gains of about 10 m do to illumination.",
        (
            "https://www.nasa.gov/technology/nasa-industry-to-mature-vertical-solar-array-technologies-for-lunar-surface/",
            "https://doi.org/10.1016/j.icarus.2010.10.030",
        ),
    ),
)

#: First and last calendar year of hourly data (UTC). Whole years, because the app is organised by
#: month and year. 2026 puts today inside the data; 2049 is the last year this pipeline ships of
#: what the lunar orientation kernel covers (``moon_pa_de421_1900-2050.bpc`` ends on 31 December
#: 2050, 23:58 UTC; see docs/VALIDATION.md).
FIRST_YEAR: int = 2026
LAST_YEAR: int = 2049


def years_from_env(value: str | None) -> tuple[int, ...]:
    """The years to build: ``CLPS_YEARS`` as "2031" or "2026-2049", or the whole range if unset."""
    if not value:
        return tuple(range(FIRST_YEAR, LAST_YEAR + 1))
    first, _, last = value.partition("-")
    return tuple(range(int(first), int(last or first) + 1))


#: Years of hourly data (UTC). Each month is exported separately, and each year's summaries and
#: flags are a file of their own, so the app loads only what it shows however long the range is.
#: ``CLPS_YEARS`` builds fewer, for a trial run: never ship a partial range.
YEARS: tuple[int, ...] = years_from_env(os.environ.get("CLPS_YEARS"))
MONTHS: tuple[str, ...] = tuple(f"{y}-{m:02d}" for y in YEARS for m in range(1, 13))
DATA_START_UTC: str = f"{YEARS[0]}-01-01T00:00:00"
DATA_END_UTC: str = f"{YEARS[-1] + 1}-01-01T00:00:00"
#: Shown first: May 2027 has the least Sun of any 2027 month at Connecting Ridge (59.5%).
DEFAULT_MONTH: str = "2027-05"
#: The four years every accuracy check was first measured on. The checks keep to them as the range
#: grows, so their numbers stay comparable from one run to the next, and the web's tests don't need
#: every year. They must lie inside ``YEARS``.
CHECK_YEARS: tuple[int, ...] = (2027, 2028, 2029, 2030)
CHECK_START_UTC: str = f"{CHECK_YEARS[0]}-01-01T00:00:00"
CHECK_END_UTC: str = f"{CHECK_YEARS[-1] + 1}-01-01T00:00:00"


@dataclass(frozen=True)
class Site:
    """A landing site. Latitude/longitude in degrees (planetocentric, east-positive)."""

    id: str
    name: str
    lat_deg: float
    lon_deg: float
    source_url: str
    group: str


#: South pole ridges: PGDA product 78 lists 27 sites, and only four have a working region file
#: (Site06's link is dead; Site23 and later have none). Each location is that file's largest region,
#: a rule applied before looking at any illumination value. tests/test_config.py checks lat/lon
#: against the published X/Y in meters (south polar stereographic, R = 1737.4 km).
_ROI_SOURCE = "https://pgda.gsfc.nasa.gov/products/78"

_POLE = "South pole ridges"
_APOLLO = "Apollo"
_CLPS = "CLPS"
_OTHER = "Other countries"
_APOLLO_SOURCE = "https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html"

#: Coordinates are copied from each source as published; future CLPS targets have none published.
SITES: tuple[Site, ...] = (
    Site("connecting-ridge", "Connecting Ridge", -89.45267, -137.14865, _ROI_SOURCE, _POLE),
    Site("shackleton-rim", "Shackleton Rim", -89.76197, -157.06720, _ROI_SOURCE, _POLE),
    Site("peak-near-shackleton", "Peak near Shackleton", -88.80733, 123.77684, _ROI_SOURCE, _POLE),
    Site("de-gerlache-rim", "de Gerlache Rim", -88.66826, -68.37576, _ROI_SOURCE, _POLE),
    Site("apollo-11", "Apollo 11", 0.67416, 23.47314, _APOLLO_SOURCE, _APOLLO),
    Site("apollo-15", "Apollo 15", 26.13239, 3.63330, _APOLLO_SOURCE, _APOLLO),
    Site("apollo-17", "Apollo 17", 20.1911, 30.7723, _APOLLO_SOURCE, _APOLLO),
    Site(
        "blue-ghost-1",
        "Blue Ghost Mission 1",
        18.5623,
        61.8103,
        "https://lroc.im-ldi.com/images/1407",
        _CLPS,
    ),
    Site(
        "im-1-odysseus",
        "IM-1 Odysseus",
        -80.13,
        1.44,
        "https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/",
        _CLPS,
    ),
    Site(
        "im-2-athena",
        "IM-2 Athena",
        -84.7906,
        29.1957,
        "https://lroc.im-ldi.com/images/1408",
        _CLPS,
    ),
    Site(
        "chandrayaan-3",
        "Chandrayaan-3 (India)",
        -69.3741,
        32.32,
        "https://lroc.im-ldi.com/images/1314",
        _OTHER,
    ),
    Site(
        "slim",
        "SLIM (Japan)",
        -13.3160,
        25.2510,
        "https://www.nasa.gov/missions/lro/nasas-lro-spots-japans-moon-lander/",
        _OTHER,
    ),
    Site(
        "change-4",
        "Chang'e 4 (China, far side)",
        -45.457,
        177.589,
        "https://lroc.im-ldi.com/images/1087",
        _OTHER,
    ),
)
