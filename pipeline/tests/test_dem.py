"""DEM reading and sampling, tested offline on small synthetic rasters in a Moon CRS."""

from pathlib import Path

import httpx
import numpy as np
import pytest
import rasterio
from pyproj import CRS
from rasterio.transform import from_origin

from clps import dem

# CRS text as found in LDEM_80S_20MPP_ADJ.TIF (a Moon sphere, south polar stereographic).
MOON_SOUTH_POLAR_WKT = (
    'PROJCS["Moon (2015) - Sphere / Ocentric / South Polar",'
    'GEOGCS["Moon (2015) - Sphere / Ocentric",DATUM["Moon (2015) - Sphere",'
    'SPHEROID["Moon (2015) - Sphere",1737400,0]],PRIMEM["Reference Meridian",0],'
    'UNIT["degree",0.0174532925199433]],PROJECTION["Polar_Stereographic"],'
    'PARAMETER["latitude_of_origin",-90],PARAMETER["central_meridian",0],'
    'PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],'
    'AXIS["Easting",NORTH],AXIS["Northing",NORTH]]'
)
RES_M = 20.0
SIZE = 41  # odd, so the center pixel's center is exactly at the projection origin


def _write_raster(
    path: Path,
    data: np.ndarray,
    nodata: float | None = float("nan"),
    scale: float = 1.0,
    offset: float = 0.0,
) -> Path:
    half = data.shape[0] * RES_M / 2
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[1],
        height=data.shape[0],
        count=1,
        dtype="float32",
        crs=MOON_SOUTH_POLAR_WKT,
        transform=from_origin(-half, half, RES_M, RES_M),
        nodata=nodata,
    ) as ds:
        ds.write(data.astype("float32"), 1)
        ds.scales = (scale,)
        ds.offsets = (offset,)
    return path


def _plane(size: int = SIZE) -> tuple[np.ndarray, float, float]:
    """Plane z = 2x + 3y + 100, sampled at pixel centers; bilinear must reproduce it exactly."""
    half = size * RES_M / 2
    xs = -half + RES_M * (np.arange(size) + 0.5)
    ys = half - RES_M * (np.arange(size) + 0.5)
    xx, yy = np.meshgrid(xs, ys)
    return 2 * xx + 3 * yy + 100, 2.0, 3.0


def _site_at(window: dem.DemWindow, x: float, y: float) -> tuple[float, float]:
    lat, lon = window.xy_to_latlon(x, y)
    return float(lat), float(lon)


def test_rejects_earth_crs() -> None:
    with pytest.raises(ValueError, match="not a Moon CRS"):
        dem.DemWindow(np.zeros((2, 2)), from_origin(0, 0, 1, 1), CRS.from_epsg(3031))


def test_geodetic_crs_is_the_moon_sphere(tmp_path: Path) -> None:
    path = _write_raster(tmp_path / "a.tif", _plane()[0])
    window = dem.read_window(path, -89.99, 0.0, 200.0)
    assert window.crs.geodetic_crs.ellipsoid.semi_major_metre == pytest.approx(1_737_400.0)


def test_projection_matches_polar_stereographic_formula(tmp_path: Path) -> None:
    path = _write_raster(tmp_path / "a.tif", _plane()[0])
    window = dem.read_window(path, -89.99, 0.0, 200.0)
    lat, lon = -89.4527, -137.15
    x, y = window.latlon_to_xy(lat, lon)
    rho = 2 * 1_737_400.0 * np.tan(np.radians(90 + lat) / 2)
    assert x == pytest.approx(rho * np.sin(np.radians(lon)), abs=1e-3)
    assert y == pytest.approx(rho * np.cos(np.radians(lon)), abs=1e-3)
    assert window.xy_to_latlon(x, y)[0] == pytest.approx(lat)
    assert window.xy_to_latlon(x, y)[1] == pytest.approx(lon)


def test_height_at_reproduces_a_plane_between_pixels(tmp_path: Path) -> None:
    data, a, b = _plane()
    window = dem.read_window(_write_raster(tmp_path / "a.tif", data), -89.99, 0.0, 400.0)
    x, y = 13.0, -27.0  # deliberately off the pixel centers
    lat, lon = _site_at(window, x, y)
    assert window.height_at(lat, lon) == pytest.approx(a * x + b * y + 100, abs=1e-2)


def test_height_at_is_vectorized_and_keeps_shape(tmp_path: Path) -> None:
    data, a, b = _plane()
    window = dem.read_window(_write_raster(tmp_path / "a.tif", data), -89.99, 0.0, 400.0)
    xs, ys = np.array([[10.0, -30.0], [55.0, 0.0]]), np.array([[-5.0, 42.0], [0.0, 70.0]])
    lat, lon = window.xy_to_latlon(xs, ys)
    assert window.height_at(lat, lon) == pytest.approx(a * xs + b * ys + 100, abs=1e-2)


