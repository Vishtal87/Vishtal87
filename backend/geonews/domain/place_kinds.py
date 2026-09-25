"""Universal place taxonomy.

The hierarchy is expressed with abstract levels (country / admin1..admin5 / locality / sublocality /
street / point). Country-specific words ('станица', 'Gemeinde', 'county') are *data*: they live in
`geo_entity.local_type` and in the settlement lexicon used for parsing, never in the schema.
"""
from __future__ import annotations

import math

KIND_RANK: dict[str, int] = {
    "continent": 1,
    "country": 2,
    "admin1": 3,
    "admin2": 4,
    "admin3": 5,
    "admin4": 6,
    "admin5": 7,
    "locality": 8,
    "sublocality": 9,
    "street": 10,
    "point": 11,
}
ADMIN_KINDS = ("admin1", "admin2", "admin3", "admin4", "admin5")

# GeoNames feature code -> (kind, place_class). Populated places that no longer exist are skipped.
GEONAMES_FEATURES: dict[str, tuple[str, str | None]] = {
    "PCLI": ("country", None), "PCLD": ("country", None), "PCLF": ("country", None),
    "PCLS": ("country", None), "PCLIX": ("country", None), "PCL": ("country", None), "TERR": ("country", None),
    "ADM1": ("admin1", None), "ADM2": ("admin2", None), "ADM3": ("admin3", None),
    "ADM4": ("admin4", None), "ADM5": ("admin5", None),
    "PPLC": ("locality", "city"), "PPLA": ("locality", None), "PPLA2": ("locality", None),
    "PPLA3": ("locality", None), "PPLA4": ("locality", None), "PPLA5": ("locality", None),
    "PPLG": ("locality", None), "PPL": ("locality", None), "PPLS": ("locality", None),
    "PPLF": ("locality", "hamlet"), "PPLL": ("locality", "hamlet"), "PPLR": ("locality", "settlement"),
    "STLMT": ("locality", "settlement"), "PPLCH": ("locality", None),
    "PPLX": ("sublocality", "neighbourhood"),
}
SKIPPED_FEATURES = {"PPLH", "PPLQ", "PPLW", "PPLCD", "ADMD", "ADM1H", "ADM2H", "ADM3H", "ADM4H", "ADMDH", "PCLH"}


def place_class_for(population: int, feature_code: str | None = None) -> str:
    """Size class of a locality. Population thresholds are a global heuristic;
    local_type (from data) carries the local legal/traditional type."""
    fc = GEONAMES_FEATURES.get(feature_code or "")
    if fc and fc[1]:
        return fc[1]
    if population >= 100_000:
        return "city"
    if population >= 10_000:
        return "town"
    if population >= 1_000:
        return "village"
    if population > 0:
        return "hamlet"
    return "settlement"  # unknown population (e.g. small admin seats)


def importance(kind: str, population: int, feature_code: str | None = None) -> float:
    """Prior used for disambiguation and ranking (roughly 0..10)."""
    base = math.log10(max(population, 0) + 10)
    bonus = {"PPLC": 2.0, "PPLA": 1.2, "PPLA2": 0.7, "PPLA3": 0.4, "PPLA4": 0.2}.get(feature_code or "", 0.0)
    kind_bonus = {"continent": 5.0, "country": 4.0, "admin1": 2.5, "admin2": 1.5, "admin3": 0.8, "admin4": 0.4}.get(kind, 0.0)
    return round(base + bonus + kind_bonus, 3)


# Continents: small fixed set (GeoNames continent codes). Label points chosen for globe readability.
CONTINENTS: dict[str, dict] = {
    "EU": {"lat": 54.0, "lon": 20.0, "names": {"en": "Europe", "ru": "Европа", "de": "Europa", "fr": "Europe", "es": "Europa", "uk": "Європа", "zh": "欧洲"}},
    "AS": {"lat": 43.0, "lon": 88.0, "names": {"en": "Asia", "ru": "Азия", "de": "Asien", "fr": "Asie", "es": "Asia", "uk": "Азія", "zh": "亚洲"}},
    "AF": {"lat": 5.0, "lon": 20.0, "names": {"en": "Africa", "ru": "Африка", "de": "Afrika", "fr": "Afrique", "es": "África", "uk": "Африка", "zh": "非洲"}},
    "NA": {"lat": 45.0, "lon": -100.0, "names": {"en": "North America", "ru": "Северная Америка", "de": "Nordamerika", "fr": "Amérique du Nord", "es": "América del Norte", "uk": "Північна Америка", "zh": "北美洲"}},
    "SA": {"lat": -15.0, "lon": -60.0, "names": {"en": "South America", "ru": "Южная Америка", "de": "Südamerika", "fr": "Amérique du Sud", "es": "América del Sur", "uk": "Південна Америка", "zh": "南美洲"}},
    "OC": {"lat": -25.0, "lon": 140.0, "names": {"en": "Oceania", "ru": "Океания", "de": "Ozeanien", "fr": "Océanie", "es": "Oceanía", "uk": "Океанія", "zh": "大洋洲"}},
    "AN": {"lat": -80.0, "lon": 0.0, "names": {"en": "Antarctica", "ru": "Антарктида", "de": "Antarktis", "fr": "Antarctique", "es": "Antártida", "uk": "Антарктида", "zh": "南极洲"}},
}
