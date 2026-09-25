"""Russian display names of foreign localities picked by the old offline heuristic: 'Лос Анђелес' (a Serbian
letter), 'Тел-Авив', 'Буенос-Аирес' (Serbian spellings). Re-pick with the current heuristic from the names the
gazetteer already has, but replace only a clearly foreign spelling, so language-tagged names from full GeoNames
dumps stay as they are: the old name is spelled in a way Russian never is (records.non_russian), or the new one differs by at most two letters
and has Russian spelling signs the old one lacks (records.ru_like)."""
from __future__ import annotations

import json
import logging

from geonews.gazetteer.records import non_russian, pick_ru_display, ru_like

log = logging.getLogger(__name__)


def _distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def better_name(current: str, latin: str, variants: list[str]) -> str | None:
    new = pick_ru_display(latin, variants)
    if not new or new == current:
        return None
    if non_russian(current) and not non_russian(new):
        return new
    if _distance(current.lower(), new.lower()) <= 2 and ru_like(new) and not ru_like(current):
        return new
    return None


def run(conn) -> None:
    rows = conn.execute(
        """SELECT e.id, e.name, e.names->>'ru' AS ru, array_agg(n.name) AS variants
           FROM geo_entity e JOIN geo_name n ON n.entity_id = e.id AND n.script = 'cyrl'
           WHERE e.kind = 'locality' AND e.country_code <> 'RU' AND e.names ? 'ru'
           GROUP BY e.id""").fetchall()
    fixed = 0
    for r in rows:
        new = better_name(r["ru"], r["name"], r["variants"])
        if new:
            conn.execute("UPDATE geo_entity SET names = names || %s::jsonb WHERE id = %s",
                         (json.dumps({"ru": new}, ensure_ascii=False), r["id"]))
            fixed += 1
    log.info("foreign Russian names fixed: %d of %d", fixed, len(rows))
