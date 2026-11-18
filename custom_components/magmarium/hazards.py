"""Tsunami warnings (NOAA, BMKG) and satellite thermal anomalies (NASA FIRMS)."""

from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
import io
import json
import re
from typing import Any
import xml.etree.ElementTree as ET

from .parsing import haversine_km

# ------------------------------------------------------------------ tsunami

# NOAA tsunami warning centers: Pacific (PTWC, also the international bulletins) and US mainland / Alaska (NTWC)
TSUNAMI_ATOM_URLS = {
    "PTWC": "https://www.tsunami.gov/events/xml/PHEBAtom.xml",
    "NTWC": "https://www.tsunami.gov/events/xml/PAAQAtom.xml",
}
TSUNAMI_PAGE = "https://www.tsunami.gov/"
# BMKG InaTEWS (Indonesia, tsunami service provider for the Indian Ocean)
BMKG_RECENT_URL = "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json"
BMKG_LATEST_URL = "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json"
BMKG_PAGE = "https://inatews.bmkg.go.id/"

# 4 warning / threat, 3 watch, 2 advisory, 1 information
TSUNAMI_LEVELS = {"warning": 4, "threat": 4, "watch": 3, "advisory": 2, "information": 1}
TSUNAMI_LEVEL_NAMES = {4: "Warning", 3: "Watch", 2: "Advisory", 1: "Information"}
# how long an event stays on the globe after its last bulletin
TSUNAMI_HOURS = {4: 12, 3: 12, 2: 12, 1: 3}
# NOAA and BMKG bulletins of the same earthquake are merged
TSUNAMI_SAME_KM = 300
TSUNAMI_SAME_MINUTES = 45

