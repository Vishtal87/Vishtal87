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
_NON_RU_CYRL = set("һәөүңҗұқғіїєґўјљњћџђҷҳӣӯ")
_RU_LIKE = re.compile(r"ь(?!о)|[йяю]|(?:^|[\s-])э", re.IGNORECASE)   # Тель-Авив, Линкольн, Нойда, Эксетер
# spellings Russian never has: Bulgarian 'Донкастър', 'Хондзьо', 'Спрингфийлд'; Ukrainian 'Логроньйо', 'Слупськ',
# 'Зениця'; a soft sign after a vowel; combining marks
_NOT_RU = re.compile(r"ъ(?![еёюя])|ьо|ьй|[аеёиоуыэюя]ь|ий(?=[бвгджзклмнпрстфхцчшщ])|ськ\b|ця\b|[\u0300-\u036f\u0483-\u0489]",
                      re.IGNORECASE)


def ru_like(name: str) -> bool:
    """Russian spelling signs that Serbian/Macedonian variants lack ('Тел-Авив' vs 'Тель-Авив')."""
    return bool(_RU_LIKE.search(name)) and not _NOT_RU.search(name)


def non_russian(name: str) -> bool:
    """A Cyrillic spelling Russian never uses ('Донкастър', 'Слупськ', 'Лос Анђелес')."""
    return bool(_NOT_RU.search(name)) or any(ch in _NON_RU_CYRL for ch in name.lower())


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


_TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "y",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
})


def _is_known_geo(word: str) -> bool:
    from geonews.domain.text_norm import _analyzer  # lazy: heavy dictionary

    for tok in word.lower().replace("-", " ").split():
        parses = _analyzer("ru").parse(tok)
        if not parses or not parses[0].is_known:
            return False
        if not any({"Geox"} & set(p.tag.grammemes) for p in parses[:3]):
            return False
    return True


def pick_ru_display(latin_name: str, alts: list[str]) -> str | None:
    """Offline heuristic (alternate names carry no language tags in the offline bundle).

    Rank Russian-looking Cyrillic variants by: known geographic word in the Russian dictionary
    ('Москва', 'Красноярск'), then similarity of its transliteration to the Latin name.
    Avoids picking obscure variants like 'Муско' (Moscow) or truncations like 'Краснояр'.
    """
    from difflib import SequenceMatcher

    cands = [a.replace("\u0301", "") for a in alts
             if script_of(a) == "cyrl" and "(" not in a and not any(c in _NON_RU_CYRL for c in a.lower())]
    if not cands:
        return None
    lat = latin_name.lower()

    def score(a: str) -> tuple:
        sim = SequenceMatcher(None, a.lower().translate(_TRANSLIT), lat).ratio()
        ntok_ok = len(a.replace("-", " ").split()) == len(latin_name.replace("-", " ").split())
        # Russian hyphenates compound foreign names (Нью-Йорк, Абу-Даби, Лос-Анджелес) and writes е, not ё, in them
        hyphen = "-" in a and " " not in a and (" " in latin_name or "-" in latin_name)
        return (_is_known_geo(a), ntok_ok, hyphen, not _NOT_RU.search(a), ru_like(a), "ё" not in a.lower(),
                round(sim, 2), -len(a))

    return max(cands, key=score)
