"""Official / municipal sites without feeds: a list page + article pages (main text via trafilatura).
Config: {"item_xpath": "//a[@class='news-link']/@href", "max_new": 10, "title_xpath": "//h1",
         "date_xpath": "//time/@datetime"}. Obeys robots.txt (enforced in Fetcher). Access model: public_web."""
from __future__ import annotations

from urllib.parse import urljoin, urlsplit

import lxml.html

from geonews.ingestion.connectors.base import FetchResult
from geonews.ingestion.entry import RawEntry
from geonews.ingestion.fetcher import FetchError, Fetcher
from geonews.pipeline.normalize import extract_article_text


class HtmlListConnector:
    name = "html_list"
    access_model = "public_web"

    def fetch(self, source: dict, fetcher: Fetcher) -> FetchResult:
        cfg = source.get("config") or {}
        r = fetcher.get(source["url"])
        doc = lxml.html.fromstring(r.text)
        host = urlsplit(r.url).netloc
        # follow only same-site http(s) links: a list page must not steer us to other hosts / internal networks
        links = [u for u in (urljoin(r.url, h) for h in doc.xpath(cfg.get("item_xpath", "//article//a/@href")))
                 if urlsplit(u).scheme in ("http", "https") and urlsplit(u).netloc == host]
        known = set(source.get("known_ids") or [])
        out = []
        for url in links:
            if url in known:
                continue
            if len(out) >= int(cfg.get("max_new", 10)):
                break
            try:
                page = fetcher.get(url)
            except FetchError:
                continue  # one broken article must not break the whole source
            pdoc = lxml.html.fromstring(page.text)
            title = (pdoc.xpath(f"string({cfg.get('title_xpath', '//h1')})") or "").strip()
            date = (pdoc.xpath(f"string({cfg.get('date_xpath', '//time/@datetime')})") or "").strip() or None
            text = extract_article_text(page.text, url)
            out.append(RawEntry(external_id=url, url=url, title=title, body_text=text, published=date,
                                raw=page.text[:8000]))
        return FetchResult(entries=out)
