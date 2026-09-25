"""Runtime configuration from environment variables (12-factor)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    dsn: str = field(default_factory=lambda: _env("GEONEWS_DSN", "postgresql://geonews:geonews@127.0.0.1:5432/geonews"))
    data_dir: Path = field(default_factory=lambda: Path(_env("GEONEWS_DATA_DIR", str(REPO_DIR / "data"))))
    config_dir: Path = field(default_factory=lambda: Path(_env("GEONEWS_CONFIG_DIR", str(BACKEND_DIR / "config"))))
    sources_file: str = field(default_factory=lambda: _env("GEONEWS_SOURCES", "sources.demo.yaml"))
    user_agent: str = field(
        default_factory=lambda: _env(
            "GEONEWS_USER_AGENT", "GeoNewsBot/0.1 (+https://github.com/Vishtal87/Vishtal87; news geolocation research)"
        )
    )
    # Languages the language detector is limited to (ISO 639-1). Keeps detection fast and accurate.
    languages: tuple[str, ...] = field(
        default_factory=lambda: tuple(_env("GEONEWS_LANGUAGES", "ru,uk,en,de,fr,es,it,pl,zh,pt,tr,be,kk").split(","))
    )
    # How long raw payloads are retained (copyright hygiene; analysis keeps derived data + links).
    raw_retention_days: int = field(default_factory=lambda: int(_env("GEONEWS_RAW_RETENTION_DAYS", "30")))
    # Articles older than this at ingestion time are stored but never treated as "live".
    live_max_age_hours: int = field(default_factory=lambda: int(_env("GEONEWS_LIVE_MAX_AGE_HOURS", "72")))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(_env("GEONEWS_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(","))
    )


settings = Settings()
