"""Multilingual lexicon of place-type words and spatial relation cues.

These are *linguistic* resources (how people write about places), not a list of places.
Keys are lemma/norm forms produced by text_norm (so 'станице' and 'станица' both match 'станица';
Latin keys are diacritic-free and casefolded: 'straße' -> 'strasse', 'nördlich' -> 'nordlich').
Each entry: word -> (target kind, local_type label)
  target kind: 'locality' | 'sublocality' | 'admin1' | 'admin2' | 'street' | 'country'
"""
from __future__ import annotations

TYPE_WORDS: dict[str, tuple[str, str]] = {
    # --- ru ---
    "город": ("locality", "город"), "г": ("locality", "город"), "станица": ("locality", "станица"),
    "ст": ("locality", "станица"), "ст-ца": ("locality", "станица"), "хутор": ("locality", "хутор"),
    "х": ("locality", "хутор"), "село": ("locality", "село"), "с": ("locality", "село"),
    "деревня": ("locality", "деревня"), "дер": ("locality", "деревня"), "д": ("locality", "деревня"),
    "поселок": ("locality", "посёлок"), "пос": ("locality", "посёлок"), "п": ("locality", "посёлок"),
    "пгт": ("locality", "посёлок городского типа"), "рп": ("locality", "рабочий посёлок"),
    "аул": ("locality", "аул"), "слобода": ("locality", "слобода"), "селение": ("locality", "селение"),
    "городок": ("locality", "городок"), "кишлак": ("locality", "кишлак"),
    "микрорайон": ("sublocality", "микрорайон"), "мкр": ("sublocality", "микрорайон"),
    "мкрн": ("sublocality", "микрорайон"), "квартал": ("sublocality", "квартал"),
    "район": ("admin2", "район"), "округ": ("admin2", "округ"), "край": ("admin1", "край"),
    "область": ("admin1", "область"), "обл": ("admin1", "область"), "республика": ("admin1", "республика"),
    "улица": ("street", "улица"), "ул": ("street", "улица"), "проспект": ("street", "проспект"),
    "пр-т": ("street", "проспект"), "переулок": ("street", "переулок"), "пер": ("street", "переулок"),
    "шоссе": ("street", "шоссе"), "бульвар": ("street", "бульвар"), "набережная": ("street", "набережная"),
    "площадь": ("street", "площадь"), "проезд": ("street", "проезд"), "тупик": ("street", "тупик"),
    # --- uk ---
    "місто": ("locality", "місто"), "селище": ("locality", "селище"), "смт": ("locality", "смт"),
    "хутір": ("locality", "хутір"), "вулиця": ("street", "вулиця"), "вул": ("street", "вулиця"),
    # --- en ---
    "city": ("locality", "city"), "town": ("locality", "town"), "village": ("locality", "village"),
    "hamlet": ("locality", "hamlet"), "township": ("locality", "township"), "borough": ("locality", "borough"),
    "county": ("admin2", "county"), "state": ("admin1", "state"), "province": ("admin1", "province"),
    "district": ("admin2", "district"), "street": ("street", "street"), "road": ("street", "road"),
    "avenue": ("street", "avenue"), "boulevard": ("street", "boulevard"), "lane": ("street", "lane"),
    "neighborhood": ("sublocality", "neighborhood"), "neighbourhood": ("sublocality", "neighbourhood"),
    # --- de ---
    "stadt": ("locality", "Stadt"), "dorf": ("locality", "Dorf"), "gemeinde": ("locality", "Gemeinde"),
    "ortsteil": ("sublocality", "Ortsteil"), "ort": ("locality", "Ort"), "ortschaft": ("locality", "Ortschaft"),
    "kreis": ("admin2", "Kreis"), "landkreis": ("admin2", "Landkreis"), "bezirk": ("admin2", "Bezirk"),
    "bundesland": ("admin1", "Bundesland"), "strasse": ("street", "Straße"),
    # --- fr ---
    "ville": ("locality", "ville"), "commune": ("locality", "commune"), "hameau": ("locality", "hameau"),
    "departement": ("admin2", "département"), "region": ("admin1", "région"), "rue": ("street", "rue"),
    "quartier": ("sublocality", "quartier"),
    # --- es / it / pl / pt ---
    "ciudad": ("locality", "ciudad"), "pueblo": ("locality", "pueblo"), "municipio": ("locality", "municipio"),
    "aldea": ("locality", "aldea"), "provincia": ("admin2", "provincia"), "calle": ("street", "calle"),
    "citta": ("locality", "città"), "paese": ("locality", "paese"), "comune": ("locality", "comune"),
    "frazione": ("locality", "frazione"), "regione": ("admin1", "regione"), "via": ("street", "via"),
    "miasto": ("locality", "miasto"), "wies": ("locality", "wieś"), "gmina": ("locality", "gmina"),
    "powiat": ("admin2", "powiat"), "wojewodztwo": ("admin1", "województwo"), "ulica": ("street", "ulica"),
    "cidade": ("locality", "cidade"), "vila": ("locality", "vila"), "aldeia": ("locality", "aldeia"),
    "rua": ("street", "rua"),
}

