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
from geonews.ingestion.connectors.article import same_site_links
from geonews.ingestion.connectors.base import respects_robots
from geonews.ingestion.connectors.sitemap_news import is_news_sitemap
from geonews.ingestion.fetcher import Fetcher
from geonews.pipeline.dates import parse_published

FEED_TYPES = ("application/rss+xml", "application/atom+xml")
COMMON_PATHS = ("/rss", "/rss.xml", "/rss/", "/feed", "/feed/")
MAX_AGE_DAYS = 14          # newest item older than this: the source is considered stale
_LINK = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
_TG_LINK = re.compile(r"""href\s*=\s*["']?(?:https?:)?//(?:t\.me|telegram\.me)/(?!s/|share|joinchat|addstickers|proxy|iv\b|\+)"""
                      r"""([A-Za-z][A-Za-z0-9_]{4,31})/?["'?#\s>]""", re.IGNORECASE)
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


def telegram_channels(page_html: str) -> list[str]:
    """Public Telegram channels a site links to (its official channel is usually in the header or footer)."""
    out: list[str] = []
    for name in _TG_LINK.findall(page_html):
        if name.lower() not in (n.lower() for n in out):
            out.append(name)
    return out


def derived_telegram(spec: dict, channel: str) -> dict:
    """Candidate for the Telegram channel an outlet links to from its own site: same home, same publisher."""
    return {k: v for k, v in spec.items() if k in ("languages", "country", "timezone", "home", "trust_tier")} | {
        "slug": f"{spec['slug']}-tg", "name": f"{spec['name']} — Telegram", "type": "telegram",
        "connector": "telegram_public", "access_model": "public_web", "url": f"https://t.me/s/{channel}",
        "poll_interval": 300, "trust_tier": spec.get("trust_tier", 2), "derived_from": spec["slug"],
        "config": {"publisher": spec["slug"]},
        "legal_note": f"official channel linked from {spec.get('homepage') or spec.get('url')}"}


@dataclass
class Check:
    slug: str
    ok: bool = False
    url: str | None = None
    entries: int = 0
    newest: datetime | None = None
    error: str | None = None
    connector: str = "rss"
    tried: list[str] = field(default_factory=list)
    telegram: list[str] = field(default_factory=list)     # channels the homepage links to

    @property
    def age_h(self) -> float | None:
        return None if self.newest is None else round((datetime.now(UTC) - self.newest).total_seconds() / 3600, 1)


SITEMAP_PATHS = ("/sitemap-news.xml", "/news-sitemap.xml", "/sitemap_news.xml", "/sitemaps/news.xml",
                 "/google-news-sitemap.xml", "/sitemap/news.xml")
CHECK_ARTICLES = 2   # page-based connectors fetch this many articles while checking (proves extraction works)


def _attempts(spec: dict, fetcher: Fetcher, robots: bool, chk: Check) -> list[tuple[str, str]]:
    """(connector, url) to try, best first: feeds, then news sitemaps, then the homepage as a news listing."""
    if spec.get("url"):
        return [(spec.get("connector", "rss"), spec["url"])]
    page = fetcher.get(spec["homepage"], respect_robots=robots)
    chk.telegram = telegram_channels(page.text)
    feeds = discover_feeds(page.text, page.url)
    feeds += [u for u, _ in same_site_links(page.text, page.url)
              if re.search(r"rss|feed|\.xml$", u, re.IGNORECASE) and u not in feeds][:4]   # "RSS" links on the page
    feeds += [u for u in (urljoin(page.url, p) for p in COMMON_PATHS) if u not in feeds]
    sitemaps = [u for u in fetcher.sitemaps(page.url) if is_news_sitemap(u)]
    sitemaps += [u for u in (urljoin(page.url, p) for p in SITEMAP_PATHS) if u not in sitemaps]
    sitemaps += [u for u in fetcher.sitemaps(page.url) if u not in sitemaps][:1]     # a general sitemap index
    return ([("rss", u) for u in feeds[:8]] + [("sitemap_news", u) for u in sitemaps[:6]]
            + [("html_list", page.url)])


def check_candidate(spec: dict, fetcher: Fetcher) -> Check:
    chk = Check(slug=spec["slug"])
    robots = respects_robots(spec)
    try:
        attempts = _attempts(spec, fetcher, robots, chk)
    except Exception as e:  # noqa: BLE001 - report every failure, never abort the whole run
        chk.error = f"homepage: {e}"
        return chk
    best: tuple[int, datetime | None, str, str] | None = None
    errors = []
    for kind, url in attempts:
        if best and best[3] != kind:
            break    # a feed beats a sitemap, a sitemap beats scraping the listing: stop at the first kind that works
        chk.tried.append(url)
        cfg = dict(spec.get("config") or {})
        if kind != "rss":
            cfg["max_new"] = CHECK_ARTICLES
        try:
            res = CONNECTORS[kind].fetch({**spec, "url": url, "config": cfg}, fetcher)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{url}: {e}")
            continue
        expected = (spec.get("config") or {}).get("expect_title")
        if expected and res.entries:
            title = (res.entries[0].extra or {}).get("channel_title") or ""
            if not any(x.casefold() in title.casefold() for x in ([expected] if isinstance(expected, str) else expected)):
                errors.append(f"{url}: channel is '{title}', expected {expected}")
                continue
        dates = [parse_published(e.published, spec.get("timezone"))[0] for e in res.entries if e.published]
        cand = (len(res.entries), max(dates) if dates else None, url, kind)
        if res.entries and (best is None or (cand[1] or datetime.min.replace(tzinfo=UTC))
                            > (best[1] or datetime.min.replace(tzinfo=UTC))):
            best = cand
    if best is None:
        chk.error = "; ".join(errors)[-400:] or "no entries"
        return chk
    chk.entries, chk.newest, chk.url, chk.connector = best
    stale = chk.newest is not None and (datetime.now(UTC) - chk.newest).days > MAX_AGE_DAYS
    chk.ok = not stale
    chk.error = f"stale: newest item {chk.age_h} h old" if stale else None
    return chk


def verified_entry(spec: dict, chk: Check) -> dict:
    """Registry entry for a verified candidate (homepage replaced by the working URL and connector)."""
    out = {k: v for k, v in spec.items() if k not in ("homepage", "enabled")}
    out["url"] = chk.url
    out["connector"] = chk.connector
    if chk.connector != "rss":
        out["access_model"] = "public_web"
    out["enabled"] = True
    robots = "robots.txt ok" if respects_robots(spec) else "robots.txt not applied (owner's decision)"
    note = f"verified {datetime.now(UTC):%Y-%m-%d} via {chk.connector}: {robots}, newest {chk.age_h} h ago"
    out["legal_note"] = f"{spec['legal_note']}; {note}" if spec.get("legal_note") else note
    return out
