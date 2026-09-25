"""Gazetteer endpoints: search, place details, reverse geocoding."""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query

from geonews.api.deps import db, ui_lang
from geonews.db.repos import geo_repo
from geonews.gazetteer.search import search

router = APIRouter(prefix="/api/geo", tags=["geo"])


def place_dto(conn: psycopg.Connection, e: dict, lang: str) -> dict:
    crumbs = geo_repo.breadcrumbs(conn, [e], lang)[e["id"]]
    return {
        "id": e["id"], "kind": e["kind"], "place_class": e["place_class"], "local_type": e["local_type"],
        "name": geo_repo.display_name(e, lang), "names": e["names"], "country_code": e["country_code"],
        "population": e["population"], "timezone": e["timezone"], "lat": e["lat"], "lon": e["lon"],
        "breadcrumb": crumbs[:-1], "has_area": e["has_area"],
    }


@router.get("/search")
def geo_search(
    q: str = Query(..., min_length=1, max_length=120),
    lang: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
    limit: int = Query(10, ge=1, le=30),
    conn: psycopg.Connection = Depends(db),
):
    near = (lat, lon) if lat is not None and lon is not None else None
    return {"query": q, "results": search(conn, q, ui_lang(lang), near, limit)}


@router.get("/reverse")
def geo_reverse(lat: float, lon: float, lang: str | None = None, conn: psycopg.Connection = Depends(db)):
    rows = geo_repo.nearest_localities(conn, lat, lon, limit=5)
    return {"results": [dict(place_dto(conn, r, ui_lang(lang)), distance_km=round(r["km"], 2)) for r in rows]}


@router.get("/{entity_id}")
def geo_place(entity_id: int, lang: str | None = None, conn: psycopg.Connection = Depends(db)):
    e = geo_repo.get_entity(conn, entity_id)
    if not e:
        raise HTTPException(404, "place not found")
    lang = ui_lang(lang)
    dto = place_dto(conn, e, lang)
    dto["children"] = [
        {"id": c["id"], "kind": c["kind"], "name": geo_repo.display_name(c, lang), "population": c["population"],
         "lat": c["lat"], "lon": c["lon"]}
        for c in geo_repo.children(conn, entity_id, 30)
    ]
    return dto
