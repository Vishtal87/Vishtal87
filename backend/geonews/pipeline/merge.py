"""Periodic event merging. Online clustering is order-dependent (a short aggregator title may arrive before the
detailed report and start its own event); this pass compares recently active events pairwise and merges the ones
that describe the same happening. Every merge is recorded in event_relation (auditable, reversible by hand)."""
from __future__ import annotations

import logging

import psycopg

from geonews.db.repos import news_repo
from geonews.pipeline import clustering
from geonews.pipeline.runner import Processor, event_features

log = logging.getLogger(__name__)
MERGE_MARGIN = 0.02   # slightly stricter than online attachment


def _load(conn: psycopg.Connection, ids: list[int]) -> dict[int, dict]:
    rows = conn.execute(
        f"""SELECT {news_repo.EVENT_COLS}, coalesce(ge.population, 0) AS place_population, ev.article_count,
                   (SELECT array_agg(DISTINCT a.source_id) FROM event_article ea JOIN article a ON a.id = ea.article_id
                     WHERE ea.event_id = ev.id) AS member_sources
            FROM event ev LEFT JOIN geo_entity ge ON ge.id = ev.geo_entity_id WHERE ev.id = ANY(%s)""", (ids,)).fetchall()
    return {r["id"]: r for r in rows}


def merge_similar_events(conn: psycopg.Connection, changed_within_min: int = 15, limit: int = 2000) -> int:
    """Incremental: only events changed recently are compared (against any active event nearby in time/space),
    so the cost follows the ingest rate, not the size of the event table."""
    pairs = conn.execute(
        """SELECT DISTINCT least(a.id, b.id) AS a_id, greatest(a.id, b.id) AS b_id FROM event a JOIN event b ON b.id <> a.id
           WHERE a.status = 'active' AND b.status = 'active'
             AND a.updated_at > now() - make_interval(mins => %(m)s)
             AND b.first_seen_at <= a.last_article_at + interval '72 hours'
             AND a.first_seen_at <= b.last_article_at + interval '72 hours'
             AND (a.locality_id = b.locality_id
                  OR (a.location_precision = b.location_precision AND a.location_precision IN ('admin1', 'admin2')
                      AND a.geo_entity_id = b.geo_entity_id)
                  OR ST_DWithin(a.geom::geography, b.geom::geography, 20000))
           LIMIT %(lim)s""", {"m": changed_within_min, "lim": limit}).fetchall()
    if not pairs:
        return 0
    evs = _load(conn, sorted({p["a_id"] for p in pairs} | {p["b_id"] for p in pairs}))
    proc = Processor(conn)
    merged: dict[int, int] = {}
    n = 0
    for p in pairs:
        a, b = merged.get(p["a_id"], p["a_id"]), merged.get(p["b_id"], p["b_id"])
        if a == b or a not in evs or b not in evs:
            continue
        fa, fb = event_features(evs[a]), event_features(evs[b])
        gap_h = abs((evs[a]["last_article_at"] - evs[b]["last_article_at"]).total_seconds()) / 3600
        if clustering.recurring_series(set(evs[a]["member_sources"] or []), set(evs[b]["member_sources"] or []), gap_h):
            continue
        s = min(clustering.match_score(fa, fb)[0], clustering.match_score(fb, fa)[0])
        if s < clustering.MATCH_THRESHOLD + MERGE_MARGIN:
            continue
        # keep the bigger (then older) event
        target, src = (a, b) if (evs[a]["article_count"], -a) >= (evs[b]["article_count"], -b) else (b, a)
        conn.execute("UPDATE event_article SET event_id = %s WHERE event_id = %s", (target, src))
        conn.execute("UPDATE event SET status = 'merged', merged_into = %s, updated_at = now() WHERE id = %s", (target, src))
        conn.execute("""INSERT INTO event_relation (event_id, related_event_id, relation, score)
                        VALUES (%s, %s, 'merged', %s) ON CONFLICT DO NOTHING""", (target, src, s))
        news_repo.log_change(conn, src, "merged")
        proc.recompute_event(target, "updated")
        evs[target] = _load(conn, [target])[target]
        merged[src] = target
        n += 1
        log.info("merged event %s into %s (score %.3f)", src, target, s)
    conn.commit()
    return n
