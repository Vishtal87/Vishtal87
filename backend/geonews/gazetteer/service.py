"""Gazetteer use-cases: import offline bundle / full GeoNames dumps, apply aliases, rebuild hierarchy."""
from __future__ import annotations

import logging
from itertools import islice
from pathlib import Path
from typing import Iterable, Iterator

import yaml

from geonews.config import settings
from geonews.db.pool import connect
from geonews.domain.text_norm import lemma_key, norm, script_of
from geonews.gazetteer import geonames_dump, offline_bundle
from geonews.gazetteer.loader import load_places, rebuild_hierarchy
from geonews.gazetteer.records import PlaceRec

log = logging.getLogger(__name__)
BATCH = 20_000


def _batched(it: Iterable[PlaceRec], n: int) -> Iterator[list[PlaceRec]]:
    it = iter(it)
    while chunk := list(islice(it, n)):
        yield chunk


def _load_ordered(records: Iterable[PlaceRec], label: str) -> int:
    """Load parents before children (continent -> country -> admins -> localities) so parent links resolve."""
    order = ["continent", "country", "admin1", "admin2", "admin3", "admin4", "admin5", "locality", "sublocality"]
    by_kind: dict[str, list[PlaceRec]] = {k: [] for k in order}
    for r in records:
        by_kind[r.kind].append(r)
    total = 0
    with connect() as conn:
        for kind in order:
            for chunk in _batched(by_kind[kind], BATCH):
                total += load_places(conn, chunk, f"{label}/{kind}")
    return total


def import_offline() -> int:
    n = _load_ordered(offline_bundle.iter_records(), "offline")
    finish()
    return n


def import_geonames(dump_dir: Path, countries: list[str]) -> int:
    # Usually `import-offline` ran first (global coverage); a full dump then deepens chosen countries.
    total = 0 if _has_continents() else _load_ordered(offline_bundle.continent_records(), "continents")
    for cc in countries:
        main = f"{cc}.txt"
        alt = f"alternatenames_{cc}.txt" if cc != "allCountries" else None
        total += _load_ordered(geonames_dump.iter_records(dump_dir, main, alt), f"geonames/{cc}")
    finish()
    return total


def _has_continents() -> bool:
    with connect() as conn:
        return bool(conn.execute("SELECT 1 FROM geo_entity WHERE kind='continent' LIMIT 1").fetchone())


def finish() -> None:
    with connect() as conn:
        _attach_sublocalities(conn)
        rebuild_hierarchy(conn)
        apply_aliases(conn)
        conn.execute("ANALYZE geo_entity")
        conn.execute("ANALYZE geo_name")
        conn.commit()


def _attach_sublocalities(conn) -> None:
    """GeoNames PPLX (city sections) carry admin codes only; attach each to the nearest locality (<=25 km)."""
    conn.execute("""
        UPDATE geo_entity s SET parent_id = COALESCE((
            SELECT l.id FROM geo_entity l
            WHERE l.kind = 'locality' AND l.country_code = s.country_code
              AND ST_DWithin(l.geom::geography, s.geom::geography, 25000)
            ORDER BY l.geom <-> s.geom, l.population DESC LIMIT 1), s.parent_id)
        WHERE s.kind = 'sublocality'
    """)
    conn.commit()


def apply_aliases(conn) -> int:
    path = settings.config_dir / "gazetteer_aliases.yaml"
    if not path.exists():
        return 0
    n = 0
    for a in yaml.safe_load(path.read_text()) or []:
        row = conn.execute(
            """SELECT e.id FROM geo_entity e JOIN geo_name gn ON gn.entity_id = e.id
               WHERE e.country_code = %s AND e.kind = %s AND gn.norm = %s
               ORDER BY e.importance DESC LIMIT 1""",
            (a["country"], a["kind"], norm(a["name"])),
        ).fetchone()
        if not row:
            log.warning("alias target not found: %s", a)
            continue
        for alias in a["aliases"]:
            conn.execute(
                """INSERT INTO geo_name (entity_id, name, lang, script, norm, lemma, is_colloquial, ntokens)
                   VALUES (%s, %s, NULL, %s, %s, %s, true, %s) ON CONFLICT (entity_id, name) DO NOTHING""",
                (row["id"], alias, script_of(alias), norm(alias), lemma_key(alias), len(norm(alias).split())),
            )
            n += 1
    conn.commit()
    return n
