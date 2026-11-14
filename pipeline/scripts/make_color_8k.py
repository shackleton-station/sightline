"""Make the globe's 8K color map: NASA's natural-color Moon at 8192 x 4096, GPU-compressed.

Source: NASA SVS CGI Moon Kit (https://svs.gsfc.nasa.gov/4720), ``lroc_color_16bit_srgb_8k.tif``
(243 MB), the same kit as the 2K and 4K maps (``fetch_color_map.py``). Made for looks, not science.
Credit: NASA's Scientific Visualization Studio.

An 8K picture is 134 MB on a graphics card as plain pixels. As a KTX2 file (Basis Universal) the
card keeps it compressed, about a sixth of that, which is what makes 8K usable in a browser. The
encoder is ``basisu`` (``brew install basis_universal``); without it this script stops after
writing the 8-bit source picture and says so.

The file is too big for Git (the rule is 2 MB), so it goes with the whole-Moon terrain tiles:
``web/public/tiles/global/color/moon_color_8k.ktx2``, uploaded to the bucket with
``npm run upload-tiles``. It is under ``tiles/global/`` because that is one of the three folders
the load balancer serves from the bucket (``infra/assets.tf``); a folder of its own would need a
change there.

Usage (from pipeline/): uv run python scripts/make_color_8k.py
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import rasterio

from clps import config, dem

URL_8K = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_8k.tif"
SIZE_8K_BYTES = 243_289_792
OUT: Path = config.WEB_TILES_DIR / "global" / "color" / "moon_color_8k.ktx2"


def source_png(cache: Path) -> Path:
    """NASA's 8K map as an 8-bit PNG in the cache, upside down, ready for the encoder.

    Upside down because a compressed texture cannot be turned over when it reaches the graphics
    card, and the globe's maps have their first row at the bottom there.
    """
    png = cache / "lroc_color_8k_flipped.png"
    if png.is_file():
        return png
    tif = dem.download_raster(cache, URL_8K, SIZE_8K_BYTES)
    with rasterio.open(tif) as src:
        rgb16 = src.read([1, 2, 3])
    rgb = np.clip(np.rint(rgb16.astype(np.float64) / 257.0), 0, 255).astype(np.uint8)[:, ::-1, :]
    _, height, width = rgb.shape
    with rasterio.open(
        png, "w", driver="PNG", width=width, height=height, count=3, dtype="uint8"
    ) as out:
        out.write(rgb)
    png.with_name(png.name + ".aux.xml").unlink(missing_ok=True)
    return png


def encode(png: Path, out: Path) -> bool:
    """Encode ``png`` as KTX2 with every smaller size inside; False if ``basisu`` is missing."""
    basisu = shutil.which("basisu")
    if basisu is None:
        return False
    out.parent.mkdir(parents=True, exist_ok=True)
    # UASTC keeps the Moon's fine gray detail that the smaller ETC1S mode smears; RDO and Zstandard
    # bring the file back down. -mipmap stores the smaller sizes, which a compressed texture needs.
    command = [basisu, "-ktx2", "-uastc", "-uastc_level", "2", "-uastc_rdo_l", "1.5", "-mipmap"]
    subprocess.run([*command, str(png), "-output_file", str(out)], check=True)
    return True


def main() -> None:
    """Fetch, convert and, where the encoder is installed, encode."""
    png = source_png(config.CACHE_DIR / "maps")
    print(f"{png}: {png.stat().st_size / 1e6:.0f} MB")
    if encode(png, OUT):
        print(f"{OUT.relative_to(config.REPO_ROOT)}: {OUT.stat().st_size / 1e6:.1f} MB")
        print("Upload it with: cd web && npm run upload-tiles")
    else:
        print(
            "basisu is not installed: run `brew install basis_universal`, then this script again."
        )


if __name__ == "__main__":
    main()
