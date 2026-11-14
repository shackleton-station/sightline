"""JSON contract shape, rounding and the generated TypeScript file."""

import gzip
import json
from pathlib import Path

import numpy as np
import pytest

from clps import export
from clps.config import SITES, WEB_CONTRACT_TS
from clps.ephemeris import Track
from clps.horizon import HorizonMask
from clps.observation import Observation, select
from clps.visibility import summarize


def _observation() -> Observation:
    times = np.array(["2027-05-01T00:00:00", "2027-05-01T01:00:00"], dtype="datetime64[s]")
    unit = np.array([[0.123456789, 0.0, 1.0], [0.0, 1.0, 0.0]])
    sun = Track(np.array([10.123, 20.0]), np.array([1.456, -2.0]), np.ones(2), unit)
    earth = Track(np.array([30.0, 40.0]), np.array([3.0, 4.0]), np.ones(2), unit)
    return Observation(times, sun, earth, np.array([0.55555, 0.0]), np.array([0.0, 1.0]))


def test_track_rows_match_contract() -> None:
    first, second = export.track_rows(_observation())
    assert first == {
        "t": "2027-05-01T00:00:00Z",
        "sun_az": 10.12,
        "sun_el": 1.46,
        "sun_frac": 0.556,
        "sun_up": True,
        "earth_az": 30.0,
        "earth_el": 3.0,
        "earth_up": False,
        "sun_vec_me": [0.12346, 0.0, 1.0],
    }
    assert second["sun_up"] is False
    assert second["earth_up"] is True


def test_select_keeps_matching_samples() -> None:
    part = select(_observation(), np.array([False, True]))
    assert len(part.times) == 1
    assert part.sun.az_deg[0] == pytest.approx(20.0)
    assert part.earth_frac[0] == pytest.approx(1.0)


def test_rows_are_plain_json_types() -> None:
    assert json.dumps(export.track_rows(_observation()))


def test_horizon_rows() -> None:
    mask = HorizonMask(np.array([0.0, 0.5]), np.array([1.234, -0.5]), np.ones(2), np.ones(2))
    assert export.horizon_rows(mask) == [{"az": 0.0, "el": 1.23}, {"az": 0.5, "el": -0.5}]


def test_summary_dict() -> None:
    times = np.arange(
        np.datetime64("2027-05-01T00", "s"),
        np.datetime64("2027-05-01T04", "s"),
        np.timedelta64(1, "h"),
    )
    summary = summarize(
        times, np.array([True, True, False, False]), np.array([True, False, True, True])
    )
    out = export.summary_dict(summary, times[0], np.datetime64("2027-05-01T04", "s"), 1, 2.0)
    assert out["pct_sun"] == pytest.approx(50.0)
    assert out["pct_both"] == pytest.approx(25.0)
    assert out["max_sun_gap_h"] == pytest.approx(2.0)
    assert out["range"] == {
        "start": "2027-05-01T00:00:00Z",
        "end": "2027-05-01T04:00:00Z",
        "step_h": 1,
    }
    assert out["sun_windows"] == [{"start": "2027-05-01T00:00:00Z", "end": "2027-05-01T02:00:00Z"}]


def test_year_dict_lists_months_and_years() -> None:
    times = np.arange(
        np.datetime64("2027-05-01T00", "s"),
        np.datetime64("2027-05-01T02", "s"),
        np.timedelta64(1, "h"),
    )
    part = summarize(times, np.array([True, False]), np.array([True, True]))
    out = export.year_dict({"2027-05": part}, {2027: part}, "2027-05")
    assert out["default_month"] == "2027-05"
    assert out["months"][0]["month"] == "2027-05"
    assert out["months"][0]["pct_sun"] == pytest.approx(50.0)
    assert out["years"][0]["year"] == 2027
    assert out["years"][0]["pct_earth"] == pytest.approx(100.0)
    assert json.dumps(out)


