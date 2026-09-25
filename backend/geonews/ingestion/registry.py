"""Source registry: YAML -> `source` table (idempotent upsert by slug)."""
from __future__ import annotations

import json
import logging
from pathlib import Path

import yaml

from geonews.config import settings
from geonews.db.pool import connect
from geonews.domain.text_norm import lemma_key, norm

log = logging.getLogger(__name__)
DEFAULT_TIER = {"official": 1, "media": 2, "regional_media": 2, "local_media": 2, "tv": 2, "aggregator": 3,
                "organization": 2, "youtube": 3, "telegram": 3, "blog": 3, "ugc": 4}


def resolve_home(conn, spec: dict | None) -> int | None:
    if not spec:
        return None
    q = spec["q"]
    row = conn.execute(
        """SELECT e.id FROM geo_name n JOIN geo_entity e ON e.id = n.entity_id
           WHERE (n.norm = %(n)s OR n.lemma = %(l)s) AND (%(cc)s::text IS NULL OR e.country_code = %(cc)s)
             AND (%(kind)s::text IS NULL OR e.kind = %(kind)s)
           ORDER BY e.importance DESC LIMIT 1""",
        {"n": norm(q), "l": lemma_key(q), "cc": spec.get("cc"), "kind": spec.get("kind")},
    ).fetchone()
    if not row:
        log.warning("home place not found: %s", spec)
    return row["id"] if row else None


def load_sources(file: str | None = None) -> int:
    path = Path(file) if file else settings.config_dir / settings.sources_file
    data = yaml.safe_load(path.read_text())
    n = 0
    with connect() as conn:
        for s in data.get("sources", []):
            home = resolve_home(conn, s.get("home"))
            conn.execute(
                """INSERT INTO source (slug, name, source_type, connector, url, config, languages, country_code,
                                       home_geo_entity_id, timezone, trust_tier, access_model, legal_note, synthetic,
                                       enabled, poll_interval_s)
                   VALUES (%(slug)s, %(name)s, %(type)s, %(connector)s, %(url)s, %(config)s, %(languages)s, %(country)s,
                           %(home)s, %(timezone)s, %(tier)s, %(access)s, %(legal)s, %(synthetic)s, %(enabled)s, %(poll)s)
                   ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, source_type = EXCLUDED.source_type,
                     connector = EXCLUDED.connector, url = EXCLUDED.url, config = EXCLUDED.config,
                     languages = EXCLUDED.languages, country_code = EXCLUDED.country_code,
                     home_geo_entity_id = EXCLUDED.home_geo_entity_id, timezone = EXCLUDED.timezone,
                     trust_tier = EXCLUDED.trust_tier, access_model = EXCLUDED.access_model,
                     legal_note = EXCLUDED.legal_note, synthetic = EXCLUDED.synthetic, enabled = EXCLUDED.enabled,
                     poll_interval_s = EXCLUDED.poll_interval_s""",
                {"slug": s["slug"], "name": s["name"], "type": s["type"], "connector": s["connector"], "url": s["url"],
                 "config": json.dumps(s.get("config") or {}), "languages": s.get("languages") or [],
                 "country": s.get("country"), "home": home, "timezone": s.get("timezone"),
                 "tier": s.get("trust_tier", DEFAULT_TIER.get(s["type"], 3)), "access": s["access_model"],
                 "legal": s.get("legal_note"), "synthetic": bool(s.get("synthetic")), "enabled": s.get("enabled", True),
                 "poll": int(s.get("poll_interval", 300))},
            )
            n += 1
        conn.commit()
    return n
