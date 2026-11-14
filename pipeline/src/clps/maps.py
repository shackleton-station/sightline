"""Shaded-relief images of the Moon, computed from our LOLA terrain, for the web app's map."""

from __future__ import annotations

import struct
import zlib

import numpy as np
from numpy.typing import NDArray

from clps.geometry import MOON_RADIUS_M

#: Light from the northwest, low enough to bring out relief.
SUN_AZ_DEG: float = 315.0
SUN_ALTITUDE_DEG: float = 30.0


def hillshade(
    heights: NDArray[np.floating],
    dx_m: NDArray[np.floating] | float,
    dy_m: float,
    exaggeration: float = 1.0,
) -> NDArray[np.uint8]:
    """Grayscale relief (0–255), rows north to south. ``dx_m`` may vary by row, shape (rows, 1)."""
    grad_rows, grad_cols = np.gradient(np.asarray(heights, float))
    dz_dx = exaggeration * grad_cols / dx_m
    dz_dy = exaggeration * -grad_rows / dy_m  # rows increase southward
    az = np.radians(SUN_AZ_DEG)
    alt = np.radians(SUN_ALTITUDE_DEG)
    light = (np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt))
    shade = (light[2] - light[0] * dz_dx - light[1] * dz_dy) / np.sqrt(1 + dz_dx**2 + dz_dy**2)
    low, high = np.percentile(shade, [1, 99])
    return (np.clip((shade - low) / (high - low), 0, 1) * 255).astype(np.uint8)


def global_relief(grid: NDArray[np.integer], ppd: int) -> NDArray[np.uint8]:
    """Relief of the whole Moon, centered on 0° longitude, from a grid starting at 0° east."""
    rows, cols = grid.shape
    centered = np.roll(np.asarray(grid, float), cols // 2, axis=1)
    pixel_m = np.pi * MOON_RADIUS_M / 180.0 / ppd
    lat = np.radians(90.0 - (np.arange(rows) + 0.5) / ppd)
    dx = pixel_m * np.maximum(np.cos(lat), 0.05)[:, None]
    return hillshade(centered, dx, pixel_m)


def block_mean(heights: NDArray[np.floating], factor: int) -> NDArray[np.floating]:
    """Downsample by averaging square blocks, ignoring NaN."""
    rows = heights.shape[0] // factor
    cols = heights.shape[1] // factor
    trimmed = heights[: rows * factor, : cols * factor]
    return np.nanmean(trimmed.reshape(rows, factor, cols, factor), axis=(1, 3))


def png_gray(image: NDArray[np.uint8]) -> bytes:
    """Encode an 8-bit grayscale image as PNG."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    rows, cols = image.shape
    header = struct.pack(">IIBBBBB", cols, rows, 8, 0, 0, 0, 0)
    raw = b"".join(b"\x00" + image[row].tobytes() for row in range(rows))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
