"""Load test: synthetic events straight into the DB (bypassing ingestion) + API latency measurement.

  python scripts/loadtest.py insert --events 1000000 --dense "Moscow" --dense-count 50000
  python scripts/loadtest.py measure [--runs 20] [--concurrency 8]
  python scripts/loadtest.py cleanup
All generated rows are titled 'LOADTEST …', marked synthetic, and removed by `cleanup`.
"""
from __future__ import annotations

import argparse
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import psycopg

DSN = "postgresql://geonews:geonews@127.0.0.1:5432/geonews"
API = "http://127.0.0.1:8000"
CATS = ["incidents", "crime", "weather", "transport", "politics", "economy", "business", "society", "culture",
        "sport", "technology", "official"]


def insert(n: int, dense: str, dense_n: int) -> None:
    with psycopg.connect(DSN) as c:
        t = time.time()
        c.execute("ALTER TABLE event DISABLE TRIGGER event_rollup_ins")   # bulk path: rebuild once at the end
        c.execute("""CREATE TEMP TABLE loc AS SELECT row_number() OVER () AS rn, id, geom, continent_id, country_id,
                     admin1_id, admin2_id, ancestors FROM geo_entity WHERE kind = 'locality' AND geom IS NOT NULL""")
        nloc = c.execute("SELECT count(*) FROM loc").fetchone()[0]
        c.execute(f"""
            INSERT INTO event (title, category, first_seen_at, last_article_at, location_precision, location_confidence,
                   geo_entity_id, geom, continent_id, country_id, admin1_id, admin2_id, locality_id, ancestors,
                   article_count, source_count, independent_count, source_types, trust_label, synthetic, is_live,
                   updated_at, lang)
            SELECT 'LOADTEST event ' || s, (%(cats)s::text[])[1 + (s %% 12)], x.t, x.t + random() * interval '3 hours',
                   'locality', 0.9, l.id, l.geom, l.continent_id, l.country_id, l.admin1_id, l.admin2_id, l.id,
                   l.ancestors || l.id, 1 + (s %% 5), 1 + (s %% 4), 1 + (s %% 3),
                   CASE s %% 4 WHEN 0 THEN ARRAY['telegram'] WHEN 1 THEN ARRAY['media']
                        WHEN 2 THEN ARRAY['official', 'media'] ELSE ARRAY['youtube'] END,
                   (ARRAY['single_source','multiple_sources','official','unverified'])[1 + (s %% 4)], true, true,
                   now() - interval '1 day', 'ru'
            FROM generate_series(1, %(n)s) s
            CROSS JOIN LATERAL (SELECT now() - random() * interval '7 days' AS t, 1 + floor(random() * {nloc})::int + 0 * s AS rn) x
            JOIN loc l ON l.rn = x.rn""", {"cats": CATS, "n": n})
        print(f"inserted {n} events over {nloc} localities in {time.time() - t:.0f}s")
        if dense_n:
            t = time.time()
            c.execute(f"""
                INSERT INTO event (title, category, first_seen_at, last_article_at, location_precision, location_confidence,
                       geo_entity_id, geom, continent_id, country_id, admin1_id, admin2_id, locality_id, ancestors,
                       article_count, source_count, independent_count, source_types, trust_label, synthetic, is_live,
                       updated_at, lang)
                SELECT 'LOADTEST dense ' || s, (%(cats)s::text[])[1 + (s %% 12)], x.t, x.t, 'locality', 0.9, g.id,
                       ST_SetSRID(ST_MakePoint(ST_X(g.geom) + (random() - 0.5) * 0.3, ST_Y(g.geom) + (random() - 0.5) * 0.2), 4326),
                       g.continent_id, g.country_id, g.admin1_id, g.admin2_id, g.id, g.ancestors || g.id, 1, 1, 1,
                       ARRAY['media'], 'single_source', true, true, now() - interval '1 day', 'ru'
                FROM generate_series(1, %(n)s) s
                CROSS JOIN LATERAL (SELECT now() - random() * interval '24 hours' + 0 * s * interval '1 s' AS t) x
                JOIN geo_entity g ON g.id = (SELECT id FROM geo_entity WHERE name = %(city)s AND kind = 'locality'
                                             ORDER BY population DESC LIMIT 1)""", {"cats": CATS, "n": dense_n, "city": dense})
            print(f"inserted {dense_n} events in {dense} in {time.time() - t:.0f}s")
        c.execute("ALTER TABLE event ENABLE TRIGGER event_rollup_ins")
        print("rollup rebuilt:", c.execute("SELECT rebuild_event_rollup()").fetchone()[0], "rows")
        c.commit()
        c.execute("ANALYZE event")
        print("total active events:", c.execute("SELECT count(*) FROM event WHERE status='active'").fetchone()[0])


