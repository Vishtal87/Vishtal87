"""Map layer: activity aggregated by the geographic hierarchy, or individual events when zoomed in.

level=continent|country|admin1|admin2 : global aggregates (small result, cached client-side per filter set)
level=locality                       : populated places in the viewport (+ area/region-level events there);
                                       without bbox: every place with events worldwide (the globe's hotspots)
level=events                         : individual events in the viewport
"""
from __future__ import annotations

import json
import threading
import time
from datetime import timedelta

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from geonews.api.deps import db, ui_lang
from geonews.api.filters import EVENT_WHERE, Filters, bbox_sql, parse_bbox, parse_filters
from geonews.api.routes.places import EVENT_IMAGE
from geonews.db.repos.geo_repo import display_name

router = APIRouter(prefix="/api/map", tags=["map"])
VIEWPORT_LEVELS = ("admin1", "admin2", "locality")
LIST_IMAGES = 30             # the "latest" panel shows 25 events
LEVEL_NUM = {"continent": 0, "country": 1, "admin1": 2, "admin2": 3, "locality": 4}
STYPE_BIT = {"telegram": 1, "media": 2, "regional_media": 2, "local_media": 2, "tv": 2, "youtube": 4, "official": 8,
             "organization": 8, "blog": 16, "ugc": 16, "aggregator": 32}
LEVEL_COL = {"continent": "continent_id", "country": "country_id", "admin1": "admin1_id", "admin2": "admin2_id",
             "locality": "locality_id"}


