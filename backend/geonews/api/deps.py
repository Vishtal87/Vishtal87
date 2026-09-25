"""FastAPI dependencies."""
from __future__ import annotations

from typing import Iterator

import psycopg

from geonews.db.pool import get_pool


def db() -> Iterator[psycopg.Connection]:
    with get_pool().connection() as conn:
        yield conn


SUPPORTED_UI_LANGS = ("ru", "en", "de", "fr", "es", "uk", "zh", "it", "pl", "pt", "tr")


def ui_lang(lang: str | None) -> str:
    return lang if lang in SUPPORTED_UI_LANGS else "en"
