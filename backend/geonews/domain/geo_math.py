"""Small spherical-geometry helpers (pure, no I/O)."""
from __future__ import annotations

import math

EARTH_KM = 6371.0088
BEARINGS = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 2 * EARTH_KM * math.asin(math.sqrt(max(a, 0.0)))


def destination(lat: float, lon: float, bearing_deg: float, km: float) -> tuple[float, float]:
    """Point reached from (lat, lon) travelling km along the initial bearing."""
    d = km / EARTH_KM
    b = math.radians(bearing_deg)
    la1, lo1 = math.radians(lat), math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b))
    lo2 = lo1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def spherical_mean(points: list[tuple[float, float]], weights: list[float] | None = None) -> tuple[float, float]:
    """Mean position on the sphere (antimeridian-safe)."""
    weights = weights or [1.0] * len(points)
    x = y = z = 0.0
    for (lat, lon), w in zip(points, weights):
        la, lo = math.radians(lat), math.radians(lon)
        x += w * math.cos(la) * math.cos(lo)
        y += w * math.cos(la) * math.sin(lo)
        z += w * math.sin(la)
    return math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))
