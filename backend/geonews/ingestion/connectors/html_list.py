"""Sites without feeds: a news listing page + article pages (main text via trafilatura).

Config (all optional): {"item_xpath": "//a[@class='news-link']/@href", "max_new": 10, "respect_robots": true}.
Without item_xpath, article links are recognised heuristically (headline-length anchor, article-like path).
Only links on the listing's own host are followed. Access model: public_web.
"""
from __future__ import annotations

from urllib.parse import urljoin, urlsplit

import lxml.html

from geonews.ingestion.connectors.article import article_links, fetch_article
from geonews.ingestion.connectors.base import FetchResult, respects_robots
from geonews.ingestion.fetcher import Fetcher


class HtmlListConnector:
    name = "html_list"
    access_model = "public_web"

    def fetch(self, source: dict, fetcher: Fetcher) -> FetchResult:
        cfg = source.get("config") or {}
        robots = respects_robots(source)
        r = fetcher.get(source["url"], respect_robots=robots)
        if cfg.get("item_xpath"):
            host = urlsplit(r.url).netloc
            links = [u for u in (urljoin(r.url, h) for h in lxml.html.fromstring(r.text).xpath(cfg["item_xpath"]))
                     if urlsplit(u).scheme in ("http", "https") and urlsplit(u).netloc == host]
        else:
            links = article_links(r.text, r.url)
        known = set(source.get("known_ids") or [])
        out = []
        for url in links:
            if len(out) >= int(cfg.get("max_new", 10)):
                break
            if url in known:
                continue
            entry = fetch_article(fetcher, url, respect_robots=robots)
            if entry:
                out.append(entry)
        return FetchResult(entries=out)
