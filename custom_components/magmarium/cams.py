"""Official volcano cameras (pure, no Home Assistant imports).

Only cameras run by the volcano observatories themselves:

- USGS Volcano Hazards Program, AshCam API: all US volcano and FAA cameras with the
  volcano number, the newest image and its time
- GeoNet (GNS Science, New Zealand): latest image of each volcano camera
- Japan Meteorological Agency: volcano monitoring camera pages
- MAGMA Indonesia (PVMBG): CCTV pages per volcano
"""

from __future__ import annotations

import html as html_lib
import json
import re
from typing import Any

from .parsing import build_index, fallback_row, haversine_km, match_catalog, normalize_name

USGS_CAMS_URL = "https://avo-volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams"
USGS_CAM_PAGE = "https://avo-volcview.wr.usgs.gov/ashcam-gui/webcam.html?webcam={code}"
JMA_CAMS_URL = "https://www.data.jma.go.jp/vois/data/obs/volcam/volcam.php"
JMA_CAM_PAGE = "https://www.data.jma.go.jp/vois/data/obs/volcam/volcam.php?VC={code}"
MAGMA_CCTV_URL = "https://magma.esdm.go.id/v1/gunung-api/cctv"
MAGMA_CCTV_PAGE = "https://magma.esdm.go.id/v1/gunung-api/cctv/{code}"
GEONET_IMAGE = "https://images.geonet.org.nz/volcano/cameras/latest/m-{code}.jpg"
GEONET_PAGE = "https://www.geonet.org.nz/volcano/cameras/{code}"

# GeoNet camera id, label, Smithsonian volcano number, position of the volcano (fallback match)
GEONET_CAMS = [
    ("ruapehunorth", "Ruapehu from North", 241100, -39.28, 175.57),
    ("ruapehusouth", "Ruapehu from South", 241100, -39.28, 175.57),
    ("ruapehueast", "Ruapehu from East", 241100, -39.28, 175.57),
    ("ngauruhoe", "Ngauruhoe", 241080, -39.157, 175.632),
    ("ngauruhoetongariro", "Ngauruhoe and Tongariro", 241080, -39.157, 175.632),
    ("tongariro", "Tongariro", 241080, -39.157, 175.632),
    ("tongarirotemaaricrater", "Tongariro Te Maari crater", 241080, -39.157, 175.632),
    ("taranaki", "Taranaki Maunga", 241030, -39.30, 174.07),
    ("whakatane", "Whakaari from Whakatane", 241040, -37.52, 177.18),
    ("tekaha", "Whakaari from Te Kaha", 241040, -37.52, 177.18),
    ("raoulisland", "Raoul Island", 242030, -29.27, -177.92),
]

USGS_MAX_AGE_S = 3 * 24 * 3600
MAX_PER_VOLCANO = 6
SOURCE_NAMES = {
    "usgs": "USGS",
    "geonet": "GeoNet",
    "jma": "Japan Meteorological Agency",
    "magma": "MAGMA Indonesia",
}


def parse_usgs_cams(text: str, now_ts: float) -> list[dict[str, Any]]:
    """USGS AshCam cameras that have a volcano number and a recent image."""
    data = json.loads(text)
    cams = data.get("webcams") if isinstance(data, dict) else data
    if not isinstance(cams, list):
        raise ValueError("USGS cameras: unexpected structure")
    out: list[dict[str, Any]] = []
    for c in cams:
        if not isinstance(c, dict) or not c.get("vnum") or c.get("hasImages") != "Y":
            continue
        try:
            number = int(str(c["vnum"]).strip())
            last = float(c.get("lastImageTimestamp") or 0)
        except (TypeError, ValueError):
            continue
        if now_ts - last > USGS_MAX_AGE_S:
            continue  # camera out of order or seasonal
        image = c.get("currentMediumImageUrl") or c.get("currentImageUrl")
        code = str(c.get("webcamCode") or "")
        if not image or not code:
            continue
        out.append({
            "src": "usgs",
            "number": number,
            "name": str(c.get("webcamName") or code).strip(),
            "img": image,
            "page": USGS_CAM_PAGE.format(code=code),
            "time": int(last),
        })
    out.sort(key=lambda c: -c["time"])
    return out


