"""Tests for the winds aloft helpers (run with: python3 -m pytest tests)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import types
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "magmarium"
pkg = types.ModuleType("magmarium_wind")
pkg.__path__ = [str(ROOT)]
sys.modules["magmarium_wind"] = pkg
import magmarium_wind.wind as wind  # noqa: E402

NOW = datetime(2026, 11, 17, 13, 10, tzinfo=timezone.utc)
T0 = int(datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc).timestamp())


def _vol(**kw):
    base = {"id": "gvp:263300", "lat": -8.108, "lon": 112.922, "elevation": 3657, "erupting": True, "ash": None}
    base.update(kw)
    return base


def _record(speed=36.0, from_deg=0.0, hours=13):
    times = [T0 + 3600 * i for i in range(hours)]
    levels = {str(h): [[speed, from_deg] for _ in times] for h, _ in wind.PRESSURE_LEVELS}
    return {"lat": -8.108, "lon": 112.922, "times": times, "levels": levels}


def test_level_for_height():
    assert wind.level_for_height(1.2)[0] == 850
    assert wind.level_for_height(4.5)[0] == 500
    assert wind.level_for_height(12)[0] == 250


def test_plume_height_uses_report():
    assert wind.plume_height_km(_vol(ash={"top_m": 4476})) == 4.476
    assert abs(wind.plume_height_km(_vol(ash={"above_summit_m": 800})) - 4.457) < 1e-9
    assert abs(wind.plume_height_km(_vol()) - 5.157) < 1e-9


def test_points_and_url():
    vols = [
        _vol(id="a", ash=None, erupting=True),
        _vol(id="b", ash={"source": "vona"}, erupting=True),
        _vol(id="c", ash=None, erupting=False),
    ]
    pts = wind.wind_points(vols)
    assert [p["id"] for p in pts] == ["b", "a"]
    q = parse_qs(urlparse(wind.build_url(pts)).query)
    assert q["latitude"] == ["-8.108,-8.108"]
    assert "wind_direction_500hPa" in q["hourly"][0]
    assert q["timeformat"] == ["unixtime"]


def test_parse_single_and_multi():
    pts = [{"id": "x", "lat": 1.0, "lon": 2.0}]
    item = {"hourly": {"time": [T0], "wind_speed_500hPa": [20.0], "wind_direction_500hPa": [90.0]}}
    out = wind.parse_response(item, pts)
    assert out["x"]["levels"]["500"] == [[20.0, 90.0]]
    assert out["x"]["levels"]["850"] == [[None, None]]
    two = wind.parse_response([item, item], pts + [{"id": "y", "lat": 0, "lon": 0}])
    assert set(two) == {"x", "y"}


def test_wind_from_north_drifts_south():
    w = wind.wind_for(_vol(ash={"top_m": 5600}), _record(speed=36.0, from_deg=0.0), NOW)
    assert w["level_hpa"] == 500
    assert w["toward_deg"] == 180.0
    assert len(w["track"]) == wind.TRACK_HOURS + 1
    end = w["track"][-1]
    # 6 h at 36 km/h = 216 km, about 1.94 degrees of latitude to the south
    assert abs((end[0] - -8.108) + 216 / 111.2) < 0.01
    assert abs(end[1] - 112.922) < 0.001


def test_stale_wind_is_dropped():
    late = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
    assert wind.wind_for(_vol(), _record(), late) is None
    assert wind.wind_for(_vol(), None, NOW) is None
