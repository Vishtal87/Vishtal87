"""Base vector tiles: every tile must contain the countries it covers, including tiles on the antimeridian edge."""
import pytest

pytestmark = pytest.mark.db

# (source_id, name, lon_min, lat_min, lon_max, lat_max)
COUNTRIES = [
    ("tile-west", "Tileland West", -100, 30, -90, 40),     # western hemisphere
    ("tile-central", "Tileland Central", 10, 45, 20, 52),  # just east of Greenwich
    ("tile-east", "Tileland East", 135, 33, 142, 40),      # next to the antimeridian (Japan-like)
]


@pytest.fixture()
def countries(db):
    with db() as c:
        for sid, name, x1, y1, x2, y2 in COUNTRIES:
            c.execute(
                "INSERT INTO geo_entity (source, source_id, kind, kind_rank, name, area, geom)"
                " VALUES ('test', %s, 'country', 1, %s, ST_Multi(ST_MakeEnvelope(%s, %s, %s, %s, 4326)),"
                "         ST_Centroid(ST_MakeEnvelope(%s, %s, %s, %s, 4326)))"
                " ON CONFLICT (source, source_id) DO NOTHING",
                (sid, name, x1, y1, x2, y2, x1, y1, x2, y2))
        c.commit()
    yield
    with db() as c:
        c.execute("DELETE FROM geo_entity WHERE source = 'test' AND source_id LIKE 'tile-%%'")
        c.commit()


def _tile(z, x, y):
    from geonews.api.routes.tiles import _tile

    _tile.cache_clear()
    return _tile(z, x, y, "en")


def test_eastern_edge_tile_keeps_its_own_hemisphere(countries):
    # z1 tile (1,1,0) = lon 0..180, lat 0..85: its margin crosses the antimeridian
    mvt = _tile(1, 1, 0)
    assert b"Tileland Central" in mvt and b"Tileland East" in mvt
    assert b"Tileland West" not in mvt


def test_western_edge_tile(countries):
    mvt = _tile(1, 0, 0)  # lon -180..0
    assert b"Tileland West" in mvt
    assert b"Tileland East" not in mvt
