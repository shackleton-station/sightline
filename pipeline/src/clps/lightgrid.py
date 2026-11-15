"""Sun and Earth visibility at every pixel of a south-polar grid (the "light grid").

The same calculation as a listed site (``horizon.py`` then ``visibility.py``), run at every pixel:
a horizon of 720 azimuths per pixel from the LOLA polar DEM, then, hour by hour, whether any part
of the Sun's or Earth's disk clears it. Compiled with numba, because a 1024 x 1024 grid is about a
trillion terrain samples.

Conventions as in ``geometry.py``. The grid is a square in the DEM's own polar stereographic plane,
centered on the pole: row 0 is the largest map y, column 0 the smallest map x, values are at pixel
centers. Visibility over a month is stored per pixel as the hours at which it changes ("flips"),
starting from "down": a pixel is up at hour ``t`` when an odd number of its flips are ``<= t``.
"""

from __future__ import annotations

import gzip
from dataclasses import dataclass, field

import numpy as np
from numba import njit, prange
from numpy.typing import NDArray
from pyproj import CRS, Transformer

from clps.geometry import MOON_RADIUS_M, FloatArray

#: The grid the web app draws: 1024 pixels of 120 m, so 61.44 km each way from the pole. It holds
#: the four ridge sites (the farthest is 40.4 km out). 120 m is two pixels of NASA's 60 m maps, and
#: about the scale below which neighbours differ by as much as the model's own error
#: (docs/VALIDATION.md §10).
GRID_SIZE: int = 1024
PIXEL_M: float = 120.0
#: Azimuth spacing of each pixel's horizon (degrees), the same as a listed site's.
AZ_STEP_DEG: float = 0.5
#: Flips kept per pixel and month; a pixel with more has its shortest runs merged. Chosen by
#: counting, over five months: with 8 Sun slots 3.3% of pixel-months need merging (5.3% on well-lit
#: ground, where a grazing Sun comes and goes) and a listed site's cell lost 13 of a month's hours;
#: with 16, 0.04% do and one hour in a million changes. Earth never needed more than 4.
SUN_SLOTS: int = 16
EARTH_SLOTS: int = 4
#: A patch: the same calculation at the terrain's own pixel size, over a square of the grid's
#: cells round a site. 20 m is the DEM's pixel, so each patch pixel is one height sample and
#: nothing finer would be more than reading between samples. ``PATCH_REACH_CELLS`` grid cells each
#: way from the site's own cell is 3.06 km: past the 2 km the app looks round a target for a lander
#: that misses, with room to move the target.
PATCH_PIXEL_M: float = 20.0
PATCH_REACH_CELLS: int = 25
#: Most flips looked at in one pixel's month before the rest are dropped (hourly samples).
_MAX_FLIPS: int = 512


