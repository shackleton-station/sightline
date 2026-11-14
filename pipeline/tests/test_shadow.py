"""Distance to permanently shadowed ground: the geometry, on small made-up maps."""

import numpy as np
import pytest

from clps import shadow
from clps.geometry import MOON_RADIUS_M


def test_ground_distance_is_arc_length_on_the_moons_sphere() -> None:
    one_degree_km = np.pi / 180.0 * MOON_RADIUS_M / 1000.0
    out = shadow.ground_distance_km(-89.0, 0.0, [-88.0, -89.0, -89.0], [0.0, 0.0, 180.0])
    assert out[0] == pytest.approx(one_degree_km)
    assert out[1] == pytest.approx(0.0, abs=1e-9)
    # Across the pole: one degree down to it and one degree up the other side.
    assert out[2] == pytest.approx(2 * one_degree_km)


def test_longitude_matters_less_near_the_pole() -> None:
    near = shadow.ground_distance_km(-89.9, 0.0, [-89.9], [90.0])[0]
    far = shadow.ground_distance_km(-60.0, 0.0, [-60.0], [90.0])[0]
    assert near < 5.0 < far


def test_a_site_is_read_on_the_finest_map_that_holds_it() -> None:
    assert shadow.covered_by(-89.5) is shadow.SOUTH_MAPS[0]
    assert shadow.covered_by(-84.79) is shadow.SOUTH_MAPS[1]
    assert shadow.covered_by(-69.37) is shadow.SOUTH_MAPS[2]
    assert shadow.covered_by(-45.0) is None
    assert shadow.covered_by(26.0) is None


def test_edge_distances_are_along_a_meridian() -> None:
    one_degree_km = np.pi / 180.0 * MOON_RADIUS_M / 1000.0
    assert shadow.edge_distance_km(-88.0, -85.0) == pytest.approx(3 * one_degree_km)
    # A site near the equator is as far from the north map's edge as from the south's.
    assert shadow.outside_km(0.0) == pytest.approx(65 * one_degree_km)
    assert shadow.outside_km(26.0) == pytest.approx(39 * one_degree_km)
    assert shadow.outside_km(-45.0) == pytest.approx(20 * one_degree_km)


def test_pixels_cover_less_ground_away_from_the_pole() -> None:
    at_pole = shadow.pixel_area_km2(60.0, 0.0)
    assert at_pole == pytest.approx(0.0036)
    # At 65 degrees south the projection stretches lengths by 2 / (1 + sin 65°).
    r_m = 2 * MOON_RADIUS_M * np.tan(np.radians(25.0) / 2)
    stretch = 2 / (1 + np.sin(np.radians(65.0)))
    assert shadow.pixel_area_km2(240.0, r_m) == pytest.approx(0.0576 / stretch**2)


def test_a_region_is_cells_that_touch_by_side_or_corner() -> None:
    cells = np.array(
        [
            [1, 1, 0, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 0, 0, 1],
            [0, 0, 0, 0, 1],
        ],
        dtype=bool,
    )
    region = shadow.region_cells(cells, 0, 0)
    assert [tuple(cell) for cell in region] == [(0, 0), (0, 1), (1, 2)]
    assert len(shadow.region_cells(cells, 3, 4)) == 2
    with pytest.raises(ValueError):
        shadow.region_cells(cells, 0, 2)
