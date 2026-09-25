"""Global place search: "Краснодар", "деревня Ивановка", "Краснодарском крае", "Dierfeld", "Paris".

Homonyms are never collapsed: each candidate is returned with its administrative context
(breadcrumb) so the user can tell "Ивановка, Амурская обл." from "Ивановка, Приморский край".
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import psycopg

from geonews.db.repos import geo_repo
from geonews.domain.geo_math import haversine_km
from geonews.domain.settlement_lexicon import TYPE_WORDS
from geonews.domain.text_norm import lemma_key, norm, script_of, token_lemmas, tokenize, cyrillic_lang_guess


@dataclass
class ParsedQuery:
    text: str                 # query without type words
    norm: str
    lemma: str
    type_kind: str | None     # e.g. 'locality' for "деревня X", 'admin1' for "X край"
    type_label: str | None


def parse_query(q: str) -> ParsedQuery:
    toks = tokenize(q)
    lang = cyrillic_lang_guess(q) if script_of(q) == "cyrl" else None
    type_kind = type_label = None
    keep = []
    for i, t in enumerate(toks):
        lem = token_lemmas(t.norm, lang)[0] if lang else t.norm
        tw = TYPE_WORDS.get(lem) or TYPE_WORDS.get(t.norm)
        # only treat as a type word when something else remains (so "Край" alone stays searchable)
        if tw and len(toks) > 1 and type_kind is None:
            type_kind, type_label = tw
            # admin words ("край", "область", "county") are usually PART of the official name: keep them too
            if tw[0] in ("admin1", "admin2"):
                keep.append(t.text)
            continue
        keep.append(t.text)
    text = " ".join(keep) if keep else q
    return ParsedQuery(text=text, norm=norm(text), lemma=lemma_key(text), type_kind=type_kind, type_label=type_label)


def search(
    conn: psycopg.Connection, q: str, lang: str = "ru", near: tuple[float, float] | None = None, limit: int = 10
) -> list[dict]:
    q = q.strip()
    if len(q) < 2:
        return []
    pq = parse_query(q)
    keys = list(dict.fromkeys([pq.norm, pq.lemma, norm(q), lemma_key(q)]))
    rows = geo_repo.match_names(conn, keys, prefix=pq.norm + "%" if len(pq.norm) >= 3 else None, limit=150)
    if len(rows) < limit and len(pq.norm) >= 4:
        rows += [r for r in geo_repo.match_names(conn, keys, fuzzy=pq.norm, limit=50)
                 if r["entity_id"] not in {x["entity_id"] for x in rows}]
    ents = geo_repo.get_entities(conn, [r["entity_id"] for r in rows])
    scored = []
    for r in rows:
        e = ents.get(r["entity_id"])
        if not e:
            continue
        s = r["mt"] * 10 + (r["sim"] or 0) * 4 + e["importance"] * 0.9
        if pq.type_kind:
            if e["kind"] == pq.type_kind:
                s += 6
            elif pq.type_kind == "locality" and e["kind"] == "sublocality":
                s += 2
            else:
                s -= 4
        if near and e["lat"] is not None:
            km = haversine_km(near[0], near[1], e["lat"], e["lon"])
            s += max(0.0, 4 - math.log10(km + 1) * 1.3)
        scored.append((s, r, e))
    scored.sort(key=lambda x: -x[0])
    top = scored[:limit]
    crumbs = geo_repo.breadcrumbs(conn, [e for _, _, e in top], lang)
    out = []
    for s, r, e in top:
        out.append({
            "id": e["id"], "kind": e["kind"], "place_class": e["place_class"], "local_type": e["local_type"],
            "name": geo_repo.display_name(e, lang), "matched_name": r["matched"],
            "country_code": e["country_code"], "population": e["population"],
            "lat": e["lat"], "lon": e["lon"], "breadcrumb": crumbs[e["id"]][:-1],
            "score": round(s, 2), "match": {3: "exact", 2: "prefix", 1: "fuzzy"}[r["mt"]],
        })
    return out

