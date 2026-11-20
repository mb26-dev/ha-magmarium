"""Parsers for the additional official sources (pure, no Home Assistant imports).

- USGS HANS: alert level and aviation colour code of US volcanoes
- Icelandic Met Office: aviation colour code notifications
- Japan Meteorological Agency: volcanic alert levels
- AviationWeather.gov: international volcanic ash SIGMETs (official ash areas)
- USGS earthquakes
- Wikidata: English Wikipedia article per Smithsonian volcano number
"""

from __future__ import annotations

from datetime import datetime, timezone
import html as html_lib
import json
import math
import re
from typing import Any
from urllib.parse import quote, unquote

from .parsing import haversine_km, normalize_name, safe_url

USGS_URL = "https://volcanoes.usgs.gov/hans-public/api/volcano/getMonitoredVolcanoes"
USGS_NOTICE_PAGE = "https://volcanoes.usgs.gov/hans-public/"
IMO_URL = "https://en.vedur.is/earthquakes-and-volcanism/volcanoes/vona-notifications/"
JMA_WARNING_URL = "https://www.jma.go.jp/bosai/volcano/data/warning.json"
JMA_LIST_URL = "https://www.jma.go.jp/bosai/volcano/const/volcano_list.json"
JMA_PAGE = "https://www.jma.go.jp/bosai/map.html#contents=volcano&lang=en"
SIGMET_URL = "https://aviationweather.gov/api/data/isigmet?format=json&hazard=va"
QUAKE_URLS = [
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
]
WIKIDATA_URL = "https://query.wikidata.org/sparql?format=json&query=" + quote(
    "SELECT ?gvp ?article WHERE { ?item wdt:P1886 ?gvp . "
    "?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }"
)

USGS_LEVEL = {"NORMAL": 1, "ADVISORY": 2, "WATCH": 3, "WARNING": 4}
COLOR_LEVEL = {"GREEN": 1, "YELLOW": 2, "ORANGE": 3, "RED": 4}
JMA_KEYWORDS = {
    1: "Keep in mind that this is an active volcano",
    2: "Do not approach the crater",
    3: "Do not approach the volcano",
    4: "Prepare to evacuate",
    5: "Evacuate",
}
FEET_TO_M = 0.3048
QUAKE_NEAR_KM = 30.0
QUAKE_MAX = 400
COMPASS = {
    "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
    "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5,
}


