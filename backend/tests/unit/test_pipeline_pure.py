from collections import Counter
from datetime import datetime, timedelta, timezone

from geonews.pipeline import clustering, dates, dedup
from geonews.pipeline.classify import classify
from geonews.pipeline.event_builder import build_event, consensus_location
from geonews.pipeline.normalize import canonical_url, excerpt
from geonews.pipeline.trust import Report, trust_label

UTC = timezone.utc


# ---------------------------------------------------------------- dates & time zones
def test_feed_date_without_timezone_uses_source_timezone():
    dt, assumed = dates.parse_published("2026-09-20 10:00", "Europe/Moscow", datetime(2026, 9, 21, tzinfo=UTC))
    assert assumed and dt == datetime(2026, 9, 20, 7, 0, tzinfo=UTC)


def test_rfc822_and_iso_dates_are_normalized_to_utc():
    fb = datetime(2026, 9, 21, tzinfo=UTC)
    assert dates.parse_published("Sun, 20 Sep 2026 10:00:00 -0500", None, fb)[0] == datetime(2026, 9, 20, 15, tzinfo=UTC)
    assert dates.parse_published("2026-09-20T10:00:00+03:00", None, fb)[0] == datetime(2026, 9, 20, 7, tzinfo=UTC)


def test_future_dates_are_not_trusted():
    fb = datetime(2026, 9, 21, tzinfo=UTC)
    dt, assumed = dates.parse_published("2027-01-01T00:00:00Z", None, fb)
    assert dt == fb and assumed


def test_yesterday_is_resolved_in_source_local_time():
    # published 01:30 local time in Vladivostok (UTC+10) = 15:30 UTC previous day
    pub = datetime(2026, 9, 19, 15, 30, tzinfo=UTC)
    et = dates.extract_event_time("Вчера вечером в посёлке произошёл пожар", pub, "ru", "Asia/Vladivostok")
    local = et.at.astimezone(dates._zone("Asia/Vladivostok"))
    assert (local.day, local.hour) == (19, 19)


def test_anniversary_is_historical_and_not_live():
    pub = datetime(2026, 9, 20, tzinfo=UTC)
    et = dates.extract_event_time("Годовщина наводнения: 14 лет назад вода затопила город", pub, "ru", None)
    assert et.historical
    assert not dates.is_live(pub, pub, et.historical, 72)
    assert not dates.is_live(pub - timedelta(days=10), pub, False, 72)  # backfill


# ---------------------------------------------------------------- normalization
def test_canonical_url_strips_tracking_and_mobile_hosts():
    assert canonical_url("http://m.example.com/news/1/?utm_source=tg&id=5&fbclid=x") == "https://example.com/news/1?id=5"


def test_excerpt_is_short_and_ends_on_sentence():
    ex = excerpt("Первое предложение. " * 40, 100)
    assert len(ex) <= 100 and ex.endswith(".")


# ---------------------------------------------------------------- dedup
def test_simhash_bands_detect_forwards_but_not_different_texts():
    a = "В станице Динской загорелся жилой дом на улице Красной, пожарные потушили огонь за час, пострадавших нет."
    b = "⚡️ В станице Динской загорелся жилой дом на улице Красной, пожарные потушили огонь за час, пострадавших нет. Подписывайтесь!"
    c = "В Краснодаре открыли новый парк с детскими площадками и велодорожками вдоль реки Кубань."
    ha, hb, hc = dedup.simhash(a), dedup.simhash(b), dedup.simhash(c)
    assert -(2**63) <= ha < 2**63
    assert dedup.hamming(ha, hb) < dedup.hamming(ha, hc)
    assert dedup.jaccard(dedup.shingles(a), dedup.shingles(b)) >= dedup.JACCARD_DUP
    assert dedup.jaccard(dedup.shingles(a), dedup.shingles(c)) < 0.1


# ---------------------------------------------------------------- clustering
def _f(**kw):
    base = dict(at=datetime(2026, 9, 20, 10, tzinfo=UTC), category="incidents", event_type="fire", locality_id=1,
                admin2_id=None, admin1_id=10, country_id=100, lat=45.2, lon=39.2, radius_km=None, precision="locality",
                place_population=30000, lang="ru", terms=Counter(), numbers=set())
    base.update(kw)
    return clustering.Features(**base)


def test_same_small_place_same_type_cross_language_merges():
    ru = _f(terms=Counter({"пожар": 2, "дом": 1}), numbers={"2"})
    de = _f(lang="de", terms=Counter({"brand": 2, "haus": 1}), numbers={"2"}, at=ru.at + timedelta(hours=3),
            place_population=30000)
    s, _ = clustering.match_score(de, ru)
    assert s >= clustering.MATCH_THRESHOLD


def test_big_city_same_category_without_shared_words_does_not_merge():
    a = _f(place_population=12_000_000, terms=Counter({"пожар": 2, "склад": 2, "промзона": 1}))
    b = _f(place_population=12_000_000, terms=Counter({"пожар": 1, "квартира": 2, "многоэтажка": 1}))
    s, d = clustering.match_score(a, b)
    assert s < clustering.MATCH_THRESHOLD


