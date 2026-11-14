"""LOLA south-polar DEM: download, windowed reading and bilinear height sampling.

Product: ``LDEM_80S_20MPP_ADJ.TIF`` (Barker et al. 2023, PGDA product 90), surface height in meters,
20 m/px, south polar stereographic in the ``MOON_ME`` frame. The projection is always read from the
file itself; lat/lon use that CRS's own geodetic CRS (a Moon sphere), never an Earth CRS.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import rasterio
from numpy.typing import ArrayLike, NDArray
from pyproj import CRS, Transformer
from rasterio.transform import Affine
from rasterio.windows import Window

from clps.config import DEM_DIR
from clps.geometry import MOON_RADIUS_M, FloatArray

HeightFn = Callable[[ArrayLike, ArrayLike], FloatArray]

DEM_FILENAME: str = "LDEM_80S_20MPP_ADJ.TIF"
DEM_URL: str = f"https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/{DEM_FILENAME}"
#: Content-Length reported by PGDA (2.70 GB); used to detect a truncated or partial file.
DEM_SIZE_BYTES: int = 2_696_082_051

_GLOBAL_DEM_BASE = (
    "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/"
    "data/lola_gdr/cylindrical/img/"
)
#: LOLA global DEM (128 pixels per degree, 237 m/px at the equator) and its label.
GLOBAL_DEM_URL: str = _GLOBAL_DEM_BASE + "ldem_128.img"
GLOBAL_DEM_SIZE_BYTES: int = 2_123_366_400
GLOBAL_LABEL_URL: str = _GLOBAL_DEM_BASE + "ldem_128.lbl"

#: GDAL block cache while reading (MB); its default of 5% of RAM wastes memory on one-shot reads.
GDAL_CACHE_MB: int = 256

#: Largest accepted difference from the lunar radius (m); catches an Earth CRS sneaking in.
_MAX_RADIUS_ERROR_M: float = 1_000.0


class DemWindow:
    """An in-memory DEM window with projection helpers.

    Attributes:
        heights_m: terrain heights (meters), shape (rows, cols); NaN where there is no data.
        transform: affine mapping (col, row) of the pixel's top-left corner to projected x/y (m).
        crs: projected CRS of the DEM.
    """

    def __init__(self, heights_m: NDArray[np.floating], transform: Affine, crs: CRS) -> None:
        radius_m = crs.ellipsoid.semi_major_metre
        if abs(radius_m - MOON_RADIUS_M) > _MAX_RADIUS_ERROR_M:
            raise ValueError(f"DEM CRS is not a Moon CRS (semi-major axis {radius_m} m)")
        self.heights_m = heights_m
        self.transform = transform
        self.crs = crs
        self._inverse = ~transform
        self._to_lonlat = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
        self._to_xy = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)

    def latlon_to_xy(self, lat_deg: ArrayLike, lon_deg: ArrayLike) -> tuple[FloatArray, FloatArray]:
        """Project lat/lon (degrees) to DEM x/y (meters)."""
        x, y = self._to_xy.transform(np.asarray(lon_deg, float), np.asarray(lat_deg, float))
        return np.asarray(x, float), np.asarray(y, float)

    def xy_to_latlon(self, x_m: ArrayLike, y_m: ArrayLike) -> tuple[FloatArray, FloatArray]:
        """Unproject DEM x/y (meters) to (lat, lon) in degrees."""
        lon, lat = self._to_lonlat.transform(np.asarray(x_m, float), np.asarray(y_m, float))
        return np.asarray(lat, float), np.asarray(lon, float)

    def height_at(self, lat_deg: ArrayLike, lon_deg: ArrayLike) -> FloatArray:
        """Bilinear terrain height (meters) at lat/lon (degrees); NaN where there is no data."""
        x, y = self.latlon_to_xy(lat_deg, lon_deg)
        col, row = _apply(self._inverse, x, y)
        # Pixel centers sit at half-integer (col, row); shift so they land on integers.
        return bilinear(self.heights_m, np.asarray(col) - 0.5, np.asarray(row) - 0.5)

    def nearest_at(self, lat_deg: float, lon_deg: float) -> float:
        """Value of the pixel containing lat/lon (degrees); NaN outside the window."""
        cells = self.neighborhood_at(lat_deg, lon_deg, half_px=0)
        return float(cells[0]) if cells.size else float("nan")

    def neighborhood_at(self, lat_deg: float, lon_deg: float, half_px: int = 1) -> FloatArray:
        """Values of the pixels within ``half_px`` of the one containing lat/lon, flattened."""
        x, y = self.latlon_to_xy(lat_deg, lon_deg)
        col, row = _apply(self._inverse, x, y)
        c, r = int(np.floor(col)), int(np.floor(row))
        rows, cols = self.heights_m.shape
        if not (0 <= r < rows and 0 <= c < cols):
            return np.empty(0)
        lo_r, lo_c = max(r - half_px, 0), max(c - half_px, 0)
        return self.heights_m[lo_r : r + half_px + 1, lo_c : c + half_px + 1].astype(float).ravel()


class GlobalDem:
    """A PDS LOLA simple-cylindrical global DEM, read lazily from disk.

    Geometry, scale and sample type come from the detached PDS label. Longitudes wrap at the map
    edge. Used where the polar DEM has no coverage.
    """

    def __init__(self, img_path: Path, lbl_path: Path) -> None:
        label = parse_pds_label(lbl_path.read_text())
        if abs(label["A_AXIS_RADIUS"] - MOON_RADIUS_M / 1000.0) > 1e-6:
            raise ValueError(f"unexpected DEM radius: {label['A_AXIS_RADIUS']} km")
        if label["SAMPLE_BITS"] != 16 or label["SAMPLE_TYPE"] != "LSB_INTEGER":
            raise ValueError("expected 16-bit little-endian samples")
        self._lines = int(label["LINES"])
        self._samples = int(label["LINE_SAMPLES"])
        self._scale = float(label["SCALING_FACTOR"])
        self._res = float(label["MAP_RESOLUTION"])
        self._center_lon = float(label["CENTER_LONGITUDE"])
        self._line_offset = float(label["LINE_PROJECTION_OFFSET"])
        self._sample_offset = float(label["SAMPLE_PROJECTION_OFFSET"])
        self.resolution_m = float(label["MAP_SCALE"])
        self._grid = np.memmap(img_path, dtype="<i2", mode="r", shape=(self._lines, self._samples))

    @property
    def shape(self) -> tuple[int, int]:
        """(lines, samples) of the map."""
        return self._lines, self._samples

    @property
    def grid(self) -> NDArray[np.int16]:
        """Raw samples, north to south from 0° east; multiply by ``scale`` for meters."""
        return self._grid

    @property
    def scale(self) -> float:
        """Meters per raw sample unit."""
        return self._scale

    def geometry(self) -> dict[str, float]:
        """Map geometry from the label, for the browser's copy of this reader."""
        return {
            "res_m": self.resolution_m,
            "lines": self._lines,
            "samples": self._samples,
            "scale": self._scale,
            "pix_per_deg": self._res,
            "center_lon": self._center_lon,
            "line_offset": self._line_offset,
            "sample_offset": self._sample_offset,
        }

    def height_at(self, lat_deg: ArrayLike, lon_deg: ArrayLike) -> FloatArray:
        """Bilinear terrain height (meters) at lat/lon (degrees); longitudes wrap around."""
        lat = np.asarray(lat_deg, float)
        lon = np.asarray(lon_deg, float) % 360.0
        line = self._line_offset - lat * self._res
        sample = self._sample_offset + (lon - self._center_lon) * self._res
        return self._interpolate(line, sample) * self._scale

    def _interpolate(self, line: FloatArray, sample: FloatArray) -> FloatArray:
        r0 = np.clip(np.floor(line).astype(np.intp), 0, self._lines - 2)
        fr = np.clip(line - r0, 0.0, 1.0)
        c_floor = np.floor(sample).astype(np.intp)
        c0 = c_floor % self._samples
        c1 = (c_floor + 1) % self._samples
        fc = sample - c_floor
        top = self._grid[r0, c0] * (1 - fc) + self._grid[r0, c1] * fc
        bottom = self._grid[r0 + 1, c0] * (1 - fc) + self._grid[r0 + 1, c1] * fc
        return np.asarray(top * (1 - fr) + bottom * fr, float)


