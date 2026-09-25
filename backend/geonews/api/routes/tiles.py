"""Self-hosted base map vector tiles from PostGIS (countries + populated places labels).

Why: the product must work without third-party tile servers (offline, privacy, no API keys). A detailed
external style (OpenFreeMap/Protomaps) can be layered underneath via frontend configuration.
"""
from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Response

from geonews.api.deps import ui_lang
from geonews.db.pool import connection

router = APIRouter(tags=["tiles"])
WORLD_M = 40075016.68557849
# population threshold for place labels per zoom (global heuristic; every place shows up from z10)
MIN_POP = {0: 10**12, 1: 10**12, 2: 5_000_000, 3: 2_000_000, 4: 700_000, 5: 250_000, 6: 80_000, 7: 25_000,
           8: 8_000, 9: 2_000}


@lru_cache(maxsize=4096)
def _tile(z: int, x: int, y: int, lang: str) -> bytes:
    tol = WORLD_M / (256 * 2 ** z)  # ~1 px
    min_pop = MIN_POP.get(z, 0)
    with connection() as conn:
        row = conn.execute(
            """
            -- The index filter box is expanded in degrees AFTER the transform: transforming a margin-expanded
            -- envelope wraps lon 183.6 -> -176.4 at the antimeridian and selects the opposite hemisphere.
            WITH b AS (SELECT ST_TileEnvelope(%(z)s, %(x)s, %(y)s) AS env,
                              ST_Expand(ST_Transform(ST_TileEnvelope(%(z)s, %(x)s, %(y)s), 4326), %(margin_deg)s) AS env4326),
            c AS (
              SELECT g.id, coalesce(g.names->>%(lang)s, g.name) AS name,
                     ST_AsMVTGeom(ST_SimplifyPreserveTopology(ST_Transform(g.area, 3857), %(tol)s), b.env, 4096, 64, true) AS geom
              FROM geo_entity g, b WHERE g.kind = 'country' AND g.area && b.env4326),
            p AS (
              SELECT g.id, g.kind, coalesce(g.names->>%(lang)s, g.name) AS name, g.population,
                     (g.feature_code = 'PPLC') AS capital,
                     ST_AsMVTGeom(ST_Transform(g.geom, 3857), b.env, 4096, 64, true) AS geom
              FROM geo_entity g, b
              WHERE g.geom && b.env4326 AND (
                    (g.kind = 'country' AND %(z)s BETWEEN 2 AND 6)
                 OR (g.kind = 'admin1' AND %(z)s BETWEEN 4 AND 7 AND g.population > 0)
                 OR (g.kind = 'locality' AND (g.population >= %(minpop)s OR (g.feature_code = 'PPLC' AND %(z)s >= 3))))
              ORDER BY g.importance DESC LIMIT 600)
            SELECT coalesce((SELECT ST_AsMVT(c, 'countries', 4096, 'geom') FROM c WHERE c.geom IS NOT NULL), ''::bytea)
                || coalesce((SELECT ST_AsMVT(p, 'places', 4096, 'geom') FROM p WHERE p.geom IS NOT NULL), ''::bytea) AS mvt
            """,
            {"z": z, "x": x, "y": y, "tol": tol, "lang": lang, "minpop": min_pop, "margin_deg": 360.0 / 2**z * 0.02},
        ).fetchone()
    return bytes(row["mvt"] or b"")


@router.get("/tiles/base/{z}/{x}/{y}.pbf")
def base_tile(z: int, x: int, y: int, lang: str | None = None):
    if not (0 <= z <= 16 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise HTTPException(404)
    data = _tile(z, x, y, ui_lang(lang))
    return Response(data, media_type="application/x-protobuf",
                    headers={"Cache-Control": "public, max-age=86400"})
