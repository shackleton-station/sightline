"""The Sun's height on Earth. SPICE-dependent tests run only when kernels are cached (not in CI)."""

import numpy as np
import pytest

from clps import earth_sun
from clps.config import KERNEL_DIR
from clps.ephemeris import to_et
from clps.kernels import load_kernels, missing_kernels


def test_sun_overhead_is_ninety_degrees() -> None:
    assert earth_sun.sun_elevation_deg(
        23.4, 10.0, np.array([23.4]), np.array([10.0])
    ) == pytest.approx(90.0)


def test_opposite_side_of_the_earth_is_minus_ninety() -> None:
    assert earth_sun.sun_elevation_deg(
        23.4, 10.0, np.array([-23.4]), np.array([-170.0])
    ) == pytest.approx(-90.0)


def test_noon_height_is_ninety_minus_latitude_difference() -> None:
    assert earth_sun.sun_elevation_deg(
        40.0, 0.0, np.array([10.0]), np.array([0.0])
    ) == pytest.approx(60.0)


def test_at_the_pole_height_equals_the_suns_latitude_whatever_the_hour() -> None:
    heights = earth_sun.sun_elevation_deg(
        -90.0, 0.0, np.array([-20.0, -20.0]), np.array([0.0, 120.0])
    )
    assert heights == pytest.approx([20.0, 20.0])


needs_kernels = pytest.mark.skipif(
    bool(missing_kernels(kernel_dir=KERNEL_DIR)), reason="SPICE kernels not cached"
)


@needs_kernels
def test_subsolar_latitude_follows_the_seasons() -> None:
    load_kernels()
    times = np.array(
        ["2027-06-21T12:00:00", "2027-12-22T12:00:00", "2027-03-20T12:00:00"],
        dtype="datetime64[s]",
    )
    lat_deg, lon_deg = earth_sun.subsolar_points(to_et(times))
    assert lat_deg[0] == pytest.approx(23.44, abs=0.02)
    assert lat_deg[1] == pytest.approx(-23.44, abs=0.02)
    assert abs(lat_deg[2]) < 0.5
    # About noon at Greenwich, within the equation of time (at most 4° of longitude).
    assert np.all(np.abs(lon_deg) < 4.5)
