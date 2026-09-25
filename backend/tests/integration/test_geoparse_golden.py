"""Golden-set accuracy against the real (offline) gazetteer in the main database.
Skipped when the main DB has no gazetteer loaded (GEONEWS_EVAL_DSN)."""
import os

import psycopg
import pytest

EVAL_DSN = os.environ.get("GEONEWS_EVAL_DSN", "postgresql://geonews:geonews@127.0.0.1:5432/geonews")


def test_golden_geoparse_accuracy(monkeypatch):
    try:
        with psycopg.connect(EVAL_DSN) as c:
            n = c.execute("SELECT count(*) FROM geo_entity WHERE kind = 'locality'").fetchone()[0]
    except Exception as e:
        pytest.skip(f"eval DB unavailable: {e}")
    if n < 100_000:
        pytest.skip("gazetteer not loaded in eval DB")
    import geonews.db.pool as pool
    from geonews.config import Settings

    monkeypatch.setattr(pool, "settings", Settings(dsn=EVAL_DSN))
    monkeypatch.setattr(pool, "_pool", None)
    from geonews.tools.eval_geoparse import evaluate

    r = evaluate()
    assert r["accuracy"] >= 0.9, r["failures"]
    assert r["ms_per_doc"] < 100
