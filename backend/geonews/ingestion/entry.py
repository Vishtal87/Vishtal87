"""Connector output contract: one RawEntry per published item, whatever the source type."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, fields


@dataclass
class RawEntry:
    external_id: str                     # stable id inside the source (guid, message id, video id, url)
    url: str | None
    title: str
    body_html: str = ""                  # summary/description/post HTML as published
    body_text: str = ""                  # full extracted text when the connector fetched the page
    published: str | None = None         # raw date string exactly as published (timezone may be missing)
    author: str | None = None
    media: str = "text"                  # text | video | photo
    lat: float | None = None             # geotag provided by the source (georss, etc.)
    lon: float | None = None
    lang: str | None = None              # declared language (feed-level)
    image: str | None = None             # preview picture the publisher attached (enclosure, og:image, post photo)
    extra: dict = field(default_factory=dict)
    raw: str = ""                        # original payload fragment (XML/HTML/JSON), retention-limited

    def payload(self) -> str:
        d = asdict(self)
        return json.dumps(d, ensure_ascii=False)

    def payload_hash(self) -> str:
        base = f"{self.title}\n{self.body_html}\n{self.body_text}"
        return hashlib.sha256(base.encode()).hexdigest()[:32]

    @staticmethod
    def from_payload(s: str) -> "RawEntry":
        # fields this version does not know are ignored: a rollback must still read items stored by a newer one
        known = {f.name for f in fields(RawEntry)}
        return RawEntry(**{k: v for k, v in json.loads(s).items() if k in known})
