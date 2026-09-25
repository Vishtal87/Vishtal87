"""Candidate toponym spans + linguistic cues around them (pure functions)."""
from __future__ import annotations

import re

from geonews.domain.settlement_lexicon import (
    ABBREVIATIONS_NEED_DOT, DIRECTION_WORDS, DISTANCE_UNITS, NEAR_CUES, ORG_CUES, POSTPOSITIVE_OK, TYPE_WORDS,
)
from geonews.domain.text_norm import Token, ngram_keys, script_of, token_lemmas, tokenize, word_is_common_noun
from geonews.pipeline.geoparse.model import Cues, Mention

MAX_NGRAM = 4
# Function words that are never toponyms by themselves (case-insensitive, normalized).
STOPWORDS = set("""
в во на у под над за из от до по при про для без о об обо с со к ко и а но или же что как это эти этот все
так там тут где когда уже еще ещё его ее её их им они она оно он мы вы ты я не ни бы ли то чтобы также
the a an of in on at to for from by with and or but not this that these those it its is are was were be been
he she they we you his her their our after before over under near into onto than then there here when where
der die das den dem des ein eine einer eines und oder im am zum zur vom beim bei mit von aus nach auf für
le la les un une des du de et ou en au aux dans sur par pour avec sans sous chez
el los las lo un una unos unas y o en del al con por para sin sobre entre
il lo gli i una uno e o di da del della nel nella con per su tra fra
w we z ze i oraz na do od po przy dla pod nad
""".split())
# Capitalized words that are frequent in news but coincide with place names somewhere.
FALSE_FRIENDS = set("""
january february march april may june july august september october november december
monday tuesday wednesday thursday friday saturday sunday
januar februar marz april mai juni juli august september oktober november dezember
montag dienstag mittwoch donnerstag freitag samstag sonntag
police president minister government army mayor governor
""".split())
LOCATIVE_PREPS = set("в во на у под около возле близ in at near bei im am um à a au aux en em no na nel nella w we".split())
NAME_CONNECTORS = {"на", "де", "ла", "ле", "de", "la", "le", "du", "des", "am", "an", "im", "upon", "on", "del", "di",
                   "sur", "en", "-"}

_SENT_SPLIT = re.compile(r"[.!?…]+[\s\"»”)]+|\n+")
_DIST_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(км|km|километр\w*|kilomet\w*|mi|miles?|м|m|метр\w*|meters?)\.?\s*"
    r"(?:(к|на|to the|north|south|east|west|nord|sud|к северу|к югу|к западу|к востоку)\s*\w*\s*)?"
    r"(от|from|von|de|da|southwest of|of)\s*$",
    re.IGNORECASE,
)
_DIR_RE = re.compile(r"(?:к|на)\s+(север\w*|юг\w*|запад\w*|восток\w*|северо-\w+|юго-\w+)\s+от\s*$|"
                     r"\b(north|south|east|west|northeast|northwest|southeast|southwest)\s+of\s*$|"
                     r"\b(nördlich|südlich|westlich|östlich)\s+(?:von\s*)?$", re.IGNORECASE)
_ROUTE_RE = re.compile(r"(трасс\w*|автодорог\w*|дорог\w*|шоссе|рейс\w*|маршрут\w*|highway|motorway|route|autobahn|"
                       r"между|between|zwischen)\s*[^.]{0,40}$", re.IGNORECASE)
_AREA_RE = re.compile(r"(в районе|в окрестностях|в пригороде|in the area of|in the vicinity of|outside of|"
                      r"in der nähe von|aux environs de|près de|cerca de|nei pressi di)\s*(\w+\s+)?$",
                      re.IGNORECASE)


def sentence_starts(text: str) -> list[int]:
    starts = [0]
    for m in _SENT_SPLIT.finditer(text):
        starts.append(m.end())
    return starts


def _gap_ok(text: str, a: Token, b: Token) -> bool:
    """Tokens a and b may belong to one toponym (only spaces/hyphen between them)."""
    gap = text[a.end:b.start]
    return gap.strip(" -‐‑–") == "" and "\n" not in gap and len(gap) <= 3


