"""People and ordinary words that are also village names: real misses from the first live run on Russian news
('встречу Путина' -> village Putina, 'Зеленский хотел' -> a Kuban khutor, 'в Лиге наций' -> village Liga)."""
from geonews.domain.text_norm import lemma_key, norm
from geonews.pipeline.geoparse.model import Candidate, SourceContext
from geonews.pipeline.geoparse.resolver import geoparse

RU, CN, UA, PSKOV, KUBAN, MORDOVIA, LENOBL = 1, 2, 3, 11, 20, 30, 40


def _place(id_, kind, name, pop, imp, admin1=None, cc="RU", country=RU):
    anc = tuple(a for a in (country if kind != "country" else None, admin1) if a)
    return Candidate(id=id_, kind=kind, name=name, matched=name, lat=45.0, lon=39.0, population=pop, importance=imp,
                     country_code=cc, country_id=country, admin1_id=admin1, admin2_id=None, locality_id=None,
                     ancestors=anc)


# importance on the gazetteer's scale: ~1.5 for a hamlet, ~5.5 for a city of 300k, ~9 for a country
PLACES = [
    _place(RU, "country", "Россия", 146_000_000, 9.5),
    _place(CN, "country", "Китай", 1_400_000_000, 9.9, cc="CN", country=CN),
    _place(UA, "country", "Украина", 40_000_000, 9.0, cc="UA", country=UA),
    _place(PSKOV, "admin1", "Псковская область", 600_000, 6.0),
    _place(KUBAN, "admin1", "Краснодарский край", 5_600_000, 7.0),
    _place(12, "locality", "Путина", 0, 1.3, admin1=PSKOV),
    _place(21, "locality", "Зеленский", 150, 1.6, admin1=KUBAN),
    _place(22, "locality", "Каневская", 45_334, 4.6, admin1=KUBAN),
    _place(23, "locality", "Чёрный", 500, 2.0, admin1=KUBAN),
    _place(24, "locality", "Победа", 300, 1.9, admin1=KUBAN),
    _place(31, "locality", "Лига", 40, 1.2, admin1=MORDOVIA),
    _place(41, "locality", "Винницы", 100, 1.5, admin1=LENOBL),
    _place(51, "locality", "Винница", 370_000, 5.6, cc="UA", country=UA),
    _place(61, "locality", "Мид", 900, 2.1, cc="US", country=None),
    _place(71, "locality", "Сочи", 443_000, 5.6, admin1=KUBAN),
]


class FakeGazetteer:
    def __init__(self, places):
        self.by_key: dict[str, list[Candidate]] = {}
        for p in places:
            for k in {norm(p.name), lemma_key(p.name)}:
                self.by_key.setdefault(k, []).append(p)

    def lookup(self, keys, per_key_limit=40):
        return {k: self.by_key[k] for k in keys if k in self.by_key}

    def lookup_within(self, keys, area_ids):
        return {}

    def nearest_locality(self, lat, lon, max_km=10):
        return None

    def parents_of(self, ids):
        return {}


GAZ = FakeGazetteer(PLACES)
FEDERAL = SourceContext(home_id=RU, home_kind="country", home_ancestors=(), country_code="RU")
KUBAN_MEDIA = SourceContext(home_id=KUBAN, home_kind="admin1", home_ancestors=(RU,), country_code="RU")


def _where(title, body="", source=FEDERAL):
    r = geoparse(title, body, "ru", GAZ, source)
    return (r.primary.entity_id if r.primary else None), {m.chosen.id for m in r.mentions if m.chosen}


def test_surname_is_not_a_village():
    primary, chosen = _where("В МИД России допустили встречу Путина, Трампа и Си Цзиньпина в Китае")
    assert 12 not in chosen and primary in (CN, RU)


def test_surname_in_source_region_is_not_a_khutor():
    primary, chosen = _where("Мендель рассказала, какие выборы Зеленский хотел провести на Украине",
                             source=KUBAN_MEDIA)
    assert 21 not in chosen and primary == UA


def test_real_khutor_with_the_same_name_still_found():
    assert _where("В хуторе Зеленском сгорел сарай", source=KUBAN_MEDIA)[0] == 21


def test_ordinary_word_after_preposition_is_not_a_village():
    primary, chosen = _where("Сборная Швеции победила румын в Лиге наций")
    assert 31 not in chosen


def test_stanitsa_that_reads_as_a_surname_is_kept():
    assert _where("В станице Каневской открыли новую школу", source=KUBAN_MEDIA)[0] == 22
    assert _where("Жители Каневской пожаловались на отключения воды", source=KUBAN_MEDIA)[0] == 22


def test_big_city_portal_is_not_hyperlocal():
    city = SourceContext(home_id=5, home_kind="locality", home_population=1_000_000, home_lat=45.0, home_lon=39.0)
    village = SourceContext(home_id=6, home_kind="locality", home_population=3_000, home_lat=45.0, home_lon=39.0)
    assert not city.hyperlocal and village.hyperlocal
    assert geoparse("Ушел из жизни известный актер", "Ему было 52 года", "ru", GAZ, city).primary is None


def test_national_outlet_prefers_the_foreign_city_over_a_home_country_hamlet():
    assert _where("В Виннице прогремел взрыв")[0] == 51


def test_acronym_is_not_a_town():
    assert 61 not in _where("Лавров обсудил с главой МИД Индии конфликты")[1]
    assert 61 not in _where("Заявление МИД США о переговорах")[1]
    assert _where("⚡️ВЗРЫВ В СОЧИ: ПОСТРАДАЛИ ДВА ЧЕЛОВЕКА", source=KUBAN_MEDIA)[0] == 71


def test_sea_and_ordinary_word_in_a_regional_story():
    primary, chosen = _where("Над Черным морем сбили 55 беспилотников", source=KUBAN_MEDIA)
    assert 23 not in chosen
    primary, chosen = _where("Музеи Кубани примут участие в проекте «Территория Победы»",
                             "Музеи Краснодарского края станут участниками проекта", source=KUBAN_MEDIA)
    assert 24 not in chosen and primary == KUBAN
