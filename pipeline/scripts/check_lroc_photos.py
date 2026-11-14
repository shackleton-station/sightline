"""Compare the model with dated LROC photos: was this ground sunlit at the hour it was photographed?

This is the most direct check we have on well-lit ridges: real light at known times, with no terrain
model behind it. The photos are 148 MB each, so it reads only a few pixels from each with ranged
requests, slowly, stopping when the archive asks. Results are kept in ``cache/lroc/`` so a run can
stop and resume. It isn't part of ``run_all.py``, because it depends on a remote archive.

Usage (from pipeline/): uv run python scripts/check_lroc_photos.py
"""

from __future__ import annotations

import json
import multiprocessing
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from typing import Any

import httpx
import numpy as np
from numpy.typing import NDArray

from clps import config, custom, dem, export, lroc, nearby
from clps.ephemeris import to_et
from clps.geometry import MOON_RADIUS_M
from clps.horizon import horizon_mask, sample_distances_m
from clps.kernels import load_kernels

FRAMES_URL = (
    "https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/"
    "lro-l-lroc-5-rdr/LROLRC_2001/DATA/BDR/WAC_POLE/WAC_POLE_MOVIE_SOUTH/"
)
OUT_DIR = config.CACHE_DIR / "lroc"
FRAME_LIST = OUT_DIR / "photo_frames.txt"
SAMPLES = OUT_DIR / "photo_samples.jsonl"
TWI_MAP = OUT_DIR / "WAC_POLE_ILL_TWI_SOUTH_100M.IMG"
RIDGES = ("connecting-ridge", "shackleton-rim", "peak-near-shackleton", "de-gerlache-rim")
N_FRAMES = 240
N_EACH_CONTROL = 8
SEED = 20261105
#: Time between requests (s), so a sampling run doesn't weigh on a public archive.
PAUSE_S = 0.5
FIRST_BACKOFF_S = 120.0
MAX_BACKOFF_S = 1800.0
MAX_RANGE_M = 200_000.0
#: A frame's label has it taking about 6.5 minutes (18:53:40 to 19:00:08 in the first we read), and
#: its name gives only the minute it started; this is the middle of its pass (s).
MID_FRAME_S = 195
#: Half a synodic month (days): a Sun in the wrong place, as a control for agreement by chance.
WRONG_SUN_SHIFT_DAYS = 14.77
#: A patch counts as lit when this share of its points are.
PATCH_LIT_SHARE = 0.5
#: Photos below this are clearly dark, and from the second clearly lit. Set from all_ground pixels,
#: which split into two groups with few values between these, so the model plays no part. Ridge
#: pixels don't split this way, so scoring only clear photos doesn't hang on one threshold.
CLEARLY_DARK_BELOW = 0.001
CLEARLY_LIT_FROM = 0.003
#: Other thresholds tried, to show how far the result depends on where the line is drawn.
OTHER_THRESHOLDS = (0.0005, 0.001, 0.002, 0.003, 0.005)
LISTING_FIRST = np.datetime64("2010-02-15T00:00")
LISTING_LAST = np.datetime64("2011-10-15T00:00")
LISTING_DRAWS = 240
LISTING_PAUSE_S = 1.0


def frame_time(name: str) -> np.datetime64:
    """The middle of a frame's pass, from a name like ``WAC_MOVIE_S20100402T1354``."""
    match = re.search(r"S(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})", name)
    if not match:
        raise ValueError(f"not a frame name: {name}")
    y, mo, d, h, mi = match.groups()
    return np.datetime64(f"{y}-{mo}-{d}T{h}:{mi}:00") + np.timedelta64(MID_FRAME_S, "s")


def get_politely(client: httpx.Client, url: str, **kwargs: Any) -> httpx.Response:
    """A GET that waits and retries when the archive says to slow down or drops the connection."""
    wait = FIRST_BACKOFF_S
    while True:
        try:
            response = client.get(url, timeout=60, **kwargs)
        except httpx.TransportError as reason:
            print(f"  connection trouble ({reason!r}); pausing {wait:.0f} s", flush=True)
        else:
            if response.status_code not in (429, 503):
                response.raise_for_status()
                return response
            print(
                f"  archive asked to wait ({response.status_code}); pausing {wait:.0f} s",
                flush=True,
            )
        time.sleep(wait)
        wait = min(wait * 2, MAX_BACKOFF_S)


