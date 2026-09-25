"""Place feed: everything happening inside a geographic entity (any level, down to a hamlet)."""
from __future__ import annotations

from datetime import datetime

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query

from geonews.api.deps import db, ui_lang
from geonews.api.filters import EVENT_WHERE, Filters, parse_filters
from geonews.api.routes.geo import place_dto
from geonews.db.repos import geo_repo

router = APIRouter(prefix="/api/places", tags=["places"])
CHILD_COL = {"continent": "country_id", "country": "admin1_id", "admin1": "locality_id", "admin2": "locality_id",
             "admin3": "locality_id", "admin4": "locality_id"}

EVENT_LIST_COLS = """ev.id, ev.title, ev.summary, ev.lang, ev.category, ev.event_type, ev.trust_label, ev.source_count,
    ev.article_count, ev.independent_count, ev.first_seen_at, ev.last_article_at, ev.event_time, ev.is_live,
    ev.location_precision, ev.location_relation, ev.radius_m, ev.geo_entity_id, ev.synthetic, ev.source_types,
    ST_Y(ev.geom) AS lat, ST_X(ev.geom) AS lon, %(lang)s::text AS ui_lang,
    CASE WHEN ev.lang IS DISTINCT FROM %(lang)s THEN
      (SELECT a.title FROM event_article ea JOIN article a ON a.id = ea.article_id JOIN source s ON s.id = a.source_id
        WHERE ea.event_id = ev.id AND a.lang = %(lang)s AND a.duplicate_of IS NULL
        ORDER BY s.source_type IN ('telegram', 'blog', 'ugc'), a.published_at LIMIT 1) END AS title_local,
    (SELECT coalesce(g.names->>%(lang)s, g.name) FROM geo_entity g WHERE g.id = ev.geo_entity_id) AS place_name"""


def event_item(r: dict) -> dict:
    return {
        "id": r["id"], "title": r["title_local"] or r["title"], "original_title": r["title"],
        "title_lang": r["lang"] if (r["lang"] and r["lang"] != r["ui_lang"] and not r["title_local"]) else None,
        "summary": r["summary"], "category": r["category"],
        "event_type": r["event_type"], "trust": r["trust_label"], "sources": r["source_count"],
        "articles": r["article_count"], "independent": r["independent_count"], "first_seen": r["first_seen_at"],
        "last_update": r["last_article_at"], "event_time": r["event_time"], "is_live": r["is_live"],
        "precision": r["location_precision"], "relation": r["location_relation"], "radius_m": r["radius_m"],
        "place_id": r["geo_entity_id"], "place_name": r["place_name"], "lat": r["lat"], "lon": r["lon"],
        "synthetic": r["synthetic"], "source_types": r["source_types"],
    }


@router.get("/{place_id}/events")
def place_events(
    place_id: int,
    lang: str | None = None,
    limit: int = Query(30, ge=1, le=100),
    cursor: str | None = Query(None, description="opaque cursor from the previous page"),
    nearby_km: float = Query(15, ge=0, le=100),
    f: Filters = Depends(parse_filters),
    conn: psycopg.Connection = Depends(db),
):
    lang = ui_lang(lang)
    place = geo_repo.get_entity(conn, place_id)
    if not place:
        raise HTTPException(404, "place not found")
    params = {**f.sql_params(), "pid": place_id, "lang": lang, "lim": limit + 1}
    keyset = ""
    if cursor:
        try:
            ts, cid = cursor.split("|")
            params.update({"cts": datetime.fromisoformat(ts), "cid": int(cid)})
            keyset = "AND (ev.last_article_at, ev.id) < (%(cts)s, %(cid)s)"
        except ValueError as e:
            raise HTTPException(422, "bad cursor") from e
    rows = conn.execute(
        f"""SELECT {EVENT_LIST_COLS} FROM event ev
            WHERE {EVENT_WHERE} AND ev.ancestors @> ARRAY[%(pid)s]::bigint[] {keyset}
            ORDER BY ev.last_article_at DESC, ev.id DESC LIMIT %(lim)s""", params).fetchall()
    has_more = len(rows) > limit
    rows = rows[:limit]
    stats = conn.execute(
        f"""SELECT jsonb_object_agg(c.category, c.n) AS by_category
            FROM (SELECT ev.category, count(*) n FROM event ev
                  WHERE {EVENT_WHERE} AND ev.ancestors @> ARRAY[%(pid)s]::bigint[] GROUP BY 1) c""", params).fetchone()
    total = sum((stats["by_category"] or {}).values())
    region_wide = []
    if place["ancestors"]:
        region_wide = conn.execute(
            f"""SELECT {EVENT_LIST_COLS} FROM event ev
                WHERE {EVENT_WHERE} AND ev.geo_entity_id = ANY(%(anc)s) AND ev.location_relation = 'region'
                ORDER BY ev.last_article_at DESC LIMIT 10""",
            {**params, "anc": list(place["ancestors"][2:])}).fetchall()  # skip continent/country-wide
    nearby = []
    if place["kind"] in ("locality", "sublocality") and nearby_km > 0 and place["lat"] is not None:
        nearby = conn.execute(
            f"""SELECT {EVENT_LIST_COLS},
                       ST_Distance(ev.geom::geography, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography) / 1000 AS km
                FROM event ev
                WHERE {EVENT_WHERE} AND NOT ev.ancestors @> ARRAY[%(pid)s]::bigint[]
                  AND ev.location_precision IN ('locality', 'sublocality', 'point', 'area')
                  AND ST_DWithin(ev.geom::geography, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(m)s)
                ORDER BY km LIMIT 10""",
            {**params, "lat": place["lat"], "lon": place["lon"], "m": nearby_km * 1000}).fetchall()
    children = []
    col = CHILD_COL.get(place["kind"])
    if col:
        children = conn.execute(
            f"""SELECT g.id, g.kind, coalesce(g.names->>%(lang)s, g.name) AS name, count(*) AS n
                FROM event ev JOIN geo_entity g ON g.id = ev.{col}
                WHERE {EVENT_WHERE} AND ev.ancestors @> ARRAY[%(pid)s]::bigint[] AND ev.{col} <> %(pid)s
                GROUP BY g.id ORDER BY n DESC LIMIT 12""", params).fetchall()
    return {
        "place": place_dto(conn, place, lang),
        "window": f.window, "since": f.since, "until": f.until,
        "total": total, "by_category": stats["by_category"] or {},
        "events": [event_item(r) for r in rows],
        "next_cursor": f"{rows[-1]['last_article_at'].isoformat()}|{rows[-1]['id']}" if has_more else None,
        "region_wide": [event_item(r) for r in region_wide],
        "nearby": [dict(event_item(r), distance_km=round(r["km"], 1)) for r in nearby],
        "children": [dict(r) for r in children],
    }
