"""Importer for FULL GeoNames dumps (download.geonames.org/export/dump).

Handles allCountries.txt or per-country CC.txt (every populated place incl. hamlets PPL/PPLX/PPLF,
admin divisions ADM1..ADM5), countryInfo.txt, admin1CodesASCII.txt, admin2Codes.txt and
language-tagged alternate names (alternatenames/CC.txt).

Main table columns (TSV, 19 cols):
 0 geonameid 1 name 2 asciiname 3 alternatenames 4 latitude 5 longitude 6 feature class 7 feature code
 8 country code 9 cc2 10 admin1 11 admin2 12 admin3 13 admin4 14 population 15 elevation 16 dem
 17 timezone 18 modification date
"""
from __future__ import annotations

import csv
import logging
import re
from collections import defaultdict
from pathlib import Path
from typing import Iterator

from geonews.domain.place_kinds import GEONAMES_FEATURES, SKIPPED_FEATURES
from geonews.gazetteer.records import NameRec, PlaceRec, guess_lang, keep_alt_name

log = logging.getLogger(__name__)
csv.field_size_limit(10_000_000)
DISPLAY_LANGS = {"ru", "en", "de", "fr", "es", "uk", "zh", "it", "pl", "pt", "tr", "be", "kk"}
_GENERIC_TITLE = re.compile(r"(?<=\S )(Область|Край|Район|Округ|Автономный|Автономная)\b")


def display_case(name: str, lang: str | None) -> str:
    """GeoNames has 'Псковская Область': Russian writes the generic part of a region name in lower case."""
    return _GENERIC_TITLE.sub(lambda m: m.group(1).lower(), name) if lang in ("ru", "uk", "be") else name


def _rows(path: Path) -> Iterator[list[str]]:
    with path.open(encoding="utf-8", newline="") as f:
        for line in f:
            if not line.strip() or line.startswith("#"):
                continue
            yield line.rstrip("\n").split("\t")


def load_alternate_names(path: Path | None) -> dict[int, list[tuple[str, str | None, bool, bool, bool, bool]]]:
    """geonameid -> [(name, lang, preferred, short, colloquial, historic)] (lang-tagged file)."""
    out: dict[int, list] = defaultdict(list)
    if not path or not path.exists():
        return out
    for r in _rows(path):
        if len(r) < 4:
            continue
        lang = r[2] or None
        if lang in ("link", "wkdt", "iata", "icao", "faac", "tcid", "post", "unlc", "abbr", "fr_1793"):
            continue
        flags = [(r[i] == "1") if len(r) > i else False for i in (4, 5, 6, 7)]
        out[int(r[1])].append((r[3], lang, *flags))
    return out


def iter_records(dump_dir: Path, main_file: str, alt_file: str | None = None) -> Iterator[PlaceRec]:
    alt = load_alternate_names(dump_dir / alt_file if alt_file else None)
    continents: dict[str, str] = {}
    info = dump_dir / "countryInfo.txt"
    if info.exists():
        for r in _rows(info):
            continents[r[0]] = r[8]
    n = 0
    for r in _rows(dump_dir / main_file):
        if len(r) < 19:
            continue
        fcode = r[7]
        if fcode in SKIPPED_FEATURES or fcode not in GEONAMES_FEATURES:
            continue
        kind, pclass = GEONAMES_FEATURES[fcode]
        gid = int(r[0])
        cc = r[8] or None
        a1, a2, a3, a4 = r[10], r[11], r[12], r[13]
        admin_code = None
        parent_codes: tuple[str, ...]
        chain = [p for p in (cc, a1, a2, a3, a4)]
        codes = []
        acc = []
        for part in chain:
            if not part:
                break
            acc.append(part)
            codes.append(".".join(acc))
        if kind == "country":
            admin_code = cc
            parent_codes = (f"CONT:{continents.get(cc, '')}",)
        elif kind.startswith("admin"):
            depth = int(kind[-1])  # admin1 -> codes[1]
            if len(codes) <= depth:
                continue  # malformed admin row without its own code
            admin_code = codes[depth]
            parent_codes = tuple(reversed(codes[:depth]))
        else:
            parent_codes = tuple(reversed(codes))

        tagged = alt.get(gid, [])
        names = {"en": r[1]}
        alt_names: list[NameRec] = []
        for name, lang, pref, short, coll, hist in tagged:
            if not keep_alt_name(name):
                continue
            alt_names.append(NameRec(name, lang, pref, coll, hist))
            if lang in DISPLAY_LANGS and not hist and not coll:
                if pref or (lang not in names and lang != "en"):
                    names[lang] = display_case(name, lang)
        if not tagged:  # no language-tagged file: fall back to the untagged list in the main row
            for name in r[3].split(","):
                if keep_alt_name(name):
                    alt_names.append(NameRec(name, guess_lang(name)))
        if r[2] and r[2] != r[1]:
            alt_names.append(NameRec(r[2]))
        n += 1
        yield PlaceRec(
            source="geonames", source_id=str(gid), kind=kind, name=r[1], country_code=cc,
            lat=float(r[4]), lon=float(r[5]), admin_code=admin_code, parent_codes=parent_codes,
            feature_code=fcode, population=int(r[14] or 0), timezone=r[17] or None,
            place_class=pclass, names=names, alt_names=alt_names,
        )
    log.info("parsed %d GeoNames features from %s", n, main_file)
