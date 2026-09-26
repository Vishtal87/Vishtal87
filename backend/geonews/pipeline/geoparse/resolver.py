"""Toponym resolution: candidates -> disambiguation with context -> focus (primary location).

Scoring is additive and explainable; every decision keeps its evidence (span, cues, alternatives)
so the UI can answer "why is this event here?".
"""
from __future__ import annotations

import math
import re
from collections import defaultdict

from geonews.domain.geo_math import BEARINGS, destination, haversine_km
from geonews.pipeline.geoparse.mentions import extract_mentions
from geonews.pipeline.geoparse.model import (
    Candidate, GazetteerPort, GeoResult, LocationDecision, Mention, SourceContext,
)

ACCEPT = 2.2            # minimal score for a span to be treated as a place reference at all
SMALL_PLACE = 10_000    # below this a bare name needs something tying the text to that place
SPECIFICITY = {"point": 1.2, "street": 1.1, "sublocality": 1.05, "locality": 1.0, "admin5": 0.8, "admin4": 0.75,
               "admin3": 0.7, "admin2": 0.62, "admin1": 0.5, "country": 0.3, "continent": 0.1}
_COORD_RE = re.compile(r"(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})")


def geoparse(
    title: str,
    body: str,
    lang: str | None,
    gaz: GazetteerPort,
    source: SourceContext | None = None,
    hint_point: tuple[float, float] | None = None,
) -> GeoResult:
    text, _toks, mentions = extract_mentions(title, body, lang)
    keys = sorted({k for m in mentions for k in m.keys})
    found = gaz.lookup(keys) if keys else {}
    for m in mentions:
        seen: dict[int, Candidate] = {}
        for k in m.keys:
            for c in found.get(k, []):
                seen.setdefault(c.id, c)
        m.candidates = list(seen.values())
    mentions = _longest_matches([m for m in mentions if m.candidates])
    _link_appositions(text, mentions)

    source = source or SourceContext()
    # pass 1: without inter-mention context
    for m in mentions:
        _score(m, source, ctx=None)
    ctx = _context(mentions, source)
    # targeted lookup: small places inside the admin context that fell outside the global top-N
    ambiguous = [m for m in mentions if len(m.candidates) >= 30 or (m.chosen and not _in_ctx(m.chosen, ctx))]
    if ambiguous and ctx["areas"]:
        extra = gaz.lookup_within(sorted({k for m in ambiguous for k in m.keys}), sorted(ctx["areas"]))
        for m in ambiguous:
            ids = {c.id for c in m.candidates}
            for k in m.keys:
                m.candidates += [c for c in extra.get(k, []) if c.id not in ids and not ids.add(c.id)]
    # pass 2: with context (admins mentioned in text + source coverage area)
    for m in mentions:
        _score(m, source, ctx)
    kept = [m for m in mentions if m.chosen is not None]

    primary = _focus(kept)
    decision = _decide(primary, kept) if primary else None
    if decision is None:
        orgs = [m for m in kept if m.cues.org and m.chosen]
        if orgs:  # "ФК Краснодар обыграл…": weak, explicit association with the organisation's home place
            best = max(orgs, key=lambda m: m.confidence)
            best.role = "primary"
            decision = _decide(best, kept)
            decision.relation = "about"
            decision.confidence = round(min(0.45, decision.confidence), 3)
            decision.evidence["reason"] = "only an organisation named after the place is mentioned"
    decision = _apply_point_hints(decision, text, hint_point, gaz)
    if decision is None and source.hyperlocal and source.home_id and source.home_lat is not None:
        decision = LocationDecision(
            entity_id=source.home_id, lat=source.home_lat, lon=source.home_lon, precision="locality",
            relation="source_area", confidence=0.35,
            evidence={"reason": "no place named in text; hyperlocal source area used", "source_home_id": source.home_id},
        )
    return GeoResult(primary=decision, mentions=kept)


# ------------------------------------------------------------------------------------------------
def _longest_matches(mentions: list[Mention]) -> list[Mention]:
    """Drop spans covered by a longer matched span ('Новгород' inside 'Нижний Новгород')."""
    mentions.sort(key=lambda m: (-m.ntokens, m.start))
    taken: list[tuple[int, int]] = []
    out = []
    for m in mentions:
        if any(m.start < e and s < m.end for s, e in taken):
            continue
        taken.append((m.start, m.end))
        out.append(m)
    out.sort(key=lambda m: m.start)
    return out


