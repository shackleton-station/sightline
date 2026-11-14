"""Copy NASA's natural-color Moon map into the web app, for the globes, in 2K and 4K.

Usage (from pipeline/): uv run python scripts/fetch_color_map.py
Source: NASA SVS CGI Moon Kit (https://svs.gsfc.nasa.gov/4720), `lroc_color_2k.jpg` (2025 version),
equirectangular, centered on 0° longitude. Made for looks, not science: the app shows it as imagery
only, and never reads a number from it. Credit: NASA's Scientific Visualization Studio.
"""

from __future__ import annotations

import shutil

import numpy as np
import rasterio
from rasterio.shutil import copy as copy_raster

from clps import config, dem

URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg"
SIZE_BYTES = 457_942
OUT = config.WEB_DATA_DIR / "maps" / "moon_color.jpg"
#: 4096 x 2048, 16-bit sRGB TIFF from the same kit; made an 8-bit JPEG for high-density screens.
URL_4K = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_4k.tif"
SIZE_4K_BYTES = 61_891_324
OUT_4K = config.WEB_DATA_DIR / "maps" / "moon_color_4k.jpg"
JPEG_QUALITY = 85


def to_8bit(rgb16: np.ndarray) -> np.ndarray:
    """16-bit sRGB values (0–65535) to 8-bit (0–255), rounding to nearest."""
    return np.clip(np.rint(rgb16.astype(np.float64) / 257.0), 0, 255).astype(np.uint8)


def fetch_color_map() -> None:
    """Download both maps into cache/maps once, then write them next to the app's map images."""
    cache = config.CACHE_DIR / "maps"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(dem.download_raster(cache, URL, SIZE_BYTES), OUT)
    tif = dem.download_raster(cache, URL_4K, SIZE_4K_BYTES)
    with rasterio.open(tif) as src:
        rgb = to_8bit(src.read([1, 2, 3]))
    _, height, width = rgb.shape
    profile = {"driver": "GTiff", "width": width, "height": height, "count": 3, "dtype": "uint8"}
    with rasterio.MemoryFile() as memory:
        with memory.open(**profile) as tmp:
            tmp.write(rgb)
            copy_raster(tmp, OUT_4K, driver="JPEG", QUALITY=JPEG_QUALITY)
    for out in (OUT, OUT_4K):
        print(f"{out.relative_to(config.REPO_ROOT)}: {out.stat().st_size} bytes")


if __name__ == "__main__":
    fetch_color_map()
