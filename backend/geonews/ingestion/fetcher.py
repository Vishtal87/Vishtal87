"""Polite HTTP fetching: identifies itself, obeys robots.txt, rate-limits per host, uses conditional GET.

We never try to bypass authorization, paywalls, CAPTCHAs or technical limits: a 401/403/429 is recorded as a
source error and retried later with backoff.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from geonews.config import settings

log = logging.getLogger(__name__)
MAX_BYTES = 5_000_000


class FetchError(Exception):
    pass


@dataclass
class Response:
    status: int
    text: str
    url: str
    etag: str | None
    last_modified: str | None
    not_modified: bool = False


class Fetcher:
    def __init__(self, min_interval_s: float = 1.0, timeout_s: float = 15.0):
        self.client = httpx.Client(
            headers={"User-Agent": settings.user_agent, "Accept": "*/*"},
            timeout=timeout_s, follow_redirects=True, trust_env=True,
        )
        self.min_interval_s = min_interval_s
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, tuple[RobotFileParser | None, float]] = {}
        self._lock = threading.Lock()

    def close(self) -> None:
        self.client.close()

    def _throttle(self, host: str) -> None:
        with self._lock:
            wait = self._last_hit.get(host, 0) + self.min_interval_s - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last_hit[host] = time.monotonic()

    def allowed(self, url: str) -> bool:
        p = urlsplit(url)
        base = f"{p.scheme}://{p.netloc}"
        rp, ts = self._robots.get(base, (None, 0.0))
        if rp is None or time.time() - ts > 3600:
            rp = RobotFileParser()
            try:
                r = self.client.get(base + "/robots.txt", timeout=10)
                if r.status_code >= 400:
                    rp.parse([])  # no robots.txt: everything allowed
                else:
                    rp.parse(r.text.splitlines())
            except httpx.HTTPError:
                rp.parse([])
            self._robots[base] = (rp, time.time())
        return rp.can_fetch(settings.user_agent, url)

    def get(self, url: str, etag: str | None = None, last_modified: str | None = None,
            respect_robots: bool = True) -> Response:
        if respect_robots and not self.allowed(url):
            raise FetchError(f"disallowed by robots.txt: {url}")
        host = urlsplit(url).netloc
        self._throttle(host)
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        try:
            r = self.client.get(url, headers=headers)
        except httpx.TimeoutException as e:
            raise FetchError(f"timeout: {url}") from e
        except httpx.HTTPError as e:
            raise FetchError(f"network error: {e.__class__.__name__}: {url}") from e
        if r.status_code == 304:
            return Response(304, "", str(r.url), etag, last_modified, not_modified=True)
        if r.status_code >= 400:
            raise FetchError(f"HTTP {r.status_code}: {url}")
        if len(r.content) > MAX_BYTES:
            raise FetchError(f"response too large ({len(r.content)} bytes): {url}")
        return Response(r.status_code, r.text, str(r.url), r.headers.get("ETag"), r.headers.get("Last-Modified"))
