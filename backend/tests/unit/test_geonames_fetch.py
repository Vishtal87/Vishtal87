"""GeoNames downloader: file layout of scripts/fetch_geonames.sh, idempotent, no partial files on failure."""
import io
import zipfile

import httpx
import pytest

from geonews.gazetteer.geonames_fetch import fetch_geonames


def _zip(name: str, text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(name, text)
    return buf.getvalue()


def _client(requests: list[str], fail: str | None = None) -> httpx.Client:
    files = {
        "/countryInfo.txt": b"RU\tRUS\n", "/admin1CodesASCII.txt": b"RU.38\tKrasnodar\n", "/admin2Codes.txt": b"",
        "/RU.zip": _zip("RU.txt", "1\tDinskaya\n"), "/alternatenames/RU.zip": _zip("RU.txt", "9\t1\tru\tДинская\n"),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        if request.url.path == fail:
            return httpx.Response(503)
        return httpx.Response(200, content=files[request.url.path])

    return httpx.Client(transport=httpx.MockTransport(handler), base_url="https://gn.test")


def test_layout_and_idempotence(tmp_path):
    seen: list[str] = []
    out = fetch_geonames(tmp_path, ["RU"], base="https://gn.test", client=_client(seen))
    assert sorted(p.name for p in out) == sorted(
        ["countryInfo.txt", "admin1CodesASCII.txt", "admin2Codes.txt", "RU.txt", "alternatenames_RU.txt"])
    assert (tmp_path / "RU.txt").read_text() == "1\tDinskaya\n"
    assert "Динская" in (tmp_path / "alternatenames_RU.txt").read_text()
    assert not list(tmp_path.glob("*.part")) and not list(tmp_path.glob("*.zip"))
    again: list[str] = []
    fetch_geonames(tmp_path, ["RU"], base="https://gn.test", client=_client(again))
    assert again == []  # everything already present


def test_failed_download_leaves_no_partial_files(tmp_path):
    with pytest.raises(SystemExit, match="download failed"):
        fetch_geonames(tmp_path, ["RU"], base="https://gn.test", client=_client([], fail="/RU.zip"))
    assert not (tmp_path / "RU.txt").exists()
    assert not list(tmp_path.glob("*.part"))
