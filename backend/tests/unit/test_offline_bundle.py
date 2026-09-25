"""TopoJSON rings from world-atlas are stitched across the antimeridian; planar decoding must not invent half-world edges."""
from geonews.gazetteer.offline_bundle import _unwrap_ring


def test_ring_crossing_antimeridian_gets_continuous_longitudes():
    ring = [(179.0, 65.0), (-179.0, 66.0), (-178.0, 64.0), (179.0, 64.5), (179.0, 65.0)]
    out = _unwrap_ring(ring)
    assert out[0] == out[-1]
    assert all(abs(b[0] - a[0]) <= 180 for a, b in zip(out, out[1:]))
    assert max(x for x, _ in out) == 182.0            # -178 -> 182; the loader splits it back at 180


def test_ring_around_a_pole_is_closed_through_the_pole():
    ring = [(-180.0, -70.0), (-90.0, -72.0), (0.0, -69.0), (90.0, -71.0), (180.0, -70.0)]
    out = _unwrap_ring(ring)
    assert out[0] == out[-1]
    assert (180.0, -90.0) in out and (-180.0, -90.0) in out


def test_ordinary_ring_is_unchanged():
    ring = [(10.0, 50.0), (12.0, 50.0), (12.0, 52.0), (10.0, 50.0)]
    assert _unwrap_ring(ring) == ring
