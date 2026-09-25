"""Minimal forward-only migration runner (no ORM on purpose: the schema is PostGIS-heavy SQL).

NNN_name.sql runs as is; NNN_name.py is a data migration with `run(conn)` for what SQL cannot express.
"""
from __future__ import annotations

import importlib.util
import logging
from pathlib import Path

from geonews.db.pool import connect

log = logging.getLogger(__name__)
MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def migrate() -> list[str]:
    applied: list[str] = []
    with connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())")
        done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations").fetchall()}
        for path in sorted([*MIGRATIONS_DIR.glob("*.sql"), *MIGRATIONS_DIR.glob("*.py")]):
            if path.name in done:
                continue
            log.info("applying migration %s", path.name)
            if path.suffix == ".py":
                spec = importlib.util.spec_from_file_location(f"migration_{path.stem}", path)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                module.run(conn)
            else:
                conn.execute(path.read_text())
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
            conn.commit()
            applied.append(path.name)
    return applied
