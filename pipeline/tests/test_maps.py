"""Relief images on small synthetic terrain."""

from pathlib import Path

import numpy as np
import rasterio

from clps import maps


def test_slope_facing_the_light_is_brighter() -> None:
    # Light comes from the northwest. Height rising toward the south faces north, into the light.
    rows, cols = 40, 40
    faces_north = np.tile(np.arange(rows)[:, None] * 5.0, (1, cols))
    faces_south = faces_north[::-1]
    terrain = np.vstack([faces_north, faces_south])
    shade = maps.hillshade(terrain, 100.0, 100.0)
    assert shade[10:30].mean() > shade[50:70].mean()


def test_hillshade_is_8_bit_and_keeps_its_shape() -> None:
    rng = np.random.default_rng(1)
    shade = maps.hillshade(rng.normal(size=(20, 30)), 10.0, 10.0)
    assert shade.shape == (20, 30)
    assert shade.dtype == np.uint8
    assert shade.min() == 0
    assert shade.max() == 255


def test_global_relief_centers_on_zero_longitude() -> None:
    grid = np.zeros((90, 180), np.int16)
    grid[40:50, 0:5] = 5000  # a mountain just east of 0° longitude, in a grid starting at 0°E
    relief = maps.global_relief(grid, ppd=1)
    assert relief.shape == (90, 180)
    # After centering, the feature sits at the image's middle, not its left edge.
    busy = np.abs(relief.astype(float) - np.median(relief)).sum(axis=0)
    assert 80 <= int(np.argmax(busy)) <= 100


def test_block_mean_ignores_nan() -> None:
    grid = np.array([[1.0, 3.0, 5.0, 5.0], [np.nan, 2.0, 5.0, 5.0]])
    assert maps.block_mean(grid, 2).tolist() == [[2.0, 5.0]]


def test_png_decodes_to_the_same_pixels(tmp_path: Path) -> None:
    image = (np.arange(48).reshape(6, 8) * 5).astype(np.uint8)
    path = tmp_path / "x.png"
    path.write_bytes(maps.png_gray(image))
    with rasterio.open(path) as ds:
        assert (ds.read(1) == image).all()