_APPOS_GAP = re.compile(r"^\s*(,|\(|in|im|en|de)\s*$", re.IGNORECASE)
_APPOS_KINDS = {"country", "admin1", "admin2", "admin3"}


def _link_appositions(text: str, mentions: list[Mention]) -> None:
    """'Springfield, Illinois', 'Moscow, Idaho', 'Illán de Vacas (Toledo)': the second name qualifies the first."""
    for a, b in zip(mentions, mentions[1:]):
        if _APPOS_GAP.match(text[a.end:b.start]):
            a.appos = {c.id for c in b.candidates if c.kind in _APPOS_KINDS}


def _context(mentions: list[Mention], source: SourceContext) -> dict:
    """Admin areas implied by confidently resolved mentions + the source coverage area."""
    areas: set[int] = set()
    countries: set[int] = set()
    for m in mentions:
        c = m.chosen
        if not c or m.confidence < 0.55 or m.cues.street or m.cues.org:
            continue
        if c.kind in ("country",):
            countries.add(c.id)
        elif c.kind in ("admin1", "admin2", "admin3", "admin4"):
            areas.add(c.id)
            if c.country_id:
                countries.add(c.country_id)
        elif c.kind in ("locality", "sublocality"):
            for a in (c.admin2_id, c.admin1_id):
                if a:
                    areas.add(a)
            if c.country_id:
                countries.add(c.country_id)
    src_areas = set()
    for a in source.home_ancestors[2:] + ((source.home_id,) if source.home_id else ()):
        src_areas.add(a)  # skip continent & country (too broad to be a disambiguation hint)
    return {"areas": areas | src_areas, "text_areas": areas, "countries": countries, "source_areas": src_areas}


def _in_ctx(c: Candidate, ctx: dict | None) -> bool:
    return bool(ctx) and any(c.within(a) for a in ctx["areas"])


def _score(m: Mention, source: SourceContext, ctx: dict | None) -> None:
    cues = m.cues
    scores = []
    n_cands = len(m.candidates)
    for c in m.candidates:
        s = 0.6 * c.importance
        if cues.type_kind:
            if c.kind == cues.type_kind:
                s += 3.0
            elif cues.type_kind == "locality" and c.kind == "sublocality":
                s += 1.0
            elif cues.type_kind == "admin2" and c.kind in ("admin3", "locality"):
                s -= 1.0
            else:
                s -= 3.0
        if c.colloquial and c.kind.startswith("admin"):
            s += 1.5
        if m.appos and any(c.within(a) for a in m.appos):
            s += 3.5
        if cues.locative:
            s += 1.0
        if n_cands == 1:
            s += 0.8
        if ctx:
            if any(a in ctx["text_areas"] for a in (c.admin2_id, c.admin1_id) if a) and c.id not in ctx["text_areas"]:
                s += 4.5 if c.admin2_id in ctx["text_areas"] else 4.0
            elif c.country_id in ctx["countries"] and c.kind != "country":
                s += 1.2
        if source.home_id:
            # the coverage area bonus is for regional/local sources; for a national outlet the "area" is the whole
            # country, and +3.5 for every village in it beat foreign cities ('в Виннице' -> a Leningrad-oblast village)
            if (source.home_kind not in ("country", "continent")
                    and any(c.within(a) for a in (source.area_ids - set(source.home_ancestors[:2])))):
                s += 3.5
            elif source.country_code and c.country_code == source.country_code:
                s += 1.2
            if source.home_lat is not None and c.kind in ("locality", "sublocality"):
                km = haversine_km(source.home_lat, source.home_lon, c.lat, c.lon)
                s += max(0.0, 2.0 - math.log10(km + 1))
        # small places named like a person or an ordinary word ('Путина', 'Самойлов', 'Лига', 'Победа' are all
        # villages somewhere): accepted with a type word, an apposition or the article naming their district.
        # A surname may also come with "в/под X". Neither the region nor the source's own area is enough: Kuban
        # has a khutor 'Зеленский' and several 'Победа', and a regional story names the region anyway
        if c.kind in ("locality", "sublocality") and c.population < SMALL_PLACE and not cues.type_kind and not m.appos:
            in_district = bool(ctx) and c.admin2_id is not None and c.admin2_id in ctx["text_areas"]
            if (cues.person_like and not (cues.strict_locative or in_district)
                    or cues.common_word and not in_district or cues.org):   # «Розы Хутор» is a resort
                s -= 6.0
        if cues.acronym and c.kind in ("locality", "sublocality"):
            s -= 6.0          # "МИД", "ЦБ", "СНГ"
        if cues.natural:
            s -= 6.0          # "над Черным морем", "на реке Кубань"
        # penalties: evidence that the span is not a place reference
        if cues.common_word and not cues.locative:
            s -= 3.0
        if cues.sentence_initial and not cues.locative and not cues.type_kind and m.ntokens == 1:
            s -= 1.5
        if cues.name_like and not cues.type_kind:
            s -= 2.5
            if cues.person_reading:
                s -= 4.0      # "Артём Сусленков": a first name next to a surname, whatever the size of the town
        if cues.street:
            s -= 6.0
        if cues.org:
            s -= 2.0
        scores.append(s)
    if not scores:
        return
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    m.candidates = [m.candidates[i] for i in order]
    m.scores = [round(scores[i], 3) for i in order]
    best = m.scores[0]
    if best < ACCEPT:
        m.chosen, m.confidence = None, 0.0
        return
    top = m.candidates[0]
    # a city and the same-named area that contains it (Paris / Paris département, Moscow / Moscow federal city)
    # are one referent, not competing interpretations
    rivals = [x for c, x in zip(m.candidates[1:9], m.scores[1:9]) if not (c.within(top.id) or top.within(c.id))]
    z = 1.0 + sum(math.exp(x - best) for x in rivals)
    p_best = 1.0 / z
    strength = 1 / (1 + math.exp(-(best - ACCEPT - 0.5)))
    m.chosen = m.candidates[0]
    m.p_best = round(p_best, 3)
    m.confidence = round(p_best * strength, 3)


