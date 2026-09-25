"""Reference data and health."""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends

from geonews.api.deps import db, ui_lang
from geonews.queue import pg_queue
from geonews.realtime.broker import broker

router = APIRouter(tags=["meta"])


@router.get("/api/categories")
def categories(lang: str | None = None, conn: psycopg.Connection = Depends(db)):
    lang = ui_lang(lang)
    rows = conn.execute("SELECT slug, names, color, icon FROM category WHERE active ORDER BY sort").fetchall()
    return [{"slug": r["slug"], "name": r["names"].get(lang) or r["names"].get("en"), "color": r["color"],
             "icon": r["icon"]} for r in rows]


@router.get("/api/sources")
def sources(conn: psycopg.Connection = Depends(db)):
    return conn.execute(
        """SELECT s.id, s.slug, s.name, s.source_type, s.connector, s.access_model, s.languages, s.country_code,
                  s.synthetic, s.enabled, s.trust_tier, s.last_success_at, s.last_attempt_at, s.consecutive_failures,
                  s.last_error, s.next_poll_at,
                  (SELECT coalesce(g.names->>'ru', g.name) FROM geo_entity g WHERE g.id = s.home_geo_entity_id) AS home,
                  (SELECT count(*) FROM article a WHERE a.source_id = s.id) AS articles
           FROM source s ORDER BY s.id""").fetchall()


@router.get("/api/health")
def health(conn: psycopg.Connection = Depends(db)):
    src = conn.execute(
        """SELECT count(*) FILTER (WHERE enabled) AS enabled,
                  count(*) FILTER (WHERE enabled AND consecutive_failures = 0 AND last_success_at IS NOT NULL) AS healthy,
                  count(*) FILTER (WHERE enabled AND consecutive_failures > 0) AS failing,
                  count(*) FILTER (WHERE synthetic) AS synthetic
           FROM source""").fetchone()
    ev = conn.execute("SELECT count(*) AS active, max(last_article_at) AS last_event_at FROM event WHERE status='active'").fetchone()
    return {
        "status": "ok" if broker.connected else "degraded",
        "realtime": {"connected": broker.connected, "subscribers": len(broker.subs), "delivered": broker.delivered},
        "sources": src, "events": ev, "queue": pg_queue.stats(conn),
        "demo_mode": bool(src["synthetic"]) and src["synthetic"] == src["enabled"],
    }
