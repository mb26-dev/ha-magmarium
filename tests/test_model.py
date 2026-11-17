"""Tests for the merge model (run with: python3 tests/test_model.py)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "magmarium"
# load parsing.py and model.py without the Home Assistant parts of the package
pkg = types.ModuleType("magmarium_pure")
pkg.__path__ = [str(ROOT)]
sys.modules["magmarium_pure"] = pkg
import magmarium_pure.model as model  # noqa: E402

NOW = datetime(2026, 11, 17, 13, 0, tzinfo=timezone.utc)
CATALOG = [
    [264180, "Lewotobi", "Indonesia", -8.542, 122.775, 1703, 2026, "Stratovolcano"],
    [263300, "Semeru", "Indonesia", -8.108, 112.922, 3657, 2026, "Stratovolcano"],
    [263250, "Merapi", "Indonesia", -7.54, 110.446, 2910, 2026, "Stratovolcano"],
    [282080, "Sakurajima", "Japan", 31.593, 130.657, 1117, 2026, "Caldera"],
    [211060, "Etna", "Italy", 37.748, 14.999, 3357, 2026, "Stratovolcano"],
]
ASH = (
    "Eruption with volcanic ash cloud at 1200 UTC. Best estimate of ash-cloud top is around 14323 FT (4476 M) "
    "above sea level or 2560 FT (800 M) above summit. Ash cloud moving to north. Volcanic ash is observed to be "
    "gray. The intensity of volcanic ash is observed to be thick."
)
NO_ASH = "Eruption at 1230 UTC. Ash-cloud is not observed."


def vona(name: str, minutes: int, text: str, color: str = "ORANGE", exercise: bool = False) -> dict:
    return {
        "name": name,
        "issued": (NOW - timedelta(minutes=minutes)).isoformat(),
        "color": color,
        "text": text,
        "url": "u",
        "magma_id": minutes,
        "exercise": exercise,
    }


def by_name(result: dict) -> dict:
    return {v["name"]: v for v in result["volcanoes"]}


def test_levels_merge_and_ash() -> None:
    levels = [
        {"name": "Lewotobi Laki-laki", "province": "NTT", "level": 4, "url": "a"},
        {"name": "Lewotobi Perempuan", "province": "NTT", "level": 2, "url": "b"},
        {"name": "Semeru", "province": "Jawa Timur", "level": 3, "url": "c"},
        {"name": "Merapi", "province": "DIY", "level": 3, "url": "d"},
    ]
    vonas = [
        vona("Lewotobi Laki-laki", 30, ASH),
        vona("Semeru", 60, NO_ASH),
        vona("Semeru", 120, ASH),
        vona("Merapi", 20, ASH, color="RED", exercise=True),
    ]
    r = by_name(model.build_volcanoes(CATALOG, levels, vonas, [], NOW, 4, 24))
    lew = r["Lewotobi"]
    assert lew["level"] == 4 and lew["local_name"] == "Lewotobi Laki-laki"
    assert lew["erupting"] and lew["ash"]["source"] == "vona"
    assert lew["ash"]["above_summit_m"] == 800 and lew["ash"]["toward_deg"] == 0.0
    sem = r["Semeru"]
    assert sem["erupting"] and sem["ash"]["source"] == "vona"
    # a newer notice without ash halves the strength of the older cloud
    assert sem["ash"]["strength"] < lew["ash"]["strength"] / 2 + 0.01
    mer = r["Merapi"]
    assert not mer["erupting"] and mer["ash"] is None and mer["aviation_color"] is None


def test_old_ash_is_not_shown() -> None:
    r = by_name(model.build_volcanoes(CATALOG, [], [vona("Semeru", 6 * 60, ASH)], [], NOW, 4, 24))
    assert r["Semeru"]["ash"] is None
    assert r["Semeru"]["erupting"]
    r = by_name(model.build_volcanoes(CATALOG, [], [vona("Semeru", 30 * 60, ASH)], [], NOW, 4, 24))
    assert not r["Semeru"]["erupting"]
    assert r["Semeru"]["level"] == 3  # from the aviation colour


def test_weekly() -> None:
    weekly = [
        {"name": "Sakurajima", "country": "Japan", "period": "p", "status": "Ongoing Activity", "status_key": "ongoing",
         "lat": 31.593, "lon": 130.657, "text": "Ash plumes rose 2.4 km (7,900 ft) a.s.l.", "ash": True,
         "ash_top_m": 2400, "ash_above_summit_m": None},
        {"name": "Etna", "country": "Italy", "period": "p", "status": "New Eruptive Activity", "status_key": "new_eruptive",
         "lat": 37.75, "lon": 15.0, "text": "Lava fountains.", "ash": False, "ash_top_m": None, "ash_above_summit_m": None},
        {"name": "Nowhere Hill", "country": "Atlantis", "period": "p", "status": "New Activity/Unrest", "status_key": "new_unrest",
         "lat": 1.0, "lon": 2.0, "text": "", "ash": False, "ash_top_m": None, "ash_above_summit_m": None},
    ]
    result = model.build_volcanoes(CATALOG, [], [], weekly, NOW, 4, 24)
    r = by_name(result)
    assert r["Sakurajima"]["level"] == 2 and r["Sakurajima"]["ash"]["source"] == "weekly"
    assert r["Etna"]["level"] == 3 and r["Etna"]["erupting"]
    assert r["Nowhere Hill"]["lat"] == 1.0 and r["Nowhere Hill"]["level"] == 2
    # catalogue volcanoes with a report are not repeated in the background list
    assert all(row[0] not in ("Sakurajima", "Etna") for row in result["catalog"])
    near = model.nearest(result["volcanoes"], 35.0, 135.0)
    assert near and near[0]["name"] == "Sakurajima"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
