"""Recompute an event from ALL its member articles (pure; the runner supplies rows).

* location = consensus of member locations (a single source with a wrong coordinate is outvoted and flagged);
  a more specific place consistent with a vaguer one wins ("Краснодарский край" + "станица Динская" -> Динская);
* title/summary from the representative report (earliest from the most accountable source);
* trust label from independent origins (see trust.py).
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from geonews.domain.geo_math import haversine_km
from geonews.pipeline.trust import Report, trust_label

RANK = {"point": 0, "street": 1, "sublocality": 2, "locality": 3, "area": 4, "admin5": 5, "admin4": 6, "admin3": 7,
        "admin2": 8, "admin1": 9, "country": 10, "continent": 11}
TITLE_RANK = {"regional_media": 0, "local_media": 0, "media": 0, "tv": 1, "official": 1, "youtube": 2,
              "organization": 2, "aggregator": 2, "telegram": 3, "blog": 3, "ugc": 4}


@dataclass
class Loc:
    entity_id: int | None
    lat: float
    lon: float
    precision: str
    relation: str
    confidence: float
    radius_km: float | None
    ancestors: tuple[int, ...]


def _compat(m: Loc, cand: Loc) -> float:
    if m.entity_id and m.entity_id == cand.entity_id:
        return 1.0
    if m.entity_id and m.entity_id in cand.ancestors:
        return 0.8   # member is vaguer (region) and contains the candidate
    if cand.entity_id and cand.entity_id in m.ancestors:
        return 0.6   # member is more specific than the candidate
    tol = max(m.radius_km or 0, cand.radius_km or 0, 5.0)
    if m.precision not in ("admin1", "country") and cand.precision not in ("admin1", "country"):
        if haversine_km(m.lat, m.lon, cand.lat, cand.lon) <= tol:
            return 0.7
    return 0.0


def consensus_location(members: list[dict], anc: dict[int, tuple[int, ...]]) -> tuple[Loc | None, list[dict]]:
    """Returns (chosen location, outliers[{article_id, km}])."""
    by_origin: dict = {}
    for m in members:
        if m.get("loc_lat") is None:
            continue
        w = (m["loc_conf"] or 0.1) * (1.5 if m["source_type"] == "official" else 1.0)
        key = m["origin_group_id"] or ("a", m["id"])
        loc = Loc(m["loc_id"], m["loc_lat"], m["loc_lon"], m["loc_precision"], m["loc_relation"] or "in",
                  m["loc_conf"] or 0.1, m["loc_radius"], anc.get(m["loc_id"], ()))
        if key not in by_origin or by_origin[key][1] < w:
            by_origin[key] = (m, w, loc)
    if not by_origin:
        return None, []
    items = list(by_origin.values())
    cands = {}
    for _, _, loc in items:
        cands.setdefault((loc.entity_id, loc.relation, round(loc.lat, 3), round(loc.lon, 3)), loc)
    total = sum(w for _, w, _ in items)
    support = {k: sum(w * _compat(loc, c) for _, w, loc in items) for k, c in cands.items()}
    best_key = max(support, key=lambda k: (support[k], -RANK.get(cands[k].precision, 12), cands[k].confidence))
    best = cands[best_key]
    # refinement: a more specific place inside the winner with decent support
    for k, c in cands.items():
        if k != best_key and best.entity_id and best.entity_id in c.ancestors \
                and support[k] >= 0.5 * support[best_key] and RANK.get(c.precision, 12) < RANK.get(best.precision, 12):
            best, best_key = c, k
    outliers = []
    for m, w, loc in items:
        if _compat(loc, best) == 0.0:
            outliers.append({"article_id": m["id"], "km": round(haversine_km(loc.lat, loc.lon, best.lat, best.lon), 1)})
    agreeing = [loc.confidence for _, _, loc in items if _compat(loc, best) > 0]
    best = Loc(best.entity_id, best.lat, best.lon, best.precision, best.relation,
               round(min(1.0, support[best_key] / total * (sum(agreeing) / len(agreeing))), 3), best.radius_km,
               best.ancestors)
    return best, outliers


def build_event(members: list[dict], anc: dict[int, tuple[int, ...]]) -> dict:
    assert members, "event without articles"
    # headline from an editorial report (clear, neutral wording); officials are shown via the trust label
    rep = min(members, key=lambda m: (m["duplicate_of"] is not None, TITLE_RANK.get(m["source_type"], 3),
                                      m["published_at"], m["id"]))
    loc, outliers = consensus_location(members, anc)
    cats = Counter(m["category"] for m in members if m["category"] not in (None, "other", "official"))
    category = cats.most_common(1)[0][0] if cats else (members[0]["category"] or "other")
    types = Counter((m.get("cluster_features") or {}).get("event_type") for m in members)
    types.pop(None, None)
    terms: Counter = Counter()
    for m in members:
        terms.update((m.get("cluster_features") or {}).get("terms") or {})
    nums = sorted({n for m in members for n in ((m.get("cluster_features") or {}).get("numbers") or [])})[:30]
    names = sorted({n for m in members for n in ((m.get("cluster_features") or {}).get("names") or [])})[:60]
    tr = trust_label([Report(m["source_id"], m["source_type"], m["trust_tier"], m["origin_group_id"]) for m in members])
    event_times = [m["event_time"] for m in members if m["event_time"]]
    return {
        "title": rep["title"],
        "summary": rep["excerpt"],
        "lang": rep["lang"],
        "category": category,
        "event_type": types.most_common(1)[0][0] if types else None,
        "first_seen_at": min(m["published_at"] for m in members),
        "last_article_at": max(m["published_at"] for m in members),
        "event_time": min(event_times) if event_times else None,
        "is_live": any(m["is_live"] for m in members),
        "geo_entity_id": loc.entity_id if loc else None,
        "location_precision": loc.precision if loc else "unknown",
        "location_confidence": loc.confidence if loc else 0.0,
        "location_relation": loc.relation if loc else "in",
        "radius_m": int(loc.radius_km * 1000) if loc and loc.radius_km else None,
        "lat": loc.lat if loc else None,
        "lon": loc.lon if loc else None,
        "article_count": len(members),
        "source_count": tr["source_count"],
        "independent_count": tr["independent_count"],
        "source_types": tr["source_types"],
        "has_official": tr["has_official"],
        "trust_label": tr["label"],
        "synthetic": any(m["synthetic"] for m in members),
        "terms": {"terms": dict(terms.most_common(120)), "numbers": nums, "names": names, "outliers": outliers},
    }
