"""Compare the hourly Sun and Earth angles the web app ships with JPL Horizons, hour for hour.

Pure helpers; ``scripts/compare_horizons.py`` does the requests and writes the result. The shipped
angles are rounded to 0.01 degrees, so the gap measured here is the one a visitor can reproduce.
"""

from __future__ import annotations

import gzip
import json
import re
from pathlib import Path
from typing import Any

import numpy as np

from clps.geometry import FloatArray
from clps.horizons import HorizonsRow, query_params

#: The two bodies, with the fields of ``track.json`` that hold their azimuth and elevation.
BODIES: tuple[tuple[str, str, str], ...] = (
    ("sun", "sun_az", "sun_el"),
    ("earth", "earth_az", "earth_el"),
)


def separations_deg(
    az1: FloatArray, el1: FloatArray, az2: FloatArray, el2: FloatArray
) -> FloatArray:
    """Great-circle angle (degrees) between pairs of az/el directions (degrees), element-wise."""
    a1, e1, a2, e2 = (np.radians(np.asarray(v, dtype=float)) for v in (az1, el1, az2, el2))
    hav = np.sin((e2 - e1) / 2) ** 2 + np.cos(e1) * np.cos(e2) * np.sin((a2 - a1) / 2) ** 2
    out: FloatArray = np.degrees(2 * np.arcsin(np.sqrt(np.clip(hav, 0.0, 1.0))))
    return out


def gap_stats(seps_deg: FloatArray) -> dict[str, float | int]:
    """Largest and typical (median) gap in degrees, and how many hours were compared."""
    return {
        "hours": int(seps_deg.size),
        "max_deg": round(float(np.max(seps_deg)), 4),
        "typical_deg": round(float(np.median(seps_deg)), 4),
    }


def year_params(
    body_id: str, lat_deg: float, lon_deg: float, alt_km: float, year: int
) -> dict[str, str]:
    """Horizons query for every hour of one calendar year (UTC) at a lunar surface point."""
    return query_params(
        body_id,
        lat_deg,
        lon_deg % 360.0,
        alt_km,
        f"{year}-01-01 00:00",
        f"{year}-12-31 23:00",
        "1h",
    )


def ephemeris_source(text: str) -> str | None:
    """The ephemeris Horizons says it used (for example ``DE441``), read from its reply."""
    found = re.search(r"\{source:\s*([A-Za-z0-9_-]+)\}", text)
    return found.group(1) if found else None


def shipped_year(site_dir: Path, year: int) -> dict[str, Any]:
    """One year of a site's shipped hourly angles: ``t`` plus an az and el array for each body."""
    rows: list[dict[str, Any]] = []
    for month in range(1, 13):
        rows += json.loads((site_dir / f"{year}-{month:02d}" / "track.json").read_text())
    out: dict[str, Any] = {
        "t": np.array([row["t"].rstrip("Z") for row in rows], dtype="datetime64[s]")
    }
    for _, az_key, el_key in BODIES:
        out[az_key] = np.array([row[az_key] for row in rows], dtype=float)
        out[el_key] = np.array([row[el_key] for row in rows], dtype=float)
    return out


def shipped_at(site_dir: Path, times: Any) -> dict[str, Any]:
    """A site's shipped angles at the given hours (UTC, any order): the same shape as a year's.

    Reads only the months those hours fall in. Every hour must be one the app ships.
    """
    wanted = np.asarray(times, dtype="datetime64[s]")
    months = wanted.astype("datetime64[M]")
    picked: dict[str, list[float]] = {key: [] for _, *keys in BODIES for key in keys}
    tracks: dict[str, list[dict[str, Any]]] = {}
    for t, month in zip(wanted, months, strict=True):
        name = str(month)
        if name not in tracks:
            path = site_dir / name / "track.json"
            # A set for another height is gzipped (scripts/make_heights.py); the app's own is not.
            text = (
                path.read_text()
                if path.is_file()
                else gzip.decompress(path.with_name("track.json.gz").read_bytes())
            )
            tracks[name] = json.loads(text)
        row = tracks[name][int((t - month.astype("datetime64[s]")) / np.timedelta64(1, "h"))]
        if np.datetime64(row["t"].rstrip("Z"), "s") != t:
            raise ValueError(f"{site_dir.name} ships no hour {t}")
        for key in picked:
            picked[key].append(row[key])
    return {"t": wanted} | {key: np.array(values, dtype=float) for key, values in picked.items()}


def compare_rows(
    rows: list[HorizonsRow], times: Any, az_deg: FloatArray, el_deg: FloatArray
) -> FloatArray:
    """Gap (degrees) between Horizons and the shipped angles; every hour must be in both."""
    theirs = np.array([row.t for row in rows], dtype="datetime64[s]")
    if theirs.shape != times.shape or not np.array_equal(theirs, times):
        raise ValueError(f"hours differ: Horizons has {theirs.size}, the app ships {times.size}")
    return separations_deg(
        az_deg,
        el_deg,
        np.array([row.az_deg for row in rows]),
        np.array([row.el_deg for row in rows]),
    )
