"""The 1 m photo tiles' arithmetic: which tiles a disc touches, and tone matching."""

import numpy as np

from clps.photo_tiles import (
    HALF_M,
    LEVEL,
    STEP,
    TILE_M,
    TILE_PX,
    enlarge,
    match_tone,
    smooth,
    tile_range,
    touches_disc,
)


def test_the_grid_is_moon_treks_two_levels_past_its_finest() -> None:
    # Level 13 of a map 2,191,860 m wide in 256 px tiles: 267.56 m a tile, 1.045 m a pixel.
    assert LEVEL == 13 and STEP == 2
    assert round(TILE_M, 2) == 267.56
    assert round(TILE_M / TILE_PX, 4) == 1.0452


def test_the_pole_is_where_four_tiles_meet() -> None:
    col0, col1, row0, row1 = tile_range(0.0, 0.0, 1.0)
    assert (col0, col1, row0, row1) == (4095, 4096, 4095, 4096)


def test_a_disc_touches_the_tiles_within_its_radius_and_no_others() -> None:
    x, y, radius = 30_000.0, -20_000.0, 10_000.0
    col0, col1, row0, row1 = tile_range(x, y, radius)
    # The square round the disc is 20 km: 75 or 76 tiles a side.
    assert col1 - col0 + 1 in (75, 76) and row1 - row0 + 1 in (75, 76)
    centre_col = int((x + HALF_M) // TILE_M)
    centre_row = int((HALF_M - y) // TILE_M)
    assert touches_disc(centre_col, centre_row, x, y, radius)
    # The square's corner tile is 14 km from the centre: outside the disc.
    assert not touches_disc(col0, row0, x, y, radius)
    touched = sum(
        touches_disc(col, row, x, y, radius)
        for row in range(row0, row1 + 1)
        for col in range(col0, col1 + 1)
    )
    # About the disc's area over a tile's, plus the ring of tiles the edge cuts through.
    area = 3.141593 * radius**2 / TILE_M**2
    assert area < touched < area * 1.08


def test_smoothing_and_enlarging_keep_the_mean() -> None:
    rng = np.random.default_rng(7)
    field = rng.uniform(0, 200, (60, 80)).astype(np.float32)
    assert abs(float(smooth(field, 5).mean()) - float(field.mean())) < 1.0
    assert smooth(field, 5).shape == field.shape
    big = enlarge(field, 4)
    assert big.shape == (240, 320)
    assert abs(float(big.mean()) - float(field.mean())) < 1.0


def test_tone_matching_takes_the_softer_pictures_brightness_and_keeps_the_detail() -> None:
    rng = np.random.default_rng(3)
    times = 2**STEP
    # A broad slope of brightness, as Moon Trek shows it, and our picture of the same ground:
    # brighter and more contrasty, with fine grain Trek's pixels cannot hold.
    broad = np.linspace(40, 120, 96, dtype=np.float32)[None, :].repeat(96, axis=0)
    grain = rng.normal(0, 12, (96 * times, 96 * times))
    ours = np.clip(np.kron(broad * 1.6 + 30, np.ones((times, times))) + grain, 1, 255)
    out = match_tone(ours.astype(np.uint8), broad).astype(np.float32)
    # Its brightness is Trek's, block for block.
    blocks = out.reshape(96, times, 96, times).mean(axis=(1, 3))
    assert abs(float(blocks.mean()) - float(broad.mean())) < 2.0
    assert float(np.abs(blocks[30:-30, 30:-30] - broad[30:-30, 30:-30]).mean()) < 4.0
    # The grain is still there: pixel to pixel it varies far more than Trek's enlarged picture.
    assert float(np.abs(np.diff(out, axis=1)).mean()) > 3.0


def test_ground_with_no_picture_stays_empty() -> None:
    times = 2**STEP
    ours = np.full((32 * times, 32 * times), 90, dtype=np.uint8)
    ours[:16, :] = 0
    out = match_tone(ours, np.full((32, 32), 60, dtype=np.float32))
    assert not out[:16, :].any()
    assert out[64:, :].min() > 0
