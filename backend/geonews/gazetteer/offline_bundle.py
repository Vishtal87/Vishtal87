"""Offline gazetteer bundle: works where only package registries are reachable.

Sources (all open data):
  * geonamescache (PyPI)  — GeoNames cities500: ~235k populated places (pop >= 500 + all admin seats down to
                            PPLA4), multilingual alternate names, admin1 codes, timezones.   CC-BY 4.0
  * cities.json (npm)     — GeoNames admin1/admin2 code names + admin2 codes of ~170k cities.   CC-BY 4.0
  * iso3166-2-db (npm)    — localized names of countries & first-level regions (+GeoNames ids).  MIT/ODbL refs
  * world-atlas (npm)     — Natural Earth country polygons.                                    Public domain
The full planet (every hamlet) comes from `geonames_dump.py` once download.geonames.org is reachable;
both importers emit the same PlaceRec stream and share the loader.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Iterator

import yaml

from geonews.config import settings
from geonews.domain.place_kinds import CONTINENTS
from geonews.gazetteer.records import NameRec, PlaceRec, guess_lang, keep_alt_name, pick_ru_display

log = logging.getLogger(__name__)
UI_LANGS = ("ru", "en", "de", "fr", "es", "uk", "zh", "it", "pl", "pt", "tr")


def _vendor(*parts: str) -> Path:
    return settings.data_dir / "vendor" / Path(*parts)


def _geonamescache_dir() -> Path:
    import geonamescache

    return Path(os.path.dirname(geonamescache.__file__)) / "data"


# ------------------------------------------------------------------------------------------------
# TopoJSON (world-atlas) -> WKT, minimal decoder (quantized arcs, Polygon/MultiPolygon only)
# ------------------------------------------------------------------------------------------------
def _decode_arcs(topo: dict) -> list[list[tuple[float, float]]]:
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    out = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        out.append(pts)
    return out


def _ring(arcs: list, idxs: list[int]) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in idxs:
        seg = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        pts.extend(seg if not pts else seg[1:])
    return _unwrap_ring(pts)


def _unwrap_ring(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """world-atlas rings are stitched across the antimeridian (spherical, for d3). Read as planar they get bogus
    half-world edges (Chukotka joined to Kola -> latitude bands). Make longitudes continuous instead (Chukotka
    becomes 180..191) and close rings around a pole through the pole; the loader then splits at +-180 (ST_WrapX)."""
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for x, y in pts[1:]:
        px = out[-1][0]
        x += 360.0 * round((px - x) / 360.0)
        out.append((x, y))
    if abs(out[-1][0] - out[0][0]) > 180:            # winds once around the globe -> encloses a pole
        pole = -90.0 if sum(y for _, y in out) < 0 else 90.0
        out += [(out[-1][0], pole), (out[0][0], pole)]
    elif out[-1] == out[0]:
        return out
    return out + [out[0]]


def _wkt_polygon(arcs, poly) -> str | None:
    rings = [_ring(arcs, r) for r in poly]
    rings = [r for r in rings if len(r) >= 4]
    if not rings:
        return None
    x0 = rings[0][0][0]                              # holes on the shell's side of the antimeridian
    rings = [rings[0]] + [[(x + 360.0 * round((x0 - h[0][0]) / 360.0), y) for x, y in h] for h in rings[1:]]
    return "(" + ",".join("(" + ",".join(f"{x:.5f} {y:.5f}" for x, y in r) + ")" for r in rings) + ")"


def country_polygons() -> dict[int, str]:
    """ISO numeric -> MULTIPOLYGON WKT."""
    path = _vendor("world-atlas", "countries-50m.json")
    if not path.exists():
        log.warning("world-atlas not found (%s); countries will have no polygons. Run scripts/fetch_offline_data.sh", path)
        return {}
    topo = json.loads(path.read_text())
    arcs = _decode_arcs(topo)
    out: dict[int, str] = {}
    for g in topo["objects"]["countries"]["geometries"]:
        if g.get("id") is None:
            continue
        polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"] if g["type"] == "MultiPolygon" else []
        parts = [p for p in (_wkt_polygon(arcs, poly) for poly in polys) if p]
        if parts:
            out[int(g["id"])] = "MULTIPOLYGON(" + ",".join(parts) + ")"
    return out


# ------------------------------------------------------------------------------------------------
def _i18n() -> dict[str, dict]:
    out = {}
    for lang in UI_LANGS:
        p = _vendor("iso3166-2-db", "i18n", f"{lang}.json")
        if p.exists():
            out[lang] = json.loads(p.read_text())
    return out


def _aliases() -> list[dict]:
    p = settings.config_dir / "gazetteer_aliases.yaml"
    return yaml.safe_load(p.read_text()) or [] if p.exists() else []


def continent_records() -> Iterator[PlaceRec]:
    for code, c in CONTINENTS.items():
        yield PlaceRec(source="geonames", source_id=f"continent:{code}", kind="continent", name=c["names"]["en"],
                       country_code=None, lat=c["lat"], lon=c["lon"], admin_code=f"CONT:{code}", names=dict(c["names"]))


def iter_records() -> Iterator[PlaceRec]:
    gdir = _geonamescache_dir()
    countries = json.loads((gdir / "countries.json").read_text())
    cities = json.loads((gdir / "cities500.json").read_text())
    i18n = _i18n()
    polys = country_polygons()
    admin1_names = {a["code"]: a["name"] for a in json.loads(_vendor("cities.json", "admin1.json").read_text())}
    admin2_names = {a["code"]: a["name"] for a in json.loads(_vendor("cities.json", "admin2.json").read_text())}
    # (cc, name, lat3, lon3) -> admin2 code, from cities.json (it carries admin2 codes, geonamescache does not)
    adm2_of: dict[tuple, str] = {}
    for c in json.loads(_vendor("cities.json", "cities.json").read_text()):
        if c.get("admin2"):
            adm2_of[(c["country"], c["name"], round(float(c["lat"]), 3), round(float(c["lng"]), 3))] = c["admin2"]

    # 1. continents
    yield from continent_records()

    # 2. countries
    for cc, c in countries.items():
        names = {lang: d[cc]["name"] for lang, d in i18n.items() if cc in d and d[cc].get("name")}
        names.setdefault("en", c["name"])
        yield PlaceRec(source="geonames", source_id=str(c["geonameid"]), kind="country", name=c["name"],
                       country_code=cc, lat=None, lon=None, admin_code=cc, parent_codes=(f"CONT:{c['continentcode']}",),
                       feature_code="PCLI", population=int(c.get("population") or 0), names=names,
                       alt_names=[NameRec(c["iso3"])] if c.get("iso3") else [],
                       area_wkt=polys.get(int(c["isonumeric"])) if c.get("isonumeric") is not None else None)

    # 3. admin1 (names in many languages from iso3166-2-db, codes/English from GeoNames)
    admin1_i18n: dict[str, dict] = {}
    for lang, d in i18n.items():
        for cc, cdata in d.items():
            for reg in cdata.get("regions", []):
                if reg.get("admin"):
                    key = f"{cc}.{reg['admin']}"
                    e = admin1_i18n.setdefault(key, {"names": {}, "gid": (reg.get("reference") or {}).get("geonames")})
                    e["names"][lang] = reg["name"]
    for code, en_name in admin1_names.items():
        cc = code.split(".")[0]
        extra = admin1_i18n.get(code, {})
        names = dict(extra.get("names", {}))
        names.setdefault("en", en_name)
        gid = extra.get("gid")
        yield PlaceRec(source="geonames", source_id=str(gid) if gid else f"code:{code}", kind="admin1", name=en_name,
                       country_code=cc, lat=None, lon=None, admin_code=code, parent_codes=(cc,), feature_code="ADM1",
                       names=names)

    # 4. admin2 — only those referenced by at least one locality (others would have no location offline)
    used_adm2 = set()
    for c in cities.values():
        a2 = adm2_of.get((c["countrycode"], c["name"], round(c["latitude"], 3), round(c["longitude"], 3)))
        if a2:
            used_adm2.add(f"{c['countrycode']}.{c['admin1code']}.{a2}")
    for code in sorted(used_adm2):
        if code in admin2_names:
            cc, a1, a2 = code.split(".", 2)
            sid = a2 if a2.isdigit() and len(a2) > 5 else f"code:{code}"   # RU/UA admin2 codes are geonameids
            yield PlaceRec(source="geonames", source_id=sid, kind="admin2", name=admin2_names[code], country_code=cc,
                           lat=None, lon=None, admin_code=code, parent_codes=(f"{cc}.{a1}",), feature_code="ADM2",
                           names={"en": admin2_names[code]})

    # 5. localities
    capital_name = {cc: c.get("capital") for cc, c in countries.items()}
    capital_id: dict[str, int] = {}
    for c in sorted(cities.values(), key=lambda c: c.get("population") or 0):
        if capital_name.get(c["countrycode"]) == c["name"]:
            capital_id[c["countrycode"]] = c["geonameid"]  # most populous namesake wins (sorted ascending)
    for c in cities.values():
        cc, a1 = c["countrycode"], c["admin1code"]
        a2 = adm2_of.get((cc, c["name"], round(c["latitude"], 3), round(c["longitude"], 3)))
        alts = [a for a in c.get("alternatenames", []) if keep_alt_name(a)]
        names = {"en": c["name"]}
        ru = pick_ru_display(c["name"], alts)
        if ru:
            names["ru"] = ru
        zh = next((a for a in alts if guess_lang(a) == "zh"), None)
        if zh:
            names["zh"] = zh
        fc = "PPLC" if capital_id.get(cc) == c["geonameid"] else None
        parents = tuple(p for p in (f"{cc}.{a1}.{a2}" if a2 else None, f"{cc}.{a1}", cc) if p)
        yield PlaceRec(source="geonames", source_id=str(c["geonameid"]), kind="locality", name=c["name"], country_code=cc,
                       lat=c["latitude"], lon=c["longitude"], parent_codes=parents, feature_code=fc,
                       population=int(c.get("population") or 0), timezone=c.get("timezone"), names=names,
                       alt_names=[NameRec(a, guess_lang(a)) for a in alts])


def alias_records() -> Iterator[tuple[dict, list[str]]]:
    for a in _aliases():
        yield a, a.get("aliases", [])
