"""Winds aloft from Open-Meteo for ash drift simulation (pure, no Home Assistant imports)."""

from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any
from urllib.parse import urlencode

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# pressure level (hPa) -> typical height above sea level (km)
PRESSURE_LEVELS: list[tuple[int, float]] = [
    (850, 1.5),
    (700, 3.0),
    (500, 5.6),
    (400, 7.2),
    (300, 9.2),
    (250, 10.4),
]
TRACK_HOURS = 6
PAST_HOURS = 1
FORECAST_HOURS = 12
MAX_POINTS = 40
EARTH_KM_PER_DEG = 111.2


def level_for_height(km: float) -> tuple[int, float]:
    """Pressure level whose typical height is closest to km above sea level."""
    return min(PRESSURE_LEVELS, key=lambda lv: abs(lv[1] - km))


def plume_height_km(vol: dict[str, Any]) -> float:
    """Best estimate of the ash cloud top above sea level, in km."""
    elev_m = vol.get("elevation") or 0
    ash = vol.get("ash") or {}
    if ash.get("top_m"):
        return max(0.5, ash["top_m"] / 1000)
    if ash.get("above_summit_m") is not None:
        return max(0.5, (elev_m + ash["above_summit_m"]) / 1000)
    # no reported height: assume a moderate column above the summit
    return max(1.5, elev_m / 1000 + 1.5)


def wind_points(volcanoes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Volcanoes that need winds aloft: an ash cloud or an eruption on the record."""
    points: list[dict[str, Any]] = []
    for vol in volcanoes:
        if vol.get("lat") is None or vol.get("lon") is None:
            continue
        if not (vol.get("ash") or vol.get("erupting")):
            continue
        points.append({"id": vol["id"], "lat": round(float(vol["lat"]), 3), "lon": round(float(vol["lon"]), 3)})
    # live VONA ash first, so the cap never drops the interesting ones
    order = {v["id"]: i for i, v in enumerate(volcanoes)}
    ranked = sorted(
        points,
        key=lambda p: (
            0 if ((next(v for v in volcanoes if v["id"] == p["id"]).get("ash") or {}).get("source") == "vona") else 1,
            order[p["id"]],
        ),
    )
    return ranked[:MAX_POINTS]


def points_key(points: list[dict[str, Any]]) -> str:
    return ";".join(sorted(f"{p['lat']},{p['lon']}" for p in points))


def build_url(points: list[dict[str, Any]]) -> str:
    hourly = []
    for hpa, _km in PRESSURE_LEVELS:
        hourly.append(f"wind_speed_{hpa}hPa")
        hourly.append(f"wind_direction_{hpa}hPa")
    query = {
        "latitude": ",".join(str(p["lat"]) for p in points),
        "longitude": ",".join(str(p["lon"]) for p in points),
        "hourly": ",".join(hourly),
        "wind_speed_unit": "kmh",
        "timeformat": "unixtime",
        "timezone": "GMT",
        "past_hours": PAST_HOURS,
        "forecast_hours": FORECAST_HOURS,
    }
    return f"{OPEN_METEO_URL}?{urlencode(query, safe=',')}"


def parse_response(data: Any, points: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Map volcano id -> {"lat", "lon", "times": [...], "levels": {hPa: [[speed, from_deg], ...]}}."""
    items = data if isinstance(data, list) else [data]
    if len(items) != len(points):
        raise ValueError(f"expected {len(points)} locations, got {len(items)}")
    out: dict[str, dict[str, Any]] = {}
    for point, item in zip(points, items):
        hourly = (item or {}).get("hourly") or {}
        times = [int(t) for t in hourly.get("time") or []]
        if not times:
            continue
        levels: dict[str, list[list[float | None]]] = {}
        for hpa, _km in PRESSURE_LEVELS:
            speeds = hourly.get(f"wind_speed_{hpa}hPa") or []
            dirs = hourly.get(f"wind_direction_{hpa}hPa") or []
            series = []
            for i in range(len(times)):
                s = speeds[i] if i < len(speeds) else None
                d = dirs[i] if i < len(dirs) else None
                series.append([s, d])
            levels[str(hpa)] = series
        out[point["id"]] = {"lat": point["lat"], "lon": point["lon"], "times": times, "levels": levels}
    return out


def _step(lat: float, lon: float, speed_kmh: float, toward_deg: float, hours: float) -> tuple[float, float]:
    d = speed_kmh * hours
    b = math.radians(toward_deg)
    dlat = d * math.cos(b) / EARTH_KM_PER_DEG
    coslat = max(0.05, math.cos(math.radians(lat)))
    dlon = d * math.sin(b) / (EARTH_KM_PER_DEG * coslat)
    nlat = max(-89.0, min(89.0, lat + dlat))
    nlon = ((lon + dlon + 540) % 360) - 180
    return nlat, nlon


def wind_for(
    vol: dict[str, Any],
    record: dict[str, Any] | None,
    now: datetime,
    hours: int = TRACK_HOURS,
) -> dict[str, Any] | None:
    """Current wind at the plume height and a simple drift track for the next hours."""
    if not record or vol.get("lat") is None:
        return None
    times: list[int] = record.get("times") or []
    if not times:
        return None
    hpa, alt = level_for_height(plume_height_km(vol))
    series = (record.get("levels") or {}).get(str(hpa)) or []
    ts = now.timestamp()
    idx = max(0, min(len(times) - 1, int(round((ts - times[0]) / 3600))))
    if abs(times[idx] - ts) > 3 * 3600 or idx >= len(series):
        return None  # stale data: better nothing than a wrong direction
    speed, from_deg = series[idx]
    if speed is None or from_deg is None:
        return None
    toward = (float(from_deg) + 180.0) % 360.0
    lat, lon = float(vol["lat"]), float(vol["lon"])
    track = [[round(lat, 3), round(lon, 3)]]
    for h in range(hours):
        j = min(idx + h, len(series) - 1)
        s, f = series[j]
        if s is None or f is None:
            break
        lat, lon = _step(lat, lon, float(s), (float(f) + 180.0) % 360.0, 1.0)
        track.append([round(lat, 3), round(lon, 3)])
    return {
        "level_hpa": hpa,
        "alt_km": alt,
        "speed_kmh": round(float(speed), 1),
        "toward_deg": round(toward, 1),
        "time": datetime.fromtimestamp(times[idx], tz=timezone.utc).isoformat(),
        "track": track,
    }
