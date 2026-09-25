"""Event clustering: does an article describe an existing event? (pure scoring; I/O lives in the runner)

Language-independent signals dominate on purpose: the place is a gazetteer id, time is UTC, category and
event type are normalized — so reports in RU/EN/DE about one fire meet without translation.
A shared *big city* is weak evidence (many simultaneous events there); a shared *small village* is strong.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

from geonews.domain.geo_math import haversine_km
from geonews.domain.text_norm import token_lemmas, tokenize
from geonews.pipeline.geoparse.mentions import STOPWORDS

MATCH_THRESHOLD = 0.58
MAX_GAP_HOURS = 72
_NUM_RE = re.compile(r"\b\d+(?:[.,]\d+)?\b")
COMPATIBLE = {("incidents", "crime"), ("incidents", "weather"), ("incidents", "transport"), ("official", "*"),
              ("society", "*"), ("other", "*")}


@dataclass
class Features:
    at: datetime
    category: str
    event_type: str | None
    locality_id: int | None
    admin2_id: int | None
    admin1_id: int | None
    country_id: int | None
    lat: float | None
    lon: float | None
    radius_km: float | None
    precision: str
    place_population: int
    lang: str | None
    terms: Counter = field(default_factory=Counter)
    numbers: set[str] = field(default_factory=set)
    names: set[str] = field(default_factory=set)   # phonetic keys of proper names (cross-language signal)


_PHON = str.maketrans({"а": "a", "б": "b", "в": "v", "г": "g", "ґ": "g", "д": "d", "е": "e", "є": "e", "ж": "zh",
                       "з": "z", "и": "i", "і": "i", "ї": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n",
                       "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c",
                       "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "", "ы": "i", "ь": "", "э": "e", "ю": "iu", "я": "ia"})


def phonetic_key(word: str) -> str:
    """Crude cross-script key: 'Голосіївському' ~ 'Holosiivskyi' -> 'golos'. Used only as a weak signal."""
    w = word.lower().translate(_PHON)
    for a, b in (("kh", "h"), ("h", "g"), ("y", "i"), ("j", "i"), ("w", "v"), ("ph", "f"), ("ck", "k"), ("x", "ks"),
                 ("ts", "c"), ("tz", "c")):
        w = w.replace(a, b)
    return "".join(ch for ch in w if ch.isalpha())[:5]


def salient_terms(title: str, text: str, lang: str | None, limit: int = 60,
                  exclude: set[str] | None = None) -> tuple[Counter, set[str], set[str]]:
    """(content-word lemmas, numbers, phonetic keys of proper names). Place-name words are excluded: sharing
    the city name says nothing about being the same event."""
    morph = lang if lang in ("ru", "uk") else None
    exclude = exclude or set()
    c: Counter = Counter()
    names: set[str] = set()
    for i, src in enumerate((title, text[:2500])):
        toks = tokenize(src)
        for k, t in enumerate(toks):
            if len(t.norm) < 4 or t.norm in STOPWORDS or t.norm.split("'")[0] in exclude:
                continue
            lem = token_lemmas(t.norm, morph)[0] if morph else t.norm
            c[lem] += 2 if i == 0 else 1
            if t.capitalized and k > 0 and len(t.norm) >= 5 and src[toks[k - 1].end:t.start].strip() not in (".", "!", "?"):
                names.add(phonetic_key(t.text))
    nums = set(_NUM_RE.findall(f"{title} {text[:1500]}"))
    return Counter(dict(c.most_common(limit))), nums, names


def cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def _place_strength(pop: int) -> float:
    if pop < 20_000:
        return 1.0
    if pop < 200_000:
        return 0.75
    if pop < 1_000_000:
        return 0.5
    return 0.35


def place_score(a: Features, b: Features) -> float:
    if a.locality_id and b.locality_id:
        if a.locality_id == b.locality_id:
            return _place_strength(max(a.place_population, b.place_population))
    if a.lat is not None and b.lat is not None and a.precision not in ("admin1", "country") \
            and b.precision not in ("admin1", "country"):
        d = haversine_km(a.lat, a.lon, b.lat, b.lon)
        tol = max(a.radius_km or 0, b.radius_km or 0, 3.0)
        if d <= tol:
            return 0.8
        if d > 60:
            return 0.0
        return 0.8 * math.exp(-(d - tol) / 10)
    # both reported at the same region level ("по всему краю"): same area is decent evidence
    if a.precision == b.precision == "admin2" and a.admin2_id and a.admin2_id == b.admin2_id:
        return 0.7
    if a.precision == b.precision == "admin1" and a.admin1_id and a.admin1_id == b.admin1_id:
        return 0.6
    if a.precision == b.precision == "country" and a.country_id and a.country_id == b.country_id:
        return 0.3
    # one of them is only known at region level
    if a.admin2_id and a.admin2_id == b.admin2_id:
        return 0.5
    if a.admin1_id and a.admin1_id == b.admin1_id:
        return 0.35
    return 0.0


def category_score(a: Features, b: Features) -> float:
    if a.category == b.category:
        return 1.0 + (0.5 if a.event_type and a.event_type == b.event_type else 0.0)
    pair = (a.category, b.category)
    for x, y in COMPATIBLE:
        if (x, y) in (pair, pair[::-1]) or (y == "*" and x in pair):
            return 0.5
    return 0.0


def match_score(article: Features, event: Features) -> tuple[float, dict]:
    gap_h = abs((article.at - event.at).total_seconds()) / 3600
    if gap_h > MAX_GAP_HOURS:
        return 0.0, {"veto": "time_gap", "gap_h": round(gap_h, 1)}
    ps = place_score(article, event)
    if ps == 0.0:
        return 0.0, {"veto": "place"}
    cs = category_score(article, event)
    if cs == 0.0:
        return 0.0, {"veto": "category"}
    ts = math.exp(-gap_h / 18)
    txt = cosine(article.terms, event.terms)
    nums = len(article.numbers & event.numbers) / max(1, min(len(article.numbers), len(event.numbers))) \
        if article.numbers and event.numbers else 0.0
    names = len(article.names & event.names) / max(1, min(len(article.names), len(event.names))) \
        if article.names and event.names else 0.0
    same_lang = article.lang and article.lang == event.lang
    # same language: texts about one event share vocabulary; require some overlap unless the place is small
    same_type = bool(article.event_type and article.event_type == event.event_type)
    # ...but an official "возгорание ликвидировано" and a media "загорелся дом" share few words while being the
    # same fire: a matching event type in a not-too-big place lifts the veto
    if same_lang and txt < 0.12 and ps < 0.9 and not (same_type and ps >= 0.75) and names == 0:
        return 0.0, {"veto": "text", "cos": round(txt, 3)}
    s = 0.36 * ps + 0.14 * ts + 0.12 * min(cs, 1.0) + 0.08 * (cs > 1.0) + 0.24 * txt + 0.06 * nums + 0.12 * names
    if not same_lang:
        s += 0.08 * ps  # cross-lingual: place/time/type carry the decision
    return round(s, 4), {"place": round(ps, 3), "time": round(ts, 3), "category": cs, "text": round(txt, 3),
                         "numbers": round(nums, 3), "names": round(names, 3), "gap_h": round(gap_h, 1)}


def merge_terms(event_terms: Counter, article_terms: Counter, cap: int = 120) -> Counter:
    c = event_terms + article_terms
    return Counter(dict(c.most_common(cap)))
