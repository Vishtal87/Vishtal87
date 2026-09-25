"""Needs the local devstand (skipped otherwise): robots.txt is honoured."""
import httpx
import pytest

from geonews.ingestion.fetcher import FetchError, Fetcher

BASE = "http://127.0.0.1:8090"


@pytest.fixture(scope="module")
def fetcher():
    try:
        httpx.get(f"{BASE}/robots.txt", timeout=2)
    except httpx.HTTPError:
        pytest.skip("devstand not running")
    f = Fetcher(min_interval_s=0)
    yield f
    f.close()


def test_robots_disallow_is_respected(fetcher):
    assert fetcher.allowed(f"{BASE}/rss/demo-kuban-news.xml")
    assert not fetcher.allowed(f"{BASE}/private/admin")
    with pytest.raises(FetchError, match="robots"):
        fetcher.get(f"{BASE}/private/admin")


def test_http_errors_become_source_errors_not_crashes(fetcher):
    with pytest.raises(FetchError, match="HTTP 404"):
        fetcher.get(f"{BASE}/rss/does-not-exist/x")