def parse_pds_label(text: str) -> dict[str, Any]:
    """Keyword values from a PDS3 label: numbers become floats, units and quotes are dropped.

    Where a keyword repeats, the first value wins.
    """
    values: dict[str, Any] = {}
    for line in text.splitlines():
        match = re.match(r"\s*([A-Z0-9_^:]+)\s*=\s*(.+?)\s*$", line)
        if not match or match[1] in values:
            continue
        raw = re.sub(r"<.*>", "", match[2]).strip().strip('"')
        try:
            values[match[1]] = float(raw.rstrip("."))
        except ValueError:
            values[match[1]] = raw
    return values


def composite_height(primary: HeightFn, fallback: HeightFn) -> HeightFn:
    """Terrain height from ``primary``, using ``fallback`` wherever ``primary`` has no data."""

    def height_at(lat_deg: ArrayLike, lon_deg: ArrayLike) -> FloatArray:
        heights = np.array(primary(lat_deg, lon_deg), float)
        missing = np.isnan(heights)
        if missing.any():
            heights[missing] = fallback(np.asarray(lat_deg)[missing], np.asarray(lon_deg)[missing])
        return heights

    return height_at


def bilinear(grid: NDArray[np.floating], col: ArrayLike, row: ArrayLike) -> FloatArray:
    """Bilinear interpolation of ``grid`` at fractional pixel-center indices.

    Returns NaN outside the pixel-center area, or when any of the four surrounding cells is NaN.
    """
    col_f = np.asarray(col, float)
    row_f = np.asarray(row, float)
    rows, cols = grid.shape
    inside = (col_f >= 0) & (col_f <= cols - 1) & (row_f >= 0) & (row_f <= rows - 1)
    # NaN coordinates compare False above, so they end up outside.
    col_safe = np.where(inside, col_f, 0.0)
    row_safe = np.where(inside, row_f, 0.0)
    c0 = np.clip(np.floor(col_safe).astype(np.intp), 0, max(cols - 2, 0))
    r0 = np.clip(np.floor(row_safe).astype(np.intp), 0, max(rows - 2, 0))
    c1 = np.minimum(c0 + 1, cols - 1)
    r1 = np.minimum(r0 + 1, rows - 1)
    fc = col_safe - c0
    fr = row_safe - r0
    top = grid[r0, c0] * (1 - fc) + grid[r0, c1] * fc
    bottom = grid[r1, c0] * (1 - fc) + grid[r1, c1] * fc
    return np.where(inside, top * (1 - fr) + bottom * fr, np.nan).astype(float)


