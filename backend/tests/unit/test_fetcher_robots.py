"""robots.txt semantics (RFC 9309): 4xx = no rules, 5xx / unreachable = assume full disallow."""
import httpx
import pytest

from geonews.ingestion.fetcher import Fetcher, FetchError


def _fetcher(robots_status: int | None, robots_body: str = "") -> Fetcher:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            if robots_status is None:
                raise httpx.ConnectError("unreachable", request=request)
            return httpx.Response(robots_status, text=robots_body)
        return httpx.Response(200, text="<rss/>")

    f = Fetcher(min_interval_s=0)
    f.client = httpx.Client(transport=httpx.MockTransport(handler))
    return f


def test_missing_robots_allows():
    assert _fetcher(404).allowed("https://example.org/feed.xml")


@pytest.mark.parametrize("status", [500, 503, None])
def test_unreachable_robots_disallows(status):
    f = _fetcher(status)
    assert not f.allowed("https://example.org/feed.xml")
    with pytest.raises(FetchError, match="robots"):
        f.get("https://example.org/feed.xml")


def test_robots_rules_are_obeyed():
    f = _fetcher(200, "User-agent: *\nDisallow: /private/\n")
    assert f.allowed("https://example.org/feed.xml")
    assert not f.allowed("https://example.org/private/feed.xml")


def test_api_asking_for_a_longer_gap_gets_it():
    import time

    import httpx

    from geonews.ingestion.fetcher import Fetcher

    f = Fetcher(min_interval_s=0)
    f.client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text="{}")))
    t0 = time.monotonic()
    f.get("https://api.test/a", respect_robots=False, min_interval=0.3)
    f.get("https://api.test/b", respect_robots=False, min_interval=0.3)
    f.get("https://other.test/c", respect_robots=False)          # another host does not wait
    assert 0.3 <= time.monotonic() - t0 < 0.6