def _iso_from_unix(value: Any) -> str | None:
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _num(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# --------------------------------------------------------------------------- USGS


def parse_usgs(text: str) -> list[dict[str, Any]]:
    """Monitored US volcanoes with their current alert level and colour code."""
    data = json.loads(text)
    if not isinstance(data, list):
        raise ValueError("USGS: expected a list")
    out: list[dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        alert = str(row.get("alert_level") or "").upper()
        color = str(row.get("color_code") or "").upper()
        level = max(USGS_LEVEL.get(alert, 0), COLOR_LEVEL.get(color, 0))
        if level == 0:
            continue  # UNASSIGNED: not monitored well enough to say anything
        vnum = str(row.get("vnum") or "").strip() or None
        out.append({
            "source": "usgs",
            "number": int(vnum) if vnum and vnum.isdigit() else None,
            "name": row.get("volcano_name") or "",
            "country": "United States",
            "level": level,
            "color": color if color in COLOR_LEVEL else None,
            "alert": f"Volcano Alert Level {alert.title()} · Aviation Color Code {color.title()} (USGS)",
            "time": _iso_from_unix(row.get("sent_unixtime")),
            "url": safe_url(row.get("notice_url")) or USGS_NOTICE_PAGE,
            "observatory": row.get("obs_fullname"),
        })
    return out


# --------------------------------------------------------------------------- Iceland

_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_TD = re.compile(r"<td[^>]*>(.*?)</td>", re.IGNORECASE | re.DOTALL)
_HREF = re.compile(r'href="([^"]*nr=\d+[^"]*)"', re.IGNORECASE)


def _cell_text(value: str) -> str:
    return html_lib.unescape(re.sub(r"<[^>]+>", " ", value)).strip()


def parse_imo(page: str) -> list[dict[str, Any]]:
    """Current aviation colour code per Icelandic volcano (newest notification wins)."""
    seen: dict[str, dict[str, Any]] = {}
    for row in _TR.findall(page):
        cells = _TD.findall(row)
        if len(cells) < 4:
            continue
        name = _cell_text(cells[0])
        vid = _cell_text(cells[1])
        when = _cell_text(cells[2])
        color = _cell_text(cells[3]).upper()
        if not vid.isdigit() or color not in COLOR_LEVEL:
            continue
        try:
            issued = datetime.strptime(when, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        link = _HREF.search(row)
        url = html_lib.unescape(link.group(1)) if link else IMO_URL
        if url.startswith("?") or url.startswith("/"):
            url = "https://en.vedur.is" + (url if url.startswith("/") else "/earthquakes-and-volcanism/volcanoes/vona-notifications/" + url)
        url = safe_url(url) or IMO_URL
        prev = seen.get(vid)
        if prev is None or issued.isoformat() > prev["time"]:
            seen[vid] = {
                "source": "imo",
                "number": int(vid),
                "name": name,
                "country": "Iceland",
                "level": COLOR_LEVEL[color],
                "color": color,
                "alert": f"Aviation Color Code {color.title()} (Icelandic Met Office)",
                "time": issued.isoformat(),
                "url": url,
            }
    return list(seen.values())


# --------------------------------------------------------------------------- Japan


def _jma_level(code: Any) -> int | None:
    """JMA warning code -> JMA level 1..5 (None when the code is not a level)."""
    try:
        c = int(code)
    except (TypeError, ValueError):
        return None
    if 11 <= c <= 15:
        return c - 10
    # volcanoes without the level system: near-crater / mountain-entry / residential warnings
    return {21: 1, 22: 2, 23: 3, 24: 4, 25: 5}.get(c)


def parse_jma(warning_text: str, list_text: str) -> list[dict[str, Any]]:
    """Current JMA volcanic alert level per volcano, newest report wins."""
    warnings = json.loads(warning_text)
    vlist = json.loads(list_text)
    if not isinstance(warnings, list) or not isinstance(vlist, list):
        raise ValueError("JMA: unexpected structure")
    places: dict[str, dict[str, Any]] = {}
    for item in vlist:
        if not isinstance(item, dict) or not item.get("latlon"):
            continue
        try:
            lat, lon = float(item["latlon"][0]), float(item["latlon"][1])
        except (TypeError, ValueError, IndexError):
            continue
        places[str(item.get("code"))] = {"lat": lat, "lon": lon, "name": item.get("name_en") or item.get("name_jp") or ""}
    best: dict[str, dict[str, Any]] = {}
    for report in warnings:
        if not isinstance(report, dict):
            continue
        when = report.get("reportDatetime")
        for group in report.get("volcanoInfos") or []:
            for item in group.get("items") or []:
                level = _jma_level(item.get("code"))
                if level is None:
                    continue
                for area in item.get("areas") or []:
                    code = str(area.get("code") or "")
                    place = places.get(code)
                    if place is None:
                        continue
                    prev = best.get(code)
                    if prev is not None and str(prev["time"] or "") >= str(when or ""):
                        continue
                    ours = min(4, level)
                    best[code] = {
                        "source": "jma",
                        "number": None,
                        "name": place["name"],
                        "country": "Japan",
                        "lat": place["lat"],
                        "lon": place["lon"],
                        "level": ours,
                        "color": None,
                        "alert": f"JMA Level {level} ({JMA_KEYWORDS.get(level, '')})",
                        "time": when,
                        "url": JMA_PAGE,
                    }
    return list(best.values())


# --------------------------------------------------------------------------- VA SIGMETs


def _sigmet_volcano(qualifier: str, raw: str) -> str | None:
    q = (qualifier or "").upper().strip()
    m = re.search(r"\bMT\s+([A-Z][A-Z0-9'\-]+(?:\s+[A-Z][A-Z0-9'\-]+)?)", q) or re.search(
        r"\bMT\s+([A-Z][A-Z0-9'\-]+(?:\s+[A-Z][A-Z0-9'\-]+)?)\s+PSN", (raw or "").upper()
    )
    if m:
        return m.group(1).title()
    q = re.sub(r"^(ERUPTION|VA|CLD)\s+", "", q)
    q = re.sub(r"\s+PSN.*$", "", q)
    if q and q not in ("ERUPTION", "CLD", "VA"):
        return q.title()
    return None


def parse_sigmets(text: str, now: datetime) -> list[dict[str, Any]]:
    """Valid volcanic ash SIGMET areas."""
    data = json.loads(text)
    if not isinstance(data, list):
        raise ValueError("SIGMET: expected a list")
    ts = now.timestamp()
    out: list[dict[str, Any]] = []
    forecasts: list[tuple[dict[str, Any], list[list[float]]]] = []
    for row in data:
        if not isinstance(row, dict) or str(row.get("hazard") or "").upper() != "VA":
            continue
        valid_to = _num(row.get("validTimeTo"))
        if valid_to is not None and valid_to < ts:
            continue
        poly = []
        for c in row.get("coords") or []:
            lat, lon = _num((c or {}).get("lat")), _num((c or {}).get("lon"))
            if lat is not None and lon is not None:
                poly.append([round(lat, 3), round(lon, 3)])
        if len(poly) < 3:
            continue
        if str(row.get("seriesId") or "").upper().endswith("F"):
            # the forecast position of the ash cloud at the end of the validity ("FCST AT ...")
            forecasts.append((row, poly))
            continue
        top_ft = _num(row.get("top"))
        base_ft = _num(row.get("base"))
        dir_txt = str(row.get("dir") or "").upper().strip()
        spd = _num(row.get("spd"))
        out.append({
            "fir": row.get("firName") or row.get("firId") or "",
            "icao": row.get("icaoId"),
            "volcano": _sigmet_volcano(str(row.get("qualifier") or ""), str(row.get("rawSigmet") or "")),
            "from": _iso_from_unix(row.get("validTimeFrom")),
            "to": _iso_from_unix(valid_to),
            "base_m": round(base_ft * FEET_TO_M) if base_ft is not None else None,
            "top_m": round(top_ft * FEET_TO_M) if top_ft is not None else None,
            "toward_deg": COMPASS.get(dir_txt),
            "speed_kmh": round(spd * 1.852) if spd is not None else None,
            "poly": poly,
            "forecast_poly": None,
            "raw": str(row.get("rawSigmet") or "")[:1200],
            "_key": (row.get("firId"), str(row.get("rawSigmet") or "")),
        })
    for row, poly in forecasts:
        key = (row.get("firId"), str(row.get("rawSigmet") or ""))
        base = next((s for s in out if s["_key"] == key), None)
        if base is not None:
            base["forecast_poly"] = poly
    for s in out:
        s.pop("_key", None)
    return out


# --------------------------------------------------------------------------- earthquakes


def parse_quakes(texts: list[str]) -> list[dict[str, Any]]:
    """Earthquakes from the USGS GeoJSON feeds, de-duplicated, newest first."""
    seen: dict[str, dict[str, Any]] = {}
    for text in texts:
        data = json.loads(text)
        for feat in data.get("features") or []:
            p = feat.get("properties") or {}
            coords = (feat.get("geometry") or {}).get("coordinates") or []
            if len(coords) < 2:
                continue
            lon, lat = _num(coords[0]), _num(coords[1])
            depth = _num(coords[2]) if len(coords) > 2 else None
            mag = _num(p.get("mag"))
            t = _num(p.get("time"))
            if lat is None or lon is None or mag is None or t is None:
                continue
            qid = str(feat.get("id") or f"{lat},{lon},{t}")
            seen[qid] = {
                "id": qid,
                "lat": round(lat, 3),
                "lon": round(lon, 3),
                "depth_km": round(depth, 1) if depth is not None else None,
                "mag": round(mag, 1),
                "time": datetime.fromtimestamp(t / 1000, tz=timezone.utc).isoformat(),
                "place": p.get("place") or "",
                "url": safe_url(p.get("url")) or "",
            }
    quakes = sorted(seen.values(), key=lambda q: q["time"], reverse=True)
    return quakes[:QUAKE_MAX]


def mark_volcanic(quakes: list[dict[str, Any]], points: list[tuple[float, float, str, str]]) -> list[dict[str, Any]]:
    """Nearest volcano within QUAKE_NEAR_KM for each quake (points: lat, lon, name, key)."""
    out = []
    for q in quakes:
        near = None
        best = QUAKE_NEAR_KM
        for lat, lon, name, key in points:
            if abs(lat - q["lat"]) > 0.5:
                continue
            d = haversine_km(q["lat"], q["lon"], lat, lon)
            if d <= best:
                best, near = d, (name, key)
        out.append({
            **q,
            "volcano": near[0] if near else None,
            "volcano_key": near[1] if near else None,
            "volcano_km": round(best, 1) if near else None,
        })
    return out


# --------------------------------------------------------------------------- Wikipedia


def parse_wikidata(text: str) -> dict[str, list[str]]:
    data = json.loads(text)
    out: dict[str, list[str]] = {}
    for b in (data.get("results") or {}).get("bindings") or []:
        gvp = str((b.get("gvp") or {}).get("value") or "").strip()
        url = str((b.get("article") or {}).get("value") or "")
        if not gvp.isdigit() or "/wiki/" not in url:
            continue
        # Wikidata gives the article URL percent-encoded: keep the plain title
        title = unquote(url.split("/wiki/", 1)[1])
        out.setdefault(gvp, [])
        if title not in out[gvp]:
            out[gvp].append(title)
    if not out:
        raise ValueError("Wikidata: no articles")
    return out


def wiki_url(title: str | None) -> str | None:
    """Link to an English Wikipedia article, encoded exactly once."""
    if not title:
        return None
    return "https://en.wikipedia.org/wiki/" + quote(title.replace(" ", "_"), safe="_()'!,-.:")


def choose_wiki(titles: list[str] | None, *names: str | None) -> str | None:
    """Best English Wikipedia title for a volcano among the articles linked to its number."""
    if not titles:
        return None
    # titles cached by older versions are still percent-encoded
    titles = [unquote(t) if "%" in t else t for t in titles]
    if len(titles) == 1:
        return titles[0]
    keys = [normalize_name(n) for n in names if n]

    def score(title: str) -> tuple[int, int]:
        t = normalize_name(title.replace("_", " ").replace("Mount ", "").replace("Volcano", ""))
        s = 0
        for k in keys:
            if not k:
                continue
            if t == k:
                s = max(s, 4)
            elif k in t or t in k:
                s = max(s, 3 if "volcan" in title.lower() else 2)
        if "(" in title:
            s -= 1
        return (s, -len(title))

    return max(titles, key=score)