def _focus(kept: list[Mention]) -> Mention | None:
    usable = [m for m in kept if not (m.cues.street or m.cues.org)]
    if not usable:
        return None
    by_entity: dict[int, list[Mention]] = defaultdict(list)
    for m in usable:
        by_entity[m.chosen.id].append(m)
    first_body_sentence = min((m.sentence for m in usable if not m.cues.in_title), default=0)
    weights: dict[int, float] = {}
    for eid, ms in by_entity.items():
        c = ms[0].chosen
        w = 0.0
        for m in ms:
            pos = 1.0 + 0.6 * m.cues.in_title + 0.4 * (m.sentence == first_body_sentence) - 0.4 * m.cues.route
            w += m.confidence * pos
        w = w * (0.75 + 0.25 * min(len(ms), 3)) + SPECIFICITY.get(c.kind, 0.5)
        weights[eid] = w
    # containment: a place inherits the weight of the areas that contain it ("Кубань … станица Динская")
    final = {}
    for eid, w in weights.items():
        c = by_entity[eid][0].chosen
        final[eid] = w + sum(0.5 * weights[a] for a in weights if a != eid and c.within(a))
    best = max(final, key=lambda e: final[e])
    for eid, ms in by_entity.items():
        for m in ms:
            m.role = "primary" if eid == best else ("secondary" if m.confidence >= 0.5 else "mentioned")
            if m.cues.relation == "near" and eid != best:
                m.role = "near"
    for m in kept:
        if m.cues.street:
            m.role = "street"
        elif m.cues.org:
            m.role = "org"
    group = by_entity[best]
    chosen = max(group, key=lambda m: (m.confidence, -m.start))
    # a later mention may carry the precise relation ("ДТП под Краснодаром … в 15 км от Краснодара")
    near = [m for m in group if m.cues.relation == "near"]
    if near and len(near) * 2 >= len(group):
        chosen.cues.relation = "near"
        dist = next((m.cues for m in near if m.cues.distance_km), None)
        if dist:
            chosen.cues.distance_km, chosen.cues.direction = dist.distance_km, dist.direction or chosen.cues.direction
    return chosen


