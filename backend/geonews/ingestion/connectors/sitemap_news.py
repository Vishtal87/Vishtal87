"""News sitemaps (Google/Yandex News format): the machine-readable list of fresh articles many sites publish for
search engines, often where no RSS exists. URL = the news sitemap or a sitemap index.

Config (optional): {"max_new": 15, "max_age_hours": 72, "respect_robots": true}. Each poll takes the newest
unseen articles (title and date from the sitemap, text from the page). Access model: public_web.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from lxml import etree

from geonews.ingestion.connectors.article import collect_articles
from geonews.ingestion.connectors.base import FetchResult, respects_robots
from geonews.ingestion.fetcher import FetchError, Fetcher
from geonews.pipeline.dates import parse_published

NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9", "news": "http://www.google.com/schemas/sitemap-news/0.9"}


@dataclass
class SitemapItem:
    url: str
    title: str
    published: str | None


def _xml(text: str):
    root = etree.fromstring(text.encode("utf-8"), etree.XMLParser(recover=True, huge_tree=True, resolve_entities=False,
                                                                 no_network=True))
    if root is None:
        raise FetchError("sitemap is not XML")
    return root


def is_news_sitemap(url: str) -> bool:
    """A sitemap named as a news one (by its path: the host may well be news.example)."""
    return "news" in urlsplit(url).path.lower()


def parse_sitemap(text: str) -> tuple[list[SitemapItem], list[str]]:
    """(articles of a urlset, child sitemap URLs of a sitemapindex)."""
    root = _xml(text)
    children = [loc.strip() for loc in root.xpath("//sm:sitemap/sm:loc/text()", namespaces=NS)]
    items = []
    for u in root.xpath("//sm:url", namespaces=NS):
        loc = "".join(u.xpath("sm:loc/text()", namespaces=NS)).strip()
        if not loc:
            continue
        title = "".join(u.xpath("news:news/news:title/text()", namespaces=NS)).strip()
        date = ("".join(u.xpath("news:news/news:publication_date/text()", namespaces=NS)).strip()
                or "".join(u.xpath("sm:lastmod/text()", namespaces=NS)).strip() or None)
        items.append(SitemapItem(loc, title, date))
    return items, children


def fresh_items(fetcher: Fetcher, url: str, respect_robots: bool = True, max_age_hours: int = 72,
                max_children: int = 2) -> list[SitemapItem]:
    """Newest-first articles of a news sitemap; for an index, its news sitemaps (or the most recent ones)."""
    items, children = parse_sitemap(fetcher.get(url, respect_robots=respect_robots).text)
    if children and not items:
        news = [c for c in children if is_news_sitemap(c)] or children[-max_children:]
        for child in news[:max_children]:
            try:
                items += parse_sitemap(fetcher.get(child, respect_robots=respect_robots).text)[0]
            except FetchError:
                continue
    since = datetime.now(UTC) - timedelta(hours=max_age_hours)
    dated = [(parse_published(i.published, None)[0] if i.published else None, i) for i in items]
    fresh = [(d, i) for d, i in dated if d is None or d >= since]
    fresh.sort(key=lambda x: x[0] or since, reverse=True)
    return [i for _, i in fresh]


class SitemapNewsConnector:
    name = "sitemap_news"
    access_model = "public_web"

    def fetch(self, source: dict, fetcher: Fetcher) -> FetchResult:
        cfg = source.get("config") or {}
        robots = respects_robots(source)
        items = fresh_items(fetcher, source["url"], robots, int(cfg.get("max_age_hours", 72)))
        return FetchResult(entries=collect_articles(
            fetcher, [i.url for i in items], set(source.get("known_ids") or []), int(cfg.get("max_new", 15)), robots,
            hints={i.url: (i.title, i.published) for i in items}))
