"""Geolocation rules changed in ways that make already stored locations wrong (surnames taken for villages, a
national outlet's home-country bonus, a big-city portal's "no place -> the city" fallback). Rebuild all derived
news data from the raw items the database keeps: articles, locations and events are recreated by the process
worker with the current rules, in the order they were collected. Raw items whose payload is already gone
(retention) cannot be reprocessed. A fresh database has nothing to do."""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def run(conn) -> None:
    n = conn.execute("SELECT count(*) AS n FROM raw_item WHERE payload IS NOT NULL").fetchone()["n"]
    if not n:
        return
    conn.execute("TRUNCATE event_change_log, event_relation, event_article, event, article_location, article_analysis, "
                 "article_version, article, event_rollup RESTART IDENTITY CASCADE")
    conn.execute("DELETE FROM job WHERE kind = 'process_raw'")
    conn.execute("UPDATE raw_item SET status = 'new' WHERE payload IS NOT NULL")
    conn.execute("INSERT INTO job (kind, payload) SELECT 'process_raw', jsonb_build_object('raw_id', id) "
                 "FROM raw_item WHERE payload IS NOT NULL ORDER BY id")
    log.info("reprocessing %d collected items with the current pipeline", n)
