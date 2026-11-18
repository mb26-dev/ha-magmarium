"""Real wildfires for the README screenshots.

Reads the public 24 hour VIIRS files of NASA FIRMS for South East Asia (no key needed,
downloaded by the screenshot workflow as docs/demo/fires_*.csv), groups the hotspots with
the code of the integration and writes docs/demo/fires.json for render.html and fire.html.

The times are moved to the moment of the data snapshot (payload.json), so the ages on the
cards are the real ages of the fires.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "docs" / "demo"
pkg = types.ModuleType("magmarium_demo")
pkg.__path__ = [str(ROOT / "custom_components" / "magmarium")]
sys.modules["magmarium_demo"] = pkg
import magmarium_demo.hazards as hz  # noqa: E402

FILES = {"fires_noaa20.csv": "VIIRS NOAA-20", "fires_noaa21.csv": "VIIRS NOAA-21", "fires_snpp.csv": "VIIRS S-NPP"}
# places that often burn in the dry seasons of South East Asia
PLACES = [
    ("Palembang", -2.99, 104.76), ("Jambi", -1.61, 103.61), ("Pekanbaru", 0.51, 101.45),
    ("Pontianak", -0.03, 109.34), ("Palangka Raya", -2.21, 113.92), ("Banjarmasin", -3.32, 114.59),
    ("Phnom Penh", 11.56, 104.92), ("Siem Reap", 13.36, 103.86), ("Battambang", 13.10, 103.20),
    ("Chiang Mai", 18.79, 98.99), ("Chiang Rai", 19.91, 99.84), ("Mae Hong Son", 19.30, 97.97),
    ("Yangon", 16.84, 96.17), ("Mandalay", 21.97, 96.08), ("Vientiane", 17.97, 102.63),
    ("Luang Prabang", 19.89, 102.13), ("Savannakhet", 16.57, 104.75), ("Ho Chi Minh City", 10.82, 106.63),
    ("Can Tho", 10.05, 105.75), ("Nakhon Ratchasima", 14.97, 102.10), ("Bangkok", 13.75, 100.50),
    ("Davao", 7.19, 125.46), ("Kupang", -10.18, 123.61), ("Makassar", -5.15, 119.43),
]
HOME = (-6.2, 106.8)


def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = math.pi / 180
    h = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 2 * 6371 * math.asin(min(1.0, math.sqrt(h)))


def main() -> None:
    payload = json.loads((DEMO / "payload.json").read_text())
    points = []
    for name, label in FILES.items():
        path = DEMO / name
        if not path.exists():
            continue
        try:
            rows = hz.parse_firms(path.read_text())
        except ValueError as err:
            print(f"{name}: {err}")
            continue
        for row in rows:
            row["src"] = label
        points += rows
        print(f"{name}: {len(rows)} hotspots")
    if not points:
        print("no wildfire data, the screenshots stay without fires")
        return

    now = datetime.now(timezone.utc)
    volcanoes = [(r[2], r[3]) for r in payload.get("catalog") or [] if isinstance(r[2], (int, float))]
    volcanoes += [(v["lat"], v["lon"]) for v in payload.get("volcanoes") or [] if v.get("lat") is not None]
    # fine 5 km fires everywhere for the demo
    hz.FIRE_FINE_KM = 10000.0
    clusters = hz.cluster_fires(points, HOME, 6000, volcanoes, now)

    # move the times to the snapshot
    shift = datetime.fromtimestamp(payload["updated"], timezone.utc) - now

    def moved(iso: str) -> str:
        return (datetime.fromisoformat(iso) + shift).isoformat()

    # the place with the most fire power around it becomes the home of the wildfire card
    def power(p: tuple[str, float, float], km: float) -> float:
        return sum(c["frp_mw"] for c in clusters if dist((p[1], p[2]), (c["lat"], c["lon"])) <= km)

    ranked = sorted(PLACES, key=lambda p: -power(p, 150))
    focus = ranked[0]
    near = sorted(PLACES, key=lambda p: dist((focus[1], focus[2]), (p[1], p[2])))
    places = [p for p in near[1:] if dist((focus[1], focus[2]), (p[1], p[2])) <= 450][:4]
    out = {
        "focus": {"name": focus[0], "lat": focus[1], "lon": focus[2]},
        "places": [{"name": p[0], "lat": p[1], "lon": p[2], "radius_km": 60} for p in places],
        "fires_meta": {
            "updated": moved((now - timedelta(minutes=20)).isoformat()),
            "hotspots": len(points),
            "radius_km": 1500,
            "satellites": sorted({p["src"] for p in points}),
        },
        "fires": [
            [c["lat"], c["lon"], c["count"], c["frp_mw"], c["max_mw"], moved(c["time"]), moved(c["first"]), c["km"], c["bearing"], c["cell_deg"]]
            for c in clusters
        ],
    }
    (DEMO / "fires.json").write_text(json.dumps(out))
    print(f"{len(clusters)} fires, focus {focus[0]} ({power(focus, 150):.0f} MW within 150 km), places {[p[0] for p in places]}")


if __name__ == "__main__":
    main()
