"""Is volcanic ash near a place? (pure, no Home Assistant imports)."""

from __future__ import annotations

import math
from typing import Any

from .parsing import haversine_km


def _point_in_poly(lat: float, lon: float, poly: list[list[float]]) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


def _segment_km(lat: float, lon: float, a: list[float], b: list[float], steps: int = 12) -> float:
    best = math.inf
    for k in range(steps + 1):
        f = k / steps
        p_lat = a[0] + (b[0] - a[0]) * f
        p_lon = a[1] + (b[1] - a[1]) * f
        best = min(best, haversine_km(lat, lon, p_lat, p_lon))
    return best


def distance_to_polygon_km(lat: float, lon: float, poly: list[list[float]]) -> float:
    if len(poly) >= 3 and _point_in_poly(lat, lon, poly):
        return 0.0
    best = math.inf
    for i in range(len(poly)):
        best = min(best, _segment_km(lat, lon, poly[i], poly[(i + 1) % len(poly)]))
    return best


def distance_to_track_km(lat: float, lon: float, track: list[list[float]]) -> tuple[float, float | None]:
    """Smallest distance to a drift track and the hour at which it is reached."""
    best, hour = math.inf, None
    for i in range(len(track) - 1):
        d = _segment_km(lat, lon, track[i], track[i + 1], 8)
        if d < best:
            best, hour = d, float(i + 1)
    return best, hour


def ash_threats(
    lat: float,
    lon: float,
    radius_km: float,
    volcanoes: list[dict[str, Any]],
    sigmets: list[dict[str, Any]],
    winds: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Every ash source within radius_km of a place, nearest first."""
    winds = winds or {}
    found: list[dict[str, Any]] = []
    for s in sigmets:
        d = distance_to_polygon_km(lat, lon, s.get("poly") or [])
        if d <= radius_km:
            found.append({
                "kind": "sigmet",
                "volcano": s.get("volcano"),
                "distance_km": round(d, 1),
                "inside": d == 0.0,
                "top_m": s.get("top_m"),
                "valid_until": s.get("to"),
                "fir": s.get("fir"),
            })
    for v in volcanoes:
        ash = v.get("ash")
        if not ash or v.get("lat") is None:
            continue
        name = v.get("local_name") or v.get("name")
        d0 = haversine_km(lat, lon, v["lat"], v["lon"])
        if d0 <= radius_km:
            found.append({"kind": "plume", "volcano": name, "distance_km": round(d0, 1), "source": ash.get("source"), "top_m": ash.get("top_m")})
            continue
        wind = winds.get(v["id"]) or v.get("wind")
        track = (wind or {}).get("track") or []
        if len(track) >= 2:
            d, hour = distance_to_track_km(lat, lon, track)
            if d <= radius_km:
                found.append({
                    "kind": "drift",
                    "volcano": name,
                    "distance_km": round(d, 1),
                    "eta_hours": hour,
                    "source": ash.get("source"),
                    "top_m": ash.get("top_m"),
                })
    found.sort(key=lambda t: t["distance_km"])
    return found
