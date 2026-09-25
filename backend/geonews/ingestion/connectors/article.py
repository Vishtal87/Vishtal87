"""Shared by connectors that work from web pages: fetch one article page, and pick article links from a listing."""
from __future__ import annotations

import re
import time
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
REJECT_TTL_S = 24 * 3600
_rejected: dict[str, float] = {}   # page URL -> time until which it is not fetched again (it gave no dated article)


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
                  published_hint: str | None = None, require_date: bool = True) -> RawEntry | None:
    """Title, publication time and main text of one article page; None when the page yields no article.
    Without a publication date a page is skipped by default: a section page or an old story would otherwise
    get the download time and show up as fresh news. Network errors raise FetchError."""
    import trafilatura  # heavy, lazy

    page = fetcher.get(url, respect_robots=respect_robots)
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
    published = published_hint or date or (doc.date if doc else None)
    if require_date and not published:
        return None
    return RawEntry(external_id=url, url=page.url or url, title=title, body_text=text, published=published,
                    raw=page.text[:8000])


def collect_articles(fetcher: Fetcher, urls: list[str], known: set[str], max_new: int, respect_robots: bool = True,
                     require_date: bool = True, hints: dict[str, tuple[str, str | None]] | None = None) -> list[RawEntry]:
    """Up to `max_new` new articles from `urls` (best first). Polite by construction: at most 2 x max_new pages per
    poll, and a page that gave no dated article is not fetched again for a day (a listing is polled every few
    minutes; without this every non-article link on it would be downloaded on every poll)."""
    now = time.monotonic()
    if len(_rejected) > 20000:
        _rejected.clear()
    out: list[RawEntry] = []
    tries = 0
    for url in urls:
        if len(out) >= max_new or tries >= 2 * max_new:
            break
        if url in known or _rejected.get(url, 0.0) > now:
            continue
        tries += 1
        title, published = (hints or {}).get(url, ("", None))
        try:
            entry = fetch_article(fetcher, url, respect_robots, title, published, require_date)
        except FetchError:
            continue           # one broken article must not break the whole source; retried next poll
        if entry:
            out.append(entry)
        else:
            _rejected[url] = now + REJECT_TTL_S
    return out
