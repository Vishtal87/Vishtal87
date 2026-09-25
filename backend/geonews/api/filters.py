"""Shared query-parameter parsing: time windows, categories, source types, bbox."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Query

WINDOWS = {"now": timedelta(minutes=10), "15m": timedelta(minutes=15), "1h": timedelta(hours=1),
           "3h": timedelta(hours=3), "24h": timedelta(hours=24), "7d": timedelta(days=7)}
SOURCE_GROUPS = {
    "telegram": ["telegram"], "media": ["media", "regional_media", "local_media", "tv"], "youtube": ["youtube"],
    "official": ["official", "organization"], "blogs": ["blog", "ugc"], "aggregators": ["aggregator"],
}


@dataclass
class Filters:
    since: datetime
    until: datetime
    live_only: bool
    cats: list[str] | None
    stypes: list[str] | None
    window: str

    def sql_params(self) -> dict:
        return {"since": self.since, "until": self.until, "live": self.live_only, "cats": self.cats,
                "stypes": self.stypes}


EVENT_WHERE = """ev.status = 'active' AND ev.last_article_at >= %(since)s AND ev.first_seen_at <= %(until)s
    AND (NOT %(live)s OR ev.is_live)
    AND (%(cats)s::text[] IS NULL OR ev.category = ANY(%(cats)s))
    AND (%(stypes)s::text[] IS NULL OR ev.source_types && %(stypes)s)"""


def _split(v: str | None) -> list[str] | None:
    items = [x for x in (v or "").split(",") if x]
    return items or None


def parse_filters(
    window: str = Query("24h", description="now|15m|1h|3h|24h|7d|custom"),
    since: datetime | None = Query(None, alias="from"),
    until: datetime | None = Query(None, alias="to"),
    cats: str | None = Query(None, description="comma-separated category slugs"),
    sources: str | None = Query(None, description="comma-separated source groups: telegram,media,youtube,official,blogs,aggregators"),
) -> Filters:
    now = datetime.now(timezone.utc)
    if window == "custom" or since or until:
        s = since or now - timedelta(days=7)
        u = until or now
        if s.tzinfo is None:
            s = s.replace(tzinfo=timezone.utc)
        if u.tzinfo is None:
            u = u.replace(tzinfo=timezone.utc)
        if u < s:
            raise HTTPException(422, "'to' must be after 'from'")
        # a custom period is "history mode": backfill and historical references are shown too
        return Filters(s, u, False, _split(cats), _stypes(sources), "custom")
    if window not in WINDOWS:
        raise HTTPException(422, f"unknown window {window}")
    return Filters(now - WINDOWS[window], now + timedelta(minutes=5), True, _split(cats), _stypes(sources), window)


def _stypes(groups: str | None) -> list[str] | None:
    g = _split(groups)
    if not g:
        return None
    out = []
    for x in g:
        out += SOURCE_GROUPS.get(x, [x])
    return out


def parse_bbox(bbox: str | None) -> list[tuple[float, float, float, float]] | None:
    """'w,s,e,n' -> list of envelopes (two when crossing the antimeridian)."""
    if not bbox:
        return None
    try:
        w, s, e, n = (float(x) for x in bbox.split(","))
    except ValueError as err:
        raise HTTPException(422, "bbox must be w,s,e,n") from err
    s, n = max(-90.0, s), min(90.0, n)
    if e - w >= 360:
        return [(-180.0, s, 180.0, n)]
    w = (w + 180) % 360 - 180
    e = (e + 180) % 360 - 180
    if w <= e:
        return [(w, s, e, n)]
    return [(w, s, 180.0, n), (-180.0, s, e, n)]


def bbox_sql(col: str, boxes: list | None, params: dict) -> str:
    if not boxes:
        return "TRUE"
    parts = []
    for i, (w, s, e, n) in enumerate(boxes):
        params.update({f"w{i}": w, f"s{i}": s, f"e{i}": e, f"n{i}": n})
        parts.append(f"{col} && ST_MakeEnvelope(%(w{i})s, %(s{i})s, %(e{i})s, %(n{i})s, 4326)")
    return "(" + " OR ".join(parts) + ")"
