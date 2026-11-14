"""Write web/public/data/future-targets.json: places NASA names for landings still to come.

Each is placed at the IAU Gazetteer's center for the named feature (``clps.future_targets``).

Usage (from pipeline/): uv run python scripts/export_future_targets.py
Needs the Gazetteer's table in cache/names/ (``scripts/export_features.py`` downloads it).
"""

from __future__ import annotations

from clps import config, export, features, future_targets

NAMES_DIR = config.CACHE_DIR / "names"


def build_future_targets() -> None:
    """Read the Gazetteer and write ``future-targets.json``."""
    rows = list(features.read_dbf(NAMES_DIR / features.GAZETTEER_DBF))
    content = future_targets.targets_dict(rows)
    export.write_json(config.WEB_DATA_DIR / "future-targets.json", content)
    for target in content["targets"]:
        print(f"{target['name']}: {target['lat']}, {target['lon']} ({target['feature']})")


if __name__ == "__main__":
    build_future_targets()
