"""Telegram public channels via the public web preview (https://t.me/s/<channel>): no login, no API keys,
only channels that the owner made public with web preview enabled. Access model: public_web.
(For large volumes use the official MTProto API with the operator's own credentials.)"""
from __future__ import annotations

import lxml.html

from geonews.ingestion.connectors.base import FetchResult, respects_robots
from geonews.ingestion.entry import RawEntry
from geonews.ingestion.fetcher import Fetcher


def channel_title(doc) -> str:
    """The channel's display name as the page shows it ('РИА Новости')."""
    t = doc.xpath("//div[contains(@class,'tgme_channel_info_header_title')]//text()") or \
        doc.xpath("//meta[@property='og:title']/@content")
    return " ".join("".join(t).split())


def parse_preview(html: str, channel_url: str) -> list[RawEntry]:
    doc = lxml.html.fromstring(html)
    title = channel_title(doc)
    out = []
    for msg in doc.xpath("//div[contains(concat(' ', normalize-space(@class), ' '), ' tgme_widget_message ')][@data-post]"):
        post = msg.get("data-post")                      # "channel/123"
        text_el = msg.xpath(".//div[contains(@class,'tgme_widget_message_text')]")
        body_html = lxml.html.tostring(text_el[0], encoding="unicode") if text_el else ""
        if text_el:
            for br in text_el[0].iter("br"):
                br.tail = "\n" + (br.tail or "")   # keep line structure: first line is the title
        body_text = text_el[0].text_content().strip() if text_el else ""
        times = msg.xpath(".//a[contains(@class,'tgme_widget_message_date')]//time/@datetime")
        link = msg.xpath(".//a[contains(@class,'tgme_widget_message_date')]/@href")
        fwd = msg.xpath(".//a[contains(@class,'tgme_widget_message_forwarded_from_name')]/@href")
        has_video = bool(msg.xpath(".//*[contains(@class,'tgme_widget_message_video')]"))
        if not body_text and not has_video:
            continue
        first_line = body_text.split("\n", 1)[0]
        out.append(RawEntry(
            external_id=post, url=link[0] if link else f"{channel_url.rstrip('/')}/{post.split('/')[-1]}",
            title=first_line[:200], body_text=body_text[len(first_line):].strip() or body_text,
            body_html=body_html, published=times[0] if times else None,
            media="video" if has_video else "text",
            extra={"forwarded_from": fwd[0] if fwd else None, "channel_title": title},
            raw=lxml.html.tostring(msg, encoding="unicode")[:8000],
        ))
    return out


class TelegramPublicConnector:
    name = "telegram_public"
    access_model = "public_web"

    def fetch(self, source: dict, fetcher: Fetcher) -> FetchResult:
        r = fetcher.get(source["url"], respect_robots=respects_robots(source))
        return FetchResult(entries=parse_preview(r.text, source["url"]))
