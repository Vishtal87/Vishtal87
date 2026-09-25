"""SQL for sources, raw items, articles, analysis, locations and events."""
from __future__ import annotations

import json
from datetime import datetime, timedelta

import psycopg
from psycopg.types.json import Jsonb


# ---------------------------------------------------------------- raw / source
def get_raw_with_source(conn: psycopg.Connection, raw_id: int) -> dict | None:
    return conn.execute(
        """SELECT r.*, s.slug, s.name AS source_name, s.source_type, s.trust_tier, s.languages, s.country_code,
                  s.home_geo_entity_id, s.timezone AS source_tz, s.synthetic, s.connector
           FROM raw_item r JOIN source s ON s.id = r.source_id WHERE r.id = %s""",
        (raw_id,),
    ).fetchone()


def set_raw_status(conn: psycopg.Connection, raw_id: int, status: str, error: str | None = None) -> None:
    conn.execute("UPDATE raw_item SET status = %s, error = %s WHERE id = %s", (status, error, raw_id))


def insert_raw(conn: psycopg.Connection, source_id: int, external_id: str, url: str | None, payload: str,
               payload_type: str, payload_hash: str) -> int | None:
    row = conn.execute(
        """INSERT INTO raw_item (source_id, external_id, url, payload, payload_type, payload_hash)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (source_id, external_id, payload_hash) DO NOTHING RETURNING id""",
        (source_id, external_id, url, payload, payload_type, payload_hash),
    ).fetchone()
    return row["id"] if row else None


# ---------------------------------------------------------------- articles
def find_article(conn: psycopg.Connection, source_id: int, external_id: str) -> dict | None:
    return conn.execute("SELECT * FROM article WHERE source_id = %s AND external_id = %s",
                        (source_id, external_id)).fetchone()


ARTICLE_FIELDS = ("source_id", "raw_item_id", "external_id", "url", "canonical_url", "title", "text", "excerpt", "lang",
                  "lang_confidence", "published_at", "published_tz_assumed", "event_time", "is_live", "content_hash",
                  "simhash", "sh_b0", "sh_b1", "sh_b2", "sh_b3", "category", "status")


def insert_article(conn: psycopg.Connection, a: dict) -> int:
    cols = ", ".join(ARTICLE_FIELDS)
    ph = ", ".join(f"%({c})s" for c in ARTICLE_FIELDS)
    return conn.execute(f"INSERT INTO article ({cols}) VALUES ({ph}) RETURNING id", a).fetchone()["id"]


def update_article(conn: psycopg.Connection, article_id: int, a: dict) -> None:
    sets = ", ".join(f"{c} = %({c})s" for c in ARTICLE_FIELDS if c not in ("source_id", "external_id"))
    conn.execute(f"UPDATE article SET {sets}, version = version + 1 WHERE id = %(id)s", {**a, "id": article_id})


