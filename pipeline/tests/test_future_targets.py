"""Future targets: placed by the Gazetteer's table, on a synthetic one."""

import pytest

from clps import future_targets


def _row(clean: str, name: str, lat: float, lon_0_360: float) -> dict[str, str]:
    return {
        "clean_name": clean,
        "name": name,
        "center_lat": str(lat),
        "center_lon": str(lon_0_360),
        "link": "http://planetarynames.wr.usgs.gov/Feature/1",
    }


ROWS = [
    _row("Reiner Gamma", "Reiner Gamma", 7.5, 301.0),
    _row("Mons Mouton", "Mons Mouton", -84.6, 31.0),
    _row("Schrodinger", "Schrödinger", -74.7, 132.9),
]


def test_each_target_takes_the_center_of_its_feature() -> None:
    content = future_targets.targets_dict(ROWS)
    by_id = {target["id"]: target for target in content["targets"]}
    assert set(by_id) == {"reiner-gamma", "mons-mouton", "schrodinger"}
    # East longitude from 0 to 360 becomes -180 to 180.
    assert by_id["reiner-gamma"]["lat"] == 7.5
    assert by_id["reiner-gamma"]["lon"] == -59.0
    assert by_id["mons-mouton"]["lon"] == 31.0
    # The feature is named as the Gazetteer writes it, and linked over https.
    assert by_id["schrodinger"]["feature"] == "Schrödinger"
    assert by_id["schrodinger"]["feature_url"].startswith("https://planetarynames.wr.usgs.gov/")


def test_every_target_cites_a_nasa_page_and_its_words() -> None:
    for target in future_targets.TARGETS:
        assert target.source_url.startswith(("https://science.nasa.gov/", "https://www.nasa.gov/"))
        assert target.name.split()[0] in target.says
        assert len(target.source_date) == 10


def test_a_feature_the_gazetteer_lacks_is_an_error() -> None:
    with pytest.raises(KeyError, match="Mons Mouton"):
        future_targets.targets_dict([row for row in ROWS if row["clean_name"] != "Mons Mouton"])
