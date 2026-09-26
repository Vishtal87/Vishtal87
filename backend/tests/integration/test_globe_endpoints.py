"""Endpoints behind the living globe: city lights, pulse of the planet, worldwide hotspots."""
import json

import pytest

pytestmark = pytest.mark.db


def test_city_lights_are_the_biggest_places(db):
    from geonews.api.routes import geo

    with db() as c:
        c.execute("INSERT INTO geo_entity (source, source_id, kind, kind_rank, name, population, geom) VALUES"
                  " ('test', 'light-big', 'locality', 5, 'Big', 5000000, ST_SetSRID(ST_MakePoint(10, 20), 4326)),"
                  " ('test', 'light-small', 'locality', 5, 'Small', 100, ST_SetSRID(ST_MakePoint(11, 21), 4326))"
                  " ON CONFLICT (source, source_id) DO NOTHING")
        c.commit()
        try:
            geo._lights = None
            rows = json.loads(geo.city_lights(conn=c).body)
            assert [10.0, 20.0, 5000000] in rows and not any(r[2] == 100 for r in rows)
        finally:
            geo._lights = None
            c.execute("DELETE FROM geo_entity WHERE source = 'test' AND source_id LIKE 'light-%%'")
            c.commit()


def test_pulse_has_a_day_of_hours(db):
    from geonews.api.routes.meta import pulse

    with db() as c:
        p = pulse(lang="ru", conn=c)
    assert len(p["hourly"]) == 24 and all(n >= 0 for n in p["hourly"])
    assert p["last_hour"] >= 0 and isinstance(p["top"], list)


def test_worldwide_hotspots_need_no_bbox(db):
    from geonews.api.filters import parse_filters
    from geonews.api.routes.map import aggregate

    with db() as c:
        out = aggregate(level="locality", bbox=None, lang="ru", f=parse_filters(window="24h", since=None, until=None, cats=None, sources=None), conn=c)
    assert out["type"] == "FeatureCollection" and all(f["properties"]["kind"] == "locality" for f in out["features"])
