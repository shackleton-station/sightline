"""JPL Horizons API: apparent Sun/Earth az/el seen from a lunar surface site (validation only).

API docs: https://ssd-api.jpl.nasa.gov/doc/horizons.html. Note the angle-format parameter is
``ANG_FORMAT`` (``ANGLE_FORMAT`` is rejected with HTTP 400).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import httpx
import numpy as np

HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"

#: Horizons body IDs.
SUN_ID = "10"
EARTH_ID = "399"
MOON_ID = "301"


@dataclass(frozen=True)
class HorizonsRow:
    """One Horizons observer-table row: UTC time and airless apparent az/el (degrees)."""

    t: np.datetime64
    az_deg: float
    el_deg: float


def query_params(
    body_id: str,
    lat_deg: float,
    lon_east_deg: float,
    alt_km: float,
    start_utc: str,
    stop_utc: str,
    step: str = "1h",
    center_id: str = MOON_ID,
) -> dict[str, str]:
    """Query parameters for an OBSERVER table from a geodetic site, by default on the Moon.

    Times are ``"YYYY-MM-DD HH:MM"`` UTC; ``alt_km`` is above Horizons' 1737.4 km lunar sphere, or
    its reference ellipsoid for a site on Earth (``center_id`` = ``EARTH_ID``).
    """
    return {
        "format": "text",
        "COMMAND": f"'{body_id}'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": f"'coord@{center_id}'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon_east_deg},{lat_deg},{alt_km}'",
        "START_TIME": f"'{start_utc}'",
        "STOP_TIME": f"'{stop_utc}'",
        "STEP_SIZE": f"'{step}'",
        "QUANTITIES": "'4,20'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
    }


def fetch(params: dict[str, str], client: httpx.Client | None = None) -> str:
    """Run a Horizons query and return the raw text response."""
    http = client or httpx.Client(timeout=60.0)
    try:
        resp = http.get(HORIZONS_URL, params=params)
        resp.raise_for_status()
        return resp.text
    finally:
        if client is None:
            http.close()


def cache_path(params: dict[str, str], cache_dir: Path) -> Path:
    """Cache file for a query, keyed on all its parameters so changed queries never reuse it."""
    key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]
    return cache_dir / f"{key}.txt"


def fetch_cached(
    params: dict[str, str], cache_dir: Path, client: httpx.Client | None = None
) -> str:
    """Return the cached response for this query, querying Horizons and caching it if missing."""
    path = cache_path(params, cache_dir)
    if path.is_file():
        return path.read_text()
    text = fetch(params, client)
    parse_observer_table(text)  # never cache an error response
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return text


def parse_observer_table(text: str) -> list[HorizonsRow]:
    """Parse the CSV rows between ``$$SOE`` and ``$$EOE`` (az/el in degrees, UTC times)."""
    if "$$SOE" not in text:
        raise ValueError(f"no ephemeris table in Horizons response: {text[:200]!r}")
    body = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows: list[HorizonsRow] = []
    for line in body.strip().splitlines():
        cols = [c.strip() for c in line.split(",")]
        t = np.datetime64(_iso(cols[0]), "s")
        # cols[1], cols[2] are solar-presence / interfering-body flags; then az, el.
        rows.append(HorizonsRow(t=t, az_deg=float(cols[3]), el_deg=float(cols[4])))
    return rows


_MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    )
}


def _iso(horizons_time: str) -> str:
    """'2027-Jan-01 00:00' → '2027-01-01T00:00'."""
    date, hm = horizons_time.split()
    y, mon, d = date.split("-")
    return f"{y}-{_MONTHS[mon]:02d}-{d}T{hm}"
