"""Download GeoNames dumps (CC-BY 4.0) into the dump directory.

Same layout as scripts/fetch_geonames.sh, but pure Python: the backend image has no curl/unzip, and
`geonews import-geonames RU --download` must work inside the container on a server.
Files: countryInfo.txt, admin1CodesASCII.txt, admin2Codes.txt, CC.txt, alternatenames_CC.txt.
Existing files are kept (delete them to refresh); every write goes through a temp file + rename.
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from geonews.config import settings

log = logging.getLogger(__name__)
BASE = "https://download.geonames.org/export/dump"
META = ("countryInfo.txt", "admin1CodesASCII.txt", "admin2Codes.txt")


def fetch_geonames(dest: Path, countries: list[str], base: str = BASE, client: httpx.Client | None = None) -> list[Path]:
    dest.mkdir(parents=True, exist_ok=True)
    c = client or httpx.Client(timeout=300, follow_redirects=True, trust_env=True,
                               headers={"User-Agent": settings.user_agent})
    try:
        return _fetch_all(c, base, dest, countries, [])
    except httpx.HTTPError as e:
        raise SystemExit(f"GeoNames download failed ({type(e).__name__}: {e}). Check network access to "
                         f"{urlsplit(base).netloc}; files already downloaded are kept.") from e
    finally:
        if client is None:
            c.close()


def _fetch_all(c: httpx.Client, base: str, dest: Path, countries: list[str], out: list[Path]) -> list[Path]:
    for name in META:
        out.append(_download(c, f"{base}/{name}", dest / name))
    for cc in countries:
        out.append(_zip_member(c, f"{base}/{cc}.zip", f"{cc}.txt", dest / f"{cc}.txt"))
        if cc != "allCountries":  # language-tagged names, used for multilingual search and display
            out.append(_zip_member(c, f"{base}/alternatenames/{cc}.zip", f"{cc}.txt", dest / f"alternatenames_{cc}.txt"))
    return out


def _stream_to_temp(c: httpx.Client, url: str, dest_dir: Path) -> Path:
    fd, tmp = tempfile.mkstemp(dir=dest_dir, suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f, c.stream("GET", url) as r:
            r.raise_for_status()
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return Path(tmp)


def _download(c: httpx.Client, url: str, target: Path) -> Path:
    if target.exists():
        return target
    log.info("downloading %s", url)
    _stream_to_temp(c, url, target.parent).replace(target)
    return target


def _zip_member(c: httpx.Client, url: str, member: str, target: Path) -> Path:
    if target.exists():
        return target
    log.info("downloading %s", url)
    archive = _stream_to_temp(c, url, target.parent)
    try:
        with zipfile.ZipFile(archive) as z, z.open(member) as src:
            fd, tmp = tempfile.mkstemp(dir=target.parent, suffix=".part")
            try:
                with os.fdopen(fd, "wb") as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
                Path(tmp).replace(target)
            except BaseException:
                Path(tmp).unlink(missing_ok=True)
                raise
    finally:
        archive.unlink(missing_ok=True)
    return target
