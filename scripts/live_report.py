"""Quality report of a live run: which sources delivered, how stories were placed on the map and why.

Reads the database of GEONEWS_DSN. Used by .github/workflows/live-check.yml; also works on a server:
  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T api python - < scripts/live_report.py
"""
from __future__ import annotations

import json

from geonews.db.pool import connect


def short(s: str | None, n: int) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def main() -> None:
    with connect() as c:
        print("== SOURCES (articles, failures, last error)")
        for r in c.execute("""SELECT s.slug, s.connector, s.consecutive_failures AS fails, s.last_error,
                                     (SELECT count(*) FROM article a WHERE a.source_id = s.id) AS n
                              FROM source s WHERE s.enabled ORDER BY n DESC, s.slug"""):
            print(f"{r['n']:>5}  {r['slug']:<24} {r['connector']:<13} fails={r['fails']} {short(r['last_error'], 110)}")

        n_art = c.execute("SELECT count(*) AS n FROM article").fetchone()["n"]
        n_loc = c.execute("""SELECT count(DISTINCT article_id) AS n FROM article_location
                             WHERE role IN ('primary', 'source_area')""").fetchone()["n"]
        print(f"\n== TOTALS  articles {n_art}, placed {n_loc} ({100 * n_loc // max(n_art, 1)}%)")
        for r in c.execute("""SELECT location_precision AS p, location_relation AS rel, count(*) AS n FROM event
                              WHERE status = 'active' GROUP BY 1, 2 ORDER BY 3 DESC"""):
            print(f"   events {r['n']:>5}  precision={r['p']:<12} relation={r['rel']}")

        print("\n== EVENTS, newest first: [articles] precision conf | place < region | title")
        for r in c.execute("""SELECT e.title, e.location_precision AS p, e.location_confidence AS conf, e.category,
                                     coalesce(g.names->>'ru', g.name) AS place, coalesce(a1.names->>'ru', a1.name) AS region,
                                     (SELECT count(*) FROM event_article ea WHERE ea.event_id = e.id) AS n
                              FROM event e LEFT JOIN geo_entity g ON g.id = e.geo_entity_id
                                           LEFT JOIN geo_entity a1 ON a1.id = e.admin1_id
                              WHERE e.status = 'active' ORDER BY e.last_article_at DESC LIMIT 120"""):
            print(f"[{r['n']}] {r['p']:<9} {r['conf']:.2f} | {short(r['place'], 28)} < {short(r['region'], 26)} "
                  f"| {r['category']:<10} | {short(r['title'], 100)}")

        print("\n== WHY HERE (per article): place [precision conf relation] <- evidence | title | lead")
        for r in c.execute("""SELECT s.slug, a.title, left(a.text, 400) AS lead, l.precision, l.confidence, l.relation,
                                     l.evidence, coalesce(g.names->>'ru', g.name) AS place
                              FROM article a JOIN source s ON s.id = a.source_id
                              LEFT JOIN article_location l ON l.article_id = a.id AND l.role IN ('primary', 'source_area')
                              LEFT JOIN geo_entity g ON g.id = l.geo_entity_id
                              ORDER BY a.published_at DESC LIMIT 150"""):
            ev = r["evidence"] or {}
            why = ev.get("span") or ev.get("text") or ev.get("reason") or json.dumps(ev, ensure_ascii=False)
            place = (f"{short(r['place'], 26)} [{r['precision']} {r['confidence']:.2f} {r['relation']}]"
                     if r["precision"] else "— not placed —")
            print(f"{r['slug']:<18} {place} <- {short(str(why), 60)}\n    {short(r['title'], 110)}\n"
                  f"    {short(r['lead'], 220)}")


if __name__ == "__main__":
    main()
