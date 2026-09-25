"""Rule-based multilingual category & event-type classification (config/categories.yaml)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

import yaml

from geonews.config import settings
from geonews.domain.text_norm import token_lemmas, tokenize


@dataclass
class Classification:
    category: str
    event_type: str | None
    scores: dict[str, float]


@lru_cache(maxsize=1)
def load_config() -> dict:
    return yaml.safe_load((settings.config_dir / "categories.yaml").read_text())


def _terms(title: str, text: str, lang: str | None) -> tuple[list[str], list[str]]:
    morph = lang if lang in ("ru", "uk") else None

    def conv(s: str) -> list[str]:
        return [token_lemmas(t.norm, morph)[0] if morph else t.norm for t in tokenize(s)]

    return conv(title), conv(text[:3000])


def _hits(words: list[str], joined: str, kws: list[str]) -> set[str]:
    out = set()
    for kw in kws:
        if " " in kw:
            if kw in joined:
                out.add(kw)
        elif any(w.startswith(kw) for w in words):
            out.add(kw)
    return out


def classify(title: str, text: str, lang: str | None, source_type: str | None = None) -> Classification:
    cfg = load_config()["categories"]
    t_words, b_words = _terms(title, text, lang)
    t_join, b_join = " ".join(t_words), " ".join(b_words)
    scores: dict[str, float] = {}
    type_scores: dict[str, float] = {}
    for cat in cfg:
        kw = cat.get("keywords") or {}
        lang_kws = kw.get(lang or "", []) or [k for v in kw.values() for k in v]
        s = 2.0 * len(_hits(t_words, t_join, lang_kws)) + 1.0 * len(_hits(b_words, b_join, lang_kws))
        if s:
            scores[cat["slug"]] = s
        for tname, tkws in (cat.get("types") or {}).items():
            ts = 2.0 * len(_hits(t_words, t_join, tkws)) + len(_hits(b_words, b_join, tkws))
            if ts:
                type_scores[f"{cat['slug']}:{tname}"] = ts
    category = max(scores, key=lambda k: scores[k]) if scores else "other"
    if source_type == "official" and scores.get(category, 0) < 2:
        category = "official"
    etype = None
    own = {k: v for k, v in type_scores.items() if k.startswith(category + ":")}
    if own:
        etype = max(own, key=lambda k: own[k]).split(":", 1)[1]
    return Classification(category=category, event_type=etype, scores=scores)


def load_categories_into_db() -> int:
    from geonews.db.pool import connect

    cfg = load_config()["categories"]
    with connect() as conn:
        for c in cfg:
            conn.execute(
                """INSERT INTO category (slug, names, color, icon, sort) VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (slug) DO UPDATE SET names = EXCLUDED.names, color = EXCLUDED.color,
                     icon = EXCLUDED.icon, sort = EXCLUDED.sort""",
                (c["slug"], json.dumps(c["names"], ensure_ascii=False), c["color"], c["icon"], c.get("sort", 100)),
            )
        conn.commit()
    return len(cfg)
