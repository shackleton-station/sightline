"""Write the terrain slope maps the web app's Moon shader lights the globe with.

Usage (from pipeline/): uv run python scripts/make_slope_maps.py
Inputs (in cache/dem, see REFERENCES.md): the LOLA global DEM `ldem_128.img` and the LOLA
south-polar DEM `LDEM_80S_20MPP_ADJ.TIF`.
Outputs (in web/public/data/maps), all 8-bit grayscale JPEG, 128 = flat (see `slopes.encode_slope`):
  moon_slope_e.jpg, moon_slope_n.jpg  4096 x 2048, equirectangular, -180° at the left edge, +90° at
                                      the top; slope toward east and toward north.
  pole_slope_x.jpg, pole_slope_y.jpg  2048 x 2048, the polar DEM's whole extent in its own polar
                                      stereographic grid, row 0 at the largest map y; slope toward
                                      increasing map x and toward increasing map y.
  slopes.json                         sizes, the encoding's range and the polar grid's orientation.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from numpy.typing import NDArray
from pyproj import CRS
from rasterio.shutil import copy as copy_raster
from rasterio.windows import Window

from clps import config, dem, export, slopes
from clps.geometry import MOON_RADIUS_M, FloatArray

OUT_DIR: Path = config.WEB_DATA_DIR / "maps"
MOON_WIDTH: int = 4096
MOON_HEIGHT: int = 2048
POLE_SIZE: int = 2048
#: Every image must stay under this size (bytes).
MAX_BYTES: int = 2_000_000
#: JPEG quality per pair of images, chosen by trying values: the highest that leaves the larger
#: file of the pair at least 5% under MAX_BYTES (moon: 1.88 MB at 90, 1.97 MB at 91; pole: 1.79 MB
#: at 99, 1.98 MB at 100).
MOON_JPEG_QUALITY: int = 90
POLE_JPEG_QUALITY: int = 99


def global_heights(world: dem.GlobalDem, rows: int, cols: int) -> FloatArray:
    """Area-averaged heights (meters) of the whole Moon: north to south, -180° to +180° east."""
    geometry = world.geometry()
    lines, samples = world.shape
    starts_at_zero_east = (
        geometry["center_lon"] == 180.0
        and geometry["sample_offset"] == samples / 2 - 0.5
        and geometry["line_offset"] == lines / 2 - 0.5
        and geometry["pix_per_deg"] * 360 == samples
        and geometry["pix_per_deg"] * 180 == lines
    )
    if not starts_at_zero_east:
        raise ValueError(f"global DEM is not a whole-Moon map starting at 0° east: {geometry}")
    if cols % 2:
        raise ValueError("an even number of columns is needed to center the map on 0° east")

    def read_rows(start: int, stop: int) -> FloatArray:
        return np.asarray(world.grid[start:stop], float) * world.scale

    from_zero_east = slopes.area_mean_by_strips(read_rows, lines, rows, cols)
    return np.roll(from_zero_east, cols // 2, axis=1)


def polar_heights(path: Path, size: int) -> tuple[FloatArray, float, CRS]:
    """Area-averaged heights (meters, NaN = no data) of the whole polar DEM on a ``size`` grid.

    Also returns half the DEM's extent (meters) and its CRS, both read from the file.
    """
    with rasterio.Env(GDAL_CACHEMAX=dem.GDAL_CACHE_MB), rasterio.open(path) as ds:
        t = ds.transform
        half_width_m = t.a * ds.width / 2
        north_up_square = t.b == 0 and t.d == 0 and t.a == -t.e and t.a > 0
        centered = ds.width == ds.height and t.c == -half_width_m and t.f == half_width_m
        if not (north_up_square and centered):
            raise ValueError(f"polar DEM is not a north-up square centered on the pole: {t}")
        scale, offset = float(ds.scales[0]), float(ds.offsets[0])
        nodata = ds.nodata

        def read_rows(start: int, stop: int) -> NDArray[np.float32]:
            raw = ds.read(1, window=Window(0, start, ds.width, stop - start))
            heights = raw.astype(np.float32, copy=False) * scale + offset
            if nodata is not None and not np.isnan(nodata):
                heights[raw == nodata] = np.nan
            return heights

        heights = slopes.area_mean_by_strips(read_rows, ds.height, size, size)
        return heights, half_width_m, CRS.from_wkt(ds.crs.to_wkt())


def axis_longitudes_deg(crs: CRS, reach_m: float) -> tuple[float, float]:
    """East longitudes (degrees) that increasing map x and increasing map y point toward.

    Found by unprojecting a point ``reach_m`` (meters) from the pole along each axis, with the DEM
    CRS's own geodetic CRS.
    """
    grid = dem.DemWindow(np.empty((1, 1)), rasterio.Affine.identity(), crs)
    _, lon = grid.xy_to_latlon([reach_m, 0.0], [0.0, reach_m])
    x_lon, y_lon = (round(float(value), 6) + 0.0 for value in lon)
    return x_lon, y_lon


def write_jpeg(path: Path, image: NDArray[np.uint8], quality: int) -> int:
    """Write an 8-bit grayscale JPEG; returns its size (bytes), which must be under MAX_BYTES."""
    rows, cols = image.shape
    profile = {"driver": "GTiff", "width": cols, "height": rows, "count": 1, "dtype": "uint8"}
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.MemoryFile() as memory:
        with memory.open(**profile) as tmp:
            tmp.write(image, 1)
            copy_raster(tmp, path, driver="JPEG", QUALITY=quality)
    size = path.stat().st_size
    if size >= MAX_BYTES:
        raise ValueError(f"{path.name} is {size} bytes at quality {quality}; lower the quality")
    return size


def write_pair(names: tuple[str, str], pair: tuple[FloatArray, FloatArray], quality: int) -> None:
    """Encode and write two slope images, printing size and share of clamped pixels for each."""
    for name, slope in zip(names, pair, strict=True):
        size = write_jpeg(OUT_DIR / name, slopes.encode_slope(slope), quality)
        clamped = slopes.clamped_fraction(slope)
        print(f"{name}: {size} bytes, quality {quality}, {clamped:.4%} of pixels clamped")


def make_slope_maps() -> None:
    """Build the four slope images and `slopes.json` from the two LOLA DEMs in cache/dem."""
    world = dem.load_global_dem()
    # East differences never span less ground than one pixel of the DEM they come from.
    moon = slopes.sphere_slopes(
        global_heights(world, MOON_HEIGHT, MOON_WIDTH), MOON_RADIUS_M, world.resolution_m
    )
    write_pair(("moon_slope_e.jpg", "moon_slope_n.jpg"), moon, MOON_JPEG_QUALITY)

    heights, half_width_m, crs = polar_heights(dem.download_raster(), POLE_SIZE)
    if crs.ellipsoid.semi_major_metre != MOON_RADIUS_M:
        raise ValueError(f"polar DEM radius is {crs.ellipsoid.semi_major_metre} m")
    pole = slopes.grid_slopes(heights, 2 * half_width_m / POLE_SIZE)
    write_pair(("pole_slope_x.jpg", "pole_slope_y.jpg"), pole, POLE_JPEG_QUALITY)

    x_lon_deg, y_lon_deg = axis_longitudes_deg(crs, half_width_m)
    export.write_json(
        OUT_DIR / "slopes.json",
        {
            "slope_max": slopes.SLOPE_MAX,
            "moon": {"width": MOON_WIDTH, "height": MOON_HEIGHT},
            "pole": {
                "size": POLE_SIZE,
                "half_width_m": half_width_m,
                "x_axis_lon_deg": x_lon_deg,
                "y_axis_lon_deg": y_lon_deg,
                "radius_m": int(MOON_RADIUS_M),
            },
        },
    )
    print((OUT_DIR / "slopes.json").read_text().strip())


if __name__ == "__main__":
    make_slope_maps()
