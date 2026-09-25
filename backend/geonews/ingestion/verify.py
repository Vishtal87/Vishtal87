"""Verify candidate sources before enabling them: reachable, allowed by robots.txt, parseable, fresh.

A candidate is a registry entry with either `url` (feed / channel page / listing) or only `homepage`: then feeds are
discovered via RSS/Atom autodiscovery (`<link rel="alternate" type="application/rss+xml">`) and, failing that,
a few conventional paths. The same connectors and polite fetcher as ingestion are used, so a candidate that
passes here behaves the same in production. Output: a report and a registry file of verified sources.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.parse import urljoin, urlsplit

from geonews.ingestion.connectors import CONNECTORS
from geonews.ingestion.fetcher import Fetcher
from geonews.pipeline.dates import parse_published

FEED_TYPES = ("application/rss+xml", "application/atom+xml")
COMMON_PATHS = ("/rss", "/rss.xml", "/rss/", "/feed", "/feed/")
MAX_AGE_DAYS = 14          # newest item older than this: the source is considered stale
_LINK = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
_ATTR = re.compile(r"""([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")


def discover_feeds(page_html: str, base_url: str) -> list[str]:
    """RSS/Atom autodiscovery: feed URLs advertised by a web page, in page order, http(s) only."""
    out: list[str] = []
    for tag in _LINK.findall(page_html):
        attrs = {k.lower(): html.unescape(a or b or c) for k, a, b, c in _ATTR.findall(tag)}
        if "alternate" not in attrs.get("rel", "").lower().split() or attrs.get("type", "").lower() not in FEED_TYPES:
            continue
        url = urljoin(base_url, attrs.get("href", ""))
        if urlsplit(url).scheme in ("http", "https") and url not in out:
            out.append(url)
    return out


@dataclass
class Check:
    slug: str
    ok: bool = False
    url: str | None = None
    entries: int = 0
    newest: datetime | None = None
    error: str | None = None
    tried: list[str] = field(default_factory=list)

    @property
    def age_h(self) -> float | None:
        return None if self.newest is None else round((datetime.now(UTC) - self.newest).total_seconds() / 3600, 1)


def check_candidate(spec: dict, fetcher: Fetcher) -> Check:
    chk = Check(slug=spec["slug"])
    connector = CONNECTORS[spec.get("connector", "rss")]
    urls = [spec["url"]] if spec.get("url") else []
    if not urls and spec.get("homepage"):
        try:
            page = fetcher.get(spec["homepage"])
        except Exception as e:  # noqa: BLE001 - report every failure, never abort the whole run
            chk.error = f"homepage: {e}"
            return chk
        urls = discover_feeds(page.text, page.url) or [urljoin(page.url, p) for p in COMMON_PATHS]
    best: tuple[int, datetime | None, str] | None = None
    errors = []
    for url in urls[:6]:
        chk.tried.append(url)
        try:
            res = connector.fetch({**spec, "url": url, "config": spec.get("config") or {}}, fetcher)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{url}: {e}")
            continue
        dates = [parse_published(e.published, spec.get("timezone"))[0] for e in res.entries if e.published]
        cand = (len(res.entries), max(dates) if dates else None, url)
        if res.entries and (best is None or (cand[1] or datetime.min.replace(tzinfo=UTC))
                            > (best[1] or datetime.min.replace(tzinfo=UTC))):
            best = cand
    if best is None:
        chk.error = "; ".join(errors)[:400] or "no entries"
        return chk
    chk.entries, chk.newest, chk.url = best
    stale = chk.newest is not None and (datetime.now(UTC) - chk.newest).days > MAX_AGE_DAYS
    chk.ok = not stale
    chk.error = f"stale: newest item {chk.age_h} h old" if stale else None
    return chk


def verified_entry(spec: dict, chk: Check) -> dict:
    """Registry entry for a verified candidate (homepage replaced by the working feed URL)."""
    out = {k: v for k, v in spec.items() if k not in ("homepage", "enabled")}
    out["url"] = chk.url
    out["enabled"] = True
    note = f"verified {datetime.now(UTC):%Y-%m-%d}: robots.txt ok, {chk.entries} items, newest {chk.age_h} h ago"
    out["legal_note"] = f"{spec['legal_note']}; {note}" if spec.get("legal_note") else note
    return out
