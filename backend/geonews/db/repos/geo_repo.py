"""SQL access to the gazetteer (geo_entity / geo_name)."""
from __future__ import annotations

from typing import Iterable, Sequence

import psycopg

ENTITY_COLS = """e.id, e.kind, e.kind_rank, e.place_class, e.local_type, e.feature_code, e.name, e.names,
    e.country_code, e.parent_id, e.ancestors, e.continent_id, e.country_id, e.admin1_id, e.admin2_id, e.locality_id,
    e.population, e.importance, e.timezone, ST_Y(e.geom) AS lat, ST_X(e.geom) AS lon, (e.area IS NOT NULL) AS has_area"""


def display_name(row: dict, lang: str) -> str:
    names = row.get("names") or {}
    return names.get(lang) or names.get("en") or row["name"]


def get_entities(conn: psycopg.Connection, ids: Iterable[int]) -> dict[int, dict]:
    ids = list({i for i in ids if i})
    if not ids:
        return {}
    rows = conn.execute(f"SELECT {ENTITY_COLS} FROM geo_entity e WHERE e.id = ANY(%s)", (ids,)).fetchall()
    return {r["id"]: r for r in rows}


def get_entity(conn: psycopg.Connection, entity_id: int) -> dict | None:
    return get_entities(conn, [entity_id]).get(entity_id)


def breadcrumbs(conn: psycopg.Connection, rows: Sequence[dict], lang: str) -> dict[int, list[dict]]:
    """entity id -> [{id, kind, name}] from continent down to the entity itself."""
    anc = get_entities(conn, [a for r in rows for a in (r["ancestors"] or [])])
    out = {}
    for r in rows:
        chain = [anc[a] for a in (r["ancestors"] or []) if a in anc] + [r]
        out[r["id"]] = [{"id": c["id"], "kind": c["kind"], "name": display_name(c, lang)} for c in chain]
    return out


def match_names(
    conn: psycopg.Connection,
    exact_keys: list[str],
    prefix: str | None = None,
    fuzzy: str | None = None,
    limit: int = 200,
    kinds: Sequence[str] | None = None,
) -> list[dict]:
    """Entities whose names match. mt: 3 exact (norm or lemma), 2 prefix, 1 trigram-similar."""
    conds = ["n.lemma = ANY(%(keys)s)", "n.norm = ANY(%(keys)s)"]
    if prefix:
        conds.append("n.norm LIKE %(prefix)s")
    if fuzzy:
        conds.append("n.norm %% %(fuzzy)s")
    kind_filter = "AND e.kind = ANY(%(kinds)s)" if kinds else ""
    sql = f"""
        SELECT m.entity_id, m.mt, m.sim, m.matched, m.colloquial
        FROM (
          SELECT n.entity_id,
                 max(CASE WHEN n.lemma = ANY(%(keys)s) OR n.norm = ANY(%(keys)s) THEN 3
                          WHEN %(prefix)s::text IS NOT NULL AND n.norm LIKE %(prefix)s THEN 2 ELSE 1 END) AS mt,
                 max(similarity(n.norm, coalesce(%(fuzzy)s, %(keys)s[1]))) AS sim,
                 (array_agg(n.name ORDER BY n.is_preferred DESC, length(n.name)))[1] AS matched,
                 bool_or(n.is_colloquial) AS colloquial
          FROM geo_name n
          WHERE {' OR '.join(conds)}
          GROUP BY n.entity_id
        ) m
        JOIN geo_entity e ON e.id = m.entity_id
        WHERE e.geom IS NOT NULL {kind_filter}
        ORDER BY m.mt DESC, m.sim DESC, e.importance DESC
        LIMIT %(limit)s
    """
    return conn.execute(
        sql, {"keys": exact_keys, "prefix": prefix, "fuzzy": fuzzy, "limit": limit, "kinds": list(kinds or [])}
    ).fetchall()


def children(conn: psycopg.Connection, entity_id: int, limit: int = 50) -> list[dict]:
    return conn.execute(
        f"SELECT {ENTITY_COLS} FROM geo_entity e WHERE e.parent_id = %s AND e.geom IS NOT NULL"
        " ORDER BY e.importance DESC LIMIT %s",
        (entity_id, limit),
    ).fetchall()


def nearest_localities(conn: psycopg.Connection, lat: float, lon: float, limit: int = 5, max_km: float = 50) -> list[dict]:
    """KNN reverse geocoding (point -> nearest populated places)."""
    return conn.execute(
        f"""SELECT {ENTITY_COLS},
                   ST_Distance(e.geom::geography, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography) / 1000 AS km
            FROM geo_entity e
            WHERE e.kind = 'locality'
              AND ST_DWithin(e.geom::geography, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(m)s)
            ORDER BY e.geom <-> ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)
            LIMIT %(limit)s""",
        {"lat": lat, "lon": lon, "limit": limit, "m": max_km * 1000},
    ).fetchall()
