"""PostGIS implementation of the geoparser's GazetteerPort, with a small in-process cache."""
from __future__ import annotations

from collections import OrderedDict
from typing import Sequence

import psycopg

from geonews.pipeline.geoparse.model import Candidate

_COLS = """e.id, e.kind, e.name, e.names->>'ru' AS name_ru, ST_Y(e.geom) AS lat, ST_X(e.geom) AS lon, e.population,
           e.importance, e.country_code, e.country_id, e.admin1_id, e.admin2_id, e.locality_id, e.ancestors,
           e.place_class"""


def _cand(r: dict) -> Candidate:
    return Candidate(
        id=r["id"], kind=r["kind"], name=r.get("name_ru") or r["name"], matched=r.get("matched") or r["name"],
        lat=r["lat"], lon=r["lon"], population=r["population"], importance=r["importance"],
        country_code=r["country_code"], country_id=r["country_id"], admin1_id=r["admin1_id"],
        admin2_id=r["admin2_id"], locality_id=r["locality_id"], ancestors=tuple(r["ancestors"] or ()),
        place_class=r["place_class"], colloquial=bool(r.get("colloquial")),
    )


class PgGazetteer:
    def __init__(self, conn: psycopg.Connection, cache_size: int = 50_000):
        self.conn = conn
        self._cache: OrderedDict[str, list[Candidate]] = OrderedDict()
        self._cache_size = cache_size

    def lookup(self, keys: Sequence[str], per_key_limit: int = 40) -> dict[str, list[Candidate]]:
        out: dict[str, list[Candidate]] = {}
        missing = []
        for k in keys:
            if k in self._cache:
                self._cache.move_to_end(k)
                out[k] = self._cache[k]
            else:
                missing.append(k)
        if missing:
            rows = self.conn.execute(
                f"""
                WITH hits AS (
                  SELECT k.key, n.entity_id, bool_or(n.is_colloquial) AS colloquial, min(n.name) AS matched
                  FROM unnest(%(keys)s::text[]) AS k(key)
                  JOIN geo_name n ON n.lemma = k.key OR n.norm = k.key
                  GROUP BY k.key, n.entity_id
                ), ranked AS (
                  SELECT h.*, row_number() OVER (PARTITION BY h.key ORDER BY e.importance DESC) AS rn
                  FROM hits h JOIN geo_entity e ON e.id = h.entity_id AND e.geom IS NOT NULL
                )
                SELECT r.key, r.colloquial, r.matched, {_COLS}
                FROM ranked r JOIN geo_entity e ON e.id = r.entity_id
                WHERE r.rn <= %(lim)s
                """,
                {"keys": missing, "lim": per_key_limit},
            ).fetchall()
            got: dict[str, list[Candidate]] = {k: [] for k in missing}
            for r in rows:
                got[r["key"]].append(_cand(r))
            for k, v in got.items():
                self._cache[k] = v
                out[k] = v
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return out

    def lookup_within(self, keys: Sequence[str], area_ids: Sequence[int]) -> dict[str, list[Candidate]]:
        rows = self.conn.execute(
            f"""
            SELECT k.key, bool_or(n.is_colloquial) AS colloquial, min(n.name) AS matched, {_COLS}
            FROM unnest(%(keys)s::text[]) AS k(key)
            JOIN geo_name n ON n.lemma = k.key OR n.norm = k.key
            JOIN geo_entity e ON e.id = n.entity_id
            WHERE e.geom IS NOT NULL AND e.ancestors && %(areas)s::bigint[]
            GROUP BY k.key, e.id
            LIMIT 500
            """,
            {"keys": list(keys), "areas": list(area_ids)},
        ).fetchall()
        out: dict[str, list[Candidate]] = {}
        for r in rows:
            out.setdefault(r["key"], []).append(_cand(r))
        return out

    def nearest_locality(self, lat: float, lon: float, max_km: float = 10) -> Candidate | None:
        r = self.conn.execute(
            f"""SELECT {_COLS} FROM geo_entity e
                WHERE e.kind = 'locality'
                  AND ST_DWithin(e.geom::geography, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(m)s)
                ORDER BY e.geom <-> ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326) LIMIT 1""",
            {"lat": lat, "lon": lon, "m": max_km * 1000},
        ).fetchone()
        return _cand(r) if r else None

    def parents_of(self, ids: Sequence[int]) -> dict[int, Candidate]:
        rows = self.conn.execute(f"SELECT {_COLS} FROM geo_entity e WHERE e.id = ANY(%s)", (list(ids),)).fetchall()
        return {r["id"]: _cand(r) for r in rows}
