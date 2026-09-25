"""Event card: summary, place, trust, every original source, timeline, 'why here?', related events.
Also the per-article provenance trail (raw -> normalized -> analysis)."""
from __future__ import annotations

import json
from datetime import datetime

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from geonews.api.deps import db, ui_lang
from geonews.api.routes.geo import place_dto
from geonews.api.routes.places import EVENT_LIST_COLS, event_item
from geonews.db.repos import geo_repo

router = APIRouter(tags=["events"])

TRUST_TEXT = {
    "official": "Есть официальный источник",
    "multiple_sources": "Сообщают несколько независимых источников",
    "single_source": "Один источник",
    "unverified": "Не подтверждено (только пользовательские источники)",
}


@router.get("/api/events/{event_id}")
def event_detail(event_id: int, lang: str | None = None, conn: psycopg.Connection = Depends(db)):
    lang = ui_lang(lang)
    ev = conn.execute(
        f"SELECT {EVENT_LIST_COLS}, ev.terms, ev.status, ev.merged_into, ev.location_confidence FROM event ev WHERE ev.id = %(id)s",
        {"id": event_id, "lang": lang}).fetchone()
    if not ev:
        raise HTTPException(404, "event not found")
    if ev["status"] == "merged" and ev["merged_into"]:
        return {"redirect": ev["merged_into"]}
    arts = conn.execute(
        """SELECT a.id, a.url, a.title, a.excerpt, a.lang, a.published_at, a.fetched_at, a.duplicate_of,
                  a.origin_group_id, a.version, a.category, a.published_tz_assumed,
                  s.id AS source_id, s.name AS source_name, s.source_type, s.trust_tier, s.synthetic, s.access_model,
                  CASE WHEN r.payload IS NOT NULL THEN (r.payload::jsonb)->>'media' END AS media,
                  (r.payload::jsonb)->'extra'->>'forwarded_from' AS forwarded_from,
                  l.geo_entity_id AS loc_id, l.precision AS loc_precision, l.relation AS loc_relation,
                  l.confidence AS loc_confidence, l.evidence AS loc_evidence,
                  (SELECT coalesce(g.names->>%(lang)s, g.name) FROM geo_entity g WHERE g.id = l.geo_entity_id) AS loc_name,
                  (SELECT json_agg(json_build_object('version', v.version, 'title', v.title, 'captured_at', v.captured_at,
                                             'published_at', coalesce(v.published_at, v.captured_at))
                          ORDER BY v.version) FROM article_version v WHERE v.article_id = a.id) AS versions
           FROM event_article ea
           JOIN article a ON a.id = ea.article_id
           JOIN source s ON s.id = a.source_id
           LEFT JOIN raw_item r ON r.id = a.raw_item_id
           LEFT JOIN LATERAL (SELECT * FROM article_location x WHERE x.article_id = a.id
                              AND x.role IN ('primary', 'source_area') ORDER BY x.confidence DESC LIMIT 1) l ON true
           WHERE ea.event_id = %(id)s ORDER BY a.published_at, a.id""",
        {"id": event_id, "lang": lang}).fetchall()
    place = geo_repo.get_entity(conn, ev["geo_entity_id"]) if ev["geo_entity_id"] else None
    outliers = {o["article_id"]: o["km"] for o in ((ev["terms"] or {}).get("outliers") or [])}

    sources, timeline = [], []
    for i, a in enumerate(arts):
        media = a["media"] or ("video" if a["source_type"] == "youtube" else "text")
        kind = ("copy" if a["duplicate_of"] else "official" if a["source_type"] == "official"
                else "video" if media == "video" else "report")
        if a["version"] > 1 and kind != "copy":
            kind = "update"
        sources.append({
            "article_id": a["id"], "source": {"id": a["source_id"], "name": a["source_name"], "type": a["source_type"],
                                              "trust_tier": a["trust_tier"], "synthetic": a["synthetic"],
                                              "access_model": a["access_model"]},
            "url": a["url"], "title": a["title"], "excerpt": a["excerpt"], "lang": a["lang"], "media": media,
            "published_at": a["published_at"], "fetched_at": a["fetched_at"], "tz_assumed": a["published_tz_assumed"],
            "copy_of": a["duplicate_of"], "forwarded_from": a["forwarded_from"], "version": a["version"],
            "versions": a["versions"] or [],
            "location": {"place_id": a["loc_id"], "name": a["loc_name"], "precision": a["loc_precision"],
                         "relation": a["loc_relation"], "confidence": a["loc_confidence"],
                         "outlier_km": outliers.get(a["id"])},
        })
        timeline.append({"at": a["published_at"], "kind": kind, "source": a["source_name"],
                         "source_type": a["source_type"], "title": a["title"], "article_id": a["id"]})
        for v in (a["versions"] or []):   # the superseded first version keeps its own place in the story
            timeline.append({"at": datetime.fromisoformat(v["published_at"]), "kind": "report", "source": a["source_name"],
                             "source_type": a["source_type"], "title": v["title"], "article_id": a["id"],
                             "superseded": True})
    timeline.sort(key=lambda t: t["at"])
    if timeline:
        first = next((t for t in timeline if t["kind"] != "copy"), timeline[0])
        first["first"] = True

    # "why here": the representative location decision + agreement across sources
    rep = next((a for a in arts if a["loc_id"] == ev["geo_entity_id"] and a["loc_evidence"]), arts[0] if arts else None)
    ev_evidence = (rep or {}).get("loc_evidence") or {}
    agreeing = sum(1 for s in sources if s["location"]["place_id"] and s["location"]["outlier_km"] is None)
    anchor = None
    if ev["location_relation"] == "near" and ev_evidence.get("alternatives"):
        anchor = ev_evidence["alternatives"][0]
    related = conn.execute(
        f"""SELECT {EVENT_LIST_COLS} FROM event ev
            WHERE ev.status = 'active' AND ev.id <> %(id)s
              AND ((%(loc)s::bigint IS NOT NULL AND ev.geo_entity_id = %(loc)s)
                   OR (ev.category = %(cat)s AND %(a1)s::bigint IS NOT NULL AND ev.admin1_id = %(a1)s))
              AND ev.last_article_at BETWEEN %(t)s - interval '7 days' AND %(t)s + interval '7 days'
            ORDER BY (ev.geo_entity_id = %(loc)s) DESC, abs(extract(epoch FROM ev.last_article_at - %(t)s)) LIMIT 6""",
        {"id": event_id, "lang": lang, "loc": ev["geo_entity_id"], "cat": ev["category"],
         "a1": place["admin1_id"] if place else None, "t": ev["last_article_at"]}).fetchall()
    return {
        **event_item(ev),
        "place": place_dto(conn, place, lang) if place else None,
        "trust_text": TRUST_TEXT.get(ev["trust_label"]),
        "trust_note": "Метка описывает, кто сообщает; она не является подтверждением достоверности.",
        "location_confidence": ev["location_confidence"],
        "why_here": {
            "precision": ev["location_precision"], "relation": ev["location_relation"], "radius_m": ev["radius_m"],
            "confidence": ev["location_confidence"], "agreeing_sources": agreeing, "total_sources": len(sources),
            "anchor": anchor, "matched_text": ev_evidence.get("span"), "cues": ev_evidence.get("cues"),
            "reason": ev_evidence.get("reason"), "alternatives": (ev_evidence.get("alternatives") or [])[1:4],
            "ambiguity": ev_evidence.get("ambiguity"), "point_hint": ev_evidence.get("point_hint"),
            "outliers": [{"article_id": k, "km": v} for k, v in outliers.items()],
        },
        "reports": sources,
        "timeline": timeline,
        "related": [event_item(r) for r in related],
    }


