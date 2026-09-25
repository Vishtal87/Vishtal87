"""Data model of the geoparser (pure dataclasses, no I/O)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, Sequence


@dataclass(slots=True)
class Candidate:
    """A gazetteer entity that a text span may refer to."""
    id: int
    kind: str
    name: str
    matched: str               # the gazetteer name that matched
    lat: float
    lon: float
    population: int
    importance: float
    country_code: str | None
    country_id: int | None
    admin1_id: int | None
    admin2_id: int | None
    locality_id: int | None
    ancestors: tuple[int, ...]
    place_class: str | None = None
    colloquial: bool = False

    def within(self, area_id: int) -> bool:
        return area_id == self.id or area_id in self.ancestors


@dataclass(slots=True)
class Cues:
    type_kind: str | None = None       # from "станица X", "X County" ...
    type_label: str | None = None
    relation: str = "in"               # in | near | from
    distance_km: float | None = None   # "в 15 км от X"
    direction: str | None = None       # N/NE/... "к северу от X"
    street: bool = False               # "ул. Ростовская", "Kölner Straße" -> not a settlement reference
    org: bool = False                  # "ФК Краснодар"
    route: bool = False                # "трасса Краснодар — Ростов"
    locative: bool = False             # preceded by a locative preposition (в, на, in, bei, à ...)
    sentence_initial: bool = False
    in_title: bool = False
    name_like: bool = False            # "Paris Hilton", "Джордж Вашингтон"
    common_word: bool = False          # dictionary says it's an ordinary word ('Мир', 'Заря')


@dataclass(slots=True)
class Mention:
    start: int
    end: int
    text: str
    keys: list[str]
    ntokens: int
    sentence: int
    cues: Cues = field(default_factory=Cues)
    candidates: list[Candidate] = field(default_factory=list)
    scores: list[float] = field(default_factory=list)
    chosen: Candidate | None = None
    confidence: float = 0.0
    role: str = "mentioned"            # primary | secondary | near | mentioned | street | org | route
    appos: set[int] = field(default_factory=set)   # "Springfield, Illinois": ids of the admin areas named right after


@dataclass(slots=True)
class SourceContext:
    """Where the source is based/what it covers: key signal for small-place disambiguation."""
    home_id: int | None = None
    home_kind: str | None = None
    home_ancestors: tuple[int, ...] = ()
    home_lat: float | None = None
    home_lon: float | None = None
    country_code: str | None = None

    @property
    def area_ids(self) -> set[int]:
        return {a for a in (*self.home_ancestors, self.home_id) if a}

    @property
    def hyperlocal(self) -> bool:
        return self.home_kind in ("locality", "sublocality", "admin3", "admin4", "admin5")


@dataclass(slots=True)
class LocationDecision:
    entity_id: int | None          # entity the event is attached to (never the city for "15 km from city")
    lat: float
    lon: float
    precision: str                 # point | sublocality | locality | area | admin2 | admin1 | country | continent
    relation: str                  # in | near | region | source_area | coordinates
    confidence: float
    radius_km: float | None = None
    anchor_id: int | None = None   # reference place for "near" relations
    evidence: dict = field(default_factory=dict)


@dataclass(slots=True)
class GeoResult:
    primary: LocationDecision | None
    mentions: list[Mention]
    method: str = "gazetteer-rules-v1"


class GazetteerPort(Protocol):
    def lookup(self, keys: Sequence[str], per_key_limit: int = 40) -> dict[str, list[Candidate]]: ...

    def lookup_within(self, keys: Sequence[str], area_ids: Sequence[int]) -> dict[str, list[Candidate]]: ...

    def nearest_locality(self, lat: float, lon: float, max_km: float = 10) -> Candidate | None: ...

    def parents_of(self, ids: Sequence[int]) -> dict[int, Candidate]: ...