def list_frames(client: httpx.Client) -> list[str]:
    """Frame names, found by asking for the first one after each of a set of random times.

    Listing the whole folder is thousands of requests, and paging it set off the archive's limits.
    Drawing one time from each equal slice of the period takes one small request per frame.
    """
    bucket, prefix = FRAMES_URL.split("/img/")
    rng = np.random.default_rng(SEED)
    span_s = int((LISTING_LAST - LISTING_FIRST) / np.timedelta64(1, "s"))
    found: set[str] = set()
    for i in range(LISTING_DRAWS):
        offset_s = int(span_s * (i + rng.random()) / LISTING_DRAWS)
        when = LISTING_FIRST + np.timedelta64(offset_s, "s")
        stamp = str(when)[:16].replace("-", "").replace(":", "")
        body = get_politely(
            client,
            f"{bucket}/img/",
            params={
                "list-type": "2",
                "prefix": prefix,
                "max-keys": "2",
                "start-after": f"{prefix}WAC_MOVIE_S{stamp}",
            },
        ).text
        # Only inside <Key>: the reply also repeats the time we asked for, which isn't a frame.
        keys = re.findall(r"<Key>[^<]*/(WAC_MOVIE_S\d{8}T\d{4})\.[^<]*</Key>", body)
        if keys:
            found.add(keys[0])
        time.sleep(LISTING_PAUSE_S)
    return sorted(found)


def read_pixel(
    client: httpx.Client, name: str, layout: lroc.PdsImageLayout, row: int, col: int
) -> float:
    """One pixel of a frame, waiting whenever the archive says to slow down; NaN if it's blank."""
    first, last = layout.byte_range(row, col, 1)
    response = get_politely(
        client, f"{FRAMES_URL}{name}.IMG", headers={"Range": f"bytes={first}-{last}"}
    )
    time.sleep(PAUSE_S)
    return float(lroc.clean(np.frombuffer(response.content, "<f4"))[0])


def choose_pixels(
    layout: lroc.PdsImageLayout, twi: NDArray[np.floating], terrain: dem.DemWindow
) -> list[dict[str, Any]]:
    """The ridge sites' pixels, plus controls: well-lit ground, and ground of any kind."""
    pixels = []
    sites = {s.id: s for s in config.SITES}
    for site_id in RIDGES:
        site = sites[site_id]
        x, y = terrain.latlon_to_xy(site.lat_deg, site.lon_deg)
        row, col = layout.pixel(np.array([x]), np.array([y]))
        pixels.append({"group": site_id, "row": int(row[0]), "col": int(col[0])})
    rng = np.random.default_rng(SEED)
    rows, cols = np.indices(twi.shape)
    x, y = layout.center_xy(rows, cols)
    distance = np.hypot(x, y)
    usable = np.isfinite(twi) & (distance >= 1_000.0) & (distance <= 55_000.0)
    for group, keep in (("well_lit", usable & (twi >= 50.0)), ("all_ground", usable)):
        for index in rng.choice(np.flatnonzero(keep), N_EACH_CONTROL, replace=False):
            pixels.append(
                {"group": group, "row": int(rows.flat[index]), "col": int(cols.flat[index])}
            )
    return pixels


