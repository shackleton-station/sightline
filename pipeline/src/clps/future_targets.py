"""Places NASA names for landings still to come, placed by the IAU Gazetteer's center point.

NASA's pages name these places and give no coordinates (read 2026-11-13), so each is an
*approximate region*: the Gazetteer's center point of the named feature, never a landing site.
Only places whose NASA name is itself an IAU feature are listed; a region named for a rim, a plain
or a peak beside a feature is left out, because the feature's center is not that place.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from clps.features import east_lon


@dataclass(frozen=True)
class FutureTarget:
    """One named place: who is going, NASA's words, and the Gazetteer feature that places it."""

    id: str
    name: str
    #: The feature's ``clean_name`` in the Gazetteer's table.
    feature: str
    #: Who NASA says is going there, short enough for a list.
    who: str
    #: NASA's own sentence naming the place, and the page it is on with the page's date.
    says: str
    source_url: str
    source_date: str


TARGETS: tuple[FutureTarget, ...] = (
    FutureTarget(
        id="reiner-gamma",
        name="Reiner Gamma",
        feature="Reiner Gamma",
        who="CLPS IM-3",
        says=(
            "Intuitive Machines' Nova-C lander will deliver four NASA CLPS science payloads to "
            "Reiner Gamma on the lunar nearside in 2026."
        ),
        source_url="https://science.nasa.gov/lunar-science/clps-deliveries/cp-11/",
        source_date="2026-11-02",
    ),
    FutureTarget(
        id="mons-mouton",
        name="Mons Mouton",
        feature="Mons Mouton",
        who="CLPS IM-4, Artemis III",
        says=(
            "The Intuitive Machines Nova-C lander (IM-4) will deliver six NASA CLPS science "
            "payloads to Mons Mouton."
        ),
        source_url="https://science.nasa.gov/lunar-science/clps-deliveries/cp-22-science/",
        source_date="2026-06-10",
    ),
    FutureTarget(
        id="schrodinger",
        name="Schrödinger basin",
        feature="Schrodinger",
        who="CLPS CS-11",
        says=(
            "A lunar lander to be determined will deliver three NASA CLPS payloads to "
            "Schrödinger Basin."
        ),
        source_url="https://science.nasa.gov/lunar-science/clps-deliveries/cs-11/",
        source_date="2026-10-23",
    ),
)

#: NASA's list of Artemis III candidate regions, which names Mons Mouton among nine (2024-10-28).
ARTEMIS_III_URL = (
    "https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/"
)


def targets_dict(rows: list[dict[str, str]]) -> dict[str, Any]:
    """The targets with the Gazetteer's center for each (degrees, east-positive, -180 to 180).

    ``rows`` is the Gazetteer's table (``features.read_dbf``). A missing feature is an error.
    """
    by_name = {row["clean_name"]: row for row in rows}
    targets = []
    for target in TARGETS:
        row = by_name.get(target.feature)
        if row is None:
            raise KeyError(f"the Gazetteer has no feature named {target.feature!r}")
        targets.append(
            {
                "id": target.id,
                "name": target.name,
                "who": target.who,
                "says": target.says,
                "source_url": target.source_url,
                "source_date": target.source_date,
                "feature": row["name"],
                "feature_url": row["link"].replace("http://", "https://"),
                "lat": round(float(row["center_lat"]), 4),
                "lon": round(east_lon(float(row["center_lon"])), 4),
            }
        )
    return {"artemis_iii_url": ARTEMIS_III_URL, "targets": targets}
