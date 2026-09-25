"""Language detection (lingua, restricted to configured languages; models preloaded once per process)."""
from __future__ import annotations

from functools import lru_cache

from geonews.config import settings
from geonews.domain.text_norm import script_of

_ISO = {"ru": "RUSSIAN", "uk": "UKRAINIAN", "en": "ENGLISH", "de": "GERMAN", "fr": "FRENCH", "es": "SPANISH",
        "it": "ITALIAN", "pl": "POLISH", "zh": "CHINESE", "pt": "PORTUGUESE", "tr": "TURKISH", "be": "BELARUSIAN",
        "kk": "KAZAKH", "ja": "JAPANESE", "ko": "KOREAN", "ar": "ARABIC"}


@lru_cache(maxsize=1)
def _detector():
    from lingua import Language, LanguageDetectorBuilder

    langs = [getattr(Language, _ISO[c]) for c in settings.languages if c in _ISO]
    return LanguageDetectorBuilder.from_languages(*langs).with_preloaded_language_models().build()


def warm_up() -> None:
    _detector()


def detect(text: str, hint: list[str] | None = None) -> tuple[str | None, float]:
    """Return (ISO 639-1 code, confidence). `hint`: languages declared by the source."""
    sample = text[:1500]
    if len(sample.strip()) < 8:
        return (hint[0] if hint else None), 0.3
    sc = script_of(sample)
    if sc == "hani":
        return "zh", 0.95
    det = _detector()
    values = det.compute_language_confidence_values(sample)
    if not values:
        return (hint[0] if hint else None), 0.3
    rev = {v: k for k, v in _ISO.items()}
    best = values[0]
    code = rev.get(best.language.name)
    conf = float(best.value)
    # short texts: trust the source's declared language when detection is uncertain
    if hint and conf < 0.6:
        for v in values:
            c = rev.get(v.language.name)
            if c in hint and v.value >= conf * 0.5:
                return c, max(float(v.value), 0.5)
    return code, conf
