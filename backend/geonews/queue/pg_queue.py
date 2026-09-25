"""Job queue on PostgreSQL (FOR UPDATE SKIP LOCKED): transactional with the data, no extra infra.

Swap for Redis Streams/Kafka behind the same functions if throughput ever requires it.
"""
from __future__ import annotations

import json
from datetime import timedelta

import psycopg

RETRY_BASE_S = 15


def enqueue(conn: psycopg.Connection, kind: str, payload: dict, delay_s: float = 0, max_attempts: int = 5) -> int:
    row = conn.execute(
        "INSERT INTO job (kind, payload, run_after, max_attempts) VALUES (%s, %s, now() + %s, %s) RETURNING id",
        (kind, json.dumps(payload), timedelta(seconds=delay_s), max_attempts),
    ).fetchone()
    return row["id"]


def claim(conn: psycopg.Connection, kinds: list[str], worker: str, limit: int = 10) -> list[dict]:
    rows = conn.execute(
        """
        UPDATE job SET status = 'running', locked_by = %(w)s, locked_at = now(), attempts = attempts + 1
        WHERE id IN (
            SELECT id FROM job
            WHERE status = 'queued' AND kind = ANY(%(kinds)s) AND run_after <= now()
            ORDER BY run_after, id
            LIMIT %(n)s
            FOR UPDATE SKIP LOCKED)
        RETURNING id, kind, payload, attempts, max_attempts
        """,
        {"w": worker, "kinds": kinds, "n": limit},
    ).fetchall()
    conn.commit()
    return rows


def complete(conn: psycopg.Connection, job_id: int) -> None:
    conn.execute("UPDATE job SET status = 'done', finished_at = now(), last_error = NULL WHERE id = %s", (job_id,))


def fail(conn: psycopg.Connection, job: dict, error: str) -> None:
    final = job["attempts"] >= job["max_attempts"]
    conn.execute(
        """UPDATE job SET status = %s, last_error = %s, locked_by = NULL,
                  run_after = now() + %s, finished_at = CASE WHEN %s THEN now() END
           WHERE id = %s""",
        ("failed" if final else "queued", error[:2000], timedelta(seconds=RETRY_BASE_S * 2 ** job["attempts"]), final,
         job["id"]),
    )


def reap_stale(conn: psycopg.Connection, older_than_s: int = 600) -> int:
    """Jobs locked by a crashed worker go back to the queue."""
    cur = conn.execute(
        "UPDATE job SET status = 'queued', locked_by = NULL WHERE status = 'running' AND locked_at < now() - %s",
        (timedelta(seconds=older_than_s),),
    )
    return cur.rowcount


def purge_done(conn: psycopg.Connection, older_than_h: int = 24) -> int:
    cur = conn.execute("DELETE FROM job WHERE status = 'done' AND finished_at < now() - %s",
                       (timedelta(hours=older_than_h),))
    return cur.rowcount


def stats(conn: psycopg.Connection) -> list[dict]:
    return conn.execute("SELECT kind, status, count(*) AS n FROM job GROUP BY 1, 2 ORDER BY 1, 2").fetchall()
