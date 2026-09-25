"""Map layer: activity aggregated by the geographic hierarchy, or individual events when zoomed in.

level=continent|country|admin1|admin2 : global aggregates (small result, cached client-side per filter set)
level=locality                       : populated places in the viewport (+ area/region-level events there)
level=events                         : individual events in the viewport
"""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query

from geonews.api.deps import db, ui_lang
from geonews.api.filters import EVENT_WHERE, Filters, bbox_sql, parse_bbox, parse_filters
from geonews.db.repos.geo_repo import display_name

router = APIRouter(prefix="/api/map", tags=["map"])
LEVEL_COL = {"continent": "continent_id", "country": "country_id", "admin1": "admin1_id", "admin2": "admin2_id",
             "locality": "locality_id"}


def _fc(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def _pt(lon, lat, props) -> dict:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": props}


@router.get("/aggregate")
def aggregate(
    level: str = Query(..., pattern="^(continent|country|admin1|admin2|locality|events)$"),
    bbox: str | None = None,
    lang: str | None = None,
    f: Filters = Depends(parse_filters),
    conn: psycopg.Connection = Depends(db),
):
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
                       ev.last_article_at, ev.geo_entity_id, ev.synthetic
                FROM event ev WHERE {EVENT_WHERE} AND ev.geom IS NOT NULL AND {where_bbox}
                ORDER BY ev.last_article_at DESC LIMIT 2000""", params).fetchall()
        return _fc([_pt(r["lon"], r["lat"], {
            "kind": "event", "id": r["id"], "title": r["title"], "category": r["category"], "trust": r["trust_label"],
            "sources": r["source_count"], "articles": r["article_count"], "radius_m": r["radius_m"],
            "relation": r["location_relation"], "precision": r["location_precision"],
            "last": r["last_article_at"].isoformat(), "synthetic": r["synthetic"], "place": r["geo_entity_id"]})
            for r in rows])

    col = LEVEL_COL[level]
    where_bbox = bbox_sql("g.geom", boxes, params) if level == "locality" else "TRUE"
    # big areas: put the bubble where things actually happen (robust median of event points), not at the
    # area's label point ("Russia" in Siberia while all events are in Kuban)
    params["median"] = level in ("continent", "country", "admin1", "admin2")
    rows = conn.execute(
        f"""
        WITH ev AS (
          SELECT ev.{col} AS gid, ev.category, ev.last_article_at, ev.geo_entity_id, ev.synthetic, ev.geom
          FROM event ev WHERE {EVENT_WHERE} AND ev.{col} IS NOT NULL AND ev.geom IS NOT NULL
        )
        SELECT g.id, g.kind, g.name, g.names, g.population,
               ST_X(CASE WHEN %(median)s THEN ST_GeometricMedian(ST_Collect(ev.geom)) ELSE g.geom END) lon,
               ST_Y(CASE WHEN %(median)s THEN ST_GeometricMedian(ST_Collect(ev.geom)) ELSE g.geom END) lat,
               count(*) AS n,
               count(*) FILTER (WHERE ev.geo_entity_id = g.id) AS region_wide,
               mode() WITHIN GROUP (ORDER BY ev.category) AS top_category,
               max(ev.last_article_at) AS last_at,
               count(*) FILTER (WHERE ev.last_article_at >= now() - interval '15 minutes') AS fresh,
               bool_and(ev.synthetic) AS synthetic
        FROM ev JOIN geo_entity g ON g.id = ev.gid
        WHERE g.geom IS NOT NULL AND {where_bbox}
        GROUP BY g.id
        ORDER BY n DESC
        LIMIT 5000""", params).fetchall()
    feats = [_pt(r["lon"], r["lat"], {
        "kind": r["kind"], "level": level, "id": r["id"], "name": display_name(r, lang), "count": r["n"],
        "region_wide": r["region_wide"], "top_category": r["top_category"], "last": r["last_at"].isoformat(),
        "fresh": r["fresh"], "population": r["population"], "synthetic": r["synthetic"]}) for r in rows]
    if level == "locality":
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
    total = conn.execute(f"SELECT count(*) n FROM event ev WHERE {EVENT_WHERE}", f.sql_params()).fetchone()["n"]
    out = _fc(feats)
    out["meta"] = {"level": level, "window": f.window, "total_events": total, "since": f.since.isoformat(),
                   "until": f.until.isoformat()}
    return out
