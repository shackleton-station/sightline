"""Independent check of Sightline's shipped data (web/public/data). Does NOT import the team's code.

Usage: python -I verify_data.py <path to web/public/data>
Checks, for every site and every month:
  C1 sun_up agrees with sun_frac > 0
  C2 sun_up / earth_up agree with "disk center elevation - horizon(az) > -angular radius"
     recomputed from horizon.json (linear interpolation, 0.5 deg steps)
  C3 summary.json (pct_sun/earth/both, longest gaps, windows) recomputed from track.json
  C4 year-YYYY.json month rows equal summary.json
  C5 overview/YYYY.json run lengths equal the hourly tracks
  C6 physics sanity (equator ~50% sun, nearside always sees Earth, farside never, polar sun stays low,
     synodic month ~29.53 d between sunrises at the equator)
"""

import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(sys.argv[1])
SUN_R_KM, EARTH_R_KM = 695_700.0, 6_371.0
# Angular radius ranges over the year/month (Sun 0.95-1.02 AU from the Moon; Earth 356-407 Mm).
SUN_R_DEG = (math.degrees(math.asin(SUN_R_KM / 1.53e8)), math.degrees(math.asin(SUN_R_KM / 1.465e8)))
EARTH_R_DEG = (math.degrees(math.asin(EARTH_R_KM / 407_000)), math.degrees(math.asin(EARTH_R_KM / 356_000)))
ROUND = 0.011  # both elevation and horizon are rounded to 0.01 deg

problems: dict[str, list[str]] = defaultdict(list)
stats: dict[str, int] = defaultdict(int)