@router.get("/api/articles/{article_id}/provenance")
def provenance(article_id: int, conn: psycopg.Connection = Depends(db)):
    a = conn.execute(
        """SELECT a.*, s.name AS source_name, s.slug, s.access_model, s.legal_note, r.payload, r.payload_type,
                  r.fetched_at AS raw_fetched_at, r.url AS raw_url
           FROM article a JOIN source s ON s.id = a.source_id LEFT JOIN raw_item r ON r.id = a.raw_item_id
           WHERE a.id = %s""", (article_id,)).fetchone()
    if not a:
        raise HTTPException(404, "article not found")
    raw = json.loads(a["payload"]) if a["payload"] else None
    analyses = conn.execute(
        "SELECT stage, method, output, created_at FROM article_analysis WHERE article_id = %s ORDER BY id",
        (article_id,)).fetchall()
    return {
        "raw": {"source": a["source_name"], "access_model": a["access_model"], "legal_note": a["legal_note"],
                "fetched_at": a["raw_fetched_at"], "payload_type": a["payload_type"], "url": a["raw_url"],
                "original": raw.get("raw") if raw else None, "retained": raw is not None,
                "entry": {k: raw.get(k) for k in ("title", "published", "lang", "lat", "lon", "media")} if raw else None},
        "normalized": {k: a[k] for k in ("title", "excerpt", "lang", "lang_confidence", "published_at",
                                          "published_tz_assumed", "event_time", "is_live", "canonical_url",
                                          "content_hash", "version", "category", "duplicate_of", "origin_group_id")},
        "analysis": analyses,
    }
