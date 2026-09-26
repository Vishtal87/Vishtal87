"""GDELT DOC 2.0 API (open): discovery of articles worldwide by query. Titles + links only (we never scrape
the publishers here). Config: {"query": "...", "maxrecords": 75}. Access model: official_api."""
from __future__ import annotations

import json
from urllib.parse import urlencode

from geonews.ingestion.connectors.article import image_url
from geonews.ingestion.connectors.base import FetchResult
from geonews.ingestion.entry import RawEntry
from geonews.ingestion.fetcher import FetchError, Fetcher

LANGS = {"English": "en", "Russian": "ru", "German": "de", "French": "fr", "Spanish": "es", "Italian": "it",
         "Ukrainian": "uk", "Chinese": "zh", "Polish": "pl", "Portuguese": "pt", "Turkish": "tr"}


class GdeltConnector:
    name = "gdelt"
    access_model = "official_api"

    def fetch(self, source: dict, fetcher: Fetcher) -> FetchResult:
        cfg = source.get("config") or {}
        q = urlencode({"query": cfg.get("query", "sourcelang:eng"), "mode": "artlist", "format": "json",
                       "maxrecords": cfg.get("maxrecords", 75), "sort": "datedesc"})
        # GDELT is slow under load (20-40 s is common): a longer timeout than for news sites; it asks for no more
        # than one request every 5 seconds (several GDELT sources share the host)
        r = fetcher.get(f"{source['url']}?{q}", respect_robots=False, timeout=float(cfg.get("timeout", 45)),
                        min_interval=float(cfg.get("min_interval", 6)))
        try:
            data = json.loads(r.text or "{}")
        except json.JSONDecodeError as e:
            raise FetchError(f"malformed GDELT response: {e}") from e
        out = []
        for a in data.get("articles", []):
            sd = a.get("seendate", "")
            iso = f"{sd[0:4]}-{sd[4:6]}-{sd[6:8]}T{sd[9:11]}:{sd[11:13]}:{sd[13:15]}Z" if len(sd) >= 15 else None
            out.append(RawEntry(external_id=a["url"], url=a["url"], title=a.get("title", ""), published=iso,
                                lang=LANGS.get(a.get("language", "")), image=image_url(a.get("socialimage")),
                                extra={"domain": a.get("domain"), "sourcecountry": a.get("sourcecountry")},
                                raw=json.dumps(a, ensure_ascii=False)))
        return FetchResult(entries=out)
