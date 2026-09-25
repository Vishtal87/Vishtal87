"""Ingest worker: polls due sources, stores raw items as received, queues them for processing.

Health & backoff: a failing source (HTTP 5xx, timeout, malformed feed, robots disallow) is retried with
exponential backoff (interval * 2^failures, capped at 6h); the rest of the system keeps working.
"""
from __future__ import annotations

import logging
import socket
from datetime import timedelta

import psycopg

from geonews.db.repos import news_repo
from geonews.ingestion.connectors import CONNECTORS
from geonews.ingestion.fetcher import FetchError, Fetcher
from geonews.queue import pg_queue

log = logging.getLogger(__name__)
MAX_BACKOFF_S = 6 * 3600


def claim_due_sources(conn: psycopg.Connection, limit: int = 5) -> list[dict]:
    rows = conn.execute(
        """UPDATE source SET last_attempt_at = now(), next_poll_at = now() + interval '10 minutes'
           WHERE id IN (SELECT id FROM source WHERE enabled AND next_poll_at <= now()
                        ORDER BY next_poll_at LIMIT %s FOR UPDATE SKIP LOCKED)
           RETURNING *""",
        (limit,),
    ).fetchall()
    conn.commit()
    return rows


def poll_source(conn: psycopg.Connection, fetcher: Fetcher, src: dict) -> dict:
    connector = CONNECTORS.get(src["connector"])
    if connector is None:
        raise FetchError(f"unknown connector {src['connector']}")
    if src["connector"] in ("html_list", "sitemap_news"):   # page-based: skip articles already collected
        src = dict(src, known_ids=[r["external_id"] for r in conn.execute(
            "SELECT external_id FROM raw_item WHERE source_id = %s ORDER BY id DESC LIMIT 500", (src["id"],))])
    res = connector.fetch(src, fetcher)
    new = 0
    for e in res.entries:
        raw_id = news_repo.insert_raw(conn, src["id"], e.external_id, e.url, e.payload(), "entry-json", e.payload_hash())
        if raw_id:
            pg_queue.enqueue(conn, "process_raw", {"raw_id": raw_id})
            new += 1
    conn.execute(
        """UPDATE source SET last_success_at = now(), consecutive_failures = 0, last_error = NULL,
                  next_poll_at = now() + make_interval(secs => poll_interval_s),
                  http_etag = coalesce(%s, http_etag), http_last_modified = coalesce(%s, http_last_modified)
           WHERE id = %s""",
        (res.etag, res.last_modified, src["id"]),
    )
    conn.commit()
    return {"source": src["slug"], "entries": len(res.entries), "new": new, "not_modified": res.not_modified}


def record_failure(conn: psycopg.Connection, src: dict, err: str) -> None:
    fails = src["consecutive_failures"] + 1
    delay = min(src["poll_interval_s"] * 2 ** fails, MAX_BACKOFF_S)
    conn.execute(
        """UPDATE source SET consecutive_failures = %s, last_error = %s, next_poll_at = now() + %s WHERE id = %s""",
        (fails, err[:1000], timedelta(seconds=delay), src["id"]),
    )
    conn.commit()
    log.warning("source %s failed (%d in a row, next try in %ss): %s", src["slug"], fails, delay, err)


def run_once(conn: psycopg.Connection, fetcher: Fetcher) -> list[dict]:
    out = []
    for src in claim_due_sources(conn):
        try:
            r = poll_source(conn, fetcher, src)
            log.info("polled %(source)s: %(entries)d entries, %(new)d new", r)
            out.append(r)
        except (FetchError, ValueError) as e:
            conn.rollback()
            record_failure(conn, src, str(e))
            out.append({"source": src["slug"], "error": str(e)})
        except Exception as e:  # never let one source kill the worker
            conn.rollback()
            record_failure(conn, src, f"{e.__class__.__name__}: {e}")
            log.exception("unexpected error polling %s", src["slug"])
            out.append({"source": src["slug"], "error": str(e)})
    return out


WORKER_ID = f"{socket.gethostname()}"