def test_runs_are_half_open_and_cover_both_ends() -> None:
    up = np.array([True, True, False, False, True, False, True])
    assert export.runs(up) == [0, 2, 4, 5, 6, 7]
    assert export.runs(np.zeros(3, dtype=bool)) == []
    assert export.runs(np.ones(3, dtype=bool)) == [0, 3]


def test_overview_lists_every_site_as_plain_json() -> None:
    sun = np.array([True, False])
    earth = np.array([False, True])
    above = {2.0: np.array([False, False])}
    out = export.overview_dict(
        np.datetime64("2027-01-01T00", "s"), 2, 2.0, {"a": (sun, earth, above)}
    )
    assert out == {
        "start": "2027-01-01T00:00:00Z",
        "hours": 2,
        "obs_height_m": 2.0,
        "sites": {"a": {"sun": [0, 1], "earth": [1, 1], "earth_above": {"2": []}}},
    }
    assert json.dumps(out)


def test_run_steps_add_up_to_runs() -> None:
    up = np.array([False, True, True, False, False, False, True, False, True, True])
    assert export.runs(up) == [1, 3, 6, 7, 8, 10]
    assert export.run_steps(up) == [1, 2, 3, 1, 1, 2]
    assert list(np.cumsum(export.run_steps(up))) == export.runs(up)
    assert export.run_steps(np.zeros(4, bool)) == []
    assert export.run_steps(np.ones(4, bool)) == [0, 4]


def test_earth_sun_month_rounds_to_a_hundredth() -> None:
    out = export.earth_sun_month(np.array([23.4567]), np.array([-120.123]))
    assert out == {"sub_lat": [23.46], "sub_lon": [-120.12]}


def test_site_row_and_write_json(tmp_path: Path) -> None:
    path = tmp_path / "a" / "sites.json"
    export.write_json(path, [export.site_row(SITES[0])])
    [row] = json.loads(path.read_text())
    assert set(row) == {"id", "name", "lat", "lon", "source_url", "group"}


def test_site_row_adds_slope_and_nearby_map_when_known() -> None:
    row = export.site_row(SITES[0], 3.14159, 40, 5000.0)
    assert row["slope"] == {"deg": 3.1, "baseline_m": 40}
    assert row["nearby_half_m"] == 5000.0


def test_mast_heights_rows_list_every_height_and_year() -> None:
    summary = summarize(
        np.array(["2027-01-01T00", "2027-01-01T01"], dtype="datetime64[s]"),
        np.array([True, False]),
        np.array([True, True]),
    )
    rows = export.mast_heights_rows({2.0: {2027: summary}, 5.0: {2027: summary}})
    assert [row["obs_height_m"] for row in rows] == [2.0, 5.0]
    assert rows[0]["years"][0]["year"] == 2027
    assert rows[0]["years"][0]["pct_sun"] == 50.0


def test_committed_typescript_contract_is_current() -> None:
    assert WEB_CONTRACT_TS.read_text() == export.CONTRACT_TS


def test_range_dict_names_the_first_and_last_hour_and_year() -> None:
    start = np.datetime64("2026-01-01T00:00:00", "s")
    out = export.range_dict(start, 24 * 365, (2026,), "2026-05")
    assert out == {
        "start": "2026-01-01T00:00:00Z",
        "end": "2027-01-01T00:00:00Z",
        "hours": 8760,
        "first_year": 2026,
        "last_year": 2026,
        "default_month": "2026-05",
    }


def test_write_json_gz_holds_what_write_json_would(tmp_path: Path) -> None:
    content = {"a": [1, 2.5, "x"], "b": None}
    export.write_json(tmp_path / "plain.json", content)
    export.write_json_gz(tmp_path / "packed.json", content)
    packed = tmp_path / "packed.json.gz"
    assert gzip.decompress(packed.read_bytes()) == (tmp_path / "plain.json").read_bytes()
    first = packed.read_bytes()
    export.write_json_gz(tmp_path / "packed.json", content)
    assert packed.read_bytes() == first
