"""Ephemeris tests. SPICE-dependent tests run only when kernels are cached (not in CI)."""

import numpy as np
import pytest

from clps import ephemeris
from clps.config import KERNEL_DIR
from clps.kernels import missing_kernels


def test_utc_range_is_half_open_hourly() -> None:
    t = ephemeris.utc_range("2027-01-01T00:00:00", "2027-02-01T00:00:00")
    assert len(t) == 31 * 24
    assert str(t[0]) == "2027-01-01T00:00:00"
    assert str(t[-1]) == "2027-01-31T23:00:00"


needs_kernels = pytest.mark.skipif(
    bool(missing_kernels(kernel_dir=KERNEL_DIR)), reason="SPICE kernels not cached"
)


@pytest.fixture(scope="module")
def spice() -> None:
    from clps.kernels import load_kernels

    load_kernels()


@needs_kernels
def test_matches_spice_azlcpo(spice: None) -> None:
    import spiceypy

    lat, lon, r_km = -89.0, 20.0, 1737.4
    et = ephemeris.to_et(ephemeris.utc_range("2027-01-01", "2027-01-02", 6))
    obspos = ephemeris.site_position_km(lat, lon, r_km)
    for target in ("SUN", "EARTH"):
        track = ephemeris.body_track(target, lat, lon, r_km, et)
        for i, t in enumerate(et):
            azl, _ = spiceypy.azlcpo(
                "ELLIPSOID", target, t, "LT+S", False, True, obspos, "MOON", "MOON_ME"
            )
            az_ref, el_ref = np.degrees(azl[1]), np.degrees(azl[2])
            daz = (track.az_deg[i] - az_ref + 180) % 360 - 180
            assert abs(daz) < 1e-6 and abs(track.el_deg[i] - el_ref) < 1e-6
            assert track.dist_km[i] == pytest.approx(azl[0], rel=1e-9)


@needs_kernels
def test_sun_skims_the_horizon_at_the_pole(spice: None) -> None:
    et = ephemeris.to_et(ephemeris.utc_range("2027-01-01", "2027-02-01", 1))
    track = ephemeris.body_track("SUN", -89.0, 0.0, 1737.4, et)
    # Sun elevation at 89°S stays within ~(1° colatitude + 1.6° tilt) of the horizon.
    assert track.el_deg.max() < 3.0 and track.el_deg.min() > -3.0
    # The Sun circles the horizon once per synodic month: all azimuths are visited.
    assert np.ptp(track.az_deg) > 350
    np.testing.assert_allclose(np.linalg.norm(track.unit_me, axis=1), 1.0)
