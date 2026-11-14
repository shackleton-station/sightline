"""Kernel download logic, tested offline with a mock HTTP transport."""

from pathlib import Path

import httpx
import pytest

from clps import kernels


def _mock_client(seen: list[str]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, content=b"KPL/fake kernel")

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_kernel_url_and_local_path(tmp_path: Path) -> None:
    rel = "fk/satellites/moon_080317.tf"
    assert kernels.kernel_url(rel) == (
        "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf"
    )
    assert kernels.local_path(rel, tmp_path) == tmp_path / "moon_080317.tf"


def test_downloads_only_missing_kernels(tmp_path: Path) -> None:
    (tmp_path / "naif0012.tls").write_text("already here")
    seen: list[str] = []
    rels = ["lsk/naif0012.tls", "pck/pck00011.tpc"]

    got = kernels.download_kernels(rels, tmp_path, client=_mock_client(seen))

    assert got == [tmp_path / "pck00011.tpc"]
    assert seen == [kernels.kernel_url("pck/pck00011.tpc")]
    assert (tmp_path / "naif0012.tls").read_text() == "already here"
    assert not list(tmp_path.glob("*.part"))


def test_empty_file_counts_as_missing(tmp_path: Path) -> None:
    (tmp_path / "pck00011.tpc").touch()
    assert kernels.missing_kernels(["pck/pck00011.tpc"], tmp_path) == ["pck/pck00011.tpc"]


def test_http_error_leaves_no_final_file(tmp_path: Path) -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404)))
    with pytest.raises(httpx.HTTPStatusError):
        kernels.download_kernels(["pck/pck00011.tpc"], tmp_path, client=client)
    assert not (tmp_path / "pck00011.tpc").exists()
