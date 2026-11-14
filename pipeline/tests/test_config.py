"""Site coordinates must match the published polar-stereographic location they came from."""

import numpy as np
import pytest

from clps.config import (
    CHECK_YEARS,
    DEFAULT_MONTH,
    FIRST_YEAR,
    LAST_YEAR,
    MONTHS,
    OBS_HEIGHT_M,
    OTHER_HEIGHTS,
    SITES,
    YEARS,
    years_from_env,
)
from clps.geometry import MOON_RADIUS_M

# Largest region in each site's PGDA product 78 ROI file (meters, south polar stereographic).
PUBLISHED_XY_M = {
    "connecting-ridge": (-11287.5, -12167.5),
    "shackleton-rim": (-2812.5, -6647.5),
    "peak-near-shackleton": (30062.5, -20107.5),
    "de-gerlache-rim": (-37542.5, 14882.5),
}


POLE_SITES = [s for s in SITES if s.id in PUBLISHED_XY_M]


def test_every_pole_ridge_site_has_a_published_xy() -> None:
    assert {s.id for s in SITES if s.group == "South pole ridges"} == set(PUBLISHED_XY_M)


@pytest.mark.parametrize("site", POLE_SITES, ids=lambda s: s.id)
def test_site_matches_published_xy(site) -> None:  # type: ignore[no-untyped-def]
    x, y = PUBLISHED_XY_M[site.id]
    rho = 2 * MOON_RADIUS_M * np.tan(np.radians(90 + site.lat_deg) / 2)
    assert rho * np.sin(np.radians(site.lon_deg)) == pytest.approx(x, abs=1.0)
    assert rho * np.cos(np.radians(site.lon_deg)) == pytest.approx(y, abs=1.0)


def test_sites_have_unique_ids_and_are_not_at_the_pole() -> None:
    assert len({s.id for s in SITES}) == len(SITES)
    assert all(-90 < s.lat_deg < 90 and -180 <= s.lon_deg <= 180 for s in SITES)
    assert all(s.source_url.startswith("https://") for s in SITES)


def test_months_cover_the_year_and_include_the_default() -> None:
    assert len(MONTHS) == 12 * len(YEARS)
    assert MONTHS[0] == f"{YEARS[0]}-01"
    assert MONTHS[-1] == f"{YEARS[-1]}-12"
    assert DEFAULT_MONTH in MONTHS


def test_the_range_is_whole_years_and_holds_the_check_years():
    assert YEARS == tuple(range(FIRST_YEAR, LAST_YEAR + 1))
    assert set(CHECK_YEARS) <= set(YEARS)


def test_years_from_env_reads_one_year_or_a_span():
    assert years_from_env(None) == tuple(range(FIRST_YEAR, LAST_YEAR + 1))
    assert years_from_env("2031") == (2031,)
    assert years_from_env("2027-2030") == (2027, 2028, 2029, 2030)


def test_other_heights_are_sourced_and_differ_from_the_apps_own() -> None:
    heights = [h.height_m for h in OTHER_HEIGHTS]
    assert heights == sorted(set(heights))
    assert OBS_HEIGHT_M not in heights
    assert all(
        h.why and h.sources and all(u.startswith("https://") for u in h.sources)
        for h in OTHER_HEIGHTS
    )