def save_version(conn: psycopg.Connection, old: dict) -> None:
    conn.execute(
        """INSERT INTO article_version (article_id, version, title, excerpt, content_hash, published_at)
           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
        (old["id"], old["version"], old["title"], old["excerpt"], old["content_hash"], old["published_at"]),
    )


def set_origin(conn: psycopg.Connection, article_id: int, origin_group_id: int, duplicate_of: int | None) -> None:
    conn.execute("UPDATE article SET origin_group_id = %s, duplicate_of = %s WHERE id = %s",
                 (origin_group_id, duplicate_of, article_id))


def add_analysis(conn: psycopg.Connection, article_id: int, stage: str, method: str, output: dict) -> None:
    conn.execute("INSERT INTO article_analysis (article_id, stage, method, output) VALUES (%s, %s, %s, %s)",
                 (article_id, stage, method, Jsonb(output)))


def replace_locations(conn: psycopg.Connection, article_id: int, rows: list[dict]) -> None:
    conn.execute("DELETE FROM article_location WHERE article_id = %s", (article_id,))
    for r in rows:
        conn.execute(
            """INSERT INTO article_location (article_id, geo_entity_id, role, relation, distance_km, geom, precision,
                                             confidence, evidence, method)
               VALUES (%(article_id)s, %(geo_entity_id)s, %(role)s, %(relation)s, %(distance_km)s,
                       CASE WHEN %(lat)s::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326) END,
                       %(precision)s, %(confidence)s, %(evidence)s, %(method)s)""",
            {**r, "article_id": article_id, "evidence": Jsonb(r.get("evidence") or {})},
        )


def exact_duplicate(conn: psycopg.Connection, content_hash: str, canon: str | None, exclude_id: int,
                    since: datetime) -> dict | None:
    return conn.execute(
        """SELECT id, source_id, origin_group_id, published_at FROM article
           WHERE id <> %(ex)s AND published_at >= %(since)s AND (content_hash = %(h)s OR (%(c)s::text IS NOT NULL
                 AND canonical_url = %(c)s))
           ORDER BY published_at, id LIMIT 1""",
        {"ex": exclude_id, "since": since, "h": content_hash, "c": canon},
    ).fetchone()


def simhash_candidates(conn: psycopg.Connection, b: tuple[int, int, int, int], since: datetime, exclude_id: int,
                       limit: int = 50) -> list[dict]:
    return conn.execute(
        """SELECT id, source_id, title, text, simhash, origin_group_id, published_at FROM article
           WHERE id <> %(ex)s AND published_at >= %(since)s
             AND (sh_b0 = %(b0)s OR sh_b1 = %(b1)s OR sh_b2 = %(b2)s OR sh_b3 = %(b3)s)
           ORDER BY published_at LIMIT %(lim)s""",
        {"ex": exclude_id, "since": since, "b0": b[0], "b1": b[1], "b2": b[2], "b3": b[3], "lim": limit},
    ).fetchall()


def same_title_candidates(conn: psycopg.Connection, title: str, since: datetime, exclude_id: int) -> list[dict]:
    return conn.execute(
        """SELECT id, source_id, title, text, simhash, origin_group_id, published_at FROM article
           WHERE md5(lower(title)) = md5(lower(%s)) AND id <> %s AND published_at >= %s LIMIT 20""",
        (title, exclude_id, since),
    ).fetchall()


# ---------------------------------------------------------------- events
EVENT_COLS = """ev.id, ev.title, ev.category, ev.event_type, ev.lang, ev.first_seen_at, ev.last_article_at,
    ev.event_time, ev.geo_entity_id, ev.location_precision, ev.radius_m, ST_Y(ev.geom) AS lat, ST_X(ev.geom) AS lon,
    ev.locality_id, ev.admin2_id, ev.admin1_id, ev.country_id, ev.terms, ev.status"""


def candidate_events(conn: psycopg.Connection, at: datetime, locality_id: int | None, admin1_id: int | None,
                     lat: float | None, lon: float | None, limit: int = 60) -> list[dict]:
    return conn.execute(
        f"""SELECT {EVENT_COLS}, coalesce(ge.population, 0) AS place_population,
                   (SELECT array_agg(DISTINCT a.source_id) FROM event_article ea JOIN article a ON a.id = ea.article_id
                     WHERE ea.event_id = ev.id) AS member_sources
            FROM event ev LEFT JOIN geo_entity ge ON ge.id = ev.geo_entity_id
            WHERE ev.status = 'active'
              AND ev.last_article_at >= %(at)s - interval '72 hours'
              AND ev.first_seen_at <= %(at)s + interval '72 hours'
              AND ( (%(loc)s::bigint IS NOT NULL AND ev.locality_id = %(loc)s)
                 OR (%(a1)s::bigint IS NOT NULL AND ev.admin1_id = %(a1)s)
                 OR (%(lat)s::float8 IS NOT NULL AND ST_DWithin(ev.geom::geography,
                        ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, 60000)) )
            ORDER BY ev.last_article_at DESC
            LIMIT %(lim)s""",
        {"at": at, "loc": locality_id, "a1": admin1_id, "lat": lat, "lon": lon, "lim": limit},
    ).fetchall()


def event_of_article(conn: psycopg.Connection, article_id: int) -> int | None:
    r = conn.execute("SELECT event_id FROM event_article WHERE article_id = %s", (article_id,)).fetchone()
    return r["event_id"] if r else None


def create_event(conn: psycopg.Connection, at: datetime, category: str, title: str) -> int:
    return conn.execute(
        """INSERT INTO event (title, category, first_seen_at, last_article_at, location_precision, location_confidence)
           VALUES (%s, %s, %s, %s, 'unknown', 0) RETURNING id""",
        (title, category, at, at),
    ).fetchone()["id"]


def attach(conn: psycopg.Connection, event_id: int, article_id: int, similarity: float) -> None:
    conn.execute(
        """INSERT INTO event_article (event_id, article_id, similarity) VALUES (%s, %s, %s)
           ON CONFLICT (article_id) DO UPDATE SET event_id = EXCLUDED.event_id, similarity = EXCLUDED.similarity""",
        (event_id, article_id, similarity),
    )


def detach(conn: psycopg.Connection, article_id: int) -> int | None:
    r = conn.execute("DELETE FROM event_article WHERE article_id = %s RETURNING event_id", (article_id,)).fetchone()
    return r["event_id"] if r else None


def event_members(conn: psycopg.Connection, event_id: int) -> list[dict]:
    return conn.execute(
        """SELECT a.id, a.title, a.excerpt, a.lang, a.published_at, a.fetched_at, a.event_time, a.is_live, a.category,
                  a.origin_group_id, a.duplicate_of, a.source_id, s.source_type, s.trust_tier, s.synthetic,
                  al.geo_entity_id AS loc_id, al.precision AS loc_precision, al.confidence AS loc_conf,
                  al.relation AS loc_relation, al.distance_km AS loc_radius,
                  ST_Y(al.geom) AS loc_lat, ST_X(al.geom) AS loc_lon,
                  aa.output AS cluster_features
           FROM event_article ea
           JOIN article a ON a.id = ea.article_id
           JOIN source s ON s.id = a.source_id
           LEFT JOIN LATERAL (SELECT * FROM article_location l WHERE l.article_id = a.id AND l.role IN ('primary','source_area')
                              ORDER BY l.confidence DESC LIMIT 1) al ON true
           LEFT JOIN LATERAL (SELECT output FROM article_analysis x WHERE x.article_id = a.id AND x.stage = 'features'
                              ORDER BY x.id DESC LIMIT 1) aa ON true
           WHERE ea.event_id = %s
           ORDER BY a.published_at, a.id""",
        (event_id,),
    ).fetchall()


def update_event(conn: psycopg.Connection, event_id: int, f: dict) -> None:
    conn.execute(
        """UPDATE event SET title = %(title)s, summary = %(summary)s, lang = %(lang)s, category = %(category)s,
                 event_type = %(event_type)s, first_seen_at = %(first_seen_at)s, last_article_at = %(last_article_at)s,
                 event_time = %(event_time)s, is_live = %(is_live)s, geo_entity_id = %(geo_entity_id)s,
                 location_precision = %(location_precision)s, location_confidence = %(location_confidence)s,
                 location_relation = %(location_relation)s, radius_m = %(radius_m)s,
                 geom = CASE WHEN %(lat)s::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326) END,
                 continent_id = g.continent_id, country_id = g.country_id, admin1_id = g.admin1_id,
                 admin2_id = g.admin2_id, locality_id = g.locality_id,
                 ancestors = CASE WHEN g.id IS NULL THEN '{}'::bigint[] ELSE g.ancestors || g.id END,
                 article_count = %(article_count)s, source_count = %(source_count)s,
                 independent_count = %(independent_count)s, source_types = %(source_types)s,
                 has_official = %(has_official)s, trust_label = %(trust_label)s, synthetic = %(synthetic)s,
                 terms = %(terms)s, updated_at = now(), status = 'active'
           FROM (SELECT NULL::int AS dummy) d
           LEFT JOIN geo_entity g ON g.id = %(geo_entity_id)s
           WHERE event.id = %(id)s""",
        {**f, "id": event_id, "terms": Jsonb(f["terms"])},
    )


def log_change(conn: psycopg.Connection, event_id: int, op: str) -> int:
    log_id = conn.execute("INSERT INTO event_change_log (event_id, op) VALUES (%s, %s) RETURNING id",
                          (event_id, op)).fetchone()["id"]
    row = change_payload(conn, event_id)
    if row:
        conn.execute("SELECT pg_notify('event_changes', %s)", (json.dumps({"log_id": log_id, "op": op, **row}),))
    return log_id


def change_payload(conn: psycopg.Connection, event_id: int) -> dict | None:
    """Compact event summary for realtime clients (well under the 8 kB NOTIFY limit)."""
    r = conn.execute(
        """SELECT ev.id, left(ev.title, 200) AS title, ev.category, ev.source_types, ev.synthetic, ev.is_live,
                  ev.trust_label, ev.source_count, ev.geo_entity_id, ev.ancestors, ev.location_relation, ev.status,
                  ST_Y(ev.geom) AS lat, ST_X(ev.geom) AS lon, ev.last_article_at,
                  (SELECT coalesce(g.names->>'ru', g.name) FROM geo_entity g WHERE g.id = ev.geo_entity_id) AS place_ru,
                  (SELECT g.name FROM geo_entity g WHERE g.id = ev.geo_entity_id) AS place_en
           FROM event ev WHERE ev.id = %s""", (event_id,)).fetchone()
    if not r:
        return None
    return {**r, "ancestors": list(r["ancestors"] or []), "last_article_at": r["last_article_at"].isoformat()}


def since(dt: datetime, days: int) -> datetime:
    return dt - timedelta(days=days)