def read_whole(path: Path) -> DemWindow:
    """A whole small raster, such as a 5 m site tile, using the CRS in the file; nodata → NaN."""
    with rasterio.open(path) as src:
        heights = src.read(1, masked=True).astype(np.float32).filled(np.nan)
        return DemWindow(heights, src.transform, CRS.from_wkt(src.crs.to_wkt()))


def read_window(path: Path, lat_deg: float, lon_deg: float, radius_m: float) -> DemWindow:
    """Read the square DEM window of half-width ``radius_m`` (meters) around lat/lon (degrees).

    The window is clipped to the raster; callers detect a short reach via ``HorizonMask.reach_m``.
    Band scale/offset are applied and nodata becomes NaN (never 0).
    """
    with rasterio.Env(GDAL_CACHEMAX=GDAL_CACHE_MB), rasterio.open(path) as ds:
        crs = CRS.from_wkt(ds.crs.to_wkt())
        placed = DemWindow(np.empty((1, 1)), ds.transform, crs)
        x, y = placed.latlon_to_xy(lat_deg, lon_deg)
        window = _pixel_window(ds.transform, float(x), float(y), radius_m, ds.width, ds.height)
        raw = ds.read(1, window=window)
        is_nodata = None
        if ds.nodata is not None and not np.isnan(ds.nodata):
            is_nodata = raw == ds.nodata
        # Large windows are gigabytes: reuse the array when no conversion is needed.
        heights = raw.astype(np.float32, copy=False)
        scale, offset = float(ds.scales[0]), float(ds.offsets[0])
        if scale != 1.0 or offset != 0.0:
            heights = heights * scale + offset
        if is_nodata is not None:
            heights[is_nodata] = np.nan
        return DemWindow(heights, ds.window_transform(window), crs)


