"""Source-independent gazetteer records produced by every importer and consumed by the loader."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from geonews.domain.text_norm import cyrillic_lang_guess, script_of


@dataclass(slots=True)
class NameRec:
    name: str
    lang: str | None = None
    preferred: bool = False
    colloquial: bool = False
    historic: bool = False


@dataclass(slots=True)
class PlaceRec:
    source: str
    source_id: str
    kind: str
    name: str
    country_code: str | None
    lat: float | None
    lon: float | None
    admin_code: str | None = None          # own code path (admins/countries only)
    parent_codes: tuple[str, ...] = ()     # candidate parent admin codes, most specific first
    feature_code: str | None = None
    population: int = 0
    timezone: str | None = None
    place_class: str | None = None
    local_type: str | None = None
    names: dict[str, str] = field(default_factory=dict)     # display names by language
    alt_names: list[NameRec] = field(default_factory=list)
    area_wkt: str | None = None
    meta: dict = field(default_factory=dict)


_DIGITS = re.compile(r"\d")
# Letters used by Turkic/Mongolic Cyrillic orthographies — such names are not Russian display names.
_NON_RU_CYRL = set("һәөүңҗұқғіїєґўјљњћџ")


def keep_alt_name(n: str) -> bool:
    """Filter GeoNames alternate-name noise: IATA codes, lowercase romanizations, URLs, numbers."""
    n = n.strip()
    if len(n) < 2 or len(n) > 64 or _DIGITS.search(n) or "http" in n or "  " in n:
        return False
    sc = script_of(n)
    if sc == "latn":
        if n == n.lower():            # 'ke la si nuo da er', 'krasnwdar' — machine romanizations
            return False
        if n.isupper() and len(n) <= 4:  # 'KRR' airport codes
            return False
    return True


def guess_lang(n: str) -> str | None:
    sc = script_of(n)
    if sc == "cyrl":
        low = n.lower()
        if any(c in _NON_RU_CYRL for c in low):
            return "uk" if cyrillic_lang_guess(low) == "uk" else None
        return "ru"
    if sc == "hani":
        return "zh"
    return None


def pick_ru_display(latin_name: str, alts: list[str]) -> str | None:
    """Offline heuristic (alternate names carry no language tags in the offline bundle)."""
    ntok = len(latin_name.replace("-", " ").split())
    cands = [a for a in alts if script_of(a) == "cyrl" and not any(c in _NON_RU_CYRL for c in a.lower())]
    same = [a for a in cands if len(a.replace("-", " ").split()) == ntok and "(" not in a]
    pool = same or cands
    if not pool:
        return None
    # Prefer the most "plain" variant (no stress marks, shortest).
    pool.sort(key=lambda a: ("́" in a, len(a)))
    return pool[0].replace("́", "")
