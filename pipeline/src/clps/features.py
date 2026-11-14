"""Named places on the Moon for the globe: big IAU features, the smaller ones round the south pole
where the app's own sites are, and past landings for orientation.

Names and centers come from the IAU Gazetteer of Planetary Nomenclature (USGS points shapefile).
Its longitudes run 0–360° east; ours run -180–180°. Nothing here is used in any calculation.
"""

from __future__ import annotations

import struct
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

GAZETTEER_URL = (
    "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip"
)
GAZETTEER_SIZE_BYTES = 23_845_070
GAZETTEER_DBF = "MOON_nomenclature_center_pts.dbf"
NSSDC_APOLLO_URL = "https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html"

#: Feature types shown on the globe, by gazetteer code.
KIND_BY_CODE: dict[str, str] = {
    "ME": "mare",
    "OC": "mare",
    "AA": "crater",
    "VA": "valley",
    "MO": "mountains",
}
#: Only features at least this wide (km), so the globe isn't crowded. Maria are always kept.
MIN_DIAMETER_KM = 300.0
#: Round the south pole smaller features are kept too: every adopted crater and mountain whose
#: centre is at or south of this latitude (degrees) and that is at least this wide (km). The cut
#: keeps Shackleton (21 km), de Gerlache, Haworth, Shoemaker, Faustini, Sverdrup, Nobile and
#: Malapert, down to Spudis (13 km), and leaves out the craters of a few km named for one landing.
#: The page prints one of these only when the view is close enough for it to have room.
POLAR_MAX_LAT_DEG = -80.0
POLAR_MIN_DIAMETER_KM = 10.0
POLAR_KINDS = ("crater", "mountains")

#: Landing sites the IAU has named, shown under the mission's name. Sites the app can already
#: analyze (Apollo 11, Chang'e 4, Chandrayaan-3) are left out so they don't appear twice.
IAU_LANDINGS: dict[str, str] = {
    "Guang Han Gong": "Chang'e 3",
    "Statio Tianchuan": "Chang'e 5",
    "Statio Tianjiang": "Chang'e 6",
}


@dataclass(frozen=True)
class Landing:
    """A past landing from a published table, in degrees (planetocentric, MOON_ME)."""

    name: str
    lat_deg: float
    lon_deg: float
    source_url: str


#: Lunar Module positions from NSSDC's table (Wagner et al. 2017). Apollo 11, 15 and 17 are sites
#: the app analyzes, so they're not repeated here.
APOLLO_LANDINGS = (
    Landing("Apollo 12", -3.0128, -23.4219, NSSDC_APOLLO_URL),
    Landing("Apollo 14", -3.64589, -17.47194, NSSDC_APOLLO_URL),
    Landing("Apollo 16", -8.9734, 15.5011, NSSDC_APOLLO_URL),
)


def read_dbf(path: Path) -> Iterator[dict[str, str]]:
    """Yield each live record of a dBASE III table as text fields (stripped)."""
    with path.open("rb") as fh:
        count, header_len, record_len = struct.unpack("<4xIHH20x", fh.read(32))
        fields: list[tuple[str, int]] = []
        while True:
            descriptor = fh.read(32)
            if descriptor[0] == 0x0D:
                break
            fields.append((descriptor[:11].split(b"\0")[0].decode("ascii"), descriptor[16]))
        fh.seek(header_len)
        for _ in range(count):
            record = fh.read(record_len)
            if record[:1] == b"*":  # deleted
                continue
            row: dict[str, str] = {}
            position = 1
            for name, length in fields:
                row[name] = record[position : position + length].decode("utf-8", "replace").strip()
                position += length
            yield row


def east_lon(lon_0_360: float) -> float:
    """Longitude in -180–180° east from one in 0–360° east."""
    return ((lon_0_360 + 180.0) % 360.0) - 180.0


def select_names(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Adopted features of the kinds we show, widest first, as JSON-ready dicts."""
    names = []
    for row in rows:
        kind = KIND_BY_CODE.get(row["code"])
        if kind is None or not row["approval"].startswith("Adopted"):
            continue
        diameter_km = float(row["diameter"])
        polar = (
            kind in POLAR_KINDS
            and float(row["center_lat"]) <= POLAR_MAX_LAT_DEG
            and diameter_km >= POLAR_MIN_DIAMETER_KM
        )
        if kind != "mare" and diameter_km < MIN_DIAMETER_KM and not polar:
            continue
        names.append(
            {
                # The IAU's own spelling ("Schrödinger", "Idel'son") where the table has it.
                "name": row.get("name") or row["clean_name"],
                "kind": kind,
                "lat": round(float(row["center_lat"]), 3),
                "lon": round(east_lon(float(row["center_lon"])), 3),
                "diameter_km": round(diameter_km),
                "source_url": row["link"].replace("http://", "https://"),
            }
        )
    return sorted(names, key=lambda n: -n["diameter_km"])


def select_landings(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Past landings: Apollo from NSSDC, then the IAU-named sites in ``IAU_LANDINGS``."""
    landings = [
        {"name": a.name, "lat": a.lat_deg, "lon": a.lon_deg, "source_url": a.source_url}
        for a in APOLLO_LANDINGS
    ]
    by_name = {row["clean_name"]: row for row in rows}
    for iau_name, mission in IAU_LANDINGS.items():
        row = by_name.get(iau_name)
        if row is None:
            raise KeyError(f"{iau_name} is missing from the gazetteer")
        landings.append(
            {
                "name": mission,
                "lat": round(float(row["center_lat"]), 4),
                "lon": round(east_lon(float(row["center_lon"])), 4),
                "source_url": row["link"].replace("http://", "https://"),
            }
        )
    return landings


def features_dict(rows: list[dict[str, str]]) -> dict[str, Any]:
    """The ``features.json`` content."""
    return {
        "source": "IAU Gazetteer of Planetary Nomenclature (USGS); NASA NSSDC for Apollo",
        "names": select_names(rows),
        "landings": select_landings(rows),
    }
