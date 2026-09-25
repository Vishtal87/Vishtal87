"""Normalization & text extraction: HTML -> clean text, canonical URLs, short excerpts."""
from __future__ import annotations

import hashlib
import html
import re
import unicodedata
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|yclid$|ref$|ref_src$|mc_|igshid$|at_medium$|at_campaign$|from$|_ga$)")
_TAGS = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t ​]+")
_NL = re.compile(r"\n{3,}")
_SENT_END = re.compile(r"(?<=[.!?…])\s+")


def safe_url(url: str | None) -> str | None:
    """Only http(s) links ever reach the UI (a feed could carry javascript:/data: URLs)."""
    if not url:
        return None
    u = url.strip()
    try:
        p = urlsplit(u)
    except ValueError:
        return None
    return u if p.scheme in ("http", "https") and p.netloc else None


def canonical_url(url: str | None) -> str | None:
    if not url:
        return None
    try:
        p = urlsplit(url.strip())
    except ValueError:
        return url
    query = urlencode([(k, v) for k, v in parse_qsl(p.query, keep_blank_values=False) if not _TRACKING.match(k)])
    host = (p.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m.") or host.startswith("amp."):
        host = host.split(".", 1)[1]
    path = re.sub(r"/amp/?$", "/", p.path) or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    return urlunsplit(("https", host + (f":{p.port}" if p.port and p.port not in (80, 443) else ""), path, query, ""))


def html_to_text(fragment: str | None) -> str:
    """Light HTML -> text for feed summaries/Telegram posts (block tags become line breaks)."""
    if not fragment:
        return ""
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</h\d>", "\n", fragment)
    s = _TAGS.sub(" ", s)
    s = html.unescape(s)
    return clean_text(s)


def extract_article_text(page_html: str, url: str | None = None) -> str:
    """Main-content extraction for full web pages (boilerplate removal)."""
    import trafilatura  # heavy, lazy

    text = trafilatura.extract(page_html, url=url, include_comments=False, include_tables=False, favor_precision=True)
    return clean_text(text or "")


def clean_text(s: str) -> str:
    s = unicodedata.normalize("NFC", s).replace("\r", "")
    s = "\n".join(_WS.sub(" ", line).strip() for line in s.split("\n"))
    return _NL.sub("\n\n", s).strip()


def excerpt(text: str, limit: int = 300) -> str:
    """Short excerpt shown to users (we link to the original instead of republishing it)."""
    text = text.strip()
    if len(text) <= limit:
        return text
    out = ""
    for sent in _SENT_END.split(text):
        if len(out) + len(sent) + 1 > limit:
            break
        out = f"{out} {sent}".strip()
    return out or text[: limit - 1].rsplit(" ", 1)[0] + "…"


def content_hash(title: str, text: str) -> str:
    base = re.sub(r"\W+", " ", f"{title}\n{text}".casefold()).strip()
    return hashlib.sha256(base.encode()).hexdigest()
