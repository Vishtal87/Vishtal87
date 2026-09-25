"""RSS 2.0 / RSS 1.0 / Atom feeds (news sites, regional & municipal portals, blogs). Access model: public_feed."""
from __future__ import annotations

import feedparser

from geonews.ingestion.connectors.base import FetchResult
from geonews.ingestion.entry import RawEntry
from geonews.ingestion.fetcher import FetchError, Fetcher


def _georss(e) -> tuple[float | None, float | None]:
    """Source-provided geotag (GeoRSS simple / W3C geo). May be wrong: the pipeline cross-checks it with the text."""
    try:
        pt = e.get("georss_point")
        if isinstance(pt, str) and pt.strip():
            lat, lon = (float(x) for x in pt.replace(",", " ").split()[:2])
            return lat, lon
        where = e.get("where")
        if isinstance(where, dict) and where.get("type") == "Point":
            lon, lat = where["coordinates"][:2]  # GeoJSON order
            return float(lat), float(lon)
        if e.get("geo_lat") and e.get("geo_long"):
            return float(e["geo_lat"]), float(e["geo_long"])
    except (TypeError, ValueError, KeyError):
        pass
    return None, None


def parse_feed(text: str, media: str = "text") -> tuple[list[RawEntry], str | None]:
    d = feedparser.parse(text)
    if d.bozo and not d.entries:
        raise FetchError(f"malformed feed: {getattr(d, 'bozo_exception', 'parse error')}")
    feed_lang = (d.feed.get("language") or "").split("-")[0].lower() or None
    out = []
    for e in d.entries:
        ext_id = e.get("id") or e.get("guid") or e.get("link")
        if not ext_id:
            continue
        body = ""
        if e.get("content"):
            body = e["content"][0].get("value", "")
        body = body or e.get("summary", "") or e.get("media_description", "")
        lat, lon = _georss(e)
        out.append(RawEntry(
            external_id=str(ext_id), url=e.get("link"), title=e.get("title", ""), body_html=body,
            published=e.get("published") or e.get("updated") or e.get("dc_date"), author=e.get("author"),
            media=media, lat=lat, lon=lon, lang=feed_lang,
            extra={k: e.get(k) for k in ("yt_videoid", "yt_channelid") if e.get(k)},
            raw=str({k: e.get(k) for k in ("id", "title", "link", "published", "updated", "summary")})[:8000],
        ))
    if d.bozo and not out:
        raise FetchError(f"malformed feed, no usable entries: {getattr(d, 'bozo_exception', 'parse error')}")
    return out, feed_lang


class RssConnector:
    name = "rss"
    access_model = "public_feed"
    media = "text"

    def fetch(self, source: dict, fetcher: Fetcher) -> FetchResult:
        r = fetcher.get(source["url"], source.get("http_etag"), source.get("http_last_modified"))
        if r.not_modified:
            return FetchResult(not_modified=True, etag=r.etag, last_modified=r.last_modified)
        entries, _ = parse_feed(r.text, self.media)
        return FetchResult(entries=entries, etag=r.etag, last_modified=r.last_modified)


class YoutubeConnector(RssConnector):
    """Official public channel feed: https://www.youtube.com/feeds/videos.xml?channel_id=… (title + description)."""
    name = "youtube_rss"
    media = "video"
