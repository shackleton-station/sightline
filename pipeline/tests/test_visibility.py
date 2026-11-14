import numpy as np
import pytest

from clps.visibility import (
    Window,
    angular_radius_deg,
    disk_fraction,
    horizon_el_at,
    longest_gap_h,
    summarize,
    visible_fraction,
    windows,
)

T0 = np.datetime64("2027-01-01T00:00:00", "s")


def hours(n: int) -> np.ndarray:
    return T0 + np.arange(n) * np.timedelta64(1, "h")


def test_sun_and_earth_angular_radius() -> None:
    assert angular_radius_deg(149_597_870.7, 696_000.0) == pytest.approx(0.2666, abs=1e-3)
    assert angular_radius_deg(384_400.0, 6_371.0) == pytest.approx(0.9497, abs=1e-3)


def test_visible_fraction_limits_and_half() -> None:
    r = 0.27
    np.testing.assert_allclose(
        visible_fraction([1.0, 0.27, 0.0, -0.27, -5.0], r), [1, 1, 0.5, 0, 0]
    )


def test_visible_fraction_is_monotonic_and_symmetric() -> None:
    d = np.linspace(-0.3, 0.3, 61)
    f = visible_fraction(d, 0.27)
    assert np.all(np.diff(f) >= 0)
    np.testing.assert_allclose(f + f[::-1], 1.0, atol=1e-12)


def test_horizon_interpolation_wraps() -> None:
    az = np.arange(0.0, 360.0, 0.5)
    el = np.zeros_like(az)
    el[0], el[-1] = 2.0, 1.0  # 0° → 2°, 359.5° → 1°
    assert horizon_el_at(359.75, az, el) == pytest.approx(1.5)
    assert horizon_el_at(-0.25, az, el) == pytest.approx(1.5)
    assert horizon_el_at(0.25, az, el) == pytest.approx(1.0)


def test_windows_and_gaps() -> None:
    t = hours(10)
    up = np.array([1, 1, 0, 0, 0, 1, 1, 1, 0, 1], dtype=bool)
    w = windows(t, up)
    h = np.timedelta64(1, "h")
    assert w == [
        Window(T0, T0 + 2 * h),
        Window(T0 + 5 * h, T0 + 8 * h),
        Window(T0 + 9 * h, T0 + 10 * h),
    ]
    assert longest_gap_h(t, up) == 3.0
    assert longest_gap_h(t, np.ones(10, bool)) == 0.0
    assert longest_gap_h(t, np.zeros(10, bool)) == 10.0


def test_summary_percentages() -> None:
    t = hours(4)
    s = summarize(t, np.array([1, 1, 0, 0], bool), np.array([1, 0, 1, 0], bool))
    assert (s.pct_sun, s.pct_earth, s.pct_both) == (50.0, 50.0, 25.0)
    assert s.max_sun_gap_h == 2.0 and s.max_earth_gap_h == 1.0


def test_irregular_times_rejected() -> None:
    t = np.array(["2027-01-01T00", "2027-01-01T01", "2027-01-01T03"], dtype="datetime64[s]")
    with pytest.raises(ValueError):
        windows(t, np.ones(3, bool))


def test_disk_fraction_uses_the_horizon_at_the_body_azimuth() -> None:
    mask_az = np.array([0.0, 90.0, 180.0, 270.0])
    mask_el = np.array([0.0, 5.0, 0.0, 0.0])
    # Same elevation: clear of the horizon at az 0, behind the 5° ridge at az 90. Distance gives a
    # 1° radius (asin(1/57.3)), comfortably smaller than either clearance.
    frac = disk_fraction(np.array([0.0, 90.0]), np.array([2.0, 2.0]), 57.3, 1.0, mask_az, mask_el)
    assert frac == pytest.approx([1.0, 0.0])