def _decide(m: Mention, kept: list[Mention]) -> LocationDecision:
    d = _decide_inner(m, kept)
    d.ambiguity = round(1 - m.p_best, 3)
    d.evidence["ambiguity"] = d.ambiguity
    return d


def _decide_inner(m: Mention, kept: list[Mention]) -> LocationDecision:
    c = m.chosen
    cues = m.cues
    ev = {
        "span": m.text, "start": m.start, "end": m.end, "cues": {k: v for k, v in _cue_dict(cues).items() if v},
        "alternatives": [{"id": a.id, "name": a.name, "kind": a.kind, "score": s}
                         for a, s in list(zip(m.candidates, m.scores))[:4]],
        "mentions": [{"span": x.text, "id": x.chosen.id, "role": x.role, "confidence": x.confidence} for x in kept][:12],
    }
    if cues.relation == "near":
        radius = cues.distance_km or (20.0 if c.population >= 100_000 else 5.0 if c.kind == "locality" else 25.0)
        lat, lon = c.lat, c.lon
        if cues.direction and cues.distance_km:
            lat, lon = destination(c.lat, c.lon, BEARINGS[cues.direction], cues.distance_km)
        small_ref = c.kind in ("locality", "sublocality") and c.population < 10_000 and not cues.distance_km
        if (cues.distance_km is not None and cues.distance_km <= 3) or small_ref:
            return LocationDecision(entity_id=c.id, lat=lat, lon=lon, precision=c.kind, relation="near",
                                    confidence=round(m.confidence * 0.9, 3), radius_km=radius, anchor_id=c.id,
                                    evidence=ev)
        # "15 km from Krasnodar" is NOT Krasnodar: attach to the containing admin area, keep anchor for the UI
        area = c.admin2_id or c.admin1_id or c.country_id
        return LocationDecision(entity_id=area, lat=lat, lon=lon, precision="area", relation="near",
                                confidence=round(m.confidence * 0.8, 3), radius_km=radius, anchor_id=c.id, evidence=ev)
    if c.kind in ("locality", "sublocality"):
        return LocationDecision(entity_id=c.id, lat=c.lat, lon=c.lon, precision=c.kind, relation="in",
                                confidence=m.confidence, evidence=ev)
    return LocationDecision(entity_id=c.id, lat=c.lat, lon=c.lon, precision=c.kind, relation="region",
                            confidence=m.confidence, evidence=ev)


def _apply_point_hints(decision: LocationDecision | None, text: str, hint: tuple[float, float] | None,
                       gaz: GazetteerPort) -> LocationDecision | None:
    """Explicit coordinates (text or feed geotags) refine or, if nothing else, provide the location."""
    pt = hint
    origin = "feed_geotag"
    if pt is None:
        mm = _COORD_RE.search(text)
        if mm:
            la, lo = float(mm.group(1)), float(mm.group(2))
            if -90 <= la <= 90 and -180 <= lo <= 180:
                pt, origin = (la, lo), "text_coordinates"
    if pt is None:
        return decision
    if decision is None:
        loc = gaz.nearest_locality(pt[0], pt[1], max_km=10)
        return LocationDecision(entity_id=loc.id if loc else None, lat=pt[0], lon=pt[1], precision="point",
                                relation="coordinates", confidence=0.6 if origin == "text_coordinates" else 0.5,
                                evidence={"reason": origin, "nearest_locality": loc.name if loc else None})
    km = haversine_km(decision.lat, decision.lon, pt[0], pt[1])
    tolerance = max(30.0, (decision.radius_km or 0) * 1.5)
    if decision.precision in ("admin1", "country", "admin2"):
        tolerance = 400.0
    if km <= tolerance:
        decision.evidence["point_hint"] = {"origin": origin, "km": round(km, 1), "agrees": True}
        if decision.precision in ("locality", "sublocality", "area") and km <= 30:
            decision.lat, decision.lon = pt
            decision.precision = "point"
        decision.confidence = round(min(1.0, decision.confidence + 0.1), 3)
    else:
        # conflicting geotag (e.g. a source with a wrong default coordinate): keep text, flag it
        decision.evidence["point_hint"] = {"origin": origin, "km": round(km, 1), "agrees": False}
    return decision


def _cue_dict(c) -> dict:
    return {k: getattr(c, k) for k in c.__slots__}
