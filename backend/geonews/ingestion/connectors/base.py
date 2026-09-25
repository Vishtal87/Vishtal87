"""Connector contract. A connector turns one source (row from `source`) into RawEntry items."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from geonews.ingestion.entry import RawEntry
from geonews.ingestion.fetcher import Fetcher


@dataclass
class FetchResult:
    entries: list[RawEntry] = field(default_factory=list)
    etag: str | None = None
    last_modified: str | None = None
    not_modified: bool = False


class Connector(Protocol):
    name: str
    access_model: str  # public_feed | official_api | public_web

    def fetch(self, source: dict, fetcher: Fetcher) -> FetchResult: ...


def respects_robots(source: dict) -> bool:
    """robots.txt is obeyed unless the owner switched it off for this one source: config {respect_robots: false}."""
    return (source.get("config") or {}).get("respect_robots", True) is not False
