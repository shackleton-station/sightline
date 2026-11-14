"""Cut the 1 m photo tiles for the ground around the south-pole ridge sites.

The Layers panel's photo is LROC's controlled average mosaic of the south pole, which Moon Trek
serves as ``LRO_NAC_AvgMosaic_SPole855_1mp`` down to its level 11: 4.18 m of ground a pixel. The
mosaic itself is 1 m a pixel. This script reads the mosaic's own files and cuts the ground within
``RADIUS_M`` of each ridge site into tiles on Moon Trek's own grid, two levels deeper (level 13,
1.045 m a pixel), so the page goes on from Trek's tiles to these: the same picture, sharper.

Source: LROC RDR ``NAC_POLE_SOUTH_CM_AVG``, "Controlled 1 m/pixel South Pole Average Mosaic":
18,323 NAC images of 2009 to 2013, tied to LOLA track data, 84 S to 90 S, 40 map tiles in polar
stereographic, in NASA's Planetary Data System:
https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_AVG
Its 8-bit GeoTIFFs are under EXTRAS/BROWSE/NAC_POLE/NAC_POLE_SOUTH_CM_AVG/. The four round the pole
(2.07 GB each, 8.3 GB in all) are downloaded whole into the cache, one request each. Reading only
the rows needed straight from the archive makes thousands of small requests, and the archive
answers 429 to that (tried on 2026-11-14).
Cite: Archinal, B., Weller, L., Richie, J., Lee, E., Bennett, K., Speyerer, E., & Tyburczy, T.
(2023), Controlled High-Resolution LROC NAC Polar Mosaics, LPSC 54, abstract 2333. Credit:
NASA/GSFC/Arizona State University (https://lroc.im-ldi.com/about/terms). Made for looks, not
science: no number is read from it. It is an average of many pictures, so its light is no one
moment's.

Not the uncontrolled mosaic (``NAC_POLE_SOUTH``), nor Moon Trek's ``LRO_NAC_Mosaic_1mpp_SP``:
measured on 2026-11-14 at Peak near Shackleton, the first sits about 70 m and the second about
300 m from the controlled one.

The tiles keep Moon Trek's broad tone. Trek's picture of this mosaic is not this file re-encoded:
measured at the four sites it is between the same brightness and 40% darker, differently from
place to place. Left alone, the ground would change brightness the moment these tiles took over
from Trek's. So each tile is this file's fine detail (everything finer than about 200 m) laid on
Trek's own brightness for that ground (everything broader), with the detail's contrast scaled to
Trek's: ``match_tone``. Where the two disagree on position (Trek's tiles sit up to 17 m farther
from the pole at these sites, 0.04%), the detail is where this file has it.

Output, too big for Git: ``web/public/tiles/polar/photo/13/<row>/<col>.jpg``, uploaded to the
bucket with the other tiles (the load balancer already serves ``tiles/polar/``). And one small
file the page reads to know where these tiles are: ``web/public/data/photo-fine.json``.

Usage (from pipeline/): uv run python scripts/make_photo_tiles.py [site-id ...]
"""

from __future__ import annotations

import json
import math
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from rasterio.windows import Window

from clps import config, dem
from clps.photo_tiles import (
    HALF_M,
    LEVEL,
    STEP,
    TILE_M,
    TILE_PX,
    TREK_LEVEL,
    match_tone,
    tile_range,
    touches_disc,
)

ARCHIVE = (
    "https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/"
    "lro-l-lroc-5-rdr/LROLRC_2001/EXTRAS/BROWSE/NAC_POLE/NAC_POLE_SOUTH_CM_AVG/"
)
# The mosaic's four tiles round the pole (88.5 S to 90 S), each with its size in bytes. They hold
# all the ground within reach of the ridge sites except a strip 2 km wide at the far side of de
# Gerlache Rim's disc, which is in a 3.8 GB tile of the next band: that strip is left to Moon
# Trek's tiles.
SOURCE_TILES = {
    "NAC_POLE_SOUTH_CM_AVG_P892S0450": 2_069_522_710,
    "NAC_POLE_SOUTH_CM_AVG_P892S1350": 2_069_522_710,
    "NAC_POLE_SOUTH_CM_AVG_P892S2250": 2_069_522_710,
    "NAC_POLE_SOUTH_CM_AVG_P892S3150": 2_069_522_710,
}
SITE_IDS = ("connecting-ridge", "shackleton-rim", "peak-near-shackleton", "de-gerlache-rim")
RADIUS_M = 10_000.0

