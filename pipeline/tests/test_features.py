"""Named places for the globe, from a tiny synthetic gazetteer table."""

import struct
from pathlib import Path

import pytest

from clps import features

FIELDS = [
    ("clean_name", 30),
    ("diameter", 12),
    ("center_lon", 12),
    ("center_lat", 12),
    ("code", 2),
    ("approval", 20),
    ("link", 50),
]


def write_dbf(path: Path, rows: list[dict[str, str]], deleted: int | None = None) -> None:
    record_len = 1 + sum(length for _, length in FIELDS)
    header_len = 32 + 32 * len(FIELDS) + 1
    out = bytearray(struct.pack("<BBBBIHH20x", 3, 126, 1, 1, len(rows), header_len, record_len))
    for name, length in FIELDS:
        out += name.encode().ljust(11, b"\0") + b"C" + b"\0" * 4 + bytes([length, 0]) + b"\0" * 14
    out += b"\x0d"
    for index, row in enumerate(rows):
        out += b"*" if index == deleted else b" "
        for name, length in FIELDS:
            out += row.get(name, "").encode().ljust(length)[:length]
    path.write_bytes(bytes(out))


def row(
    name: str, code: str, diameter: float, lon: float, lat: float, approval: str = "Adopted by IAU"
) -> dict[str, str]:
    return {
        "clean_name": name,
        "code": code,
        "diameter": str(diameter),
        "center_lon": str(lon),
        "center_lat": str(lat),
        "approval": approval,
        "link": f"http://planetarynames.wr.usgs.gov/Feature/{len(name)}",
    }


def test_read_dbf_skips_deleted_records(tmp_path: Path) -> None:
    path = tmp_path / "t.dbf"
    write_dbf(path, [row("A", "ME", 1, 0, 0), row("B", "ME", 1, 0, 0)], deleted=0)
    names = [r["clean_name"] for r in features.read_dbf(path)]
    assert names == ["B"]


@pytest.mark.parametrize(
    ("lon", "expected"), [(0.0, 0.0), (90.0, 90.0), (270.0, -90.0), (359.5, -0.5)]
)
def test_east_lon_wraps_to_plus_minus_180(lon: float, expected: float) -> None:
    assert features.east_lon(lon) == pytest.approx(expected)


def test_select_names_keeps_big_adopted_features_widest_first() -> None:
    rows = [
        row("Mare Small", "ME", 50, 10, 5),  # maria are kept whatever their size
        row("Big Basin", "AA", 500, 231.3, 1.4),
        row("Little Crater", "AA", 20, 10, 10),  # too small
        row("Rima Long", "RI", 900, 10, 10),  # kind not shown
        row("Proposed", "AA", 900, 10, 10, approval="Dropped"),
    ]
    names = features.select_names(rows)
    assert [n["name"] for n in names] == ["Big Basin", "Mare Small"]
    assert names[0]["kind"] == "crater"
    assert names[0]["lon"] == pytest.approx(-128.7)
    assert names[0]["source_url"].startswith("https://")


def test_select_names_keeps_smaller_craters_and_mountains_round_the_south_pole() -> None:
    rows = [
        row("Shackleton", "AA", 20.9, 129.78, -89.67),
        row("Mons Mouton", "MO", 130, 31, -84.6),
        row("Spudis", "AA", 13, 275.39, -89.51),
        row("Marvin", "AA", 4.6, 272.22, -89.13),  # under the polar cut
        row("Moretus", "AA", 114, 354.1, -70.6),  # not far enough south
        row("Rupes Polar", "RU", 80, 10, -85),  # kind not shown
        row("Polar North", "AA", 50, 10, 88),  # the north pole is not ours
    ]
    names = features.select_names(rows)
    assert [n["name"] for n in names] == ["Mons Mouton", "Shackleton", "Spudis"]
    assert [n["kind"] for n in names] == ["mountains", "crater", "crater"]
    assert names[2]["lon"] == pytest.approx(-84.61)


def test_select_names_uses_the_iau_spelling_when_the_table_has_it() -> None:
    plain = row("Schrodinger", "AA", 316, 132.9, -74.7)
    spelled = {**plain, "name": "Schrödinger"}
    assert features.select_names([plain])[0]["name"] == "Schrodinger"
    assert features.select_names([spelled])[0]["name"] == "Schrödinger"


def test_select_landings_uses_mission_names_and_fails_loudly_when_missing() -> None:
    rows = [row(iau, "ST", 0.01, 340.5, 44.1) for iau in features.IAU_LANDINGS]
    landings = features.select_landings(rows)
    names = [landing["name"] for landing in landings]
    assert names[:3] == ["Apollo 12", "Apollo 14", "Apollo 16"]
    assert "Chang'e 3" in names
    assert all(-180 <= landing["lon"] <= 180 for landing in landings)
    with pytest.raises(KeyError):
        features.select_landings(rows[1:])
