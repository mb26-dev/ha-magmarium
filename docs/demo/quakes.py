"""Real earthquakes for the README screenshot of the quake card.

Reads the public USGS feeds (M4.5+ of the week, M2.5+ of the day, downloaded by the
screenshot workflow as docs/demo/quakes_week.geojson and quakes_day.geojson), parses them
with the code of the integration and writes docs/demo/quakes.json for quake.html.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "docs" / "demo"
pkg = types.ModuleType("magmarium_demo")
pkg.__path__ = [str(ROOT / "custom_components" / "magmarium")]
sys.modules["magmarium_demo"] = pkg
import magmarium_demo.extra as ex  # noqa: E402

# places on the Ring of Fire; the one with the strongest quakes this week gets the screenshot
FOCUS = [
    ("Jakarta", -6.2, 106.8, [("Sumatra", -1.0, 100.5, 450), ("Java", -7.5, 110.0, 350), ("Bali & Lombok", -8.5, 116.0, 250), ("Banda Sea", -6.5, 128.0, 500)]),
    ("Tokyo", 35.68, 139.69, [("Kanto", 35.9, 140.0, 200), ("Tohoku", 38.5, 141.5, 300), ("Izu Islands", 32.5, 140.0, 300), ("Hokkaido", 43.0, 143.0, 350)]),
    ("Manila", 14.6, 121.0, [("Luzon", 16.5, 121.0, 300), ("Visayas", 11.0, 124.0, 300), ("Mindanao", 7.5, 126.0, 350), ("Taiwan", 23.7, 121.0, 250)]),
    ("Santiago", -33.45, -70.67, [("Central Chile", -33.5, -71.5, 300), ("Northern Chile", -22.0, -69.5, 450), ("Southern Chile", -39.0, -73.0, 400), ("Argentina", -31.0, -67.0, 400)]),
    ("Anchorage", 61.2, -149.9, [("Cook Inlet", 60.5, -152.0, 200), ("Kodiak", 57.5, -153.5, 250), ("Interior", 64.0, -148.0, 350), ("Aleutians", 53.0, -170.0, 600)]),
    ("Suva", -18.14, 178.44, [("Fiji", -17.5, 178.5, 300), ("Tonga", -20.0, -174.5, 450), ("Vanuatu", -16.5, 168.0, 450), ("Kermadec", -30.0, -178.0, 500)]),
]


def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math

    r = math.pi / 180
    h = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 2 * 6371 * math.asin(min(1.0, math.sqrt(h)))


def main() -> None:
    texts = [p.read_text() for p in (DEMO / "quakes_week.geojson", DEMO / "quakes_day.geojson") if p.exists()]
    if not texts:
        print("no USGS files, quake.html uses the snapshot in payload.json")
        return
    quakes = ex.parse_quakes(texts)
    rows = [[q["lat"], q["lon"], q["mag"], q["depth_km"], q["time"], q["place"], q["url"], None] for q in quakes]
    # weighted by strength (10 ** (M - 4)), so one M5.5 counts more than many small quakes
    best = max(FOCUS, key=lambda f: sum(10 ** (q["mag"] - 4) for q in quakes if dist((f[1], f[2]), (q["lat"], q["lon"])) <= 1200))
    focus = {
        "name": best[0], "lat": best[1], "lon": best[2],
        "places": [{"name": n, "lat": la, "lon": lo, "radius_km": r} for n, la, lo, r in best[3]],
    }
    out = {"updated": datetime.now(timezone.utc).timestamp(), "quakes": rows, "focus": focus}
    (DEMO / "quakes.json").write_text(json.dumps(out))
    print(f"wrote docs/demo/quakes.json with {len(rows)} quakes, focus {best[0]}")


if __name__ == "__main__":
    main()
