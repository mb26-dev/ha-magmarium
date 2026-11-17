"""Merge the source data into one list of volcanoes (pure, runs in the executor)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .parsing import (
    LEVEL_NAMES_ID,
    analyse_vona_text,
    build_index,
    fallback_row,
    match_catalog,
    normalize_name,
)

LEVEL_KEYS = {0: "unknown", 1: "normal", 2: "advisory", 3: "watch", 4: "warning"}
COLOR_LEVEL = {"GREEN": 1, "YELLOW": 2, "ORANGE": 3, "RED": 4}
WEEKLY_LEVEL = {"new_eruptive": 3, "eruptive": 3, "new_unrest": 2, "ongoing": 2}
ROMAN = {1: "I", 2: "II", 3: "III", 4: "IV"}


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class _Builder:
    def __init__(self, catalog: list[list[Any]]) -> None:
        self.catalog = catalog
        self.index = build_index(catalog)
        self.volcanoes: dict[str, dict[str, Any]] = {}

    def resolve(self, name: str, country: str, lat: float | None = None, lon: float | None = None) -> dict[str, Any]:
        row = match_catalog(name, country, self.index) if self.index else None
        if row is None and country.lower() == "indonesia":
            row = fallback_row(name)
        if row is not None and row[0]:
            key = f"gvp:{row[0]}"
        elif row is not None:
            key = f"name:{normalize_name(row[1])}"
        else:
            key = f"name:{normalize_name(name)}"
        vol = self.volcanoes.get(key)
        if vol is None:
            vol = {
                "id": key,
                "name": row[1] if row else name,
                "local_name": None,
                "country": (row[2] if row else country) or country,
                "number": row[0] if row and row[0] else None,
                "lat": row[3] if row else lat,
                "lon": row[4] if row else lon,
                "elevation": row[5] if row else None,
                "type": row[7] if row else None,
                "level": 0,
                "level_key": "unknown",
                "alert": None,
                "province": None,
                "aviation_color": None,
                "erupting": False,
                "eruption": None,
                "ash": None,
                "notice": None,
                "weekly": None,
                "report_url": None,
                "sources": [],
            }
            self.volcanoes[key] = vol
        if vol["lat"] is None and lat is not None:
            vol["lat"], vol["lon"] = lat, lon
        return vol


def _add_source(vol: dict[str, Any], source: str) -> None:
    if source not in vol["sources"]:
        vol["sources"].append(source)


def build_volcanoes(
    catalog: list[list[Any]],
    levels: list[dict[str, Any]],
    vonas: list[dict[str, Any]],
    weekly: list[dict[str, Any]],
    now: datetime,
    ash_live_hours: float,
    eruption_hours: float,
) -> dict[str, Any]:
    """Return {"volcanoes": [...], "catalog": [...], "latest_vona": {...} | None}."""
    b = _Builder(catalog)

    # ---- MAGMA ground alert levels (Level I-IV)
    for item in levels:
        vol = b.resolve(item["name"], "Indonesia")
        _add_source(vol, "magma")
        # two MAGMA volcanoes can share one catalogue volcano (Lewotobi Laki-laki and
        # Lewotobi Perempuan): the higher level wins
        if "magma" in vol.get("_levels", ()) and int(item["level"]) <= vol["level"]:
            continue
        vol.setdefault("_levels", set()).add("magma")
        vol["local_name"] = item["name"] if normalize_name(item["name"]) != normalize_name(vol["name"]) else None
        vol["level"] = int(item["level"])
        vol["alert"] = f"Level {ROMAN[vol['level']]} ({LEVEL_NAMES_ID[vol['level']]})"
        vol["province"] = item.get("province") or None
        vol["report_url"] = item.get("url")

    # ---- MAGMA VONAs, newest first
    ordered = sorted(
        (v for v in vonas if not v.get("exercise")),
        key=lambda v: _parse_dt(v.get("issued")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    latest_vona: dict[str, Any] | None = None
    # volcanoes whose newest notice says the ash cloud is no longer observed
    cleared: set[str] = set()
    for v in ordered:
        issued = _parse_dt(v.get("issued"))
        if issued is None:
            continue
        vol = b.resolve(v["name"], "Indonesia")
        if vol["local_name"] is None and normalize_name(v["name"]) != normalize_name(vol["name"]):
            vol["local_name"] = v["name"]
        _add_source(vol, "magma")
        info = analyse_vona_text(v.get("text", ""))
        age_h = (now - issued).total_seconds() / 3600.0
        if vol["notice"] is None:
            vol["notice"] = {
                "kind": "vona",
                "time": issued.isoformat(),
                "text": v.get("text", ""),
                "color": v.get("color"),
                "url": v.get("url"),
                "source": "MAGMA Indonesia (PVMBG)",
            }
            vol["aviation_color"] = v.get("color")
            if latest_vona is None:
                latest_vona = {
                    "volcano": vol["name"],
                    "local_name": v["name"],
                    "time": issued.isoformat(),
                    "color": v.get("color"),
                    "text": v.get("text", ""),
                    "url": v.get("url"),
                    "ash": info["ash"],
                    "ash_top_m": info["top_m"],
                }
        if info["eruption"] and vol["eruption"] is None and 0 <= age_h <= eruption_hours:
            vol["eruption"] = {"time": issued.isoformat(), "source": "vona", "age_min": round(age_h * 60)}
        if not info["ash"] and vol["ash"] is None:
            cleared.add(vol["id"])
        if info["ash"] and vol["ash"] is None and 0 <= age_h <= ash_live_hours:
            strength = max(0.3, 1.0 - 0.7 * age_h / ash_live_hours)
            if vol["id"] in cleared:
                # a newer notice did not see ash any more: show the old cloud only faintly
                strength *= 0.5
            vol["ash"] = {
                "source": "vona",
                "time": issued.isoformat(),
                "age_min": round(age_h * 60),
                "top_m": info["top_m"],
                "above_summit_m": info["above_summit_m"],
                "toward": info["toward"],
                "toward_deg": info["toward_deg"],
                "color": info["ash_color"],
                "intensity": info["intensity"],
                # full strength when new, fading to 30 % at the end of the live window
                "strength": round(strength, 2),
            }

    # ---- Smithsonian / USGS weekly report (worldwide)
    for w in weekly:
        vol = b.resolve(w["name"], w.get("country", ""), w.get("lat"), w.get("lon"))
        _add_source(vol, "gvp_weekly")
        vol["weekly"] = {
            "period": w.get("period"),
            "status": w.get("status"),
            "status_key": w.get("status_key"),
            "text": w.get("text"),
            "url": "https://volcano.si.edu/reports_weekly.cfm",
            "ash": bool(w.get("ash")),
        }
        if vol["level"] == 0 and vol["aviation_color"] is None:
            vol["level"] = WEEKLY_LEVEL.get(w.get("status_key"), 2)
        if vol["eruption"] is None and (w.get("status_key") in ("new_eruptive", "eruptive") or w.get("ash")):
            vol["eruption"] = {"time": None, "source": "weekly", "age_min": None}
        if vol["ash"] is None and w.get("ash"):
            vol["ash"] = {
                "source": "weekly",
                "time": None,
                "age_min": None,
                "top_m": w.get("ash_top_m"),
                "above_summit_m": w.get("ash_above_summit_m"),
                "toward": None,
                "toward_deg": None,
                "color": None,
                "intensity": None,
                "strength": 0.35,
            }
        if vol["notice"] is None:
            vol["notice"] = {
                "kind": "weekly",
                "time": None,
                "text": w.get("text"),
                "color": None,
                "url": "https://volcano.si.edu/reports_weekly.cfm",
                "source": "Smithsonian / USGS Weekly Volcanic Activity Report",
                "period": w.get("period"),
            }

    # ---- finish
    out: list[dict[str, Any]] = []
    for vol in b.volcanoes.values():
        vol.pop("_levels", None)
        if vol["level"] == 0 and vol["aviation_color"]:
            vol["level"] = COLOR_LEVEL.get(vol["aviation_color"], 0)
        vol["level_key"] = LEVEL_KEYS[vol["level"]]
        vol["erupting"] = vol["eruption"] is not None
        out.append(vol)
    out.sort(key=lambda v: (-v["level"], not v["erupting"], v["name"]))

    used = {v["number"] for v in out if v["number"]}
    background = [
        [r[1], r[2], r[3], r[4], r[5], r[0]]
        for r in catalog
        if r[0] not in used
    ]
    return {"volcanoes": out, "catalog": background, "latest_vona": latest_vona}


def nearest(volcanoes: list[dict[str, Any]], lat: float, lon: float, min_level: int = 2) -> tuple[dict[str, Any], float] | None:
    from .parsing import haversine_km

    best: tuple[dict[str, Any], float] | None = None
    for vol in volcanoes:
        if vol["lat"] is None or (vol["level"] < min_level and not vol["erupting"]):
            continue
        d = haversine_km(lat, lon, vol["lat"], vol["lon"])
        if best is None or d < best[1]:
            best = (vol, d)
    return best


def recent_cutoff(now: datetime, days: int) -> datetime:
    return now - timedelta(days=days)
