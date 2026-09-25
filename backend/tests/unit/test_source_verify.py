"""Candidate verification: feed autodiscovery, robots.txt, freshness, verified registry entry."""
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime

import httpx

from geonews.ingestion.fetcher import Fetcher
from geonews.ingestion.verify import check_candidate, discover_feeds, verified_entry


def _rss(age: timedelta) -> str:
    when = format_datetime(datetime.now(UTC) - age)
    return (f'<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>'
            f'<item><title>Пожар в Динской</title><link>https://news.test/1</link><guid>1</guid>'
            f'<pubDate>{when}</pubDate></item></channel></rss>')


def _fetcher(pages: dict[str, tuple[int, str]]) -> Fetcher:
    def handler(request: httpx.Request) -> httpx.Response:
        status, body = pages.get(request.url.path, (404, ""))
        return httpx.Response(status, text=body)

    f = Fetcher(min_interval_s=0)
    f.client = httpx.Client(transport=httpx.MockTransport(handler))
    return f


HOME = ('<html><head><link rel="stylesheet" href="/s.css">'
        '<link rel="alternate" type="application/rss+xml" title="Новости" href="/export/news.rss">'
        "<link type='application/atom+xml' rel='alternate' href='https://news.test/atom.xml'></head></html>")


def test_autodiscovery_reads_rss_and_atom_links():
    assert discover_feeds(HOME, "https://news.test/") == ["https://news.test/export/news.rss", "https://news.test/atom.xml"]


def test_homepage_candidate_is_verified_with_discovered_feed():
    f = _fetcher({"/": (200, HOME), "/export/news.rss": (200, _rss(timedelta(hours=2))), "/atom.xml": (500, "")})
    spec = {"slug": "kuban-test", "name": "Test", "type": "regional_media", "homepage": "https://news.test/",
            "access_model": "public_feed", "languages": ["ru"]}
    chk = check_candidate(spec, f)
    assert chk.ok and chk.url == "https://news.test/export/news.rss" and chk.entries == 1 and chk.age_h < 3
    entry = verified_entry(spec, chk)
    assert entry["enabled"] is True and entry["url"] == chk.url and "homepage" not in entry
    assert "robots.txt ok" in entry["legal_note"]


def test_robots_disallow_and_stale_feed_fail():
    blocked = _fetcher({"/robots.txt": (200, "User-agent: *\nDisallow: /\n"), "/rss": (200, _rss(timedelta(hours=1)))})
    chk = check_candidate({"slug": "blocked", "url": "https://news.test/rss"}, blocked)
    assert not chk.ok and "robots" in chk.error
    stale = _fetcher({"/rss": (200, _rss(timedelta(days=40)))})
    chk = check_candidate({"slug": "stale", "url": "https://news.test/rss"}, stale)
    assert not chk.ok and chk.error.startswith("stale")
