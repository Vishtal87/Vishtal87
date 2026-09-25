"""Test setup. DB tests use a dedicated database (GEONEWS_TEST_DSN) that is migrated on first use."""
import os

import pytest

TEST_DSN = os.environ.get("GEONEWS_TEST_DSN", "postgresql://geonews:geonews@127.0.0.1:5432/geonews_test")
os.environ["GEONEWS_DSN"] = TEST_DSN  # must happen before geonews.config is imported


@pytest.fixture(scope="session")
def db():
    import psycopg

    try:
        psycopg.connect(TEST_DSN).close()
    except Exception as e:  # pragma: no cover
        pytest.skip(f"test database unavailable: {e}")
    from geonews.db.migrate import migrate

    migrate()
    from geonews.db.pool import connect

    return connect