JPEG_QUALITY = 85
# Moon Trek's finest tiles of the layer's own mosaic, for their tone (clps/photo_tiles.py).
TREK_TILES = (
    "https://trek.nasa.gov/tiles/Moon/SP/LRO_NAC_AvgMosaic_SPole855_1mp/1.0.0/default/default028mm/"
)

OUT_DIR: Path = config.WEB_TILES_DIR / "polar" / "photo" / str(LEVEL)
COVERAGE: Path = config.WEB_DATA_DIR / "photo-fine.json"
SOURCE_DIR: Path = config.CACHE_DIR / "photo" / "source"


def read_square(sources: list[rasterio.DatasetReader], left: float, top: float, size_m: int):
    """The mosaic's pixels (1 m each) for a square of ground, from whichever files hold them.

    ``left`` and ``top`` are the square's corner on the map, in whole metres. Ground no file
    holds stays 0.
    """
    out = np.zeros((size_m, size_m), dtype=np.uint8)
    for src in sources:
        bounds = src.bounds
        x0 = max(left, bounds.left)
        x1 = min(left + size_m, bounds.right)
        y1 = min(top, bounds.top)
        y0 = max(top - size_m, bounds.bottom)
        if x1 <= x0 or y1 <= y0:
            continue
        window = Window(
            round(x0 - bounds.left), round(bounds.top - y1), round(x1 - x0), round(y1 - y0)
        )
        part = src.read(1, window=window)
        rows = slice(round(top - y1), round(top - y1) + part.shape[0])
        cols = slice(round(x0 - left), round(x0 - left) + part.shape[1])
        # Where two files overlap by a pixel, the one that has a picture there wins.
        out[rows, cols] = np.maximum(out[rows, cols], part)
    return out


def trek_tile(row: int, col: int, client: httpx.Client) -> np.ndarray:
    """One of Moon Trek's finest tiles of the layer's mosaic, as gray; kept in the cache."""
    cached = config.CACHE_DIR / "photo" / "trek" / str(TREK_LEVEL) / f"{row}_{col}.png"
    if not cached.is_file():
        response = client.get(f"{TREK_TILES}{TREK_LEVEL}/{row}/{col}.png")
        response.raise_for_status()
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(response.content)
        time.sleep(0.05)
    with rasterio.open(cached) as tile:
        return tile.read(1)


