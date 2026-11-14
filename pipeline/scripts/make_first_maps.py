"""Write small first versions of the globe's maps, so the Moon shows before the full maps arrive.

The web app's globe draws from several maps of 0.9 to 1.8 MB each. On a slow network that is seconds
of black. This script resamples the maps the pipeline already wrote (``maps.py``,
``make_slope_maps.py``, ``fetch_color_map.py``) into small copies the page loads first:

- ``moon_first.jpg`` and ``moon_color_first.jpg``: the relief and the color at 512 x 256, for the
  first picture.
- ``moon_relief.jpg``: the relief at its own size as a JPEG, a quarter of the PNG's bytes.
- ``moon_slope_e_2k.jpg``, ``moon_slope_n_2k.jpg``: the whole-Moon slopes at 2048 x 1024, enough
  for the whole Moon on screen; the 4096 x 2048 ones load when the visitor zooms in.
- ``pole_slope_x_1k.jpg``, ``pole_slope_y_1k.jpg``: the polar slopes at 1024 x 1024, likewise.

Nothing is computed here: each output is an average of its source's pixels.

Usage (from pipeline/): uv run python scripts/make_first_maps.py
"""

from __future__ import annotations

import warnings
from pathlib import Path

import rasterio
from rasterio.enums import Resampling
from rasterio.errors import NotGeoreferencedWarning

from clps import config

MAPS_DIR: Path = config.WEB_DATA_DIR / "maps"

#: (source, output, width, height, JPEG quality). Every map but the color one is shades of gray:
#: one value a pixel.
FIRST_MAPS: tuple[tuple[str, str, int, int, int], ...] = (
    ("moon.png", "moon_first.jpg", 512, 256, 80),
    ("moon_color.jpg", "moon_color_first.jpg", 512, 256, 80),
    ("moon.png", "moon_relief.jpg", 1440, 720, 88),
    ("moon_slope_e.jpg", "moon_slope_e_2k.jpg", 2048, 1024, 88),
    ("moon_slope_n.jpg", "moon_slope_n_2k.jpg", 2048, 1024, 88),
    ("pole_slope_x.jpg", "pole_slope_x_1k.jpg", 1024, 1024, 88),
    ("pole_slope_y.jpg", "pole_slope_y_1k.jpg", 1024, 1024, 88),
)


def resample(source: Path, output: Path, width: int, height: int, quality: int) -> int:
    """Write ``source`` averaged down to ``width`` x ``height`` as a JPEG; returns its bytes."""
    with warnings.catch_warnings():
        # These are pictures, not maps with a projection: rasterio warns of it on every open.
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with rasterio.open(source) as image:
            bands = [1, 2, 3] if "color" in source.name else [1]
            shape = (len(bands), height, width)
            pixels = image.read(bands, out_shape=shape, resampling=Resampling.average)
        with rasterio.open(
            output,
            "w",
            driver="JPEG",
            width=width,
            height=height,
            count=len(bands),
            dtype="uint8",
            QUALITY=quality,
        ) as out:
            out.write(pixels)
    # GDAL leaves a sidecar file beside a JPEG it writes; the web app has no use for it.
    output.with_name(output.name + ".aux.xml").unlink(missing_ok=True)
    return output.stat().st_size


def main() -> None:
    """Write every first map and say how big each is."""
    for source, output, width, height, quality in FIRST_MAPS:
        size = resample(MAPS_DIR / source, MAPS_DIR / output, width, height, quality)
        print(f"{output}: {width} x {height}, {size / 1024:.0f} kB (from {source})")


if __name__ == "__main__":
    main()