def extract_mentions(title: str, body: str, lang: str | None) -> tuple[str, list[Token], list[Mention]]:
    """Return full text, tokens and candidate spans (not yet resolved against the gazetteer)."""
    text = (title.strip() + ".\n" + body.strip()) if title else body
    title_end = len(title.strip()) if title else 0
    toks = tokenize(text)
    sstarts = sentence_starts(text)
    morph_lang = lang if lang in ("ru", "uk") else None

    def sent_idx(pos: int) -> int:
        lo = 0
        for i, s in enumerate(sstarts):
            if s <= pos:
                lo = i
        return lo

    first_tok_of_sentence = set()
    for s in sstarts:
        for i, t in enumerate(toks):
            if t.start >= s:
                first_tok_of_sentence.add(i)
                break

    mentions: list[Mention] = []
    for i, t0 in enumerate(toks):
        if script_of(t0.text) == "hani":
            mentions.extend(_cjk_mentions(t0, sent_idx(t0.start), t0.start < title_end))
            continue
        if not _can_start(t0, text):
            continue
        for n in range(1, MAX_NGRAM + 1):
            j = i + n - 1
            if j >= len(toks):
                break
            if n > 1 and not _gap_ok(text, toks[j - 1], toks[j]):
                break
            tj = toks[j]
            if n > 1 and not (tj.capitalized or tj.norm in NAME_CONNECTORS or not tj.text.isalpha()
                              or _is_admin_word(tj, morph_lang)):
                break
            last = toks[j]
            if last.norm in NAME_CONNECTORS:
                continue  # a name does not end with a connector
            if n == 1 and (len(t0.norm) < 3 or t0.norm in STOPWORDS or t0.norm in FALSE_FRIENDS):
                continue
            keys = ngram_keys(toks, i, n, morph_lang)
            m = Mention(start=t0.start, end=last.end, text=text[t0.start:last.end], keys=keys, ntokens=n,
                        sentence=sent_idx(t0.start))
            m.cues = _cues(text, toks, i, j, morph_lang, first_tok_of_sentence, title_end)
            mentions.append(m)
    return text, toks, mentions


def _cjk_mentions(t: Token, sentence: int, in_title: bool) -> list[Mention]:
    """Chinese/Japanese have no spaces: every 2..6-char substring of a Han run is a candidate span;
    longest-match suppression and scoring pick the real toponyms."""
    out = []
    s = t.text
    for a in range(len(s)):
        for n in range(2, 7):
            if a + n > len(s):
                break
            sub = s[a:a + n]
            m = Mention(start=t.start + a, end=t.start + a + n, text=sub, keys=[sub], ntokens=n, sentence=sentence)
            m.cues = Cues(in_title=in_title, locative=True)
            out.append(m)
    return out


def _is_admin_word(t: Token, lang: str | None) -> bool:
    """Lowercase admin type words that are part of official names: 'Краснодарский край', 'Динской район'."""
    lem = token_lemmas(t.norm, lang)[0] if lang else t.norm
    tw = TYPE_WORDS.get(lem)
    return bool(tw and tw[0] in ("admin1", "admin2"))


def _can_start(t: Token, text: str) -> bool:
    ch = t.text[0]
    if not ch.isalpha():
        return False
    if ch.isupper():
        return True
    # scripts without letter case (CJK, Arabic...) — let the gazetteer decide
    return ch.lower() == ch.upper()


def _prev_norms(toks: list[Token], i: int, k: int = 3) -> list[Token]:
    return toks[max(0, i - k):i]