def test_top_of_raster_is_north_in_y_not_flipped(tmp_path: Path) -> None:
    data = np.zeros((SIZE, SIZE))
    data[: SIZE // 2] = 500.0  # the rows with positive y
    # Radius covers the whole raster: lat -89.99 sits ~303 m from the pole, off-center.
    window = dem.read_window(_write_raster(tmp_path / "a.tif", data), -89.99, 0.0, 10_000.0)
    assert window.height_at(*_site_at(window, 0.0, 200.0)) == pytest.approx(500.0)
    assert window.height_at(*_site_at(window, 0.0, -200.0)) == pytest.approx(0.0)


def test_nan_nodata_stays_nan_and_never_becomes_zero(tmp_path: Path) -> None:
    data = _plane()[0]
    data[SIZE // 2, SIZE // 2] = np.nan  # the pixel at the origin
    window = dem.read_window(_write_raster(tmp_path / "a.tif", data), -89.99, 0.0, 400.0)
    assert np.isnan(window.height_at(*_site_at(window, 3.0, 3.0)))


def test_numeric_nodata_becomes_nan(tmp_path: Path) -> None:
    data = _plane()[0]
    data[SIZE // 2, SIZE // 2] = -9999.0
    path = _write_raster(tmp_path / "a.tif", data, nodata=-9999.0)
    window = dem.read_window(path, -89.99, 0.0, 400.0)
    assert np.isnan(window.height_at(*_site_at(window, 3.0, 3.0)))


def test_scale_and_offset_are_applied(tmp_path: Path) -> None:
    data = np.full((SIZE, SIZE), 10.0)
    path = _write_raster(tmp_path / "a.tif", data, scale=2.0, offset=5.0)
    window = dem.read_window(path, -89.99, 0.0, 400.0)
    assert window.height_at(*_site_at(window, 7.0, 7.0)) == pytest.approx(25.0)


def test_outside_the_raster_is_nan(tmp_path: Path) -> None:
    window = dem.read_window(_write_raster(tmp_path / "a.tif", _plane()[0]), -89.99, 0.0, 400.0)
    far = _site_at(window, 5_000.0, 5_000.0)
    assert np.isnan(window.height_at(*far))


def test_window_is_a_subset_with_a_correct_transform(tmp_path: Path) -> None:
    data, a, b = _plane()
    path = _write_raster(tmp_path / "a.tif", data)
    full = dem.read_window(path, -89.99, 0.0, 10_000.0)
    x, y = 60.0, -40.0
    lat, lon = _site_at(full, x, y)
    small = dem.read_window(path, lat, lon, 100.0)
    assert small.heights_m.shape[0] < SIZE and small.heights_m.shape[1] < SIZE
    assert small.height_at(lat, lon) == pytest.approx(a * x + b * y + 100, abs=1e-2)


def test_window_missing_the_raster_raises(tmp_path: Path) -> None:
    path = _write_raster(tmp_path / "a.tif", _plane()[0])
    with pytest.raises(ValueError, match="misses the DEM"):
        dem.read_window(path, -85.0, 0.0, 100.0)


def test_nearest_and_neighborhood(tmp_path: Path) -> None:
    data = np.arange(SIZE * SIZE, dtype=float).reshape(SIZE, SIZE)
    window = dem.read_window(_write_raster(tmp_path / "a.tif", data), -89.99, 0.0, 10_000.0)
    center = SIZE // 2
    lat, lon = _site_at(window, 3.0, -3.0)
    assert window.nearest_at(lat, lon) == data[center, center]
    assert sorted(window.neighborhood_at(lat, lon)) == sorted(
        data[center - 1 : center + 2, center - 1 : center + 2].ravel()
    )
    assert np.isnan(window.nearest_at(*_site_at(window, 5_000.0, 5_000.0)))


def test_bilinear_edges() -> None:
    grid = np.array([[0.0, 10.0], [20.0, 30.0]])
    assert dem.bilinear(grid, 1.0, 1.0) == pytest.approx(30.0)  # last pixel center is inside
    assert dem.bilinear(grid, 0.5, 0.5) == pytest.approx(15.0)
    assert np.isnan(dem.bilinear(grid, 1.01, 0.0))
    assert np.isnan(dem.bilinear(grid, -0.01, 0.0))
    assert np.isnan(dem.bilinear(grid, np.nan, 0.0))


def _client(body: bytes, seen: list[str]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, content=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_download_writes_file_and_skips_when_complete(tmp_path: Path) -> None:
    seen: list[str] = []
    url = "https://example.test/x.TIF"
    path = dem.download_raster(tmp_path, url, 4, _client(b"data", seen))
    assert path.read_bytes() == b"data"
    assert dem.download_raster(tmp_path, url, 4, _client(b"data", seen)) == path
    assert len(seen) == 1


def test_download_with_wrong_size_raises_and_leaves_no_final_file(tmp_path: Path) -> None:
    url = "https://example.test/x.TIF"
    with pytest.raises(OSError, match="expected 99"):
        dem.download_raster(tmp_path, url, 99, _client(b"data", []))
    assert not (tmp_path / "x.TIF").exists()


LABEL = """
RECORD_BYTES              = 16
LINES                 = 4
LINE_SAMPLES          = 8
SAMPLE_TYPE           = LSB_INTEGER
SAMPLE_BITS           = 16
SCALING_FACTOR        = 0.5
OFFSET                = 1737400.
MAP_RESOLUTION               = 0.0222222222 <pix/deg>
A_AXIS_RADIUS                = 1737.4 <km>
CENTER_LONGITUDE             = 180 <deg>
MAP_SCALE                    = 1364500.0 <m/pix>
LINE_PROJECTION_OFFSET       = 1.5 <pix>
SAMPLE_PROJECTION_OFFSET     = 3.5 <pix>
COORDINATE_SYSTEM_NAME       = "MEAN EARTH/POLAR AXIS OF DE421"
"""


def _global_dem(tmp_path: Path, grid: np.ndarray, label: str = LABEL) -> dem.GlobalDem:
    img, lbl = tmp_path / "g.img", tmp_path / "g.lbl"
    grid.astype("<i2").tofile(img)
    lbl.write_text(label)
    return dem.GlobalDem(img, lbl)


def test_parse_pds_label_keeps_numbers_and_strips_units() -> None:
    label = dem.parse_pds_label(LABEL)
    assert label["LINES"] == 4
    assert label["MAP_SCALE"] == pytest.approx(1364500.0)
    assert label["OFFSET"] == pytest.approx(1737400.0)
    assert label["SAMPLE_TYPE"] == "LSB_INTEGER"
    assert label["COORDINATE_SYSTEM_NAME"] == "MEAN EARTH/POLAR AXIS OF DE421"


def test_global_dem_reads_pixel_centers_and_applies_scale(tmp_path: Path) -> None:
    res = dem.parse_pds_label(LABEL)["MAP_RESOLUTION"]
    grid = np.arange(32).reshape(4, 8)
    world = _global_dem(tmp_path, grid)
    # Line 1, sample 5: lat = (1.5 - 1) / res, lon = 180 + (5 - 3.5) / res.
    lat, lon = (1.5 - 1) / res, 180 + (5 - 3.5) / res
    assert world.height_at(lat, lon) == pytest.approx(grid[1, 5] * 0.5)


def test_global_dem_interpolates_and_wraps_longitude(tmp_path: Path) -> None:
    res = dem.parse_pds_label(LABEL)["MAP_RESOLUTION"]
    grid = np.zeros((4, 8))
    grid[:, 0] = 100.0
    grid[:, 7] = 300.0
    world = _global_dem(tmp_path, grid)
    # Halfway between the last sample and the first, across the 0°/360° seam.
    lon_last = 180 + (7 - 3.5) / res
    lon_seam = lon_last + 0.5 / res
    assert world.height_at(0.0, lon_seam) == pytest.approx((100 + 300) / 2 * 0.5)
    assert world.height_at(0.0, lon_seam - 360.0) == pytest.approx((100 + 300) / 2 * 0.5)


def test_global_dem_is_vectorized(tmp_path: Path) -> None:
    world = _global_dem(tmp_path, np.full((4, 8), 10))
    assert world.height_at(np.array([0.0, 1.0]), np.array([10.0, 20.0])) == pytest.approx([5, 5])


def test_global_dem_rejects_the_wrong_body_or_format(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="radius"):
        _global_dem(tmp_path, np.zeros((4, 8)), LABEL.replace("1737.4", "6378.1"))
    with pytest.raises(ValueError, match="16-bit"):
        _global_dem(tmp_path, np.zeros((4, 8)), LABEL.replace("LSB_INTEGER", "MSB_INTEGER"))


def test_composite_height_falls_back_only_where_primary_has_no_data() -> None:
    primary = lambda lat, lon: np.where(np.asarray(lat) < 0, 1.0, np.nan)  # noqa: E731
    fallback = lambda lat, lon: np.full(np.shape(lat), 9.0)  # noqa: E731
    height = dem.composite_height(primary, fallback)
    assert height(np.array([-1.0, 1.0]), np.array([0.0, 0.0])) == pytest.approx([1.0, 9.0])
    assert height(np.array([-1.0]), np.array([0.0])) == pytest.approx([1.0])