def test_time_gap_and_distant_place_veto():
    a = _f(terms=Counter({"пожар": 1}))
    assert clustering.match_score(_f(at=a.at + timedelta(days=4)), a)[0] == 0
    assert clustering.match_score(_f(locality_id=2, lat=55.7, lon=37.6), a)[0] == 0


# ---------------------------------------------------------------- trust
def test_forwards_of_one_post_are_one_independent_source():
    reps = [Report(1, "telegram", 3, 77)] + [Report(i, "telegram", 3, 77, is_copy=True) for i in range(2, 11)]
    t = trust_label(reps)
    assert t["independent_count"] == 1 and t["label"] == "single_source" and t["source_count"] == 10
    t2 = trust_label(reps + [Report(20, "media", 2, 90)])
    assert t2["label"] == "multiple_sources" and t2["independent_count"] == 2
    assert trust_label([Report(1, "official", 1, 5)])["label"] == "official"
    # an outlet's site feed and its Telegram channel are one voice
    same = [Report(1, "media", 2, 5, publisher="ria"), Report(2, "telegram", 2, 6, publisher="ria")]
    assert trust_label(same)["label"] == "single_source"
    assert trust_label([Report(1, "ugc", 4, 5)])["label"] == "unverified"


# ---------------------------------------------------------------- event location consensus
def _m(i, loc_id, lat, lon, prec="locality", conf=0.9, origin=None, stype="media", **kw):
    d = dict(id=i, loc_id=loc_id, loc_lat=lat, loc_lon=lon, loc_precision=prec, loc_conf=conf, loc_relation="in",
             loc_radius=None, origin_group_id=origin or i, source_type=stype, trust_tier=2, source_id=i,
             duplicate_of=None, published_at=datetime(2026, 9, 20, 10, i, tzinfo=UTC), title=f"t{i}", excerpt="e",
             lang="ru", category="incidents", event_time=None, is_live=True, synthetic=False, cluster_features={})
    d.update(kw)
    return d


def test_wrong_coordinate_from_one_source_is_outvoted_and_flagged():
    members = [_m(1, 5, 45.20, 39.20), _m(2, 5, 45.20, 39.20), _m(3, 99, 55.75, 37.62)]
    loc, outliers = consensus_location(members, {5: (100, 10), 99: (100, 11)})
    assert loc.entity_id == 5
    assert [o["article_id"] for o in outliers] == [3]


def test_region_report_plus_village_report_resolves_to_village():
    members = [_m(1, 10, 45.0, 39.0, prec="admin1", conf=0.95), _m(2, 5, 45.2, 39.2, conf=0.8)]
    loc, _ = consensus_location(members, {5: (100, 10), 10: (100,)})
    assert loc.entity_id == 5


def test_event_title_prefers_editorial_source_official_shown_by_label():
    members = [_m(1, 5, 45.2, 39.2, stype="telegram"), _m(2, 5, 45.2, 39.2, stype="media"),
               _m(3, 5, 45.2, 39.2, stype="official", trust_tier=1)]
    ev = build_event(members, {5: (100, 10)})
    assert ev["title"] == "t2" and ev["trust_label"] == "official" and ev["article_count"] == 3


# ---------------------------------------------------------------- classification
def test_classify_multilingual():
    assert classify("Пожар в станице", "Загорелся дом, спасатели эвакуировали жильцов", "ru").category == "incidents"
    assert classify("Pożar", "", "pl").category in ("other", "incidents")
    c = classify("Brand in Dierfeld", "Die Feuerwehr löschte eine brennende Scheune", "de")
    assert c.category == "incidents" and c.event_type == "fire"
    assert classify("Hochwasser", "Nach Unwetter steigen die Pegel", "de").category == "weather"
    assert classify("ФК Краснодар обыграл соперника", "Матч завершился со счётом 2:0", "ru").category == "sport"


def test_two_fires_in_big_city_with_different_streets_do_not_merge():
    a = _f(place_population=900_000, terms=Counter({"пожар": 2, "склад": 2, "площадь": 1}), names={"urals"})
    b = _f(place_population=900_000, terms=Counter({"пожар": 2, "квартира": 2, "площадь": 1}), names={"gidro"},
           at=a.at + timedelta(minutes=10))
    assert clustering.match_score(a, b)[0] < clustering.MATCH_THRESHOLD


def test_title_only_aggregator_item_joins_big_city_event_same_hour():
    ev = _f(place_population=2_900_000, lang="en", event_type="explosion",
            terms=Counter({"explosion": 3, "heard": 1, "emergency": 1, "services": 1, "district": 1}), names={"golos"})
    item = _f(place_population=2_900_000, lang="en", event_type="explosion", at=ev.at + timedelta(minutes=10),
              terms=Counter({"explosion": 2, "heard": 2, "emergency": 2, "services": 2, "respond": 2}))
    assert clustering.match_score(item, ev)[0] >= clustering.MATCH_THRESHOLD