def _cues(text: str, toks: list[Token], i: int, j: int, lang: str | None, first_of_sentence: set[int],
          title_end: int) -> Cues:
    c = Cues()
    t0 = toks[i]
    c.in_title = t0.start < title_end
    c.sentence_initial = i in first_of_sentence
    prev = _prev_norms(toks, i)
    window = text[max(0, t0.start - 70):t0.start]

    # type word right before ("станице X", "г. Сочи", "village of X") or right after ("X County", "X край")
    if prev:
        p = prev[-1]
        lem = token_lemmas(p.norm, lang)[0] if lang else p.norm
        tw = TYPE_WORDS.get(lem) or TYPE_WORDS.get(p.norm)
        needs_dot = p.norm in ABBREVIATIONS_NEED_DOT
        has_dot = text[p.end:p.end + 1] == "."
        if tw and (not needs_dot or has_dot):
            c.type_kind, c.type_label = tw
        elif p.norm == "of" and len(prev) >= 2 and TYPE_WORDS.get(prev[-2].norm):
            c.type_kind, c.type_label = TYPE_WORDS[prev[-2].norm]
        if lem in ORG_CUES or p.norm in ORG_CUES:
            c.org = True
        if p.norm in LOCATIVE_PREPS or (len(prev) >= 2 and prev[-2].norm in LOCATIVE_PREPS and c.type_kind):
            c.locative = True
        # "Джордж Вашингтон", "Иван Краснодаров": capitalized word right before, same sentence, not a type word
        if (p.capitalized and not tw and p.norm not in STOPWORDS and i - 1 not in first_of_sentence
                and _adjacent(text, p, t0) and p.norm not in NAME_CONNECTORS):
            c.name_like = True
    if j + 1 < len(toks):
        nx = toks[j + 1]
        if _adjacent(text, toks[j], nx):
            lem = token_lemmas(nx.norm, lang)[0] if lang else nx.norm
            tw = TYPE_WORDS.get(lem) or TYPE_WORDS.get(nx.norm)
            if tw and (lem in POSTPOSITIVE_OK or nx.norm in POSTPOSITIVE_OK or tw[0] == "street"):
                if tw[0] == "street":
                    c.street = True
                elif c.type_kind is None:
                    c.type_kind, c.type_label = tw
            elif nx.capitalized and nx.norm not in STOPWORDS and not tw and nx.text.isalpha():
                c.name_like = True  # "Paris Hilton"
    if c.type_kind == "street":
        c.street = True
        c.type_kind = None

    # spatial relations
    m = _DIST_RE.search(window)
    if m:
        c.relation = "near"
        c.distance_km = float(m.group(1).replace(",", ".")) * DISTANCE_UNITS.get(m.group(2).lower().rstrip("."), 1.0)
    d = _DIR_RE.search(window)
    if d:
        c.relation = "near"
        word = next(g for g in d.groups() if g)
        c.direction = _direction(word)
    if c.relation == "in" and prev:
        p = prev[-1].norm
        rel = NEAR_CUES.get(p)
        if rel == "near":
            c.relation = "near"
        elif rel == "from" and len(prev) >= 2 and prev[-2].norm in ("недалеко", "неподалеку", "далеко", "away", "unweit",
                                                                     "loin", "lejos", "lontano", "north", "south", "east", "west"):
            c.relation = "near"
        elif (len(prev) >= 2 and NEAR_CUES.get(prev[-2].norm) == "near" and c.type_kind):
            c.relation = "near"  # "около станицы X", "near the village of X"
    if _AREA_RE.search(window):
        c.relation = "near"
    if _ROUTE_RE.search(window) or re.match(r"\s*[—–-]\s*[A-ZА-ЯЁ]", text[toks[j].end:toks[j].end + 4]):
        c.route = True

    # Russian streets are often named without the word "улица": "на Уральской", "по Красной";
    # and listed after one type word: "на улицах Мира, Советской и Кирова"
    if not c.street and lang in ("ru", "uk") and i == j:
        if prev and prev[-1].norm in ("на", "по", "с") and _is_fem_adjective(t0.norm, lang) and c.type_kind is None:
            c.street = True
        clause = text[max(0, t0.start - 80):t0.start]
        m_list = re.search(r"(улиц\w*|ул\.|проспект\w*|переулк\w*|пер\.|бульвар\w*|вулиц\w*)\s+"
                           r"(?:[А-ЯЁІЇЄҐ][\w-]*\s*(?:,|и|та)\s*)+$", clause)
        if m_list:
            c.street = True

    # «Краснодар», „Kuban“: quoted names are clubs, companies, ships, stations — not the place itself
    before, after = text[max(0, t0.start - 1):t0.start], text[toks[j].end:toks[j].end + 1]
    if before in ("«", "„", "\"", "“") and after in ("»", "“", "\"", "”"):
        c.org = True

    # common word check (ru/uk dictionary) for single-token spans without a type cue
    if i == j and lang and c.type_kind is None:
        c.common_word = word_is_common_noun(t0.norm, lang)
    return c


def _is_fem_adjective(word: str, lang: str) -> bool:
    """'уральской', 'красной': feminine adjective in an oblique case (street name with 'улица' omitted)."""
    from geonews.domain.text_norm import _analyzer

    parses = _analyzer(lang).parse(word)
    if not parses:
        return False
    p = parses[0]
    g = set(p.tag.grammemes)
    return "ADJF" in g and "femn" in g and bool({"loct", "datv", "gent", "ablt"} & g) and "Geox" not in g


def _adjacent(text: str, a: Token, b: Token) -> bool:
    return text[a.end:b.start] in (" ", " ")


def _direction(word: str) -> str | None:
    w = word.lower()
    for k, v in sorted(DIRECTION_WORDS.items(), key=lambda kv: -len(kv[0])):  # "северо-запад" before "север"
        if w.startswith(k):
            return v
    return None