def _fc(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def _pt(lon, lat, props) -> dict:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": props}


class _AggCache:
    """Tiny in-process cache for map aggregates. The key includes the latest event change id, so any new/updated
    event invalidates it immediately; the TTL only bounds memory. Many viewers of the global map share one result."""

    def __init__(self, ttl_s: float = 60, max_items: int = 512):
        self.ttl, self.max = ttl_s, max_items
        self.data: dict[tuple, tuple[float, bytes]] = {}
        self.lock = threading.Lock()
        self.hits = self.misses = 0

    def get(self, key: tuple) -> bytes | None:
        with self.lock:
            v = self.data.get(key)
            if v and time.monotonic() - v[0] < self.ttl:
                self.hits += 1
                return v[1]
            self.misses += 1
            return None

    def put(self, key: tuple, value: bytes) -> None:
        with self.lock:
            if len(self.data) >= self.max:
                for k in sorted(self.data, key=lambda k: self.data[k][0])[: self.max // 4]:
                    del self.data[k]
            self.data[key] = (time.monotonic(), value)


_cache = _AggCache()


@router.get("/aggregate")
def aggregate_cached(
    level: str = Query(..., pattern="^(continent|country|admin1|admin2|locality|events)$"),
    bbox: str | None = None,
    lang: str | None = None,
    f: Filters = Depends(parse_filters),
    conn: psycopg.Connection = Depends(db),
):
    last = conn.execute("SELECT coalesce(max(id), 0) AS m FROM event_change_log").fetchone()["m"]
    rel = f.window != "custom"
    key = (level, bbox and ",".join(f"{float(x):.2f}" for x in bbox.split(",")), ui_lang(lang), f.window,
           None if rel else (f.since, f.until), tuple(f.cats or ()), tuple(f.stypes or ()), last,
           int(time.time() // 30) if rel else 0)  # relative windows slide: at most 30 s of drift
    hit = _cache.get(key)
    headers = {"Cache-Control": "public, max-age=10", "X-Cache": "hit" if hit is not None else "miss"}
    if hit is None:
        hit = json.dumps(aggregate(level=level, bbox=bbox, lang=lang, f=f, conn=conn), ensure_ascii=False,
                         separators=(",", ":"), default=str).encode()
        _cache.put(key, hit)   # serialized once, served many times
    return Response(hit, media_type="application/json", headers=headers)


def aggregate(level: str, bbox: str | None, lang: str | None, f: Filters, conn: psycopg.Connection) -> dict:
    lang = ui_lang(lang)
    boxes = parse_bbox(bbox)
    params = f.sql_params()
    if level == "events":
        if not boxes:
            raise HTTPException(422, "bbox is required for level=events")
        where_bbox = bbox_sql("ev.geom", boxes, params)
        rows = conn.execute(
            f"""SELECT ev.id, ST_X(ev.geom) lon, ST_Y(ev.geom) lat, ev.title, ev.category, ev.trust_label,
                       ev.source_count, ev.article_count, ev.radius_m, ev.location_relation, ev.location_precision,
                       ev.last_article_at, ev.geo_entity_id, ev.synthetic,
                       -- pictures only for the head of the list the side panel shows, not for every point on the map
                       CASE WHEN row_number() OVER (ORDER BY ev.last_article_at DESC) <= {LIST_IMAGES}
                            THEN {EVENT_IMAGE} END AS image
                FROM event ev WHERE {EVENT_WHERE} AND ev.geom IS NOT NULL AND {where_bbox}
                ORDER BY ev.last_article_at DESC LIMIT 2000""", params).fetchall()
        return _fc([_pt(r["lon"], r["lat"], {
            "kind": "event", "id": r["id"], "title": r["title"], "category": r["category"], "trust": r["trust_label"],
            "sources": r["source_count"], "articles": r["article_count"], "radius_m": r["radius_m"],
            "relation": r["location_relation"], "precision": r["location_precision"],
            "last": r["last_article_at"].isoformat(), "synthetic": r["synthetic"], "place": r["geo_entity_id"],
            **({"image": r["image"]} if r["image"] else {})})
            for r in rows])

    col = LEVEL_COL[level]
    lvl = LEVEL_NUM[level]
    params.update(_rollup_params(f))
    viewport = boxes is not None and level in VIEWPORT_LEVELS
    geo_filter = ev_filter = ""
    if viewport:
        # entities in the viewport first (GiST), then only their rollup rows (index level, geo_id, hour).
        # Passed as an array: keeps the planner from merge-joining the whole gazetteer.
        bp: dict = {"kind": level}
        ids = [r["id"] for r in conn.execute(
            f"SELECT g.id FROM geo_entity g WHERE g.kind = %(kind)s AND {bbox_sql('g.geom', boxes, bp)}", bp).fetchall()]
        params["gids"] = ids
        geo_filter = "AND r.geo_id = ANY(%(gids)s::bigint[])"
        ev_filter = f"AND ev.{col} = ANY(%(gids)s::bigint[])"
    # full hours from the rollup + the partial first hour exactly from the event table (fast: <1 h of rows)
    rows = conn.execute(
        f"""
        WITH parts AS (
          SELECT r.geo_id, r.category, sum(r.n) AS n, sum(r.n) FILTER (WHERE r.own) AS own_n,
                 sum(r.sx) AS sx, sum(r.sy) AS sy, sum(r.sz) AS sz, max(r.last_at) AS last_at
          FROM event_rollup r
          WHERE r.level = %(lvl)s AND r.hour >= %(h0)s AND r.hour <= %(until)s {geo_filter}
            AND (NOT %(live)s OR r.live)
            AND (%(cats)s::text[] IS NULL OR r.category = ANY(%(cats)s))
            AND (%(mask)s = 0 OR (r.smask & %(mask)s) <> 0)
          GROUP BY 1, 2
          UNION ALL
          SELECT ev.{col}, ev.category, count(*), count(*) FILTER (WHERE ev.geo_entity_id = ev.{col}),
                 sum(cos(radians(ST_Y(ev.geom))) * cos(radians(ST_X(ev.geom)))),
                 sum(cos(radians(ST_Y(ev.geom))) * sin(radians(ST_X(ev.geom)))),
                 sum(sin(radians(ST_Y(ev.geom)))), max(ev.last_article_at)
          FROM event ev
          WHERE ev.status = 'active' AND ev.last_article_at >= %(since)s AND ev.last_article_at < %(h0)s
            AND (NOT %(live)s OR ev.is_live) AND (%(cats)s::text[] IS NULL OR ev.category = ANY(%(cats)s))
            AND (%(stypes)s::text[] IS NULL OR ev.source_types && %(stypes)s)
            AND ev.{col} IS NOT NULL AND ev.geom IS NOT NULL {ev_filter}
          GROUP BY 1, 2
        ), gc AS (
          SELECT geo_id, category, sum(n) AS n, sum(own_n) AS own_n, sum(sx) AS sx, sum(sy) AS sy, sum(sz) AS sz,
                 max(last_at) AS last_at
          FROM parts GROUP BY 1, 2 HAVING sum(n) > 0
        ), per_geo AS (
          SELECT geo_id, sum(n) AS n, coalesce(sum(own_n), 0) AS own_n, sum(sx) AS sx, sum(sy) AS sy, sum(sz) AS sz,
                 max(last_at) AS last_at, (array_agg(category ORDER BY n DESC))[1] AS top_category
          FROM gc GROUP BY 1
        )
        SELECT g.id, g.kind, g.name, g.names, g.population, pg.n, pg.own_n AS region_wide, pg.top_category,
               pg.last_at,
               CASE WHEN %(mean)s THEN degrees(atan2(pg.sy, pg.sx)) ELSE ST_X(g.geom) END AS lon,
               CASE WHEN %(mean)s THEN degrees(atan2(pg.sz, sqrt(pg.sx * pg.sx + pg.sy * pg.sy))) ELSE ST_Y(g.geom) END AS lat
        FROM per_geo pg JOIN geo_entity g ON g.id = pg.geo_id
        WHERE g.geom IS NOT NULL
        ORDER BY pg.n DESC
        LIMIT 5000""", {**params, "lvl": lvl, "mean": level != "locality"}).fetchall()
    fresh = {r["gid"]: r["n"] for r in conn.execute(
        f"""SELECT ev.{col} AS gid, count(*) AS n FROM event ev
            WHERE {EVENT_WHERE} AND ev.{col} IS NOT NULL AND ev.last_article_at >= now() - interval '15 minutes'
            GROUP BY 1""", f.sql_params()).fetchall()}
    feats = [_pt(r["lon"], r["lat"], {
        "kind": r["kind"], "level": level, "id": r["id"], "name": display_name(r, lang), "count": int(r["n"]),
        "region_wide": int(r["region_wide"]), "top_category": r["top_category"], "last": r["last_at"].isoformat(),
        "fresh": fresh.get(r["id"], 0), "population": r["population"]}) for r in rows]
    if level == "locality" and boxes:
        # events known only at area/region level inside the viewport ("в 15 км от…", "по всему району")
        p2 = f.sql_params()
        wb = bbox_sql("ev.geom", boxes, p2)
        for r in conn.execute(
            f"""SELECT ev.id, ST_X(ev.geom) lon, ST_Y(ev.geom) lat, ev.title, ev.category, ev.radius_m,
                       ev.location_relation, ev.location_precision, ev.last_article_at, ev.geo_entity_id
                FROM event ev WHERE {EVENT_WHERE} AND ev.locality_id IS NULL AND ev.geom IS NOT NULL
                  AND ev.location_precision IN ('area', 'point') AND {wb}
                ORDER BY ev.last_article_at DESC LIMIT 500""", p2).fetchall():
            feats.append(_pt(r["lon"], r["lat"], {
                "kind": "area_event", "id": r["id"], "title": r["title"], "category": r["category"],
                "radius_m": r["radius_m"], "relation": r["location_relation"], "precision": r["location_precision"],
                "last": r["last_article_at"].isoformat()}))
    total = _total(conn, params)
    out = _fc(feats)
    out["meta"] = {"level": level, "window": f.window, "total_events": total, "since": f.since.isoformat(),
                   "until": f.until.isoformat()}
    return out


def _rollup_params(f: Filters) -> dict:
    h0 = f.since.replace(minute=0, second=0, microsecond=0)
    if h0 < f.since:
        h0 += timedelta(hours=1)
    mask = 0
    for t in f.stypes or []:
        mask |= STYPE_BIT.get(t, 0)
    return {"h0": h0, "mask": mask}


def _total(conn: psycopg.Connection, params: dict) -> int:
    """Located events in the window = sum at continent level (every located event has a continent)."""
    r = conn.execute(
        """SELECT coalesce((SELECT sum(n) FROM event_rollup r
                  WHERE r.level = 0 AND r.hour >= %(h0)s AND r.hour <= %(until)s AND (NOT %(live)s OR r.live)
                    AND (%(cats)s::text[] IS NULL OR r.category = ANY(%(cats)s))
                    AND (%(mask)s = 0 OR (r.smask & %(mask)s) <> 0)), 0)
             + (SELECT count(*) FROM event ev
                WHERE ev.status = 'active' AND ev.last_article_at >= %(since)s AND ev.last_article_at < %(h0)s
                  AND (NOT %(live)s OR ev.is_live) AND (%(cats)s::text[] IS NULL OR ev.category = ANY(%(cats)s))
                  AND (%(stypes)s::text[] IS NULL OR ev.source_types && %(stypes)s)
                  AND ev.continent_id IS NOT NULL AND ev.geom IS NOT NULL) AS n""", params).fetchone()
    return int(r["n"])