def geonet_cams() -> list[dict[str, Any]]:
    return [
        {
            "src": "geonet",
            "number": number,
            "lat": lat,
            "lon": lon,
            "name": label,
            "img": GEONET_IMAGE.format(code=code),
            "page": GEONET_PAGE.format(code=code),
            "time": None,
        }
        for code, label, number, lat, lon in GEONET_CAMS
    ]


_JMA_LINK = re.compile(r'href="[^"]*volcam\.php\?VC=(\d{5})"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)


def parse_jma_cams(page: str, list_text: str) -> list[dict[str, Any]]:
    """JMA camera pages; the first three digits of a camera code are the JMA volcano code."""
    vlist = json.loads(list_text)
    places: dict[str, tuple[float, float]] = {}
    for item in vlist if isinstance(vlist, list) else []:
        try:
            places[str(item["code"])] = (float(item["latlon"][0]), float(item["latlon"][1]))
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for code, label in _JMA_LINK.findall(page):
        if code in seen:
            continue
        seen.add(code)
        place = places.get(code[:3])
        if place is None:
            continue
        text = re.sub(r"\s+", " ", html_lib.unescape(re.sub(r"<[^>]+>", "", label))).strip()
        out.append({
            "src": "jma",
            "number": None,
            "lat": place[0],
            "lon": place[1],
            "name": text or f"Camera {code}",
            "img": None,
            "page": JMA_CAM_PAGE.format(code=code),
            "time": None,
        })
    if not out:
        raise ValueError("JMA cameras: no camera links found")
    return out


_MAGMA_LINK = re.compile(r'href="[^"]*/cctv/([A-Z]{3})"[^>]*>\s*([^<(]+?)\s*\((\d+)\)\s*</a>', re.IGNORECASE)


def parse_magma_cctv(page: str) -> list[dict[str, Any]]:
    """MAGMA Indonesia CCTV pages, one per volcano."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for code, name, count in _MAGMA_LINK.findall(page):
        code = code.upper()
        if code in seen:
            continue
        seen.add(code)
        n = int(count)
        out.append({
            "src": "magma",
            "number": None,
            "volcano": html_lib.unescape(name).strip(),
            "name": f"{n} CCTV camera{'s' if n != 1 else ''}",
            "img": None,
            "page": MAGMA_CCTV_PAGE.format(code=code),
            "time": None,
        })
    if not out:
        raise ValueError("MAGMA CCTV: no cameras found")
    return out


def link_cams(catalog: list[list[Any]], cams: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Cameras per volcano id (the ids of the volcano model: gvp:<number> or name:<name>)."""
    by_number = {row[0]: row for row in catalog if row and row[0]}
    index = build_index(catalog)
    out: dict[str, list[dict[str, Any]]] = {}
    for cam in cams:
        row = None
        if cam.get("number"):
            # a known volcano number is enough, even when the catalogue is not loaded yet
            row = by_number.get(cam["number"]) or [cam["number"], "", "", 0.0, 0.0]
        elif cam.get("lat") is not None:
            best = 25.0
            for r in catalog:
                if abs(r[3] - cam["lat"]) > 0.4:
                    continue
                d = haversine_km(cam["lat"], cam["lon"], r[3], r[4])
                if d < best:
                    row, best = r, d
        elif cam.get("volcano"):
            row = match_catalog(cam["volcano"], "Indonesia", index) if index else None
            if row is None:
                row = fallback_row(cam["volcano"])
        if row is not None and row[0]:
            key = f"gvp:{row[0]}"
        elif row is not None:
            key = f"name:{normalize_name(row[1])}"
        elif cam.get("volcano"):
            key = f"name:{normalize_name(cam['volcano'])}"
        else:
            continue
        lst = out.setdefault(key, [])
        if len(lst) < MAX_PER_VOLCANO and not any(c["page"] == cam["page"] for c in lst):
            lst.append({k: cam[k] for k in ("src", "name", "img", "page", "time")})
    for lst in out.values():
        # cameras with a live image first, the freshest of those first
        lst.sort(key=lambda c: (c["img"] is None, -(c["time"] or 0)))
    return out
