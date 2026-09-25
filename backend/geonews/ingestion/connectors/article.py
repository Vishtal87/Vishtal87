"""Shared by connectors that work from web pages: fetch one article page, and pick article links from a listing."""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlsplit

import lxml.html

from geonews.ingestion.entry import RawEntry
from geonews.ingestion.fetcher import FetchError, Fetcher

_DATE_XPATHS = ("//meta[@property='article:published_time']/@content", "//meta[@name='pubdate']/@content",
                "//meta[@itemprop='datePublished']/@content", "//*[@itemprop='datePublished']/@datetime",
                "//time/@datetime")
_NOT_ARTICLE = re.compile(r"/(tags?|authors?|category|categories|rubric|rubrics|page|search|about|contacts?|login|"
                          r"register|subscribe|advert|reklama|video|photo|gallery|specials?)(/|$)|\.(pdf|jpe?g|png|zip)$",
                          re.IGNORECASE)


def same_site_links(page_html: str, base_url: str) -> list[tuple[str, str]]:
    """(url, anchor text) for http(s) links on the page's own host, in page order, without duplicates.
    Links to other hosts are never followed: a listing must not steer the collector elsewhere."""
    doc = lxml.html.fromstring(page_html)
    host = urlsplit(base_url).netloc
    seen, out = set(), []
    for a in doc.xpath("//a[@href]"):
        url = urljoin(base_url, a.get("href")).split("#")[0]
        p = urlsplit(url)
        if p.scheme in ("http", "https") and p.netloc == host and url not in seen:
            seen.add(url)
            out.append((url, " ".join(a.text_content().split())))
    return out


def article_links(page_html: str, base_url: str) -> list[str]:
    """Links that look like articles: a headline-length anchor text and a path that is deeper than a section page
    (or carries an id/date). Heuristic, used when a site has no feed and no configured item_xpath."""
    out = []
    for url, text in same_site_links(page_html, base_url):
        path = urlsplit(url).path.rstrip("/")
        segments = [s for s in path.split("/") if s]
        if not 25 <= len(text) <= 250 or _NOT_ARTICLE.search(path):
            continue
        if len(segments) >= 2 or re.search(r"\d{3,}", path):
            out.append(url)
    return out


def fetch_article(fetcher: Fetcher, url: str, respect_robots: bool = True, title_hint: str = "",
                  published_hint: str | None = None) -> RawEntry | None:
    """Title, publication time and main text of one article page; None when the page yields no article."""
    import trafilatura  # heavy, lazy

    try:
        page = fetcher.get(url, respect_robots=respect_robots)
    except FetchError:
        return None  # one broken article must not break the whole source
    doc = trafilatura.bare_extraction(page.text, url=url, with_metadata=True, favor_precision=True)
    text = (doc.text or "").strip() if doc else ""
    if len(text) < 80:
        return None
    try:
        tree = lxml.html.fromstring(page.text)
        date = next((d.strip() for x in _DATE_XPATHS for d in tree.xpath(x) if d.strip()), None)
        og_title = next((t.strip() for t in tree.xpath("//meta[@property='og:title']/@content") if t.strip()), "")
    except (ValueError, lxml.etree.ParserError):
        date, og_title = None, ""
    title = title_hint or og_title or (doc.title or "").strip()
    return RawEntry(external_id=url, url=page.url or url, title=title, body_text=text,
                    published=published_hint or date or (doc.date if doc else None), raw=page.text[:8000])