_NS = {
    "a": "http://www.w3.org/2005/Atom",
    "geo": "http://www.w3.org/2003/01/geo/wgs84_pos#",
}
_CATEGORY = re.compile(r"Category\s*:\s*([A-Za-z ]+?)\s*(?:<|\n|Bulletin|$)", re.IGNORECASE)
_MAG = re.compile(r"Magnitude\s*:\s*([0-9.]+)", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")


def _float(value: Any) -> float | None:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _iso(value: str | None) -> str | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def tsunami_level(category: str | None, title: str | None = None) -> int:
    """Level of a NOAA bulletin; 0 for cancellations and unknown products."""
    text = f"{category or ''} {title or ''}".lower()
    if "cancel" in text or "final" in text:
        return 0
    for key in ("warning", "threat", "watch", "advisory", "information"):
        if key in (category or "").lower():
            return TSUNAMI_LEVELS[key]
    for key in ("warning", "threat", "watch", "advisory", "information"):
        if key in text:
            return TSUNAMI_LEVELS[key]
    return 0


def parse_tsunami_atom(text: str, center: str) -> list[dict[str, Any]]:
    """Bulletins of one NOAA warning center (its Atom feed holds the latest bulletin per event)."""
    if not text or not text.strip():
        return []
    root = ET.fromstring(text)
    feed_title = (root.findtext("a:title", default="", namespaces=_NS) or "").strip()
    out: list[dict[str, Any]] = []
    for entry in root.findall("a:entry", _NS):
        summary_el = entry.find("a:summary", _NS)
        summary = ET.tostring(summary_el, encoding="unicode") if summary_el is not None else ""
        plain = _TAGS.sub("\n", summary)
        cat = _CATEGORY.search(plain)
        category = cat.group(1).strip() if cat else ""
        level = tsunami_level(category, feed_title)
        lat = _float(entry.findtext("geo:lat", namespaces=_NS))
        lon = _float(entry.findtext("geo:long", namespaces=_NS))
        when = _iso(entry.findtext("a:updated", namespaces=_NS))
        if lat is None or lon is None or not when:
            continue
        mag = _MAG.search(plain)
        url = None
        for link in entry.findall("a:link", _NS):
            if link.get("rel") == "alternate" and link.get("href"):
                url = link.get("href").strip()
        out.append(
            {
                "source": f"NOAA {center}",
                "level": level,
                "category": category or (TSUNAMI_LEVEL_NAMES.get(level) or ""),
                "bulletin": " ".join(feed_title.split()) or None,
                "region": " ".join((entry.findtext("a:title", default="", namespaces=_NS) or "").split()),
                "lat": round(lat, 3),
                "lon": round(lon, 3),
                "mag": _float(mag.group(1)) if mag else None,
                "time": when,
                "url": url or TSUNAMI_PAGE,
            }
        )
    return out


def _bmkg_level(potential: str | None) -> int:
    text = (potential or "").lower()
    if "tsunami" not in text or "tidak" in text:
        return 0
    return 4


def _bmkg_item(item: dict[str, Any]) -> dict[str, Any] | None:
    level = _bmkg_level(item.get("Potensi"))
    if not level:
        return None
    coords = str(item.get("Coordinates") or "").split(",")
    if len(coords) != 2:
        return None
    lat, lon = _float(coords[0]), _float(coords[1])
    when = _iso(item.get("DateTime"))
    if lat is None or lon is None or not when:
        return None
    return {
        "source": "BMKG InaTEWS",
        "level": level,
        "category": "Warning",
        "bulletin": str(item.get("Potensi") or "").strip(),
        "region": str(item.get("Wilayah") or "").strip(),
        "lat": round(lat, 3),
        "lon": round(lon, 3),
        "mag": _float(item.get("Magnitude")),
        "time": when,
        "url": BMKG_PAGE,
    }


def parse_bmkg(texts: list[str]) -> list[dict[str, Any]]:
    """Earthquakes with a tsunami potential from the BMKG lists (latest and recent M5+)."""
    out: list[dict[str, Any]] = []
    for text in texts:
        if not text or not text.strip():
            continue
        data = json.loads(text)
        gempa = (data.get("Infogempa") or {}).get("gempa")
        items = gempa if isinstance(gempa, list) else [gempa] if isinstance(gempa, dict) else []
        for item in items:
            event = _bmkg_item(item)
            if event and not any(e["time"] == event["time"] and e["lat"] == event["lat"] for e in out):
                out.append(event)
    return out


def active_tsunami(events: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    """Events still in force: the newest bulletin per event, merged across sources, highest level first."""
    keep: list[dict[str, Any]] = []
    for ev in sorted(events, key=lambda e: e["time"], reverse=True):
        if not ev.get("level"):
            continue
        t = datetime.fromisoformat(ev["time"])
        if now - t > timedelta(hours=TSUNAMI_HOURS.get(ev["level"], 3)):
            continue
        same = None
        for other in keep:
            dt = abs((datetime.fromisoformat(other["time"]) - t).total_seconds()) / 60
            if dt <= TSUNAMI_SAME_MINUTES and haversine_km(other["lat"], other["lon"], ev["lat"], ev["lon"]) <= TSUNAMI_SAME_KM:
                same = other
                break
        if same is None:
            keep.append({**ev, "sources": [ev["source"]]})
            continue
        if ev["source"] not in same["sources"]:
            same["sources"].append(ev["source"])
        if ev["level"] > same["level"]:
            same.update({k: ev[k] for k in ("level", "category", "bulletin", "url", "source")})
    keep.sort(key=lambda e: (-e["level"], e["time"]))
    return keep


# ------------------------------------------------------------------ thermal anomalies

FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{area}/{days}"
FIRMS_PAGE = "https://firms.modaps.eosdis.nasa.gov/map/"
FIRMS_SOURCES = ("VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT")
FIRMS_DAYS = 2
# hotspots within this distance of the summit count for the volcano
FIRMS_RADIUS_KM = 5.0
FIRMS_BOX_DEG = 0.06


def firms_area(lat: float, lon: float) -> str:
    """west,south,east,north around a summit."""
    return ",".join(
        f"{v:.3f}"
        for v in (
            max(-180.0, lon - FIRMS_BOX_DEG),
            max(-90.0, lat - FIRMS_BOX_DEG),
            min(180.0, lon + FIRMS_BOX_DEG),
            min(90.0, lat + FIRMS_BOX_DEG),
        )
    )


class FirmsKeyError(Exception):
    """The FIRMS map key was refused."""


def parse_firms(text: str) -> list[dict[str, Any]]:
    """Hotspots of a FIRMS area CSV; low confidence detections are left out."""
    text = (text or "").strip()
    if not text:
        return []
    first = text.splitlines()[0].lower()
    if not first.startswith("latitude"):
        if "key" in first or "invalid" in first:
            raise FirmsKeyError(text.splitlines()[0][:120])
        raise ValueError(f"unexpected FIRMS answer: {text.splitlines()[0][:120]}")
    out: list[dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(text)):
        lat, lon = _float(row.get("latitude")), _float(row.get("longitude"))
        if lat is None or lon is None:
            continue
        conf = str(row.get("confidence") or "").strip().lower()
        if conf in ("l", "low") or (conf.isdigit() and int(conf) < 30):
            continue
        date = str(row.get("acq_date") or "").strip()
        hhmm = str(row.get("acq_time") or "").strip().zfill(4)
        try:
            when = datetime.strptime(f"{date} {hhmm}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
        out.append({"lat": lat, "lon": lon, "frp": _float(row.get("frp")) or 0.0, "time": when})
    return out


def thermal_summary(points: list[dict[str, Any]], lat: float, lon: float, source: str) -> dict[str, Any] | None:
    """Hotspots near a summit: count, total radiative power (MW), newest pass."""
    near = [p for p in points if haversine_km(lat, lon, p["lat"], p["lon"]) <= FIRMS_RADIUS_KM]
    if not near:
        return None
    return {
        "count": len(near),
        "frp_mw": round(sum(p["frp"] for p in near), 1),
        "max_mw": round(max(p["frp"] for p in near), 1),
        "time": max(p["time"] for p in near),
        "source": source,
    }


def merge_thermal(a: dict[str, Any] | None, b: dict[str, Any] | None) -> dict[str, Any] | None:
    """Two satellites over the same summit: keep the newer pass, the larger count."""
    if not a:
        return b
    if not b:
        return a
    newer, older = (a, b) if a["time"] >= b["time"] else (b, a)
    return {
        **newer,
        "count": max(a["count"], b["count"]),
        "frp_mw": max(a["frp_mw"], b["frp_mw"]),
        "max_mw": max(a["max_mw"], b["max_mw"]),
        "source": newer["source"] if newer["source"] == older["source"] else "VIIRS",
    }