def cleanup() -> None:
    """Bulk delete with the per-row rollup triggers off, then one set-based rollup rebuild."""
    with psycopg.connect(DSN) as c:
        c.execute("ALTER TABLE event DISABLE TRIGGER event_rollup_del")
        try:
            n = c.execute("DELETE FROM event WHERE title LIKE 'LOADTEST %'").rowcount
        finally:
            c.execute("ALTER TABLE event ENABLE TRIGGER event_rollup_del")
        rows = c.execute("SELECT rebuild_event_rollup()").fetchone()[0]
        c.commit()
        print("deleted", n, "events; rollup rebuilt:", rows, "rows")


def measure(runs: int, concurrency: int) -> None:
    with psycopg.connect(DSN) as c:
        moscow = c.execute("SELECT id FROM geo_entity WHERE name='Moscow' AND kind='locality' ORDER BY population DESC LIMIT 1").fetchone()[0]
        krai = c.execute("SELECT id FROM geo_entity WHERE admin_code='RU.38'").fetchone()[0]
        hamlet = c.execute("SELECT id FROM geo_entity WHERE name='Kashtany' AND country_code='RU'").fetchone()[0]
    cases = {
        "aggregate continent 24h": "/api/map/aggregate?level=continent&window=24h",
        "aggregate country 7d": "/api/map/aggregate?level=country&window=7d",
        "aggregate admin1 24h (Europe view)": "/api/map/aggregate?level=admin1&window=24h&bbox=-12,34,45,62",
        "aggregate admin1 7d + cats (Europe)": "/api/map/aggregate?level=admin1&window=7d&cats=incidents,weather&bbox=-12,34,45,62",
        "locality bbox Kuban 24h": "/api/map/aggregate?level=locality&window=24h&bbox=36.5,43.3,41.8,46.9",
        "events bbox Moscow (dense) 24h": "/api/map/aggregate?level=events&window=24h&bbox=37.3,55.5,37.9,55.95",
        "place feed Moscow 24h": f"/api/places/{moscow}/events?window=24h",
        "place feed Krasnodar Krai 7d": f"/api/places/{krai}/events?window=7d",
        "place feed hamlet 7d": f"/api/places/{hamlet}/events?window=7d",
        "search 'Ивановка'": "/api/geo/search?q=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%D0%BA%D0%B0&lang=ru",
        "tile z5": "/tiles/base/5/19/11.pbf?lang=ru",
    }
    with httpx.Client(base_url=API, timeout=60) as cl:
        print(f"{'endpoint':<36} {'p50 ms':>8} {'p95 ms':>8} {'max':>8}  size")
        for name, url in cases.items():
            cl.get(url)  # warm-up
            lat = []
            size = 0
            for _ in range(runs):
                t = time.perf_counter()
                r = cl.get(url)
                lat.append((time.perf_counter() - t) * 1000)
                size = len(r.content)
                r.raise_for_status()
            lat.sort()
            print(f"{name:<36} {statistics.median(lat):8.0f} {lat[int(len(lat) * 0.95) - 1]:8.0f} {lat[-1]:8.0f}  {size // 1024} KB")
    # concurrency: mixed map workload
    urls = list(cases.values())[:7] * 10
    t = time.perf_counter()
    lat = []

    shared = httpx.Client(base_url=API, timeout=120, limits=httpx.Limits(max_connections=concurrency))

    def hit(u):
        s = time.perf_counter()
        shared.get(u).raise_for_status()
        return (time.perf_counter() - s) * 1000

    with ThreadPoolExecutor(concurrency) as ex:
        lat = sorted(ex.map(hit, urls))
    shared.close()
    dt = time.perf_counter() - t
    print(f"\nconcurrency {concurrency}: {len(urls)} requests in {dt:.1f}s = {len(urls) / dt:.1f} req/s, "
          f"p50 {statistics.median(lat):.0f} ms, p95 {lat[int(len(lat) * 0.95) - 1]:.0f} ms")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("insert")
    i.add_argument("--events", type=int, default=1_000_000)
    i.add_argument("--dense", default="Moscow")
    i.add_argument("--dense-count", type=int, default=50_000)
    m = sub.add_parser("measure")
    m.add_argument("--runs", type=int, default=15)
    m.add_argument("--concurrency", type=int, default=8)
    sub.add_parser("cleanup")
    a = ap.parse_args()
    {"insert": lambda: insert(a.events, a.dense, a.dense_count), "measure": lambda: measure(a.runs, a.concurrency),
     "cleanup": cleanup}[a.cmd]()
    sys.exit(0)
