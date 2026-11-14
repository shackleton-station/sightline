"""Smoke test: the package imports and its core dependencies are installed."""

import clps


def test_package_imports() -> None:
    import numpy  # noqa: F401
    import pyproj  # noqa: F401
    import rasterio  # noqa: F401
    import spiceypy  # noqa: F401

    assert clps.__version__