# Single-letter abbreviations are only trusted when followed by a dot in the text ("ст. Динская", "г. Сочи").
ABBREVIATIONS_NEED_DOT = {"г", "ст", "х", "с", "д", "п", "пос", "дер", "ул", "пер", "обл", "мкр", "мкрн", "вул"}

# Postpositive type words ("Krasnodar city", "Landkreis" is prepositive, "Kreis Pinneberg"): mostly en/de.
POSTPOSITIVE_OK = {"city", "town", "village", "county", "district", "province", "state", "street", "road",
                   "avenue", "край", "область", "район", "округ", "республика", "обл", "шоссе", "проспект"}

# ------------------------------------------------------------------------------------------------
# Spatial relation cues: "near X" must NOT be geolocated as "in X".
# Values: relation kind. Matched on norm/lemma tokens immediately preceding the toponym.
NEAR_CUES: dict[str, str] = {
    # ru
    "под": "near", "около": "near", "возле": "near", "близ": "near", "недалеко": "near", "вблизи": "near",
    "окрестность": "near", "окрестности": "near", "пригород": "near", "рядом": "near", "неподалеку": "near",
    "от": "from",   # "в 15 км от Краснодара", "к северу от Сочи"
    # uk
    "біля": "near", "поблизу": "near", "неподалік": "near",
    # en
    "near": "near", "outside": "near", "nearby": "near", "outskirts": "near", "from": "from",
    # de
    "bei": "near", "nahe": "near", "unweit": "near", "vor": "near", "von": "from",
    # fr / es / it
    "pres": "near", "proche": "near", "environs": "near", "cerca": "near", "afueras": "near",
    "vicino": "near", "presso": "near", "de": "from", "da": "from",
}
DISTANCE_UNITS = {"км": 1.0, "km": 1.0, "километр": 1.0, "километров": 1.0, "kilometer": 1.0, "kilometers": 1.0,
                  "kilometres": 1.0, "kilometern": 1.0, "м": 0.001, "метр": 0.001, "m": 0.001, "meters": 0.001,
                  "mi": 1.609, "mile": 1.609, "miles": 1.609}
DIRECTION_WORDS = {
    "север": "N", "юг": "S", "запад": "W", "восток": "E", "северо-запад": "NW", "северо-восток": "NE",
    "юго-запад": "SW", "юго-восток": "SE", "north": "N", "south": "S", "west": "W", "east": "E",
    "nordlich": "N", "sudlich": "S", "westlich": "W", "ostlich": "E", "nord": "N", "sud": "S", "ouest": "W", "est": "E",
}
# Words after which a capitalized toponym-like token is part of an organisation/person, not a place.
# e.g. "ФК Краснодар", "клуб «Кубань»", "поезд Москва — Сочи" is handled by route logic in the resolver.
# a name next to these is a sea, river, mountain...: "Черное море", "река Кубань", "гора Ахун" - not a settlement
NATURAL_FEATURES = {"море", "река", "озеро", "залив", "пролив", "гора", "хребет", "мыс", "остров", "бухта", "лиман",
                    "водохранилище", "ущелье", "перевал", "полуостров", "пустыня", "долина", "sea", "river", "lake",
                    "bay", "gulf", "strait", "mountain", "mountains", "island", "cape", "peninsula", "desert", "valley"}
ORG_CUES = {"фк", "клуб", "команда", "хк", "бк", "fc", "sc", "club", "team", "компания", "завод", "холдинг",
            "банк", "театр", "гостиница", "отель", "hotel", "ресторан", "кафе", "тц", "трц", "жк", "снт"}
