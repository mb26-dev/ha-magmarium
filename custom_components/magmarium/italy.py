"""Parsers for the official Italian sources (pure, no Home Assistant imports).

- Dipartimento della Protezione Civile: the national alert levels of the Italian volcanoes
  (verde, giallo, arancione, rosso), published as GeoJSON for the official map
- INGV Osservatorio Etneo: VONA notices for aviation (Etna, Stromboli)
- INGV: earthquakes in and around Italy (FDSN event web service, text format)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import html as html_lib
import json
import math
import re
from typing import Any
from urllib.parse import urlencode

from .parsing import haversine_km, safe_url

DPC_URL = (
    "https://raw.githubusercontent.com/pcm-dpc/DPC-Mappe/master/"
    "rischi/vulcani-livelli-allerte/vulcani_liv_allerta_maplite.geojson"
)
DPC_MAP_PAGE = "https://mappe.protezionecivile.gov.it/it/mappe-e-dashboard-rischi/mappa-livelli-di-allerta-vulcani-italia/"
INGV_VONA_URL = "https://www.ct.ingv.it/sezioniesterne/Comunicati/ComunicatiVonaN.php"
INGV_VONA_PAGE = "https://www.ct.ingv.it/index.php/monitoraggio-e-sorveglianza/prodotti-del-monitoraggio/comunicati-vona"
INGV_QUAKE_URL = "https://webservices.ingv.it/fdsnws/event/1/query"
INGV_EVENT_PAGE = "https://terremoti.ingv.it/event/{id}"

DPC_LEVEL = {"verde": 1, "giallo": 2, "arancione": 3, "rosso": 4}
DPC_COLOR_EN = {"verde": "Green", "giallo": "Yellow", "arancione": "Orange", "rosso": "Red"}
COLOR_LEVEL = {"GREEN": 1, "YELLOW": 2, "ORANGE": 3, "RED": 4}

# summit positions of the volcanoes in the INGV VONA list (the list itself has none)
VONA_VOLCANOES = {
    "etna": ("Etna", 37.748, 14.999),
    "stromboli": ("Stromboli", 38.789, 15.213),
}
# VONAs older than this no longer describe the current state
VONA_MAX_AGE_DAYS = 120

# earthquakes: Italy and the surrounding seas, a week back
ITALY_BOX = {"minlat": 35.0, "maxlat": 48.0, "minlon": 6.0, "maxlon": 19.0}
INGV_QUAKE_DAYS = 7
INGV_QUAKE_MIN_MAG = 2.0
# INGV quakes away from volcanoes are kept from this magnitude on
INGV_QUAKE_KEEP_MAG = 3.0
INGV_QUAKE_MAX = 600
# a USGS quake this close in time and place to an INGV quake is the same event
DUPLICATE_SECONDS = 60
DUPLICATE_KM = 50.0

_TAG = re.compile(r"<[^>]+>")
_HREF = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.IGNORECASE | re.DOTALL)
_COLOR = re.compile(r"\b(GREEN|YELLOW|ORANGE|RED)\b", re.IGNORECASE)
_EVENT_ID = re.compile(r"^\d+$")


def _text(value: Any) -> str:
    """Plain text of a short HTML fragment."""
    return re.sub(r"\s+", " ", html_lib.unescape(_TAG.sub(" ", str(value or "")))).strip()


def _num(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# --------------------------------------------------------------------------- Protezione Civile


def parse_dpc_levels(text: str) -> list[dict[str, Any]]:
    """Alert levels of the Italian volcanoes from the Civil Protection GeoJSON.

    Volcanoes whose levels are not defined yet ("non definito") are left out.
    """
    data = json.loads(text)
    out: list[dict[str, Any]] = []
    for feat in data.get("features") or []:
        p = feat.get("properties") or {}
        key = str(p.get("livello_allerta") or "").strip().lower()
        level = DPC_LEVEL.get(key)
        if level is None:
            continue
        coords = (feat.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = _num(coords[0]), _num(coords[1])
        name = _text(p.get("Vulcano"))
        if lat is None or lon is None or not name:
            continue
        link = _HREF.search(str(p.get("livello_allerta_link") or ""))
        page = _HREF.search(str(p.get("Vulcano") or ""))
        url = (
            (safe_url(html_lib.unescape(link.group(1))) if link else None)
            or (safe_url(html_lib.unescape(page.group(1))) if page else None)
            or DPC_MAP_PAGE
        )
        out.append({
            "source": "dpc",
            "name": name,
            "country": "Italy",
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "level": level,
            "color": None,
            "alert": f"Civil Protection alert level {DPC_COLOR_EN[key]} ({key.capitalize()})",
            "time": None,
            "url": url,
        })
    return out


# --------------------------------------------------------------------------- INGV VONA


def parse_ingv_vona(page: str, now: datetime) -> list[dict[str, Any]]:
    """Newest VONA per volcano from the INGV Osservatorio Etneo list (times in UTC)."""
    oldest = now - timedelta(days=VONA_MAX_AGE_DAYS)
    newest: dict[str, dict[str, Any]] = {}
    for row in _ROW.findall(page):
        cells = _CELL.findall(row)
        if len(cells) < 4:
            continue
        name = _text(cells[0])
        when = _text(cells[1])
        color_m = _COLOR.search(_text(cells[2]))
        if not name or not color_m:
            continue
        try:
            issued = datetime.strptime(when, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if issued < oldest:
            continue
        key = name.strip().lower()
        prev = newest.get(key)
        if prev is not None and prev["time"] >= issued.isoformat():
            continue
        color = color_m.group(1).upper()
        known = VONA_VOLCANOES.get(key)
        link = _HREF.search(cells[3])
        url = safe_url(html_lib.unescape(link.group(1)), INGV_VONA_URL) if link else None
        newest[key] = {
            "source": "ingv",
            "name": known[0] if known else name.title(),
            "country": "Italy",
            "lat": known[1] if known else None,
            "lon": known[2] if known else None,
            "level": COLOR_LEVEL[color],
            "color": color,
            "alert": f"Aviation colour code {color.title()} (VONA)",
            "time": issued.isoformat(),
            "url": url or INGV_VONA_PAGE,
        }
    return sorted(newest.values(), key=lambda o: o["time"], reverse=True)


# --------------------------------------------------------------------------- INGV earthquakes


def ingv_quake_url(now: datetime) -> str:
    """FDSN query for the last week of earthquakes in and around Italy."""
    start = (now - timedelta(days=INGV_QUAKE_DAYS)).strftime("%Y-%m-%dT%H:%M:%S")
    params = {
        "starttime": start,
        **{k: f"{v:g}" for k, v in ITALY_BOX.items()},
        "minmag": f"{INGV_QUAKE_MIN_MAG:g}",
        "format": "text",
        "orderby": "time",
        "limit": str(INGV_QUAKE_MAX),
    }
    return f"{INGV_QUAKE_URL}?{urlencode(params)}"


def parse_ingv_quakes(text: str) -> list[dict[str, Any]]:
    """Earthquakes from the INGV FDSN text format, newest first.

    Columns: EventID|Time|Latitude|Longitude|Depth/Km|Author|Catalog|Contributor|ContributorID|
    MagType|Magnitude|MagAuthor|EventLocationName|EventType
    """
    seen: dict[str, dict[str, Any]] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        f = line.split("|")
        if len(f) < 13:
            continue
        eid = f[0].strip()
        if len(f) > 13 and f[13].strip() and f[13].strip().lower() != "earthquake":
            continue  # quarry blasts and other events
        lat, lon, depth, mag = _num(f[2]), _num(f[3]), _num(f[4]), _num(f[10])
        if lat is None or lon is None or mag is None or not eid:
            continue
        try:
            t = datetime.fromisoformat(f[1].strip().replace("Z", ""))
        except ValueError:
            continue
        t = t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t.astimezone(timezone.utc)
        url = safe_url(INGV_EVENT_PAGE.format(id=eid)) if _EVENT_ID.match(eid) else None
        seen[eid] = {
            "id": f"ingv:{eid}",
            "lat": round(lat, 3),
            "lon": round(lon, 3),
            "depth_km": round(depth, 1) if depth is not None else None,
            "mag": round(mag, 1),
            "time": t.replace(microsecond=0).isoformat(),
            "place": f[12].strip(),
            "url": url or "",
            "source": "INGV",
        }
    quakes = sorted(seen.values(), key=lambda q: q["time"], reverse=True)
    return quakes[:INGV_QUAKE_MAX]


def merge_quakes(usgs: list[dict[str, Any]], ingv: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """USGS and INGV quakes in one list: inside Italy INGV is more precise, so a USGS quake
    that is the same event as an INGV quake is dropped."""
    if not ingv:
        return list(usgs)
    ingv_times = [(datetime.fromisoformat(q["time"]), q) for q in ingv]
    out = list(ingv)
    for q in usgs:
        t = datetime.fromisoformat(q["time"])
        same = any(
            abs((t - it).total_seconds()) <= DUPLICATE_SECONDS
            and haversine_km(q["lat"], q["lon"], iq["lat"], iq["lon"]) <= DUPLICATE_KM
            for it, iq in ingv_times
        )
        if not same:
            out.append(q)
    return sorted(out, key=lambda q: q["time"], reverse=True)


def keep_ingv_quake(q: dict[str, Any]) -> bool:
    """Small Italian quakes are only interesting near a volcano (Campi Flegrei, Etna ...)."""
    if not str(q.get("id") or "").startswith("ingv:"):
        return True
    return bool(q.get("volcano")) or float(q.get("mag") or 0) >= INGV_QUAKE_KEEP_MAG
