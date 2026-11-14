"""Check the hourly sets for other heights against the app's own 2 m set.

Usage (from pipeline/):
  uv run python scripts/check_heights.py                 every height that has been built
  uv run python scripts/check_heights.py --base /tmp/base
      also require a 2 m set rebuilt by make_heights.py to equal web/public/data file for file

Three checks, for every site and every hour of the range:

1. **Directions.** Standing a few metres higher moves the Sun and Earth in the sky by far less than
   the 0.01° the tracks are rounded to, so each height's azimuths and elevations must equal the
   2 m ones to within that rounding.
2. **Higher never sees less.** Every terrain point sits lower in the sky from higher up, so the
   horizon can only drop: at the same site and hour the Sun's visible share, and whether the Sun
   and Earth are up at all, can only stay the same or improve from one height to the next. Every
   hour that breaks this is counted and the first few are printed.
3. **Yearly numbers.** ``run_all.py`` already writes each site's yearly numbers at 2, 5 and 10 m
   (``heights.json``). Where a set's height is one of those, its own yearly files must agree.

Writes ``web/public/tiles/light/heights/validation.json`` and prints the table in
docs/VALIDATION.md §15.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

from clps import config, export, horizons_compare

#: Two angles each rounded to 0.01° can differ by 0.01° with nothing else changed; the true shift
#: from a few metres of height is under a millionth of a degree. A hair is added for float noise.
ROUNDING_DEG = 0.01 + 1e-9
#: ``sun_frac`` is rounded to 0.001: a drop this small is rounding, not the terrain.
FRAC_ROUNDING = 0.001 + 1e-9
FIELDS = ("sun_az", "sun_el", "sun_frac", "sun_up", "earth_az", "earth_el", "earth_up")


def read_json(path: Path) -> Any:
    """A JSON file, or the gzipped one beside it."""
    if path.is_file():
        return json.loads(path.read_text())
    return json.loads(gzip.decompress(path.with_name(path.name + ".gz").read_bytes()))


def site_hours(root: Path, site_id: str) -> dict[str, np.ndarray]:
    """Every hour of a site's tracks under ``root``, as one array per field, in time order."""
    rows: list[dict[str, Any]] = []
    for month in config.MONTHS:
        rows += read_json(root / site_id / month / "track.json")
    out = {field: np.array([row[field] for row in rows]) for field in FIELDS}
    out["t"] = np.array([row["t"] for row in rows])
    return out


def directions(base: dict[str, np.ndarray], other: dict[str, np.ndarray]) -> dict[str, float]:
    """Largest gap in degrees between two sets' directions to the Sun and to Earth."""
    return {
        body: round(
            float(
                horizons_compare.separations_deg(
                    base[f"{body}_az"], base[f"{body}_el"], other[f"{body}_az"], other[f"{body}_el"]
                ).max()
            ),
            4,
        )
        for body in ("sun", "earth")
    } | {
        f"{body}_el": round(float(np.abs(base[f"{body}_el"] - other[f"{body}_el"]).max()), 4)
        for body in ("sun", "earth")
    }


def losses(low: dict[str, np.ndarray], high: dict[str, np.ndarray]) -> dict[str, Any]:
    """Hours where the higher point sees less than the lower one, and what it gains."""
    sun_lost = low["sun_up"] & ~high["sun_up"]
    earth_lost = low["earth_up"] & ~high["earth_up"]
    frac_lost = high["sun_frac"] < low["sun_frac"] - FRAC_ROUNDING
    first = [
        {
            "t": str(low["t"][i]),
            "sun_frac": [float(low["sun_frac"][i]), float(high["sun_frac"][i])],
            "earth_up": [bool(low["earth_up"][i]), bool(high["earth_up"][i])],
        }
        for i in np.flatnonzero(sun_lost | earth_lost | frac_lost)[:3]
    ]
    return {
        "sun_up_lost_h": int(sun_lost.sum()),
        "earth_up_lost_h": int(earth_lost.sum()),
        "sun_share_dropped_h": int(frac_lost.sum()),
        "first": first,
        "sun_up_gained_h": int((high["sun_up"] & ~low["sun_up"]).sum()),
        "earth_up_gained_h": int((high["earth_up"] & ~low["earth_up"]).sum()),
        "pct_sun": [round(100.0 * float(s["sun_up"].mean()), 2) for s in (low, high)],
        "pct_earth": [round(100.0 * float(s["earth_up"].mean()), 2) for s in (low, high)],
    }


