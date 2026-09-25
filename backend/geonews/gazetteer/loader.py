"""Bulk loader shared by all gazetteer importers (offline bundle, full GeoNames dumps, ...).

Idempotent: entities are upserted by (source, source_id); admin entities are additionally matched by
their admin code path, so a later full-dump import upgrades rows created by the offline bundle
instead of duplicating them.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Iterable

import psycopg

from geonews.domain.place_kinds import ADMIN_KINDS, KIND_RANK, importance, place_class_for
from geonews.domain.text_norm import lemma_key, norm, script_of
from geonews.gazetteer.records import PlaceRec

log = logging.getLogger(__name__)

_STAGE_ENTITY = """
CREATE TEMP TABLE stage_entity (
  source text, source_id text, admin_code text, parent_codes text[], kind text, kind_rank smallint,
  place_class text, local_type text, feature_code text, name text, names jsonb, country_code text,
  population bigint, importance real, lat double precision, lon double precision, timezone text,
  area_wkt text, meta jsonb
) ON COMMIT DROP
"""
_STAGE_NAME = """
CREATE TEMP TABLE stage_name (
  source text, source_id text, name text, lang text, script text, norm text, lemma text,
  preferred boolean, colloquial boolean, historic boolean, ntokens smallint
) ON COMMIT DROP
"""


def load_places(conn: psycopg.Connection, records: Iterable[PlaceRec], batch_label: str = "") -> int:
    """Stage + upsert a batch of records (entities and their names). Returns number of entities."""
    t0 = time.time()
    n_ent = 0
    n_names = 0
    conn.execute(_STAGE_ENTITY)
    conn.execute(_STAGE_NAME)
    with conn.cursor() as cur:
        with cur.copy(
            "COPY stage_entity (source, source_id, admin_code, parent_codes, kind, kind_rank, place_class, local_type,"
            " feature_code, name, names, country_code, population, importance, lat, lon, timezone, area_wkt, meta) FROM STDIN"
        ) as cp_ent:
            name_rows: list[tuple] = []
            for r in records:
                pc = r.place_class or (place_class_for(r.population, r.feature_code) if r.kind == "locality" else None)
                cp_ent.write_row((
                    r.source, r.source_id, r.admin_code, list(r.parent_codes), r.kind, KIND_RANK[r.kind], pc,
                    r.local_type, r.feature_code, r.name, json.dumps(r.names, ensure_ascii=False), r.country_code,
                    r.population, importance(r.kind, r.population, r.feature_code), r.lat, r.lon, r.timezone,
                    r.area_wkt, json.dumps(r.meta, ensure_ascii=False),
                ))
                n_ent += 1
                name_rows.extend(_name_rows(r))
        with cur.copy(
            "COPY stage_name (source, source_id, name, lang, script, norm, lemma, preferred, colloquial, historic, ntokens)"
            " FROM STDIN"
        ) as cp_name:
            for row in name_rows:
                cp_name.write_row(row)
                n_names += 1

        # Admin rows created earlier under another source key (e.g. offline bundle 'code:RU.38')
        # are re-keyed to the incoming key so the upsert below updates them in place.
        cur.execute("""
            UPDATE geo_entity g SET source = s.source, source_id = s.source_id
            FROM (SELECT DISTINCT ON (admin_code) * FROM stage_entity WHERE admin_code IS NOT NULL) s
            WHERE g.admin_code = s.admin_code AND (g.source, g.source_id) <> (s.source, s.source_id)
              AND NOT EXISTS (SELECT 1 FROM geo_entity x WHERE x.source = s.source AND x.source_id = s.source_id)
        """)
        cur.execute("""
            INSERT INTO geo_entity (source, source_id, admin_code, kind, kind_rank, place_class, local_type, feature_code,
                                    name, names, country_code, population, importance, geom, area, timezone, meta)
            SELECT DISTINCT ON (source, source_id)
                   source, source_id, admin_code, kind, kind_rank, place_class, local_type, feature_code,
                   name, names, country_code, population, importance,
                   CASE WHEN lat IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(lon, lat), 4326) END,
                   CASE WHEN area_wkt IS NULL THEN NULL ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText(area_wkt, 4326)), 3)) END,
                   timezone, meta
            FROM stage_entity
            ORDER BY source, source_id
            ON CONFLICT (source, source_id) DO UPDATE SET
                admin_code   = COALESCE(EXCLUDED.admin_code, geo_entity.admin_code),
                kind         = EXCLUDED.kind, kind_rank = EXCLUDED.kind_rank,
                place_class  = COALESCE(EXCLUDED.place_class, geo_entity.place_class),
                local_type   = COALESCE(EXCLUDED.local_type, geo_entity.local_type),
                feature_code = COALESCE(EXCLUDED.feature_code, geo_entity.feature_code),
                name         = EXCLUDED.name,
                names        = geo_entity.names || EXCLUDED.names,
                country_code = EXCLUDED.country_code,
                population   = GREATEST(EXCLUDED.population, geo_entity.population),
                importance   = GREATEST(EXCLUDED.importance, geo_entity.importance),
                geom         = COALESCE(EXCLUDED.geom, geo_entity.geom),
                area         = COALESCE(EXCLUDED.area, geo_entity.area),
                timezone     = COALESCE(EXCLUDED.timezone, geo_entity.timezone),
                meta         = geo_entity.meta || EXCLUDED.meta,
                updated_at   = now()
        """)
        # Parent = first existing admin code in parent_codes (most specific first).
        cur.execute("""
            UPDATE geo_entity g SET parent_id = p.id
            FROM stage_entity s
            CROSS JOIN LATERAL (
                SELECT e.id FROM unnest(s.parent_codes) WITH ORDINALITY AS pc(code, ord)
                JOIN geo_entity e ON e.admin_code = pc.code
                ORDER BY pc.ord LIMIT 1
            ) p
            WHERE g.source = s.source AND g.source_id = s.source_id AND g.parent_id IS DISTINCT FROM p.id
        """)
        cur.execute("""
            INSERT INTO geo_name (entity_id, name, lang, script, norm, lemma, is_preferred, is_colloquial, is_historic, ntokens)
            SELECT e.id, s.name, s.lang, s.script, s.norm, s.lemma, s.preferred, s.colloquial, s.historic, s.ntokens
            FROM (SELECT DISTINCT ON (source, source_id, name) * FROM stage_name
                  ORDER BY source, source_id, name, preferred DESC, (lang IS NULL)) s
            JOIN geo_entity e ON e.source = s.source AND e.source_id = s.source_id
            ON CONFLICT (entity_id, name) DO UPDATE SET
                lang = COALESCE(EXCLUDED.lang, geo_name.lang),
                is_preferred = geo_name.is_preferred OR EXCLUDED.is_preferred,
                is_colloquial = geo_name.is_colloquial OR EXCLUDED.is_colloquial,
                is_historic = geo_name.is_historic AND EXCLUDED.is_historic
        """)
    conn.commit()
    log.info("loaded %s: %d entities, %d names in %.1fs", batch_label, n_ent, n_names, time.time() - t0)
    return n_ent


def _name_rows(r: PlaceRec):
    seen: set[str] = set()
    items = [(r.name, None, True, False, False)]
    items += [(v, k, True, False, False) for k, v in r.names.items() if v]
    items += [(a.name, a.lang, a.preferred, a.colloquial, a.historic) for a in r.alt_names]
    for name, lang, pref, coll, hist in items:
        name = name.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        n = norm(name)
        yield (r.source, r.source_id, name, lang, script_of(name), n, lemma_key(name, lang), pref, coll, hist,
               len(n.split()))


def rebuild_hierarchy(conn: psycopg.Connection) -> None:
    """Recompute materialized paths and per-level ids top-down, then derived admin geometry/stats."""
    t0 = time.time()
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE geo_entity SET ancestors = '{}',
              continent_id = CASE WHEN kind = 'continent' THEN id END,
              country_id   = CASE WHEN kind = 'country'   THEN id END,
              admin1_id    = CASE WHEN kind = 'admin1'    THEN id END,
              admin2_id    = CASE WHEN kind = 'admin2'    THEN id END,
              locality_id  = CASE WHEN kind = 'locality'  THEN id END
        """)
        for rank in range(2, max(KIND_RANK.values()) + 1):
            cur.execute("""
                UPDATE geo_entity c SET
                  ancestors    = p.ancestors || p.id,
                  continent_id = COALESCE(c.continent_id, p.continent_id),
                  country_id   = COALESCE(c.country_id, p.country_id),
                  admin1_id    = COALESCE(c.admin1_id, p.admin1_id),
                  admin2_id    = COALESCE(c.admin2_id, p.admin2_id),
                  locality_id  = COALESCE(c.locality_id, p.locality_id)
                FROM geo_entity p
                WHERE c.parent_id = p.id AND c.kind_rank = %s AND p.kind_rank < c.kind_rank
            """, (rank,))
        # Admin areas without own coordinates: spherical mean of their localities.
        for level_col, kinds in (("country_id", ("country",)), ("admin1_id", ("admin1",)), ("admin2_id", ("admin2",))):
            cur.execute(f"""
                WITH agg AS (
                  SELECT {level_col} AS id,
                         avg(cos(radians(ST_Y(geom))) * cos(radians(ST_X(geom)))) AS x,
                         avg(cos(radians(ST_Y(geom))) * sin(radians(ST_X(geom)))) AS y,
                         avg(sin(radians(ST_Y(geom)))) AS z,
                         sum(population) AS pop
                  FROM geo_entity WHERE kind = 'locality' AND {level_col} IS NOT NULL AND geom IS NOT NULL
                  GROUP BY {level_col})
                UPDATE geo_entity a SET
                  geom = COALESCE(a.geom, CASE WHEN a.area IS NOT NULL THEN NULL
                         ELSE ST_SetSRID(ST_MakePoint(degrees(atan2(agg.y, agg.x)),
                                                      degrees(atan2(agg.z, sqrt(agg.x*agg.x + agg.y*agg.y)))), 4326) END),
                  population = GREATEST(a.population, agg.pop)
                FROM agg WHERE a.id = agg.id AND a.kind = ANY(%s)
            """, (list(kinds),))
        # Areas with polygons: label point on the largest polygon part.
        cur.execute("""
            UPDATE geo_entity SET geom = (
                SELECT ST_PointOnSurface(d.geom) FROM ST_Dump(area) d ORDER BY ST_Area(d.geom) DESC LIMIT 1)
            WHERE area IS NOT NULL AND geom IS NULL
        """)
        cur.execute(f"""
            UPDATE geo_entity SET importance = round((log(greatest(population, 0) + 10)
                + CASE kind WHEN 'continent' THEN 5 WHEN 'country' THEN 4 WHEN 'admin1' THEN 2.5
                            WHEN 'admin2' THEN 1.5 ELSE 0.8 END)::numeric, 3)
            WHERE kind = ANY(%s) OR kind = 'country'
        """, (list(ADMIN_KINDS),))
    conn.commit()
    log.info("hierarchy rebuilt in %.1fs", time.time() - t0)
