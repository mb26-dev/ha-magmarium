"""Pure parsers for the Magmarium data sources.

Nothing in here touches Home Assistant, so the parsers can be tested on
their own. All functions are synchronous and run in the executor.
"""

from __future__ import annotations

from datetime import datetime, timezone
import html
import json
import math
import re
from typing import Any
import xml.etree.ElementTree as ET

# --------------------------------------------------------------------------- helpers

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def clean_text(value: str | None) -> str:
    """Strip tags, decode entities and collapse whitespace."""
    if not value:
        return ""
    text = _TAG.sub(" ", value)
    text = html.unescape(text)
    return _SPACE.sub(" ", text).strip()


def normalize_name(name: str) -> str:
    """Lower case letters and digits only ("Lewotobi Laki-laki" -> "lewotobilakilaki")."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


# --------------------------------------------------------------------------- VONA text

_NOT_OBSERVED = re.compile(r"\bnot\s+(?:be\s+)?observed\b", re.IGNORECASE)
_TOP_ASL_M = re.compile(r"(\d[\d,.]*)\s*M\s*\)?\s*above\s+sea\s+level", re.IGNORECASE)
_ABOVE_SUMMIT_M = re.compile(r"(\d[\d,.]*)\s*M\s*\)?\s*above\s+(?:the\s+)?summit", re.IGNORECASE)
_MOVING = re.compile(
    r"\bmoving\s+(?:from\s+(?P<src>[a-z\- ]+?)\s+)?to(?:wards?)?\s+(?:the\s+)?(?P<dst>[a-z\-]+(?:\s*-\s*[a-z]+)?)",
    re.IGNORECASE,
)
_ERUPTION = re.compile(r"\beruption\b", re.IGNORECASE)
_INTENSITY = re.compile(r"intensity of volcanic ash is observed to be\s+([a-z ]+?)\s*\.", re.IGNORECASE)
_ASH_COLOR = re.compile(r"volcanic ash is observed to be\s+([a-z ]+?)\s*\.", re.IGNORECASE)

COMPASS = {
    "north": 0.0, "northnortheast": 22.5, "northeast": 45.0, "eastnortheast": 67.5,
    "east": 90.0, "eastsoutheast": 112.5, "southeast": 135.0, "southsoutheast": 157.5,
    "south": 180.0, "southsouthwest": 202.5, "southwest": 225.0, "westsouthwest": 247.5,
    "west": 270.0, "westnorthwest": 292.5, "northwest": 315.0, "northnorthwest": 337.5,
    "n": 0.0, "nne": 22.5, "ne": 45.0, "ene": 67.5, "e": 90.0, "ese": 112.5, "se": 135.0,
    "sse": 157.5, "s": 180.0, "ssw": 202.5, "sw": 225.0, "wsw": 247.5, "w": 270.0,
    "wnw": 292.5, "nw": 315.0, "nnw": 337.5,
}


def compass_to_deg(text: str | None) -> float | None:
    if not text:
        return None
    key = re.sub(r"[^a-z]", "", text.lower())
    return COMPASS.get(key)


def _to_int(text: str) -> int | None:
    digits = text.replace(",", "")
    try:
        return round(float(digits))
    except ValueError:
        return None


def analyse_vona_text(text: str) -> dict[str, Any]:
    """Read eruption and ash information from a VONA summary paragraph.

    MAGMA writes the summary as
    "Eruption with volcanic ash cloud at 0557 UTC (1357 local). Best estimate of
    ash-cloud top is around 6989 FT (2184 M) above sea level or 1920 FT (600 M)
    above summit. ... Ash cloud moving from southwest to west. Volcanic ash is
    observed to be gray. The intensity of volcanic ash is observed to be thick."
    """
    out: dict[str, Any] = {
        "eruption": False,
        "ash": False,
        "top_m": None,
        "above_summit_m": None,
        "toward_deg": None,
        "toward": None,
        "ash_color": None,
        "intensity": None,
    }
    if not text:
        return out
    out["eruption"] = bool(_ERUPTION.search(text))
    top = _TOP_ASL_M.search(text)
    above = _ABOVE_SUMMIT_M.search(text)
    if top:
        out["top_m"] = _to_int(top.group(1))
    if above:
        out["above_summit_m"] = _to_int(above.group(1))
    not_observed = bool(_NOT_OBSERVED.search(text))
    has_height = out["top_m"] is not None or out["above_summit_m"] is not None
    out["ash"] = has_height or (
        not not_observed and re.search(r"\bvolcanic ash cloud\b|\bash[- ]cloud\b", text, re.IGNORECASE) is not None
    )
    if not out["ash"]:
        out["top_m"] = None
        out["above_summit_m"] = None
        return out
    move = _MOVING.search(text)
    if move:
        dst = move.group("dst")
        deg = compass_to_deg(dst)
        if deg is not None:
            out["toward_deg"] = deg
            out["toward"] = re.sub(r"\s+", "", dst.lower())
    color = _ASH_COLOR.search(text)
    if color:
        out["ash_color"] = color.group(1).strip().lower()
    intensity = _INTENSITY.search(text)
    if intensity:
        out["intensity"] = intensity.group(1).strip().lower()
    return out


# --------------------------------------------------------------------------- MAGMA VONA list

_ITEM_SPLIT = re.compile(r'<div class="timeline-item(?P<extra>[^"]*)">', re.IGNORECASE)
_LIST_TIME = re.compile(r"<small>\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*UTC\s*</small>", re.IGNORECASE)
_COLOR_BTN = re.compile(r'<a[^>]*class="btn[^"]*"[^>]*>\s*(Green|Yellow|Orange|Red)\s*</a>', re.IGNORECASE)
_TITLE = re.compile(r'<p class="timeline-title">\s*<a[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
_TEXT = re.compile(r'<p class="timeline-text">(.*?)</p>', re.IGNORECASE | re.DOTALL)
_LINK = re.compile(r'<a class="card-link[^"]*"\s+href="([^"]+)"', re.IGNORECASE)
_VONA_ID = re.compile(r"/vona/(\d+)")


_HHMM = re.compile(r"\b([01]\d|2[0-3])([0-5]\d)(\s*(?:UTC|UT|local|LT|WIB|WITA|WIT)\b)")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def tidy_notice(text: str) -> str:
    """Readable notice text: "1218 UTC" becomes "12:18 UTC", repeated sentences are dropped."""
    if not text:
        return text
    text = _HHMM.sub(lambda m: f"{m.group(1)}:{m.group(2)}{m.group(3)}", text)
    seen: set[str] = set()
    out: list[str] = []
    for sentence in _SENTENCE.split(text.strip()):
        key = re.sub(r"[^a-z0-9]+", " ", sentence.lower()).strip()
        if key and key in seen:
            continue
        seen.add(key)
        out.append(sentence)
    return " ".join(out)


def parse_vona_list(page: str) -> list[dict[str, Any]]:
    """Parse the public MAGMA VONA list (https://magma.esdm.go.id/v1/vona).

    Returns one dict per notice, newest first. Exercise notices are flagged.
    """
    items: list[dict[str, Any]] = []
    parts = _ITEM_SPLIT.split(page)
    # split() yields: [before, extra1, block1, extra2, block2, ...]
    for i in range(1, len(parts) - 1, 2):
        extra = parts[i] or ""
        block = parts[i + 1]
        if "timeline-day" in extra:
            continue
        tm = _LIST_TIME.search(block)
        title_m = _TITLE.search(block)
        if not tm or not title_m:
            continue
        year, month, day, hour, minute = (int(x) for x in tm.groups()[:5])
        issued = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        title = clean_text(title_m.group(1))
        name, sep, _dtg = title.rpartition(" - ")
        if not sep:
            name = title
        color_m = _COLOR_BTN.search(block)
        text_m = _TEXT.search(block)
        link_m = _LINK.search(block)
        url = html.unescape(link_m.group(1)) if link_m else None
        id_m = _VONA_ID.search(url or "")
        text = clean_text(text_m.group(1)) if text_m else ""
        text = tidy_notice(re.sub(r"\.{2,}$", ".", text))
        items.append({
            "name": name.strip(),
            "issued": issued,
            "color": color_m.group(1).upper() if color_m else None,
            "text": text,
            "url": url,
            "magma_id": int(id_m.group(1)) if id_m else None,
            "exercise": "VA EXERCISE" in block.upper(),
        })
    return items


# --------------------------------------------------------------------------- MAGMA alert levels

_LEVEL_HEADER = re.compile(r"Level\s+(IV|III|II|I)\s*\((Awas|Siaga|Waspada|Normal)\)\s*</a>", re.IGNORECASE)
_LEVEL_ROW = re.compile(r"<td>\s*([^<]+?)\s*<a\s+href=\"([^\"]+)\"[^>]*>(?:(?!</a>).)*Lihat laporan", re.IGNORECASE | re.DOTALL)
LEVEL_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4}
LEVEL_NAMES_ID = {1: "Normal", 2: "Waspada", 3: "Siaga", 4: "Awas"}


def parse_level_page(page: str) -> list[dict[str, Any]]:
    """Parse the MAGMA activity level page (/v1/gunung-api/tingkat-aktivitas).

    Rows look like "Merapi - Daerah Istimewa Yogyakarta dan Jawa Tengah <a>Lihat laporan</a>"
    and belong to the last "Level X (...)" section header seen before them.
    """
    events: list[tuple[int, str, Any]] = []
    for m in _LEVEL_HEADER.finditer(page):
        events.append((m.start(), "level", LEVEL_ROMAN[m.group(1).upper()]))
    for m in _LEVEL_ROW.finditer(page):
        events.append((m.start(), "row", (clean_text(m.group(1)), html.unescape(m.group(2)))))
    events.sort(key=lambda e: e[0])
    level: int | None = None
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _pos, kind, value in events:
        if kind == "level":
            level = value
            continue
        if level is None:
            continue
        label, url = value
        name, sep, province = label.partition(" - ")
        name = name.strip()
        if not name or normalize_name(name) in seen:
            continue
        seen.add(normalize_name(name))
        out.append({
            "name": name,
            "province": province.strip() if sep else "",
            "level": level,
            "url": url,
        })
    return out


# --------------------------------------------------------------------------- GVP weekly report

_GVP_TITLE = re.compile(r"^(?P<name>.+?)\s+\((?P<country>[^()]+)\)\s+-\s+Report for\s+(?P<period>.+?)\s+-\s+(?P<status>.+)$")
_ASH_WORDS = re.compile(r"\bash(?:\s|-)?(?:plumes?|emissions?|columns?|clouds?|explosions?)\b|\bash\b.{0,40}\brose\b", re.IGNORECASE)
_PLUME_HEIGHT = re.compile(
    r"(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(km|m)\s*\([\d,.\s\-]+ft\)\s*a\.s\.l\.",
    re.IGNORECASE,
)
_ABOVE_SUMMIT = re.compile(
    r"(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(km|m)\s*\([\d,.\s\-]+ft\)\s*above\s+the\s+(?:summit|crater|vent)",
    re.IGNORECASE,
)


def _max_height_m(regex: re.Pattern[str], text: str) -> int | None:
    best: float | None = None
    for m in regex.finditer(text):
        values = [float(m.group(1))]
        if m.group(2):
            values.append(float(m.group(2)))
        factor = 1000.0 if m.group(3).lower() == "km" else 1.0
        value = max(values) * factor
        if best is None or value > best:
            best = value
    return round(best) if best is not None else None


def gvp_status_key(status: str) -> str:
    s = status.lower()
    if "eruptive" in s:
        return "new_eruptive" if "new" in s else "eruptive"
    if "unrest" in s:
        return "new_unrest"
    return "ongoing"


def parse_gvp_weekly(data: bytes) -> dict[str, Any]:
    """Parse the Smithsonian / USGS Weekly Volcanic Activity Report RSS."""
    root = ET.fromstring(data)
    channel = root.find("channel")
    if channel is None:
        raise ValueError("no RSS channel")
    pub = clean_text(channel.findtext("pubDate"))
    items: list[dict[str, Any]] = []
    for item in channel.findall("item"):
        title = clean_text(item.findtext("title"))
        m = _GVP_TITLE.match(title)
        if not m:
            continue
        point = None
        for child in item:
            if child.tag.endswith("point"):
                point = (child.text or "").split()
        if not point or len(point) != 2:
            continue
        try:
            lat, lon = float(point[0]), float(point[1])
        except ValueError:
            continue
        description = clean_text(item.findtext("description"))
        ash = bool(_ASH_WORDS.search(description))
        items.append({
            "name": m.group("name").strip(),
            "country": m.group("country").strip(),
            "period": m.group("period").strip(),
            "status": m.group("status").strip(),
            "status_key": gvp_status_key(m.group("status")),
            "lat": lat,
            "lon": lon,
            "text": description,
            "guid": clean_text(item.findtext("guid")),
            "ash": ash,
            "ash_top_m": _max_height_m(_PLUME_HEIGHT, description) if ash else None,
            "ash_above_summit_m": _max_height_m(_ABOVE_SUMMIT, description) if ash else None,
        })
    return {"published": pub, "items": items}


# --------------------------------------------------------------------------- GVP catalogue

def parse_gvp_catalog(text: str) -> list[list[Any]]:
    """GVP Holocene volcano list (WFS GeoJSON) to compact rows.

    Row: [volcano_number, name, country, lat, lon, elevation_m, last_eruption_year, type]
    """
    data = json.loads(text)
    rows: list[list[Any]] = []
    for feat in data.get("features", []):
        p = feat.get("properties") or {}
        try:
            lat = float(p.get("Latitude"))
            lon = float(p.get("Longitude"))
        except (TypeError, ValueError):
            coords = (feat.get("geometry") or {}).get("coordinates") or []
            if len(coords) < 2:
                continue
            lon, lat = float(coords[0]), float(coords[1])
        try:
            elev = int(float(p.get("Elevation")))
        except (TypeError, ValueError):
            elev = None
        try:
            last = int(p.get("Last_Eruption_Year"))
        except (TypeError, ValueError):
            last = None
        rows.append([
            int(p.get("Volcano_Number") or 0),
            str(p.get("Volcano_Name") or "").strip(),
            str(p.get("Country") or "").strip(),
            round(lat, 4),
            round(lon, 4),
            elev,
            last,
            str(p.get("Primary_Volcano_Type") or "").strip(),
        ])
    if not rows:
        raise ValueError("empty volcano catalogue")
    return rows


# --------------------------------------------------------------------------- name matching

# MAGMA names that differ from the GVP catalogue names
MAGMA_ALIASES = {
    "anakkrakatau": "krakatau",
    "lewotobilakilaki": "lewotobi",
    "lewotobiperempuan": "lewotobi",
    "ililewotolok": "lewotolok",
    "iliwerung": "iliwerung",
    "bromo": "tenggercaldera",
    "ciremai": "cereme",
    "dieng": "diengvolcaniccomplex",
    "anakranakah": "ranakah",
    "inerie": "inierie",
    "rokatenda": "paluweh",
    "lokon": "lokonempung",
    "tangkoko": "tangkokoduasudara",
    "peutsague": "peuetsague",
    "tandikat": "tandikatsinggalang",
    "gede": "gedepangrango",
    "kiebesi": "kiebesi",
    "bururnitelong": "burnitelong",
}

# Used when the GVP catalogue is not available yet: the most active Indonesian volcanoes
FALLBACK_COORDS: dict[str, tuple[str, float, float, int]] = {
    "krakatau": ("Krakatau", -6.102, 105.423, 155),
    "lewotobi": ("Lewotobi", -8.542, 122.775, 1703),
    "semeru": ("Semeru", -8.108, 112.922, 3657),
    "merapi": ("Merapi", -7.540, 110.446, 2910),
    "sinabung": ("Sinabung", 3.170, 98.392, 2460),
    "ibu": ("Ibu", 1.488, 127.630, 1325),
    "dukono": ("Dukono", 1.693, 127.894, 1229),
    "marapi": ("Marapi", -0.381, 100.473, 2885),
    "ruang": ("Ruang", 2.300, 125.370, 725),
    "lewotolok": ("Lewotolok", -8.272, 123.505, 1431),
    "karangetang": ("Karangetang", 2.781, 125.407, 1797),
    "raung": ("Raung", -8.119, 114.056, 3332),
    "ijen": ("Ijen", -8.058, 114.242, 2769),
    "agung": ("Agung", -8.343, 115.508, 2997),
    "kelud": ("Kelud", -7.930, 112.308, 1731),
    "lokonempung": ("Lokon-Empung", 1.358, 124.792, 1580),
    "soputan": ("Soputan", 1.112, 124.737, 1785),
    "gamalama": ("Gamalama", 0.810, 127.332, 1715),
}


def match_catalog(name: str, country: str, index: dict[str, list[list[Any]]]) -> list[Any] | None:
    """Find the catalogue row for a volcano name reported by a source.

    index: normalized catalogue name -> rows. Matching prefers the given country.
    """
    key = normalize_name(name)
    if not key:
        return None
    key = MAGMA_ALIASES.get(key, key)

    def pick(rows: list[list[Any]]) -> list[Any] | None:
        if not rows:
            return None
        same = [r for r in rows if country and r[2].lower() == country.lower()]
        return (same or rows)[0]

    if key in index:
        return pick(index[key])
    # containment: "lewotobilakilaki" contains "lewotobi", "lokon" is in "lokonempung"
    best: tuple[int, list[Any]] | None = None
    for cname, rows in index.items():
        if len(cname) < 4:
            continue
        if cname in key or key in cname:
            cand = pick(rows)
            if cand is None:
                continue
            if country and cand[2].lower() != country.lower():
                continue
            score = len(cname)
            if best is None or score > best[0]:
                best = (score, cand)
    return best[1] if best else None


def build_index(rows: list[list[Any]]) -> dict[str, list[list[Any]]]:
    index: dict[str, list[list[Any]]] = {}
    for row in rows:
        index.setdefault(normalize_name(row[1]), []).append(row)
    return index


def fallback_row(name: str) -> list[Any] | None:
    key = MAGMA_ALIASES.get(normalize_name(name), normalize_name(name))
    hit = FALLBACK_COORDS.get(key)
    if hit is None:
        for k, v in FALLBACK_COORDS.items():
            if k in key or key in k:
                hit = v
                break
    if hit is None:
        return None
    return [0, hit[0], "Indonesia", hit[1], hit[2], hit[3], None, ""]