def yearly_agree(root: Path, site_id: str, height_m: float) -> bool | None:
    """Whether a set's yearly files equal ``heights.json``'s rows; None if it has no such height."""
    known = read_json(config.WEB_DATA_DIR / site_id / "heights.json")
    rows = next((entry["years"] for entry in known if entry["obs_height_m"] == height_m), None)
    if rows is None:
        return None
    ours = [read_json(root / site_id / f"year-{row['year']}.json")["years"][0] for row in rows]
    return ours == rows


def same_files(base: Path) -> tuple[int, list[str]]:
    """Compare a rebuilt 2 m set with the app's files: how many compared, and which differ."""
    differ: list[str] = []
    compared = 0
    for packed in sorted(base.rglob("*.json.gz")):
        rel = packed.relative_to(base).with_suffix("")
        compared += 1
        if gzip.decompress(packed.read_bytes()) != (config.WEB_DATA_DIR / rel).read_bytes():
            differ.append(str(rel))
    return compared, differ


def main() -> None:
    """Run the checks, print them and write ``validation.json``."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="", help="a 2 m set rebuilt by make_heights.py")
    args = parser.parse_args()
    root = config.WEB_HEIGHTS_DIR
    heights_m = sorted(
        float(folder.name[:-1])
        for folder in root.iterdir()
        if folder.is_dir() and folder.name.endswith("m")
    )
    report: dict[str, Any] = {"base_height_m": config.OBS_HEIGHT_M, "heights_m": heights_m}
    failed = False
    if args.base:
        compared, differ = same_files(Path(args.base))
        report["base_rebuilt"] = {"files": compared, "differ": differ}
        print(
            f"2 m set rebuilt by make_heights.py: {compared} files, {len(differ)} differ"
            f" {differ[:5]}"
        )
        failed |= bool(differ) or compared == 0

    sites: dict[str, Any] = {}
    for site in config.SITES:
        sets = [site_hours(config.WEB_DATA_DIR, site.id)]
        sets += [site_hours(root / f"{h:g}m", site.id) for h in heights_m]
        names = [f"{config.OBS_HEIGHT_M:g}m"] + [f"{h:g}m" for h in heights_m]
        entry: dict[str, Any] = {"hours": int(sets[0]["t"].size)}
        for i in range(1, len(sets)):
            if not np.array_equal(sets[i]["t"], sets[0]["t"]):
                raise ValueError(f"{site.id} {names[i]}: the hours are not the 2 m set's")
            gap = directions(sets[0], sets[i])
            step = losses(sets[i - 1], sets[i])
            agree = yearly_agree(root / names[i], site.id, heights_m[i - 1])
            entry[names[i]] = {
                "directions_vs_2m_deg": gap,
                f"against_{names[i - 1]}": step,
                "yearly_agree": agree,
            }
            failed |= max(gap.values()) > ROUNDING_DEG or agree is False
            failed |= (
                step["sun_up_lost_h"] + step["earth_up_lost_h"] + step["sun_share_dropped_h"] > 0
            )
            print(
                f"{site.id} {names[i]}: directions within {max(gap.values())} deg of 2 m; against "
                f"{names[i - 1]}: Sun {step['pct_sun'][0]}% -> {step['pct_sun'][1]}% "
                f"(+{step['sun_up_gained_h']} h, -{step['sun_up_lost_h']} h), Earth "
                f"{step['pct_earth'][0]}% -> {step['pct_earth'][1]}% "
                f"(+{step['earth_up_gained_h']} h, -{step['earth_up_lost_h']} h), "
                f"Sun's share dropped in {step['sun_share_dropped_h']} h; "
                f"yearly numbers agree with heights.json: {agree}"
            )
            for case in step["first"]:
                print(f"    sees less: {case}")
        sites[site.id] = entry
    report["sites"] = sites
    export.write_json(root / "validation.json", report)
    print("FAILED: see above" if failed else "All checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