def download_raster(
    dem_dir: Path = DEM_DIR,
    url: str = DEM_URL,
    expected_size: int = DEM_SIZE_BYTES,
    client: httpx.Client | None = None,
) -> Path:
    """Download a raster into ``dem_dir`` unless a complete copy is present; return its path.

    Writes to a ``.part`` file and renames when the size matches, so a partial download is never
    mistaken for a finished one.
    """
    dest = dem_dir / url.rsplit("/", 1)[-1]
    if dest.is_file() and dest.stat().st_size == expected_size:
        return dest
    dem_dir.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    own_client = client is None
    http = client or httpx.Client(timeout=120.0, follow_redirects=True)
    try:
        with http.stream("GET", url) as resp:
            resp.raise_for_status()
            with part.open("wb") as fh:
                for chunk in resp.iter_bytes():
                    fh.write(chunk)
    finally:
        if own_client:
            http.close()
    if part.stat().st_size != expected_size:
        raise OSError(f"{part}: got {part.stat().st_size} bytes, expected {expected_size}")
    part.rename(dest)
    return dest


def load_global_dem(dem_dir: Path = DEM_DIR) -> GlobalDem:
    """Open the global DEM, downloading it and its label if missing."""
    img = download_raster(dem_dir, GLOBAL_DEM_URL, GLOBAL_DEM_SIZE_BYTES)
    lbl = dem_dir / GLOBAL_LABEL_URL.rsplit("/", 1)[-1]
    if not lbl.is_file():
        with httpx.Client(timeout=60.0, follow_redirects=True) as http:
            response = http.get(GLOBAL_LABEL_URL)
            response.raise_for_status()
        lbl.write_text(response.text)
    return GlobalDem(img, lbl)


def _apply(transform: Affine, x: ArrayLike, y: ArrayLike) -> tuple[FloatArray, FloatArray]:
    """Apply an affine transform to array coordinates."""
    x_a, y_a = np.asarray(x, float), np.asarray(y, float)
    return (
        transform.a * x_a + transform.b * y_a + transform.c,
        transform.d * x_a + transform.e * y_a + transform.f,
    )


def _pixel_window(
    transform: Affine, x_m: float, y_m: float, radius_m: float, width: int, height: int
) -> Window:
    """Whole-pixel window covering x/y ± radius, clipped to the raster; error if it misses."""
    inverse = ~transform
    col_a, row_a = _apply(inverse, x_m - radius_m, y_m + radius_m)
    col_b, row_b = _apply(inverse, x_m + radius_m, y_m - radius_m)
    col_lo = max(int(np.floor(min(col_a, col_b))), 0)
    row_lo = max(int(np.floor(min(row_a, row_b))), 0)
    col_hi = min(int(np.ceil(max(col_a, col_b))), width)
    row_hi = min(int(np.ceil(max(row_a, row_b))), height)
    if col_hi <= col_lo or row_hi <= row_lo:
        raise ValueError(f"window around x={x_m}, y={y_m} (±{radius_m} m) misses the DEM")
    return Window(col_lo, row_lo, col_hi - col_lo, row_hi - row_lo)