@dataclass(frozen=True)
class PolarPlane:
    """A south-polar stereographic plane, as plain numbers a compiled loop can use.

    Attributes:
        radius_m: the sphere's radius (meters).
        x_axis, y_axis: unit vectors in ``MOON_ME`` x/y that map x and map y point along.
    """

    radius_m: float
    x_axis: tuple[float, float]
    y_axis: tuple[float, float]

    def project(self, unit: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Map x/y (meters) of unit vector(s) of shape (..., 3)."""
        scale = 2.0 * self.radius_m / (1.0 - unit[..., 2])
        x = scale * (unit[..., 0] * self.x_axis[0] + unit[..., 1] * self.x_axis[1])
        y = scale * (unit[..., 0] * self.y_axis[0] + unit[..., 1] * self.y_axis[1])
        return x, y

    def unproject(self, x_m: FloatArray, y_m: FloatArray) -> FloatArray:
        """Unit vector(s) in ``MOON_ME`` for map x/y (meters); shape (..., 3)."""
        rho = np.hypot(x_m, y_m)
        colat = 2.0 * np.arctan(rho / (2.0 * self.radius_m))
        with np.errstate(invalid="ignore", divide="ignore"):
            along_x = np.where(rho > 0, x_m / rho, 0.0)
            along_y = np.where(rho > 0, y_m / rho, 0.0)
        sin_c = np.sin(colat)
        return np.stack(
            [
                sin_c * (along_x * self.x_axis[0] + along_y * self.y_axis[0]),
                sin_c * (along_x * self.x_axis[1] + along_y * self.y_axis[1]),
                -np.cos(colat),
            ],
            axis=-1,
        )


def polar_plane(crs: CRS, check_reach_m: float = 300_000.0) -> PolarPlane:
    """The closed-form version of a south-polar stereographic CRS, checked against the CRS itself.

    The projection is never assumed: the axes come from unprojecting two points with the CRS, and
    the closed form must then reproduce the CRS's own projection to a millimeter at random points
    within ``check_reach_m`` of the pole, or this raises.
    """
    to_lonlat = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
    to_xy = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
    lon_x, _ = to_lonlat.transform(1000.0, 0.0)
    lon_y, _ = to_lonlat.transform(0.0, 1000.0)
    plane = PolarPlane(
        radius_m=float(crs.ellipsoid.semi_major_metre),
        x_axis=(float(np.cos(np.radians(lon_x))), float(np.sin(np.radians(lon_x)))),
        y_axis=(float(np.cos(np.radians(lon_y))), float(np.sin(np.radians(lon_y)))),
    )
    rng = np.random.default_rng(0)
    x = rng.uniform(-check_reach_m, check_reach_m, 200)
    y = rng.uniform(-check_reach_m, check_reach_m, 200)
    lon, lat = to_lonlat.transform(x, y)
    back_x, back_y = to_xy.transform(lon, lat)
    lat_r, lon_r = np.radians(lat), np.radians(lon)
    unit = np.stack(
        [np.cos(lat_r) * np.cos(lon_r), np.cos(lat_r) * np.sin(lon_r), np.sin(lat_r)], axis=-1
    )
    ours_x, ours_y = plane.project(unit)
    worst = float(np.max(np.hypot(ours_x - back_x, ours_y - back_y)))
    if not worst < 1e-3:
        raise ValueError(f"closed-form polar projection is {worst} m from the CRS's own")
    return plane


def grid_xy_m(size: int = GRID_SIZE, pixel_m: float = PIXEL_M) -> tuple[FloatArray, FloatArray]:
    """Map x and y (meters) of every pixel center, each of shape (size, size)."""
    half = size * pixel_m / 2.0
    centers = -half + pixel_m * (np.arange(size) + 0.5)
    x, y = np.meshgrid(centers, -centers)
    return x, y


@dataclass(frozen=True)
class Patch:
    """A square of the grid's cells, each split into smaller pixels.

    Attributes:
        col, row: the grid's column and row of the patch's top-left cell.
        cells: grid cells along a side.
        sub: patch pixels along one grid cell.
        pixel_m: the patch's pixel size (meters).
        x_left_m, y_top_m: map x/y (meters) of the top-left corner of the top-left pixel.
    """

    col: int
    row: int
    cells: int
    sub: int
    pixel_m: float
    x_left_m: float
    y_top_m: float

    @property
    def size(self) -> int:
        """Patch pixels along a side."""
        return self.cells * self.sub


def patch_around(
    x_m: float,
    y_m: float,
    reach_cells: int = PATCH_REACH_CELLS,
    patch_pixel_m: float = PATCH_PIXEL_M,
    size: int = GRID_SIZE,
    pixel_m: float = PIXEL_M,
) -> Patch:
    """The patch of whole grid cells reaching ``reach_cells`` each way from a point's own cell.

    The patch's pixels divide the grid's cells exactly, so each patch pixel lies in one cell and a
    cell's pixels are found by counting. Raises if the cell size is not a whole number of patch
    pixels, or if the patch would reach outside the grid.
    """
    sub = round(pixel_m / patch_pixel_m)
    if sub < 1 or abs(sub * patch_pixel_m - pixel_m) > 1e-9:
        raise ValueError(f"a {pixel_m} m cell is not a whole number of {patch_pixel_m} m pixels")
    half = size * pixel_m / 2.0
    col = int((x_m + half) // pixel_m) - reach_cells
    row = int((half - y_m) // pixel_m) - reach_cells
    cells = 2 * reach_cells + 1
    if col < 0 or row < 0 or col + cells > size or row + cells > size:
        raise ValueError("the patch reaches outside the grid")
    return Patch(col, row, cells, sub, patch_pixel_m, -half + col * pixel_m, half - row * pixel_m)


def patch_xy_m(patch: Patch) -> tuple[FloatArray, FloatArray]:
    """Map x and y (meters) of every patch pixel center, each (size, size); row 0 on top."""
    steps = patch.pixel_m * (np.arange(patch.size) + 0.5)
    x, y = np.meshgrid(patch.x_left_m + steps, patch.y_top_m - steps)
    return x, y


@dataclass(frozen=True)
class Observers:
    """Points on the ground, each with its local frame. Arrays have one row per point.

    Attributes:
        up, east, north: unit vectors in ``MOON_ME``, shape (n, 3).
        radius_m: distance of the observer's eye from the Moon's center (meters), shape (n,).
    """

    up: FloatArray
    east: FloatArray
    north: FloatArray
    radius_m: FloatArray


def observers(up: FloatArray, ground_m: FloatArray, obs_height_m: float) -> Observers:
    """Observers ``obs_height_m`` above ground heights ``ground_m`` at unit vectors ``up``."""
    up = np.ascontiguousarray(up.reshape(-1, 3), dtype=np.float64)
    east = np.cross([0.0, 0.0, 1.0], up)
    norm = np.linalg.norm(east, axis=1, keepdims=True)
    if np.any(norm < 1e-12):
        raise ValueError("local north/east are undefined exactly at a pole")
    east = east / norm
    north = np.cross(up, east)
    radius = MOON_RADIUS_M + np.asarray(ground_m, float).ravel() + obs_height_m
    return Observers(up, np.ascontiguousarray(east), np.ascontiguousarray(north), radius)


@njit(cache=True)
def _bilinear(dem, col, row):  # type: ignore[no-untyped-def]
    """Bilinear height at fractional pixel-center indices; NaN outside, as ``dem.bilinear``."""
    rows, cols = dem.shape
    if not (col >= 0.0 and col <= cols - 1 and row >= 0.0 and row <= rows - 1):
        return np.nan
    c0 = min(int(col), cols - 2)
    r0 = min(int(row), rows - 2)
    fc = col - c0
    fr = row - r0
    top = dem[r0, c0] * (1.0 - fc) + dem[r0, c0 + 1] * fc
    bottom = dem[r0 + 1, c0] * (1.0 - fc) + dem[r0 + 1, c0 + 1] * fc
    return top * (1.0 - fr) + bottom * fr


@njit(cache=True)
def _far_height(far, far_geom, dx, dy, dz):  # type: ignore[no-untyped-def]
    """Height from the whole-Moon map at a unit vector, as ``dem.GlobalDem.height_at`` reads it.

    ``far`` is the map's southern rows; ``far_geom`` is pixels per degree, the central longitude,
    the line of the equator counted from ``far``'s first row, the sample offset and meters per unit.
    """
    rows, cols = far.shape
    lat = np.degrees(np.arcsin(dz))
    lon = np.degrees(np.arctan2(dy, dx)) % 360.0
    line = far_geom[2] - lat * far_geom[0]
    sample = far_geom[3] + (lon - far_geom[1]) * far_geom[0]
    r0 = min(max(int(np.floor(line)), 0), rows - 2)
    fr = min(max(line - r0, 0.0), 1.0)
    c_floor = int(np.floor(sample))
    c0 = c_floor % cols
    c1 = (c_floor + 1) % cols
    fc = sample - c_floor
    top = far[r0, c0] * (1.0 - fc) + far[r0, c1] * fc
    bottom = far[r0 + 1, c0] * (1.0 - fc) + far[r0 + 1, c1] * fc
    return (top * (1.0 - fr) + bottom * fr) * far_geom[4]


@njit(parallel=True, cache=True)
def _heights_kernel(dem, x_left, y_top, pixel_m, x_m, y_m, out):  # type: ignore[no-untyped-def]
    for i in prange(x_m.shape[0]):
        out[i] = _bilinear(dem, (x_m[i] - x_left) / pixel_m - 0.5, (y_top - y_m[i]) / pixel_m - 0.5)


@njit(parallel=True, cache=True)
def _horizon_kernel(  # type: ignore[no-untyped-def]
    dem, x_left, y_top, pixel_m, radius_m, x_axis, y_axis, far, far_geom,
    up, east, north, eye_radius_m, cos_d, sin_d, cos_az, sin_az, out,
):  # fmt: skip
    """Horizon elevation (degrees) per observer and azimuth; NaN where a ray finds no terrain.

    Where the polar DEM has nothing (a ray that runs off its edge), the whole-Moon map ``far`` is
    read instead, if there is one: the same rule as ``dem.composite_height`` for a listed site.

    The elevation of a terrain point at central angle ``d`` and radius ``r``, seen from an eye at
    radius ``e`` on the same great circle, has tangent ``(r cos d - e) / (r sin d)``: the same
    angle ``horizon.horizon_mask`` gets from 3D vectors.
    """
    two_r = 2.0 * radius_m
    inv_px = 1.0 / pixel_m
    for i in prange(up.shape[0]):
        ux, uy, uz = up[i, 0], up[i, 1], up[i, 2]
        eye = eye_radius_m[i]
        for a in range(cos_az.shape[0]):
            hx = cos_az[a] * north[i, 0] + sin_az[a] * east[i, 0]
            hy = cos_az[a] * north[i, 1] + sin_az[a] * east[i, 1]
            hz = cos_az[a] * north[i, 2] + sin_az[a] * east[i, 2]
            best = -np.inf
            for k in range(cos_d.shape[0]):
                dx = cos_d[k] * ux + sin_d[k] * hx
                dy = cos_d[k] * uy + sin_d[k] * hy
                dz = cos_d[k] * uz + sin_d[k] * hz
                scale = two_r / (1.0 - dz)
                x = scale * (dx * x_axis[0] + dy * x_axis[1])
                y = scale * (dx * y_axis[0] + dy * y_axis[1])
                h = _bilinear(dem, (x - x_left) * inv_px - 0.5, (y_top - y) * inv_px - 0.5)
                if np.isnan(h):
                    if far.shape[0] < 2:
                        continue
                    h = _far_height(far, far_geom, dx, dy, dz)
                r = radius_m + h
                tangent = (r * cos_d[k] - eye) / (r * sin_d[k])
                if tangent > best:
                    best = tangent
            out[i, a] = np.degrees(np.arctan(best)) if best > -np.inf else np.nan


@dataclass(frozen=True)
class Terrain:
    """A polar DEM in memory, with where it sits in its own map plane.

    Attributes:
        heights_m: float32 heights (meters), shape (rows, cols), row 0 at the largest y; NaN = none.
        x_left_m, y_top_m: map x/y (meters) of the top-left corner of the top-left pixel.
        pixel_m: pixel size (meters).
        plane: the map plane.
        far: the whole-Moon map's southern rows (raw samples), read where the polar DEM has
            nothing; an empty array if rays never leave the polar DEM.
        far_geom: how to read ``far`` (see ``_far_height``).
    """

    heights_m: NDArray[np.float32]
    x_left_m: float
    y_top_m: float
    pixel_m: float
    plane: PolarPlane
    far: NDArray[np.int16] = field(default_factory=lambda: np.empty((0, 0), np.int16))
    far_geom: FloatArray = field(default_factory=lambda: np.zeros(5))

    def height_at(self, up: FloatArray) -> FloatArray:
        """Bilinear terrain height (meters) at unit vectors of shape (n, 3)."""
        x, y = self.plane.project(np.asarray(up, float).reshape(-1, 3))
        out = np.empty(x.shape[0])
        _heights_kernel(self.heights_m, self.x_left_m, self.y_top_m, self.pixel_m, x, y, out)
        return out


def horizons(
    terrain: Terrain, at: Observers, distances_m: FloatArray, az_step_deg: float = AZ_STEP_DEG
) -> NDArray[np.float32]:
    """Horizon elevation (degrees) at each observer, shape (n, 360 / az_step_deg).

    ``distances_m`` are the ground distances sampled along each ray, as in ``horizon.py``.
    """
    az = np.radians(np.arange(0.0, 360.0, az_step_deg))
    delta = np.asarray(distances_m, float) / terrain.plane.radius_m
    out = np.empty((at.up.shape[0], az.size), np.float32)
    _horizon_kernel(
        terrain.heights_m, terrain.x_left_m, terrain.y_top_m, terrain.pixel_m,
        terrain.plane.radius_m, np.array(terrain.plane.x_axis), np.array(terrain.plane.y_axis),
        terrain.far, terrain.far_geom,
        at.up, at.east, at.north, at.radius_m, np.cos(delta), np.sin(delta), np.cos(az), np.sin(az),
        out,
    )  # fmt: skip
    return out


@njit(cache=True)
def _clearance_over_radius(  # type: ignore[no-untyped-def]
    horizon, up, east, north, eye_km, px, py, pz, body_radius_km, az_shift_deg
):
    """How far a disk's center is above the horizon, in disk radii, for one observer and time.

    Above 1 the whole disk is clear, below -1 none of it is. ``az_shift_deg`` turns the body in
    azimuth before the horizon is read; anything but 0 is a deliberately wrong sky, for controls.
    """
    rx = px - eye_km * up[0]
    ry = py - eye_km * up[1]
    rz = pz - eye_km * up[2]
    dist = np.sqrt(rx * rx + ry * ry + rz * rz)
    e = (rx * east[0] + ry * east[1] + rz * east[2]) / dist
    n = (rx * north[0] + ry * north[1] + rz * north[2]) / dist
    u = (rx * up[0] + ry * up[1] + rz * up[2]) / dist
    az = (np.degrees(np.arctan2(e, n)) + az_shift_deg) % 360.0
    el = np.degrees(np.arctan2(u, np.sqrt(e * e + n * n)))
    n_az = horizon.shape[0]
    f = az * n_az / 360.0
    a0 = int(f)
    w = f - a0
    a0 = a0 % n_az
    a1 = (a0 + 1) % n_az
    skyline = horizon[a0] * (1.0 - w) + horizon[a1] * w
    return (el - skyline) / np.degrees(np.arcsin(body_radius_km / dist))


@njit(parallel=True, cache=True)
def _flags_kernel(  # type: ignore[no-untyped-def]
    horizon, up, east, north, eye_km, positions_km, body_radius_km, az_shift_deg, out
):
    for i in prange(up.shape[0]):
        for t in range(positions_km.shape[0]):
            x = _clearance_over_radius(
                horizon[i], up[i], east[i], north[i], eye_km[i],
                positions_km[t, 0], positions_km[t, 1], positions_km[t, 2],
                body_radius_km, az_shift_deg,
            )  # fmt: skip
            out[i, t] = x > -1.0


def up_flags(
    horizon: NDArray[np.float32],
    at: Observers,
    positions_km: FloatArray,
    body_radius_km: float,
    az_shift_deg: float = 0.0,
) -> NDArray[np.bool_]:
    """Whether any part of a body's disk clears the horizon; shape (observers, times).

    ``positions_km`` is the body's position from the Moon's center in ``MOON_ME`` at each time,
    shape (times, 3); each observer's own position is subtracted, so Earth's parallax is exact.
    """
    out = np.empty((at.up.shape[0], positions_km.shape[0]), np.bool_)
    _flags_kernel(
        horizon, at.up, at.east, at.north, at.radius_m / 1000.0,
        np.ascontiguousarray(positions_km, dtype=np.float64), body_radius_km, az_shift_deg, out,
    )  # fmt: skip
    return out


@njit(parallel=True, cache=True)
def _average_kernel(  # type: ignore[no-untyped-def]
    horizon, up, east, north, eye_km, positions_km, body_radius_km, az_shift_deg, any_part, disk
):
    n_t = positions_km.shape[0]
    for i in prange(up.shape[0]):
        seen = 0
        area = 0.0
        for t in range(n_t):
            x = _clearance_over_radius(
                horizon[i], up[i], east[i], north[i], eye_km[i],
                positions_km[t, 0], positions_km[t, 1], positions_km[t, 2],
                body_radius_km, az_shift_deg,
            )  # fmt: skip
            if x > -1.0:
                seen += 1
                if x >= 1.0:
                    area += 1.0
                else:
                    # The part of a disk above a straight line, as in visibility.visible_fraction.
                    area += (np.arccos(-x) + x * np.sqrt(1.0 - x * x)) / np.pi
        any_part[i] = 100.0 * seen / n_t
        disk[i] = 100.0 * area / n_t


def averages_pct(
    horizon: NDArray[np.float32],
    at: Observers,
    positions_km: FloatArray,
    body_radius_km: float,
    az_shift_deg: float = 0.0,
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    """Share of the times (percent) with any part of the disk up, and the mean visible disk."""
    any_part = np.empty(at.up.shape[0], np.float32)
    disk = np.empty(at.up.shape[0], np.float32)
    _average_kernel(
        horizon, at.up, at.east, at.north, at.radius_m / 1000.0,
        np.ascontiguousarray(positions_km, dtype=np.float64), body_radius_km, az_shift_deg,
        any_part, disk,
    )  # fmt: skip
    return any_part, disk


@njit(parallel=True, cache=True)
def _flips_kernel(flags, slots, flips, found, changed):  # type: ignore[no-untyped-def]
    n, n_t = flags.shape
    for i in prange(n):
        times = np.empty(_MAX_FLIPS, np.int64)
        count = 0
        state = False
        for t in range(n_t):
            if flags[i, t] != state:
                state = flags[i, t]
                if count < _MAX_FLIPS:
                    times[count] = t
                count += 1
        found[i] = count
        kept = min(count, _MAX_FLIPS)
        lost = 0
        # Too many to keep: merge the shortest run into its neighbours until they fit. Removing a
        # run removes the two flips around it; an odd number of flips always leaves room for that.
        while kept > slots:
            shortest = 0
            for j in range(1, kept - 1):
                if times[j + 1] - times[j] < times[shortest + 1] - times[shortest]:
                    shortest = j
            lost += times[shortest + 1] - times[shortest]
            for j in range(shortest, kept - 2):
                times[j] = times[j + 2]
            kept -= 2
        changed[i] = lost
        for j in range(slots):
            flips[i, j] = times[j] if j < kept else n_t


def flips(
    flags: NDArray[np.bool_], slots: int
) -> tuple[NDArray[np.uint16], NDArray[np.int32], NDArray[np.int32]]:
    """Hours at which each row of ``flags`` changes, starting from "down"; shape (n, slots).

    Unused slots hold the number of hours. Also returns how many flips each row really had, and
    how many of its hours changed because runs were merged to fit ``slots`` (0 for almost all).
    ``slots`` must be even, so that removing runs two flips at a time always fits.
    """
    if slots % 2:
        raise ValueError("slots must be even")
    n = flags.shape[0]
    out = np.empty((n, slots), np.uint16)
    found = np.empty(n, np.int32)
    changed = np.empty(n, np.int32)
    _flips_kernel(np.ascontiguousarray(flags), slots, out, found, changed)
    return out, found, changed


def flags_from_flips(flips_h: NDArray[np.uint16], hours: int) -> NDArray[np.bool_]:
    """The up/down flags that ``flips`` encodes, shape (n, hours), as the browser's shader does."""
    t = np.arange(hours)
    return (np.sum(flips_h[:, :, None] <= t[None, None, :], axis=1) % 2).astype(bool)


def encode_month(sun: NDArray[np.uint16], earth: NDArray[np.uint16], size: int) -> bytes:
    """A month of the grid as gzip: Sun flips then Earth flips, little-endian uint16.

    Each is stored slot by slot (a ``size`` x ``size`` plane per slot), which is the order the
    browser uploads them in, and compresses better than pixel by pixel.
    """
    planes = [
        np.ascontiguousarray(flips_h.reshape(size, size, -1).transpose(2, 0, 1)).astype("<u2")
        for flips_h in (sun, earth)
    ]
    return gzip.compress(b"".join(plane.tobytes() for plane in planes), 6, mtime=0)


def decode_month(
    blob: bytes, size: int, sun_slots: int, earth_slots: int
) -> tuple[NDArray[np.uint16], NDArray[np.uint16]]:
    """The inverse of ``encode_month``: Sun and Earth flips, each of shape (size², slots)."""
    raw = np.frombuffer(gzip.decompress(blob), "<u2")
    if raw.size != size * size * (sun_slots + earth_slots):
        raise ValueError("month file does not match the grid")
    planes = raw.reshape(sun_slots + earth_slots, size * size)
    return planes[:sun_slots].T.copy(), planes[sun_slots:].T.copy()


def far_terrain(
    grid: NDArray[np.int16], geometry: dict[str, float], north_edge_lat_deg: float = -60.0
) -> tuple[NDArray[np.int16], FloatArray]:
    """The part of a whole-Moon map south of a latitude, in memory, and how to read it.

    ``grid`` and ``geometry`` are ``dem.GlobalDem.grid`` and ``.geometry()``. Only the southern
    rows are copied (355 MB of the 2 GB map for 60° S), which is all a polar ray can reach.
    """
    first = int(np.floor(geometry["line_offset"] - north_edge_lat_deg * geometry["pix_per_deg"]))
    first = min(max(first - 1, 0), grid.shape[0] - 2)
    geom = np.array(
        [
            geometry["pix_per_deg"],
            geometry["center_lon"],
            geometry["line_offset"] - first,
            geometry["sample_offset"],
            geometry["scale"],
        ]
    )
    return np.ascontiguousarray(grid[first:]), geom


def comparison(ours_pct: FloatArray, map_pct: FloatArray) -> dict[str, float]:
    """Our values against a map's at the same pixels (percentage points), NaNs left out."""
    keep = np.isfinite(ours_pct) & np.isfinite(map_pct)
    ours, theirs = np.asarray(ours_pct, float)[keep], np.asarray(map_pct, float)[keep]
    difference = ours - theirs
    return {
        "n": int(ours.size),
        "bias": round(float(np.mean(difference)), 2),
        "mean_abs": round(float(np.mean(np.abs(difference))), 2),
        "rmse": round(float(np.sqrt(np.mean(difference**2))), 2),
        "r": round(float(np.corrcoef(ours, theirs)[0, 1]), 3),
    }


def agreement(ours: NDArray[np.bool_], theirs: NDArray[np.bool_]) -> dict[str, float]:
    """How often two up/down series agree, and the same with up and down hours weighted equally.

    A series that is nearly always up agrees with almost anything; the balanced score is 50 for
    a coin flip whatever the mix.
    """
    ours, theirs = np.asarray(ours, bool), np.asarray(theirs, bool)
    up, down = theirs, ~theirs
    hit_up = float(np.mean(ours[up])) if up.any() else float("nan")
    hit_down = float(np.mean(~ours[down])) if down.any() else float("nan")
    return {
        "hours": int(theirs.size),
        "agree_pct": round(100.0 * float(np.mean(ours == theirs)), 2),
        "balanced_pct": round(100.0 * float(np.nanmean([hit_up, hit_down])), 2),
    }
