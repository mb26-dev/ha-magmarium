"""Official volcano cameras (pure, no Home Assistant imports).

Only cameras run by the volcano observatories themselves:

- USGS Volcano Hazards Program, AshCam API: all US volcano and FAA cameras with the
  volcano number, the newest image and its time
- GeoNet (GNS Science, New Zealand): latest image of each volcano camera
- Japan Meteorological Agency: volcano monitoring camera pages
- MAGMA Indonesia (PVMBG): CCTV pages per volcano
- INGV Osservatorio Etneo (Italy): surveillance cameras of Etna, Stromboli and Vulcano
"""

from __future__ import annotations

from datetime import datetime, timezone
import html as html_lib
import json
import re
from typing import Any

from .parsing import build_index, fallback_row, haversine_km, match_catalog, normalize_name, safe_url

USGS_CAMS_URL = "https://avo-volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams"
USGS_CAM_PAGE = "https://avo-volcview.wr.usgs.gov/ashcam-gui/webcam.html?webcam={code}"
JMA_CAMS_URL = "https://www.data.jma.go.jp/vois/data/obs/volcam/volcam.php"
JMA_CAM_PAGE = "https://www.data.jma.go.jp/vois/data/obs/volcam/volcam.php?VC={code}"
MAGMA_CCTV_URL = "https://magma.esdm.go.id/v1/gunung-api/cctv"
MAGMA_CCTV_PAGE = "https://magma.esdm.go.id/v1/gunung-api/cctv/{code}"
GEONET_IMAGE = "https://images.geonet.org.nz/volcano/cameras/latest/m-{code}.jpg"
GEONET_PAGE = "https://www.geonet.org.nz/volcano/cameras/{code}"
# INGV Osservatorio Etneo: one page per area with the newest image of every camera.
# The image path changes with every picture, so the pages are read every few minutes.
INGV_CAM_PAGES = [
    "https://www.ct.ingv.it/sezioniesterne/webcam/WebcamEtna.php",
    "https://www.ct.ingv.it/sezioniesterne/webcam/WebcamEolie.php",
]
# camera code: label (T = thermal, V = visible, H = high sensitivity), in the order shown
INGV_CAM_NAMES = {
    "Emov": "Etna, La Montagnola",
    "Emot": "Etna, La Montagnola (thermal)",
    "Epvh": "Etna from Piedimonte Etneo",
    "Emct": "Etna from Monte Cagliato (thermal)",
    "Ecv": "Etna from Catania",
    "Env": "Etna from Nicolosi",
    "Ent": "Etna from Nicolosi (thermal)",
    "Ebt": "Etna from Bronte (thermal)",
    "Emv": "Etna from Milo",
    "Scv": "Stromboli SCV",
    "Sct": "Stromboli SCT (thermal)",
    "Spct": "Stromboli, Punta dei Corvi (thermal)",
    "Spt": "Stromboli, Pizzo (thermal)",
    "Vlv": "Vulcano from Lipari",
    "Vlvh": "Vulcano from Lipari (high sensitivity)",
    "Vvt": "Vulcano VVT (thermal)",
}
# the first letter of the camera code names the volcano: summit positions for the match
INGV_CAM_VOLCANO = {"E": ("Etna", 37.748, 14.999), "S": ("Stromboli", 38.789, 15.213), "V": ("Vulcano", 38.404, 14.962)}
INGV_CAM_MAX_AGE_S = 24 * 3600

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
    "ingv": "INGV",
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


# the JMA page writes its links with single quotes, accept both
_JMA_LINK = re.compile(r"""href=["'][^"']*volcam\.php\?VC=(\d{5})["'][^>]*>(.*?)</a>""", re.IGNORECASE | re.DOTALL)


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


_MAGMA_LINK = re.compile(r"""href=["'][^"']*/cctv/([A-Z]{3})["'][^>]*>\s*([^<(]+?)\s*\((\d+)\)\s*</a>""", re.IGNORECASE)


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


_INGV_CAM = re.compile(
    r"""<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>\s*<img[^>]+src\s*=\s*["']([^"']+)["']""",
    re.IGNORECASE,
)
_INGV_PATH = re.compile(r"/webcams/([A-Za-z]+)/(\d{8})/(\d{2})\d{2}/[^/]+\.jpe?g$", re.IGNORECASE)


def parse_ingv_cams(pages: list[tuple[str, str]], now_ts: float) -> list[dict[str, Any]]:
    """Newest image of every INGV Osservatorio Etneo camera; pages are (url, html).

    Cameras without a current picture (the page then shows a placeholder) are left out.
    The time is the hour of the picture folder, which is enough to drop dead cameras.
    """
    found: dict[str, dict[str, Any]] = {}
    for base, page in pages:
        for href, src in _INGV_CAM.findall(page):
            img = safe_url(html_lib.unescape(src), base)
            m = _INGV_PATH.search(img or "")
            if not img or not m:
                continue  # "Nowork.jpg": camera out of order
            code = m.group(1)
            code = code[:1].upper() + code[1:].lower()
            volcano = INGV_CAM_VOLCANO.get(code[:1])
            if volcano is None or code in found:
                continue
            try:
                ts = datetime.strptime(m.group(2) + m.group(3), "%Y%m%d%H").replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                continue
            if now_ts - ts > INGV_CAM_MAX_AGE_S:
                continue
            found[code] = {
                "src": "ingv",
                "number": None,
                "lat": volcano[1],
                "lon": volcano[2],
                "name": INGV_CAM_NAMES.get(code, f"{volcano[0]} {code.upper()}"),
                "img": img,
                "page": safe_url(html_lib.unescape(href), base) or base,
                "time": ts,
            }
    # the best views first (the card shows the first camera live)
    return [found[k] for k in INGV_CAM_NAMES if k in found] + [c for k, c in found.items() if k not in INGV_CAM_NAMES]


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
        lst.sort(key=lambda c: (c["img"] is None, -(c["time"] or 0) if c["src"] != "ingv" else 0))
    return out
