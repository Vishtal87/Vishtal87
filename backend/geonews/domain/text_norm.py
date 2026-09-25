"""Single source of truth for text normalization, tokenization and lemmatization.

Used by the gazetteer loader (to build name keys), by the geoparser (to build lookup keys
from article text) and by search. Gazetteer and text MUST go through the same functions,
otherwise inflected mentions ("в станице Динской") would not meet dictionary forms ("Динская").
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from itertools import product

_APOSTROPHES = str.maketrans({"’": "'", "ʼ": "'", "`": "'", "´": "'", "‘": "'", "–": "-", "—": "-", "‐": "-", "‑": "-"})
_UKR_LETTERS = set("іїєґ")
_BEL_LETTERS = set("ў")
_SERB_MAC_LETTERS = set("јљњћџѓќѕ")


def _strip_latin_diacritics(s: str) -> str:
    out = []
    for ch in s:
        if ord(ch) < 128:
            out.append(ch)
            continue
        base = unicodedata.normalize("NFKD", ch)
        # Only strip marks from Latin letters: 'é'->'e', 'ß' stays, Cyrillic 'й' stays.
        if base and ord(base[0]) < 128 and base[0].isalpha():
            out.append(base[0])
        else:
            out.append(ch)
    return "".join(out)


@lru_cache(maxsize=200_000)
def norm(s: str) -> str:
    """Casefold, unify apostrophes/dashes, ё->е, strip Latin diacritics, collapse spaces."""
    s = unicodedata.normalize("NFKC", s).translate(_APOSTROPHES).casefold()
    s = s.replace("ё", "е")
    s = _strip_latin_diacritics(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def script_of(s: str) -> str:
    counts: dict[str, int] = {}
    for ch in s:
        if not ch.isalpha():
            continue
        o = ord(ch)
        if o < 0x250:
            k = "latn"
        elif 0x400 <= o < 0x530:
            k = "cyrl"
        elif 0x370 <= o < 0x400:
            k = "grek"
        elif 0x590 <= o < 0x600:
            k = "hebr"
        elif 0x600 <= o < 0x700 or 0x750 <= o < 0x780:
            k = "arab"
        elif 0x4E00 <= o < 0xA000 or 0x3400 <= o < 0x4DC0:
            k = "hani"
        elif 0x3040 <= o < 0x3100:
            k = "kana"
        elif 0xAC00 <= o < 0xD7B0:
            k = "hang"
        else:
            k = "other"
        counts[k] = counts.get(k, 0) + 1
    if not counts:
        return "none"
    return max(counts.items(), key=lambda kv: kv[1])[0]


def cyrillic_lang_guess(s: str) -> str | None:
    """Which morphological analyzer fits a Cyrillic string (None = no analyzer: keep surface form)."""
    low = s.lower()
    if any(c in _UKR_LETTERS for c in low):
        return "uk"
    if any(c in _BEL_LETTERS for c in low) or any(c in _SERB_MAC_LETTERS for c in low):
        return None
    return "ru"


# ---------------------------------------------------------------------------------------------
# Tokenization
# ---------------------------------------------------------------------------------------------
# Words may contain inner hyphens/apostrophes ("Ростов-на-Дону", "L'Aquila", "Эсто-Садок").
_WORD_RE = re.compile(r"[^\W\d_](?:[^\W_]|['’\-‐‑](?=[^\W\d_]))*", re.UNICODE)
_CJK_RE = re.compile(r"[㐀-䶿一-鿿]+")


@dataclass(frozen=True, slots=True)
class Token:
    text: str      # original surface form
    start: int     # char offset in the source text
    end: int
    norm: str      # norm(text)

    @property
    def capitalized(self) -> bool:
        return self.text[:1].isupper()


def tokenize(text: str) -> list[Token]:
    return [Token(m.group(0), m.start(), m.end(), norm(m.group(0))) for m in _WORD_RE.finditer(text)]


def cjk_runs(text: str) -> list[tuple[str, int]]:
    return [(m.group(0), m.start()) for m in _CJK_RE.finditer(text)]


# ---------------------------------------------------------------------------------------------
# Morphology (ru / uk) — pymorphy3, loaded lazily once per process.
# ---------------------------------------------------------------------------------------------
_ANALYZERS: dict[str, object] = {}
_KEEP_PARTS = {"на", "де", "ла", "ле", "по", "под", "над", "у", "в"}  # parts of compound names that don't inflect


def _analyzer(lang: str):
    a = _ANALYZERS.get(lang)
    if a is None:
        import pymorphy3  # heavy import, keep lazy

        a = pymorphy3.MorphAnalyzer(lang=lang)
        _ANALYZERS[lang] = a
    return a


@lru_cache(maxsize=500_000)
def _word_lemmas(word: str, lang: str) -> tuple[str, ...]:
    """Distinct normal forms of a single (lowercase) word, best first (max 4)."""
    if lang not in ("ru", "uk") or script_of(word) != "cyrl":
        return (word,)
    out: list[str] = []
    for p in _analyzer(lang).parse(word)[:6]:
        nf = p.normal_form.replace("ё", "е")
        if nf not in out:
            out.append(nf)
        if len(out) == 4:
            break
    return tuple(out) or (word,)


@lru_cache(maxsize=500_000)
def word_is_common_noun(word: str, lang: str = "ru") -> bool:
    """True if the analyzer is confident the word is an ordinary word, not a proper geo name.

    Used to reject noise like 'Мир', 'Заря', 'Ключ' when they appear lowercase / without a type cue.
    """
    if lang not in ("ru", "uk") or script_of(word) != "cyrl":
        return False
    parses = _analyzer(lang).parse(word)
    if not parses:
        return False
    proper = {"Geox", "Surn", "Name", "Patr", "Orgn", "Trad"}
    geo = sum(p.score for p in parses if proper & set(p.tag.grammemes))
    known = parses[0].is_known
    return known and geo < 0.3


def _part_lemmas(part: str, lang: str) -> tuple[str, ...]:
    if part in _KEEP_PARTS:
        return (part,)
    return _word_lemmas(part, lang)


def token_lemmas(tok_norm: str, lang: str | None) -> tuple[str, ...]:
    """Candidate lemma keys for one normalized token (handles hyphenated compounds)."""
    if not lang:
        return (tok_norm,)
    parts = tok_norm.split("-")
    if len(parts) == 1:
        return _word_lemmas(tok_norm, lang)
    options = [_part_lemmas(p, lang)[:2] for p in parts[:5]]
    return tuple(dict.fromkeys("-".join(c) for c in product(*options)))


def lemma_key(name: str, lang: str | None = None) -> str:
    """Canonical lemma key for a dictionary (gazetteer) name: best lemma per token."""
    n = norm(name)
    if script_of(n) != "cyrl":
        return n
    lang = lang if lang in ("ru", "uk") else cyrillic_lang_guess(n)
    if lang is None:
        return n
    toks = [t.norm for t in tokenize(n)]
    return " ".join(token_lemmas(t, lang)[0] for t in toks)


def ngram_keys(tokens: list[Token], i: int, n: int, lang: str | None, max_keys: int = 16) -> list[str]:
    """All lookup keys (lemma combinations + surface norm) for tokens[i:i+n]."""
    window = tokens[i : i + n]
    surface = " ".join(t.norm for t in window)
    keys = [surface]
    if lang in ("ru", "uk"):
        per_tok = [token_lemmas(t.norm, lang)[:3] for t in window]
        for combo in product(*per_tok):
            k = " ".join(combo)
            if k not in keys:
                keys.append(k)
            if len(keys) >= max_keys:
                break
    return keys
