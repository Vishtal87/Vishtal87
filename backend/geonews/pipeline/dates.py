"""Publication time normalization (always UTC) and event-time extraction.

* Feed dates without a timezone are interpreted in the source's timezone (and flagged `tz_assumed`).
* Relative expressions ("вчера вечером", "gestern", "last night") are resolved against the publication
  time *in the source's local timezone* — "yesterday" in Vladivostok is not "yesterday" in UTC.
* Explicit old dates / "N years ago" / anniversaries mark the article as historical (not live).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

from dateutil import parser as du_parser

UTC = timezone.utc


@dataclass
class EventTime:
    at: datetime | None
    historical: bool
    evidence: str | None


def _zone(tz: str | None):
    try:
        return ZoneInfo(tz) if tz else UTC
    except Exception:
        return UTC


def parse_published(raw, source_tz: str | None, fallback: datetime | None = None) -> tuple[datetime, bool]:
    """Return (UTC datetime, tz_assumed). Accepts RFC 822, ISO 8601, or datetime objects."""
    fallback = fallback or datetime.now(UTC)
    dt: datetime | None = None
    if isinstance(raw, datetime):
        dt = raw
    elif isinstance(raw, str) and raw.strip():
        s = raw.strip()
        try:
            dt = parsedate_to_datetime(s)  # RFC 822 (RSS)
        except (TypeError, ValueError, IndexError):
            try:
                dt = du_parser.parse(s)
            except (ValueError, OverflowError):
                dt = None
    if dt is None:
        return fallback.astimezone(UTC), True
    assumed = False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_zone(source_tz))
        assumed = True
    dt = dt.astimezone(UTC)
    # clock skew / bogus future dates: never trust a date more than 10 minutes in the future
    if dt > fallback + timedelta(minutes=10):
        return fallback.astimezone(UTC), True
    return dt, assumed


_REL_DAYS = {
    "сегодня": 0, "вчера": -1, "позавчера": -2, "накануне": -1, "сьогодні": 0, "вчора": -1, "позавчора": -2,
    "today": 0, "yesterday": -1, "tonight": 0, "heute": 0, "gestern": -1, "vorgestern": -2,
    "aujourd'hui": 0, "hier": -1, "avant-hier": -2, "hoy": 0, "ayer": -1, "anteayer": -2, "oggi": 0, "ieri": -1,
    "dzisiaj": 0, "wczoraj": -1,
}
_PART_OF_DAY = {
    "утром": 8, "днем": 13, "днём": 13, "вечером": 19, "ночью": 2, "morning": 8, "afternoon": 14, "evening": 19,
    "night": 2, "morgen": 8, "abend": 19, "nacht": 2, "matin": 8, "soir": 19, "nuit": 2, "mañana": 8, "tarde": 16,
    "noche": 21,
}
_REL_RE = re.compile(r"\b(" + "|".join(re.escape(k) for k in sorted(_REL_DAYS, key=len, reverse=True)) + r")\b"
                     r"(?:\s+(утром|дн[её]м|вечером|ночью|morning|afternoon|evening|night|abend|nacht|matin|soir|nuit))?",
                     re.IGNORECASE)
_LAST_NIGHT_RE = re.compile(r"\b(last night|прошлой ночью|минувшей ночью|in der nacht|cette nuit|anoche)\b", re.IGNORECASE)
_HHMM_RE = re.compile(r"\b(?:в|около|at|um|à|a las)\s+(\d{1,2})[:.](\d{2})\b", re.IGNORECASE)
_YEARS_AGO_RE = re.compile(r"\b(\d{1,3})\s+(лет|года|год|years?|jahren|ans|años|anni)\s+(назад|ago)?|"
                           r"\b(vor|il y a|hace)\s+(\d{1,3})\s+(jahren|ans|años)", re.IGNORECASE)
_ANNIV_RE = re.compile(r"годовщин|юбиле|anniversary|jahrestag|anniversaire|aniversario|anniversario|річниц", re.IGNORECASE)
_EXPLICIT_RE = re.compile(
    r"\b(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря|"
    r"january|february|march|april|may|june|july|august|september|october|november|december|"
    r"januar|februar|märz|mai|juni|juli|oktober|dezember|janvier|février|mars|avril|juin|juillet|août|septembre|"
    r"octobre|novembre|décembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|"
    r"diciembre)(?:\s+\d{4})?)|\b(\d{1,2}\.\d{1,2}\.\d{4})\b|\b(\d{4}-\d{2}-\d{2})\b",
    re.IGNORECASE,
)


def extract_event_time(text: str, published_utc: datetime, lang: str | None, source_tz: str | None) -> EventTime:
    local_pub = published_utc.astimezone(_zone(source_tz))
    head = text[:600]  # the event is described at the start; later dates are usually background
    historical = bool(_ANNIV_RE.search(head)) and bool(_YEARS_AGO_RE.search(head))
    m = _REL_RE.search(head)
    if m:
        day = local_pub + timedelta(days=_REL_DAYS[m.group(1).lower()])
        hour = _PART_OF_DAY.get((m.group(2) or "").lower())
        hm = _HHMM_RE.search(head)
        if hm and 0 <= int(hm.group(1)) < 24:
            at = day.replace(hour=int(hm.group(1)), minute=int(hm.group(2)), second=0, microsecond=0)
        elif hour is not None:
            at = day.replace(hour=hour, minute=0, second=0, microsecond=0)
        else:
            at = day
        if at > local_pub:  # "сегодня вечером" in an article published at noon: the future; cap at publication
            at = local_pub if _REL_DAYS[m.group(1).lower()] == 0 else at
        return EventTime(at.astimezone(UTC), historical, m.group(0))
    if _LAST_NIGHT_RE.search(head):
        at = (local_pub - timedelta(days=1 if local_pub.hour >= 12 else 0)).replace(hour=2, minute=0, second=0)
        return EventTime(at.astimezone(UTC), historical, "last night")
    e = _EXPLICIT_RE.search(head[:300])
    if e:
        import dateparser  # lazy: slow import

        raw = next(g for g in e.groups() if g)
        dt = dateparser.parse(raw, languages=[lang] if lang else None,
                              settings={"RELATIVE_BASE": local_pub.replace(tzinfo=None), "PREFER_DATES_FROM": "past",
                                        "DATE_ORDER": "DMY"})
        if dt:
            dt = dt.replace(tzinfo=_zone(source_tz)).astimezone(UTC)
            if dt < published_utc - timedelta(days=30):
                historical = True
            return EventTime(dt, historical, raw)
    return EventTime(None, historical, None)


def is_live(published_utc: datetime, fetched_utc: datetime, historical: bool, max_age_hours: int) -> bool:
    """Backfill and historical references are stored but never shown as live."""
    return not historical and (fetched_utc - published_utc) <= timedelta(hours=max_age_hours)
