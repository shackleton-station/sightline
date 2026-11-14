import numpy as np
import pytest

from clps.geometry import az_el_deg, enu_basis, unit_vector, vector_to_latlon


def test_latlon_roundtrip() -> None:
    lat, lon = vector_to_latlon(unit_vector([-89.5, -85.0], [12.0, -170.0]))
    np.testing.assert_allclose(lat, [-89.5, -85.0], atol=1e-12)
    np.testing.assert_allclose(lon, [12.0, -170.0], atol=1e-12)


def test_south_pole_site_north_points_to_equator() -> None:
    east, north, up = enu_basis(-89.0, 0.0)
    toward_equator = unit_vector(-88.0, 0.0) - unit_vector(-89.0, 0.0)
    az, _ = az_el_deg(toward_equator, east, north, up)
    assert az == pytest.approx(0.0, abs=0.01)
    toward_pole = unit_vector(-90.0, 0.0) - unit_vector(-89.0, 0.0)
    az, _ = az_el_deg(toward_pole, east, north, up)
    assert az == pytest.approx(180.0, abs=0.01)
    toward_east = unit_vector(-89.0, 1.0) - unit_vector(-89.0, 0.0)
    az, _ = az_el_deg(toward_east, east, north, up)
    assert az == pytest.approx(90.0, abs=0.5)


def test_zenith_is_elevation_90() -> None:
    east, north, up = enu_basis(-85.0, 30.0)
    _, el = az_el_deg(up, east, north, up)
    assert el == pytest.approx(90.0)


def test_pole_rejected() -> None:
    with pytest.raises(ValueError):
        enu_basis(-90.0, 0.0)
