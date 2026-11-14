"""Validation helpers: compare our geometry with JPL Horizons, and our averages with NASA PGDA.

All functions are pure; ``scripts/run_all.py`` supplies the data and writes the report.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from numpy.typing import NDArray

from clps.ephemeris import Track
from clps.geometry import FloatArray
from clps.horizon import HorizonMask
from clps.horizons import HorizonsRow


@dataclass(frozen=True)
class SpotCheck:
    """One timestamp compared with Horizons (degrees; ``sep_deg`` is the on-sky separation)."""

    body: str
    t: str
    our_az: float
    our_el: float
    horizons_az: float
    horizons_el: float
    sep_deg: float


def separation_deg(az1: float, el1: float, az2: float, el2: float) -> float:
    """Great-circle angle (degrees) between two az/el directions (degrees)."""
    a1, e1, a2, e2 = np.radians([az1, el1, az2, el2])
    hav = np.sin((e2 - e1) / 2) ** 2 + np.cos(e1) * np.cos(e2) * np.sin((a2 - a1) / 2) ** 2
    return float(np.degrees(2 * np.arcsin(np.sqrt(hav))))


def spot_checks(
    body: str, rows: list[HorizonsRow], times: np.ndarray, track: Track
) -> list[SpotCheck]:
    """Compare a track with Horizons rows at their shared timestamps; a missing time is an error."""
    index = {t: i for i, t in enumerate(times.astype("datetime64[s]"))}
    checks = []
    for row in rows:
        i = index[row.t.astype("datetime64[s]")]
        az, el = float(track.az_deg[i]), float(track.el_deg[i])
        checks.append(
            SpotCheck(
                body=body,
                t=str(row.t),
                our_az=az,
                our_el=el,
                horizons_az=row.az_deg,
                horizons_el=row.el_deg,
                sep_deg=separation_deg(az, el, row.az_deg, row.el_deg),
            )
        )
    return checks


def long_run_stats(sun_frac: FloatArray, earth_frac: FloatArray) -> dict[str, float]:
    """Long-run averages in percent, in each definition PGDA's maps could be using."""
    return {
        "sun_mean_disk_pct": 100.0 * float(np.mean(sun_frac)),
        "sun_any_pct": 100.0 * float(np.mean(sun_frac > 0)),
        "earth_any_pct": 100.0 * float(np.mean(earth_frac > 0)),
    }


def mask_max_diff_deg(mask: HorizonMask, reference: HorizonMask) -> float:
    """Largest absolute horizon elevation difference (degrees) between two masks."""
    return float(np.max(np.abs(mask.el_deg - reference.el_deg)))


def stratified_pixels(
    eligible: NDArray[np.bool_],
    sun_pct: FloatArray,
    rng: np.random.Generator,
    n_each: int,
    high_pct: float,
) -> tuple[NDArray[np.intp], NDArray[np.intp]]:
    """Random (rows, cols): ``n_each`` eligible pixels, plus ``n_each`` with Sun ≥ ``high_pct``.

    The second group keeps well-lit ridges represented; most polar terrain is dark, so a uniform
    sample alone would hardly test the places a mission would actually choose.
    """
    any_pixel = np.flatnonzero(eligible)
    high_pixel = np.flatnonzero(eligible & (sun_pct >= high_pct))
    picked = np.concatenate(
        [
            rng.choice(any_pixel, min(n_each, any_pixel.size), replace=False),
            rng.choice(high_pixel, min(n_each, high_pixel.size), replace=False),
        ]
    )
    rows, cols = np.unravel_index(picked, eligible.shape)
    return rows, cols


def comparison_stats(ours_pct: FloatArray, map_pct: FloatArray) -> dict[str, float]:
    """Agreement between our values and a map's (percentage points; ``r`` is Pearson)."""
    diff = ours_pct - map_pct
    return {
        "bias": float(np.mean(diff)),
        "median": float(np.median(diff)),
        "mae": float(np.mean(np.abs(diff))),
        "rmse": float(np.sqrt(np.mean(diff**2))),
        "r": float(np.corrcoef(ours_pct, map_pct)[0, 1]),
    }


def checks_as_dicts(checks: list[SpotCheck]) -> list[dict[str, object]]:
    """Spot checks as JSON-ready dictionaries, with angles rounded to 0.0001°."""
    return [
        {k: round(v, 4) if isinstance(v, float) else v for k, v in asdict(c).items()}
        for c in checks
    ]