def t(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def horizon_at(mask: list[dict], az: float) -> float:
    az %= 360.0
    step = mask[1]["az"] - mask[0]["az"]
    i = int(az // step)
    a0, e0 = mask[i % len(mask)]["az"], mask[i % len(mask)]["el"]
    e1 = mask[(i + 1) % len(mask)]["el"]
    return e0 + (e1 - e0) * ((az - a0) / step)


def runs(flags: list[bool]) -> list[tuple[bool, int, int]]:
    out, start = [], 0
    for i in range(1, len(flags) + 1):
        if i == len(flags) or flags[i] != flags[start]:
            out.append((flags[start], start, i))
            start = i
    return out


def longest_false(flags: list[bool]) -> int:
    return max((e - s for v, s, e in runs(flags) if not v), default=0)


sites = json.loads((ROOT / "sites.json").read_text())
site_ids = [s["id"] for s in sites]
yearly: dict[str, dict[str, list[bool]]] = defaultdict(dict)  # site -> month -> flags

for site in sites:
    sid = site["id"]
    sdir = ROOT / sid
    mask = json.loads((sdir / "horizon.json").read_text())
    months = sorted(p.name for p in sdir.iterdir() if p.is_dir() and p.name[:2] == "20")
    sun_all, earth_all, sun_el_all, times_all = [], [], [], []
    year_cache: dict[str, dict] = {}
    for m in months:
        track = json.loads((sdir / m / "track.json").read_text())
        summ = json.loads((sdir / m / "summary.json").read_text())
        stats["months"] += 1
        sun = [p["sun_up"] for p in track]
        earth = [p["earth_up"] for p in track]
        yearly[sid][m] = (sun, earth)
        # C1
        for p in track:
            stats["hours"] += 1
            if p["sun_up"] != (p["sun_frac"] > 0):
                problems["C1 sun_up vs sun_frac"].append(f"{sid} {p['t']} up={p['sun_up']} frac={p['sun_frac']}")
        # C2
        for p in track:
            for body, rr, up in (("sun", SUN_R_DEG, p["sun_up"]), ("earth", EARTH_R_DEG, p["earth_up"])):
                clear = p[f"{body}_el"] - horizon_at(mask, p[f"{body}_az"])
                if clear > -rr[0] + ROUND:
                    expect = True
                elif clear < -rr[1] - ROUND:
                    expect = False
                else:
                    stats[f"C2 {body} boundary (ambiguous, not judged)"] += 1
                    continue
                stats[f"C2 {body} judged"] += 1
                if expect != up:
                    problems[f"C2 {body}_up vs horizon"].append(
                        f"{sid} {p['t']} el={p[f'{body}_el']} az={p[f'{body}_az']} clear={clear:.3f} shipped={up}"
                    )
        # C3
        n = len(track)
        start, end = t(summ["range"]["start"]), t(summ["range"]["end"])
        if n != int((end - start).total_seconds() // 3600):
            problems["C3 hour count"].append(f"{sid} {m}: {n} rows vs range {start}..{end}")
        mine = {
            "pct_sun": round(100 * sum(sun) / n, 1),
            "pct_earth": round(100 * sum(earth) / n, 1),
            "pct_both": round(100 * sum(a and b for a, b in zip(sun, earth)) / n, 1),
            "max_sun_gap_h": float(longest_false(sun)),
            "max_earth_gap_h": float(longest_false(earth)),
        }
        for k, v in mine.items():
            if abs(summ[k] - v) > 0.051:
                problems[f"C3 summary {k}"].append(f"{sid} {m}: shipped {summ[k]} recomputed {v}")
        win = [
            (track[s]["t"], (t(track[e - 1]["t"]) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            for v, s, e in runs(sun)
            if v
        ]
        shipped_win = [(w["start"], w["end"]) for w in summ["sun_windows"]]
        if win != shipped_win:
            problems["C3 sun_windows"].append(f"{sid} {m}: {len(shipped_win)} shipped vs {len(win)} recomputed")
        # C4
        y = m[:4]
        if y not in year_cache:
            f = sdir / f"year-{y}.json"
            year_cache[y] = {r["month"]: r for r in json.loads(f.read_text())["months"]} if f.exists() else {}
        row = year_cache[y].get(m)
        if row is None:
            problems["C4 year file missing month"].append(f"{sid} {m}")
        else:
            for k in mine:
                if abs(row[k] - summ[k]) > 1e-9:
                    problems[f"C4 year vs summary {k}"].append(f"{sid} {m}: {row[k]} vs {summ[k]}")
        sun_all += sun
        earth_all += earth
        sun_el_all += [p["sun_el"] for p in track]
        times_all += [p["t"] for p in track]

    # C6 physics
    frac_sun = sum(sun_all) / len(sun_all)
    frac_earth = sum(earth_all) / len(earth_all)
    stats[f"C6 {sid}: sun {100 * frac_sun:.1f}% earth {100 * frac_earth:.1f}% "
          f"sun_el {min(sun_el_all):.2f}..{max(sun_el_all):.2f} lat {site['lat']:.2f}"] = 1
    # Sun's elevation can never exceed 90-|lat|+1.6 (obliquity of lunar equator to ecliptic ~1.54 deg)
    if max(sun_el_all) > 90 - abs(site["lat"]) + 1.6:
        problems["C6 sun higher than geometry allows"].append(f"{sid} {max(sun_el_all):.2f}")
    if abs(site["lat"]) < 30:
        rises = [t(times_all[s]) for v, s, e in runs(sun_all) if v and s > 0]
        gaps = [(b - a).total_seconds() / 86400 for a, b in zip(rises, rises[1:])]
        if gaps:
            mean = sum(gaps) / len(gaps)
            stats[f"C6 {sid}: mean days between sunrises {mean:.3f} (synodic 29.531)"] = 1
            if abs(mean - 29.531) > 0.05:
                problems["C6 synodic period"].append(f"{sid} {mean:.3f} d")
        if not 0.45 < frac_sun < 0.55:
            problems["C6 low-latitude sun share"].append(f"{sid} {100 * frac_sun:.1f}%")

# C5 overview run-lengths
for f in sorted((ROOT / "overview").glob("20*.json")):
    ov = json.loads(f.read_text())
    year = f.stem
    for sid, entry in ov["sites"].items():
        if sid not in yearly:
            continue
        months = [m for m in sorted(yearly[sid]) if m.startswith(year)]
        if len(months) != 12:
            continue
        for key, idx in (("sun", 0), ("earth", 1)):
            flags = [x for m in months for x in yearly[sid][m][idx]]
            decoded, val = [], False
            for r in entry[key]:
                decoded += [val] * r
                val = not val
            # Format: (hours down, hours up) pairs; the trailing hours down are left out.
            if len(decoded) <= len(flags):
                decoded += [False] * (len(flags) - len(decoded))
            stats["C5 overview series checked"] += 1
            if decoded != flags:
                diff = sum(a != b for a, b in zip(decoded, flags)) + abs(len(decoded) - len(flags))
                problems[f"C5 overview {key}"].append(f"{sid} {year}: {diff} hours differ (len {len(decoded)} vs {len(flags)})")

print("== stats")
for k, v in sorted(stats.items()):
    print(f"  {k}: {v}" if v != 1 else f"  {k}")
print("== problems" if problems else "== no problems found")
for k, v in problems.items():
    print(f"  {k}: {len(v)}")
    for line in v[:5]:
        print(f"     {line}")