def collect(pixels: list[dict[str, Any]], layout: lroc.PdsImageLayout) -> dict[str, list[float]]:
    """Read the pixels from a fixed random sample of frames, resuming from what's already cached."""
    names = [line.strip() for line in FRAME_LIST.read_text().splitlines() if line.strip()]
    rng = np.random.default_rng(SEED)
    frames = sorted(rng.choice(names, min(N_FRAMES, len(names)), replace=False).tolist())
    done: dict[str, list[float]] = {}
    if SAMPLES.exists():
        for line in SAMPLES.read_text().splitlines():
            row = json.loads(line)
            done[row["frame"]] = row["values"]
    with httpx.Client(follow_redirects=True) as client, SAMPLES.open("a") as out:
        for i, frame in enumerate(frames):
            if frame in done:
                continue
            values = [read_pixel(client, frame, layout, p["row"], p["col"]) for p in pixels]
            done[frame] = values
            out.write(json.dumps({"frame": frame, "values": values}) + "\n")
            out.flush()
            if i % 20 == 0:
                print(f"  frame {i + 1} of {len(frames)}", flush=True)
    return {frame: done[frame] for frame in frames}


_terrain: dem.DemWindow | None = None
_positions: dict[str, NDArray[np.float32]] = {}


def _patch(job: tuple[float, float, float]) -> dict[str, NDArray[np.bool_]]:
    """Whether a point is sunlit at each frame time, at the true and a wrong Sun position."""
    assert _terrain is not None
    lat, lon, height_m = job
    h_m = float(_terrain.height_at(np.array([lat]), np.array([lon]))[0])
    mask = horizon_mask(
        lat,
        lon,
        _terrain.height_at,
        obs_height_m=height_m,
        distances_m=sample_distances_m(MAX_RANGE_M),
    )
    radius_km = (MOON_RADIUS_M + h_m + height_m) / 1000.0
    return {
        key: nearby.fractions_from_center(pos, lat, lon, radius_km, mask)[0] > 0
        for key, pos in _positions.items()
    }


def model_lit(
    layout: lroc.PdsImageLayout, pixel: dict[str, Any], height_m: float
) -> dict[str, NDArray[np.bool_]]:
    """Whether the model has a photo pixel's patch of ground lit, for each frame."""
    assert _terrain is not None
    px, py = layout.center_xy(pixel["row"], pixel["col"])
    offsets = np.array([(a, b) for a in lroc.PATCH_OFFSETS_M for b in lroc.PATCH_OFFSETS_M])
    lats, lons = _terrain.xy_to_latlon(float(px) + offsets[:, 0], float(py) + offsets[:, 1])
    jobs = [(float(a), float(b), height_m) for a, b in zip(lats, lons, strict=True)]
    with ProcessPoolExecutor(12, mp_context=multiprocessing.get_context("fork")) as pool:
        results = list(pool.map(_patch, jobs, chunksize=4))
    return {
        key: np.mean([r[key] for r in results], axis=0) >= PATCH_LIT_SHARE for key in _positions
    }


def choose_threshold(
    values: NDArray[np.floating], pixels: list[dict[str, Any]], twi: NDArray[np.floating]
) -> tuple[float, float]:
    """The brightness that calls a pixel lit, set from the photos alone.

    It's the value at which each pixel's lit share across these frames best matches LROC's own
    long-term lit share, so the model plays no part in choosing it.
    """
    expected = np.array([twi[p["row"], p["col"]] for p in pixels])
    good = np.isfinite(values)
    finite = values[good]
    candidates = np.quantile(finite[finite > 0], np.linspace(0.02, 0.9, 60))
    best = (float(candidates[0]), np.inf)
    for threshold in candidates:
        seen = np.nanmean(np.where(good, values >= threshold, np.nan), axis=0) * 100.0
        error = float(np.nanmean(np.abs(seen - expected)))
        if error < best[1]:
            best = (float(threshold), error)
    return best


def score(
    values: NDArray[np.floating],
    model: dict[str, NDArray[np.bool_]],
    dark_below: float,
    bright_from: float,
) -> dict[str, Any]:
    """How well the model and a wrong Sun match a group's photos; arrays are (frames, pixels)."""
    counted, lit = lroc.scored_frames(values, dark_below, bright_from)
    right = lroc.balanced_accuracy(model["true"][counted], lit[counted])
    wrong = lroc.balanced_accuracy(model["wrong"][counted], lit[counted])
    interval = lroc.frame_interval(model["true"], lit, counted)
    return {
        "n_frames": int(np.sum(counted)),
        "photo_lit_pct": round(100.0 * float(np.mean(lit[counted])), 1),
        "model_lit_pct": round(100.0 * float(np.mean(model["true"][counted])), 1),
        "balanced_agreement_pct": None if right is None else round(right, 1),
        "wrong_sun_agreement_pct": None if wrong is None else round(wrong, 1),
        "interval_pct": None if interval is None else [round(v, 1) for v in interval],
    }