def write_jpeg(path: Path, pixels: np.ndarray) -> None:
    """One tile as a gray JPEG."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with MemoryFile() as memory:
        with memory.open(
            driver="JPEG",
            width=TILE_PX,
            height=TILE_PX,
            count=1,
            dtype="uint8",
            quality=JPEG_QUALITY,
        ) as out:
            out.write(pixels, 1)
        path.write_bytes(memory.read())


def cut_site(site: config.Site, x_m: float, y_m: float, sources, done: set[tuple[int, int]]) -> int:
    """Cut one site's disc into tiles no earlier site wrote; the number written."""
    col0, col1, row0, row1 = tile_range(x_m, y_m, RADIUS_M)
    # Whole tiles of Moon Trek's finest level, so the two pictures line up tile for tile.
    times = 2**STEP
    col0, row0 = col0 - col0 % times, row0 - row0 % times
    col1, row1 = col1 + times - 1 - col1 % times, row1 + times - 1 - row1 % times
    wanted = [
        (col, row)
        for row in range(row0, row1 + 1)
        for col in range(col0, col1 + 1)
        if (col, row) not in done and touches_disc(col, row, x_m, y_m, RADIUS_M)
    ]
    if not wanted:
        return 0
    # The square of ground those tiles cover, with a margin for the resampling, in whole metres.
    left = math.floor(col0 * TILE_M - HALF_M) - 4
    top = math.ceil(HALF_M - row0 * TILE_M) + 4
    size_m = math.ceil((max(col1 - col0, row1 - row0) + 1) * TILE_M) + 8
    cached = config.CACHE_DIR / "photo" / f"{site.id}_{left}_{top}_{size_m}.npy"
    if cached.is_file():
        ground = np.load(cached)
    else:
        started = time.time()
        ground = read_square(sources, left, top, size_m)
        cached.parent.mkdir(parents=True, exist_ok=True)
        np.save(cached, ground)
        print(f"  read {size_m} m square from the files in {time.time() - started:.0f} s")

    cols = col1 - col0 + 1
    rows = row1 - row0 + 1
    pixel_m = TILE_M / TILE_PX
    onto = np.zeros((rows * TILE_PX, cols * TILE_PX), dtype=np.uint8)
    crs = sources[0].crs
    reproject(
        ground,
        onto,
        src_transform=from_origin(left, top, 1.0, 1.0),
        src_crs=crs,
        dst_transform=from_origin(col0 * TILE_M - HALF_M, HALF_M - row0 * TILE_M, pixel_m, pixel_m),
        dst_crs=crs,
        resampling=Resampling.cubic,
    )
    # Moon Trek's picture of the same ground, for its tone.
    trek = np.zeros((rows * TILE_PX // times, cols * TILE_PX // times), dtype=np.float32)
    with httpx.Client(timeout=60.0, headers={"user-agent": "lunar-tiles-pipeline/1.0"}) as client:
        for trek_row in range(row0 // times, row1 // times + 1):
            for trek_col in range(col0 // times, col1 // times + 1):
                y = (trek_row - row0 // times) * TILE_PX
                x = (trek_col - col0 // times) * TILE_PX
                trek[y : y + TILE_PX, x : x + TILE_PX] = trek_tile(trek_row, trek_col, client)
    onto = match_tone(onto, trek)
    written = 0
    for col, row in wanted:
        tile = onto[
            (row - row0) * TILE_PX : (row - row0 + 1) * TILE_PX,
            (col - col0) * TILE_PX : (col - col0 + 1) * TILE_PX,
        ]
        done.add((col, row))
        # Ground the mosaic has no picture of is left to Moon Trek's tiles.
        if not tile.any():
            continue
        write_jpeg(OUT_DIR / str(row) / f"{col}.jpg", tile)
        written += 1
    return written


def main() -> None:
    """Cut every ridge site's disc (or only the sites named) and write the page's coverage file."""
    only = set(sys.argv[1:])
    sites = [site for site in config.SITES if site.id in SITE_IDS and (not only or site.id in only)]
    with rasterio.Env():
        sources = [
            rasterio.open(dem.download_raster(SOURCE_DIR, f"{ARCHIVE}{name}.TIF", size))
            for name, size in SOURCE_TILES.items()
        ]
        # The map's own projection, read from the file: never written out by hand.
        to_map = Transformer.from_crs(sources[0].crs.geodetic_crs, sources[0].crs, always_xy=True)
        done: set[tuple[int, int]] = set()
        discs = []
        total = 0
        for site in sites:
            x_m, y_m = to_map.transform(site.lon_deg, site.lat_deg)
            print(f"{site.id}: centre {x_m:.0f}, {y_m:.0f} m on the map")
            written = cut_site(site, x_m, y_m, sources, done)
            total += written
            print(f"  {written} tiles")
            discs.append({"site": site.id, "x_m": round(x_m, 1), "y_m": round(y_m, 1)})
        for src in sources:
            src.close()
    size = sum(path.stat().st_size for path in OUT_DIR.rglob("*.jpg"))
    if not only:
        COVERAGE.write_text(
            json.dumps(
                {
                    "level": LEVEL,
                    "radius_m": RADIUS_M,
                    "metres_per_pixel": round(TILE_M / TILE_PX, 4),
                    "discs": discs,
                    "tiles": total,
                    "bytes": size,
                    "product": "NAC_POLE_SOUTH_CM_AVG",
                    "title": "LROC Controlled NAC South Pole Average Mosaic, 1 m/pixel",
                    "credit": "NASA/GSFC/Arizona State University",
                    "tone": "matched to Moon Trek's tiles of the same mosaic (level 11)",
                    "source": "https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_AVG",
                    "made": datetime.now(UTC).strftime("%Y-%m-%d"),
                },
                indent=1,
            )
            + "\n"
        )
    print(f"{total} tiles, {size / 1e6:.0f} MB, in {OUT_DIR.relative_to(config.REPO_ROOT)}")


if __name__ == "__main__":
    main()
