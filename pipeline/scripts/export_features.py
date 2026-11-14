"""Write web/public/data/features.json: Moon place names for the globe.

Usage (from pipeline/): uv run python scripts/export_features.py
Downloads the IAU gazetteer points (~24 MB) into cache/names/ once.
Also runs at the end of run_all.py.
"""

from __future__ import annotations

import zipfile

from clps import config, dem, export, features

NAMES_DIR = config.CACHE_DIR / "names"


def build_features() -> None:
    """Download the gazetteer if needed and write ``features.json``."""
    archive = dem.download_raster(NAMES_DIR, features.GAZETTEER_URL, features.GAZETTEER_SIZE_BYTES)
    table = NAMES_DIR / features.GAZETTEER_DBF
    if not table.is_file():
        with zipfile.ZipFile(archive) as zf:
            zf.extract(features.GAZETTEER_DBF, NAMES_DIR)
    rows = list(features.read_dbf(table))
    content = features.features_dict(rows)
    export.write_json(config.WEB_DATA_DIR / "features.json", content)
    print(f"features.json: {len(content['names'])} names, {len(content['landings'])} landings")


if __name__ == "__main__":
    build_features()