def main() -> None:
    """Sample the photos, then compare them with the model at ground level and 2 m up."""
    global _terrain, _positions
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not FRAME_LIST.exists():
        with httpx.Client(follow_redirects=True) as client:
            FRAME_LIST.write_text("\n".join(list_frames(client)) + "\n")
    if not TWI_MAP.exists():
        sys.exit(f"Missing {TWI_MAP}: run scripts/run_all.py --accuracy-only first.")
    load_kernels()
    layout, twi = lroc.read_image(TWI_MAP)
    first_frame = FRAME_LIST.read_text().split()[0]
    header = httpx.get(
        f"{FRAMES_URL}{first_frame}.IMG",
        headers={"Range": "bytes=0-16383"},
        follow_redirects=True,
        timeout=60,
    )
    header.raise_for_status()
    frame_layout = lroc.parse_pds_layout(header.content.decode("latin1"))
    _terrain = dem.read_window(dem.download_raster(), -90.0, 0.0, custom.POLAR_HALF_M)
    pixels = choose_pixels(layout, twi, _terrain)
    # Frames are on a larger grid than the map, so read the same ground from their own rows.
    frame_pixels = []
    for p in pixels:
        x, y = layout.center_xy(p["row"], p["col"])
        row, col = frame_layout.pixel(np.array([x]), np.array([y]))
        frame_pixels.append(p | {"row": int(row[0]), "col": int(col[0])})
    samples = collect(frame_pixels, frame_layout)
    frames = list(samples)
    values = np.array([samples[f] for f in frames], float)
    threshold, fit_error = choose_threshold(values, pixels, twi)
    print(f"lit threshold {threshold:.5f}; fits LROC's own shares within {fit_error:.1f} points")

    times = np.array([frame_time(f) for f in frames])
    _positions = {
        "true": custom.moon_centered_positions_km(to_et(times)),
        "wrong": custom.moon_centered_positions_km(
            to_et(times + np.timedelta64(int(WRONG_SUN_SHIFT_DAYS * 86400), "s"))
        ),
    }
    out: dict[str, Any] = {
        "frames_sampled": len(frames),
        "first": export.iso(times.min()),
        "last": export.iso(times.max()),
        "control_pixels": N_EACH_CONTROL,
        "threshold": round(threshold, 5),
        "clearly_dark_below": CLEARLY_DARK_BELOW,
        "clearly_lit_from": CLEARLY_LIT_FROM,
        "groups": {},
    }
    for height_name, height_m in (("ground", 0.0), ("up_2m", config.OBS_HEIGHT_M)):
        models = [model_lit(layout, p, height_m) for p in pixels]
        for group in [*RIDGES, "well_lit", "all_ground"]:
            members = [i for i, p in enumerate(pixels) if p["group"] == group]
            joined = {
                key: np.stack([models[i][key] for i in members], axis=1) for key in _positions
            }
            part = values[:, members]
            result = {
                "fitted": score(part, joined, threshold, threshold),
                "clear": score(part, joined, CLEARLY_DARK_BELOW, CLEARLY_LIT_FROM),
                "by_threshold": [
                    {"threshold": level} | score(part, joined, level, level)
                    for level in OTHER_THRESHOLDS
                ],
            }
            out["groups"].setdefault(group, {})[height_name] = result
            print(f"{group} {height_name} fitted {result['fitted']}", flush=True)
            print(f"{group} {height_name} clear {result['clear']}", flush=True)
            for row in result["by_threshold"]:
                print(f"{group} {height_name} {row}", flush=True)
    export.write_json(config.WEB_DATA_DIR / "lroc-photos.json", out)


if __name__ == "__main__":
    main()
