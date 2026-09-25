"""Database connections (psycopg 3). One pool per process, created lazily."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from geonews.config import settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            settings.dsn, min_size=1, max_size=10, kwargs={"row_factory": dict_row, "autocommit": False}, open=True,
            check=ConnectionPool.check_connection,  # survive DB restarts: validate on checkout
        )
    return _pool


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """Pooled connection; commits on success, rolls back on error."""
    with get_pool().connection() as conn:
        yield conn


def connect(autocommit: bool = False) -> psycopg.Connection:
    """Dedicated (non-pooled) connection, e.g. for LISTEN or long bulk loads."""
    return psycopg.connect(settings.dsn, row_factory=dict_row, autocommit=autocommit)
