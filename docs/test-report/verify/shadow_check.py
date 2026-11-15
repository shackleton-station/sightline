"""Independent check of web/public/data/shadow.json: each site's distance to permanently shadowed ground.

Reads NASA PGDA's LPSR maps (product 69) and places pixels with the PDS label's own projection numbers
(polar stereographic, 1737.4 km sphere, scale and offsets below), not the GeoTIFF's georeferencing and not
the pipeline's code. Regions are grouped with my own flood fill, under both 8- and 4-neighbour rules.

Run: pipeline/.venv/bin/python -I docs/test-report/verify/shadow_check.py <dir with the TIFs> web/public/data
"""

import json
import math
import sys
from collections import deque
from pathlib import Path

import numpy as np
import rasterio  # only to read the pixel values

R_KM = 1737.4
MAPS = {  # file: (metres a pixel, projection offset in pixels, from the PDS labels)
    "LPSR_85S_060M_201608.TIF": (60.0, 2528.5),
    "LPSR_75S_120M_201608.TIF": (120.0, 3811.5),
    "LPSR_65S_240M_201608.TIF": (240.0, 3209.5),
}


def pixel_latlon(rows, cols, scale_m, offset):
    """PDS polar stereographic, south pole: x = (sample - offset - 1) * scale, y = (offset - line + 1) * scale, sample and line 1-based (PDS Standards, DSMAP). This puts the pole at the map's exact centre, as the GeoTIFF does."""
    x_km = ((cols + 1) - offset - 1) * scale_m / 1000
    y_km = (offset - (rows + 1) + 1) * scale_m / 1000
    rho = np.hypot(x_km, y_km)
    lat = -90 + np.degrees(2 * np.arctan(rho / (2 * R_KM)))
    lon = np.degrees(np.arctan2(x_km, y_km))
    return lat, lon


def great_circle_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(lon2 - lon1)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def regions(shadow, eight):
    """Label connected shadow pixels by flood fill; returns labels and each label's pixel count."""
    labels = np.zeros(shadow.shape, dtype=np.int32)
    sizes = [0]
    steps = [(-1, 0), (1, 0), (0, -1), (0, 1)] + ([(-1, -1), (-1, 1), (1, -1), (1, 1)] if eight else [])
    h, w = shadow.shape
    for r0, c0 in zip(*np.nonzero(shadow)):
        if labels[r0, c0]:
            continue
        n = len(sizes)
        labels[r0, c0] = n
        count, queue = 0, deque([(r0, c0)])
        while queue:
            r, c = queue.popleft()
            count += 1
            for dr, dc in steps:
                rr, cc = r + dr, c + dc
                if 0 <= rr < h and 0 <= cc < w and shadow[rr, cc] and not labels[rr, cc]:
                    labels[rr, cc] = n
                    queue.append((rr, cc))
        sizes.append(count)
    return labels, np.array(sizes)


def main():
    tif_dir, data = Path(sys.argv[1]), Path(sys.argv[2])
    shipped = json.loads((data / "shadow.json").read_text())
    sites = {s["id"]: s for s in json.loads((data / "sites.json").read_text())}
    print(f"{'site':22} {'kind':6} {'shipped km':>10} {'mine km':>8} {'diff m':>7} {'shipped km2':>11} {'mine km2':>9} {'4-nbr km':>8}")
    worst = 0.0
    for name, (scale_m, offset) in MAPS.items():
        users = {sid: e for sid, e in shipped["sites"].items() if any(e[k].get("map") == name for k in ("patch", "region"))}
        if not users:
            continue
        with rasterio.open(tif_dir / name) as src:
            dn = src.read(1)
        shadow = (dn * 0.000025 + 0.5) > 0.5
        rows, cols = np.nonzero(shadow)
        lat, lon = pixel_latlon(rows, cols, scale_m, offset)
        pixel_km2 = (scale_m / 1000) ** 2
        print(f"-- {name}: {shadow.shape}, {shadow.sum():,} shadowed pixels")
        lab = {}
        for eight in (True, False):
            labels, sizes = regions(shadow, eight)
            lab[eight] = (labels[rows, cols], sizes)
        for sid, entry in users.items():
            s = sites[sid]
            d = great_circle_km(s["lat"], s["lon"], lat, lon)
            for kind in ("patch", "region"):
                want = entry[kind]
                if want.get("map") != name:
                    continue
                if kind == "patch":
                    i = int(np.argmin(d))
                    d4 = d[i]
                else:
                    big8 = lab[True][1][lab[True][0]] * pixel_km2 >= shipped["region_min_km2"]
                    big4 = lab[False][1][lab[False][0]] * pixel_km2 >= shipped["region_min_km2"]
                    i = int(np.argmin(np.where(big8, d, np.inf)))
                    d4 = float(np.min(np.where(big4, d, np.inf)))
                area = lab[True][1][lab[True][0][i]] * pixel_km2
                diff_m = abs(d[i] - want["distance_km"]) * 1000
                worst = max(worst, diff_m)
                print(f"{sid:22} {kind:6} {want['distance_km']:10.2f} {d[i]:8.2f} {diff_m:7.0f} {want['region_km2']:11.4f} {area:9.4f} {d4:8.2f}")
    print(f"worst distance difference: {worst:.0f} m (shipped values are rounded to 10 m)")


main()
