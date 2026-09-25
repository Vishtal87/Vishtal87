"""Worker processes: ingest (poll sources), process (pipeline), maintenance (housekeeping)."""
from __future__ import annotations

import logging
import os
import time

from geonews.db.pool import connect
from geonews.queue import pg_queue

log = logging.getLogger(__name__)


def run_ingest(once: bool) -> None:
    from geonews.ingestion.fetcher import Fetcher
    from geonews.workers.ingest import run_once

    fetcher = Fetcher(min_interval_s=float(os.environ.get("GEONEWS_HOST_INTERVAL_S", "1.0")))
    with connect() as conn:
        seen: set[str] = set()
        while True:
            res = run_once(conn, fetcher)
            if once and (not res or all(r["source"] in seen for r in res)):
                return  # --once: one pass over every due source
            seen.update(r["source"] for r in res)
            if not res:
                time.sleep(2)


def run_process(once: bool) -> None:
    from geonews.pipeline import language
    from geonews.pipeline.runner import Processor

    language.warm_up()
    worker = f"process-{os.getpid()}"
    with connect() as conn:
        proc = Processor(conn)
        while True:
            jobs = pg_queue.claim(conn, ["process_raw"], worker, limit=20)
            for job in jobs:
                t = time.time()
                try:
                    r = proc.process_raw(job["payload"]["raw_id"])
                    pg_queue.complete(conn, job["id"])
                    conn.commit()
                    log.info("raw %s -> %s (%.0f ms)", job["payload"]["raw_id"], r, (time.time() - t) * 1000)
                except Exception as e:
                    conn.rollback()
                    log.exception("job %s failed", job["id"])
                    pg_queue.fail(conn, job, f"{e.__class__.__name__}: {e}")
                    conn.execute("UPDATE raw_item SET status = 'failed', error = %s WHERE id = %s",
                                 (str(e)[:1000], job["payload"]["raw_id"]))
                    conn.commit()
            if once and not jobs:
                return
            if not jobs:
                time.sleep(0.5)


def run_maintenance(once: bool) -> None:
    from geonews.config import settings

    with connect() as conn:
        while True:
            n = pg_queue.reap_stale(conn)
            p = pg_queue.purge_done(conn)
            # copyright hygiene: drop raw payloads after the retention period (derived data + links remain)
            r = conn.execute(
                "UPDATE raw_item SET payload = NULL WHERE payload IS NOT NULL AND fetched_at < now() - make_interval(days => %s)",
                (settings.raw_retention_days,)).rowcount
            c = conn.execute("DELETE FROM event_change_log WHERE changed_at < now() - interval '2 days'").rowcount
            conn.commit()
            from geonews.pipeline.merge import merge_similar_events

            m = merge_similar_events(conn)
            if m:
                log.info("maintenance: merged %d duplicate events", m)
            if n or p or r or c:
                log.info("maintenance: reaped=%s purged_jobs=%s raw_payloads_dropped=%s changelog_trimmed=%s", n, p, r, c)
            if once:
                return
            time.sleep(float(os.environ.get("GEONEWS_MAINTENANCE_INTERVAL_S", "30")))


def run_worker(kind: str, once: bool = False) -> None:
    if kind == "all":
        import threading

        threads = [threading.Thread(target=f, args=(once,), daemon=True) for f in (run_ingest, run_process, run_maintenance)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        return
    {"ingest": run_ingest, "process": run_process, "maintenance": run_maintenance}[kind](once)
