"""Download NAIF SPICE generic kernels into the cache and load them.

Kernel set (see CLAUDE.md §3.2 and REFERENCES.md): leapseconds, DE440 planetary ephemeris (short
version), the DE421-based lunar orientation PCK with its frames kernel (gives frame ``MOON_ME``, the
mean-Earth/polar-axis frame LOLA products use), and pck00011 for body radii.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import httpx
import spiceypy

from clps.config import KERNEL_DIR

NAIF_BASE_URL = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"

#: Kernel paths relative to ``NAIF_BASE_URL``, in load order.
KERNELS: tuple[str, ...] = (
    "lsk/naif0012.tls",
    "spk/planets/de440s.bsp",
    "pck/moon_pa_de421_1900-2050.bpc",
    "fk/satellites/moon_080317.tf",
    "pck/pck00011.tpc",
)


def kernel_url(rel_path: str) -> str:
    """Full NAIF URL for a kernel path relative to the generic_kernels root."""
    return f"{NAIF_BASE_URL}/{rel_path}"


def local_path(rel_path: str, kernel_dir: Path = KERNEL_DIR) -> Path:
    """Local cache path for a kernel (flat: only the file name is kept)."""
    return kernel_dir / Path(rel_path).name


def missing_kernels(kernels: Iterable[str] = KERNELS, kernel_dir: Path = KERNEL_DIR) -> list[str]:
    """Kernels not yet present (non-empty) in ``kernel_dir``."""
    return [k for k in kernels if not _is_present(local_path(k, kernel_dir))]


def download_kernels(
    kernels: Iterable[str] = KERNELS,
    kernel_dir: Path = KERNEL_DIR,
    client: httpx.Client | None = None,
) -> list[Path]:
    """Download any missing kernels into ``kernel_dir``; return the paths that were downloaded.

    Files already present are skipped. Each file is written to a ``.part`` file first and renamed
    when complete, so an interrupted download is never mistaken for a finished one.
    """
    kernel_dir.mkdir(parents=True, exist_ok=True)
    todo = missing_kernels(kernels, kernel_dir)
    own_client = client is None
    http = client or httpx.Client(timeout=120.0, follow_redirects=True)
    downloaded: list[Path] = []
    try:
        for rel in todo:
            dest = local_path(rel, kernel_dir)
            part = dest.with_name(dest.name + ".part")
            with http.stream("GET", kernel_url(rel)) as resp:
                resp.raise_for_status()
                with part.open("wb") as fh:
                    for chunk in resp.iter_bytes():
                        fh.write(chunk)
            part.rename(dest)
            downloaded.append(dest)
    finally:
        if own_client:
            http.close()
    return downloaded


def load_kernels(kernels: Iterable[str] = KERNELS, kernel_dir: Path = KERNEL_DIR) -> None:
    """Download missing kernels, then ``furnsh`` all of them (in order) into the SPICE pool."""
    kernels = tuple(kernels)
    download_kernels(kernels, kernel_dir)
    for rel in kernels:
        spiceypy.furnsh(str(local_path(rel, kernel_dir)))


def _is_present(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0
