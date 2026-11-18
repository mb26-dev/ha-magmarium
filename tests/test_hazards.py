"""Tests for tsunami warnings and thermal anomalies (run with: python3 -m pytest tests)."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import types

import pytest

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "magmarium"
pkg = types.ModuleType("magmarium_hazards")
pkg.__path__ = [str(ROOT)]
sys.modules["magmarium_hazards"] = pkg
import magmarium_hazards.hazards as hz  # noqa: E402

ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#">
  <title>  TSUNAMI {kind} NUMBER   1 </title>
  <updated>2026-11-18T02:30:47Z</updated>
  <entry>
    <title>ABOUT 94 MILES SOUTHWEST OF GUAM</title>
    <updated>2026-11-18T02:30:47Z</updated>
    <geo:lat>12.073</geo:lat>
    <geo:long>143.992</geo:long>
    <summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">
      <strong>Category:</strong> {category}<br/>
      <strong>Bulletin Issue Time:</strong> 2026.11.18 02:30:47 UTC<br/>
      <strong>Preliminary Magnitude: </strong>5.9(Mwp)<br/>
    </div></summary>
    <link rel="alternate" title="Bulletin" href="https://www.tsunami.gov/events/PHEB/x/WEGM42.txt" type="application/xml"/>
  </entry>
</feed>"""


def test_noaa_information():
    ev = hz.parse_tsunami_atom(ATOM.format(kind="INFORMATION STATEMENT", category="Information"), "PTWC")
    assert len(ev) == 1
    e = ev[0]
    assert e["level"] == 1 and e["mag"] == 5.9 and e["lat"] == 12.073 and e["lon"] == 143.992
    assert e["region"] == "ABOUT 94 MILES SOUTHWEST OF GUAM"
    assert e["bulletin"] == "TSUNAMI INFORMATION STATEMENT NUMBER 1"
    assert e["url"].endswith("WEGM42.txt")
    assert e["time"].startswith("2026-11-18T02:30:47")


def test_noaa_levels():
    assert hz.parse_tsunami_atom(ATOM.format(kind="WARNING", category="Warning"), "PTWC")[0]["level"] == 4
    assert hz.parse_tsunami_atom(ATOM.format(kind="THREAT MESSAGE", category="Threat"), "PTWC")[0]["level"] == 4
    assert hz.parse_tsunami_atom(ATOM.format(kind="ADVISORY", category="Advisory"), "NTWC")[0]["level"] == 2
    assert hz.parse_tsunami_atom(ATOM.format(kind="CANCELLATION", category="Warning"), "NTWC")[0]["level"] == 0
    assert hz.parse_tsunami_atom("", "PTWC") == []


def test_bmkg():
    data = {"Infogempa": {"gempa": [
        {"DateTime": "2026-11-18T04:41:32+00:00", "Coordinates": "-8.17,120.54", "Magnitude": "5.8",
         "Wilayah": "49 km TimurLaut RUTENG", "Potensi": "Tidak berpotensi tsunami"},
        {"DateTime": "2026-11-18T05:00:00+00:00", "Coordinates": "-6.10,105.40", "Magnitude": "7.2",
         "Wilayah": "Selat Sunda", "Potensi": "Berpotensi TSUNAMI untuk diteruskan pada masyarakat"},
    ]}}
    latest = {"Infogempa": {"gempa": data["Infogempa"]["gempa"][1]}}
    ev = hz.parse_bmkg([json.dumps(data), json.dumps(latest)])
    assert len(ev) == 1
    assert ev[0]["level"] == 4 and ev[0]["lat"] == -6.1 and ev[0]["mag"] == 7.2 and ev[0]["source"] == "BMKG InaTEWS"


def test_active_merge_and_expiry():
    now = datetime(2026, 11, 18, 8, 0, tzinfo=timezone.utc)
    events = [
        {"source": "BMKG InaTEWS", "level": 4, "category": "Warning", "bulletin": "b", "region": "Selat Sunda",
         "lat": -6.1, "lon": 105.4, "mag": 7.2, "time": "2026-11-18T05:00:00+00:00", "url": "u1"},
        {"source": "NOAA PTWC", "level": 1, "category": "Information", "bulletin": "i", "region": "SUNDA STRAIT",
         "lat": -6.2, "lon": 105.5, "mag": 7.1, "time": "2026-11-18T05:10:00+00:00", "url": "u2"},
        {"source": "NOAA PTWC", "level": 1, "category": "Information", "bulletin": "old", "region": "GUAM",
         "lat": 12.0, "lon": 144.0, "mag": 5.9, "time": "2026-11-18T02:30:00+00:00", "url": "u3"},
        {"source": "NOAA NTWC", "level": 0, "category": "Cancellation", "bulletin": "c", "region": "ALASKA",
         "lat": 55.0, "lon": -160.0, "mag": 7.0, "time": "2026-11-18T07:00:00+00:00", "url": "u4"},
    ]
    act = hz.active_tsunami(events, now)
    assert len(act) == 1  # Guam information expired after 3 h, Alaska cancelled
    assert act[0]["level"] == 4 and sorted(act[0]["sources"]) == ["BMKG InaTEWS", "NOAA PTWC"]


CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-8.108,112.922,367.0,0.4,0.4,2026-11-17,1812,N20,VIIRS,h,2.0NRT,290.1,25.3,N
-8.109,112.925,340.0,0.4,0.4,2026-11-18,0548,N20,VIIRS,n,2.0NRT,295.0,10.7,D
-8.110,112.920,310.0,0.4,0.4,2026-11-18,0548,N20,VIIRS,l,2.0NRT,295.0,3.0,D
-8.300,113.200,330.0,0.4,0.4,2026-11-18,0548,N20,VIIRS,h,2.0NRT,295.0,8.0,D
"""


def test_firms():
    pts = hz.parse_firms(CSV)
    assert len(pts) == 3  # the low confidence detection is left out
    s = hz.thermal_summary(pts, -8.108, 112.922, "VIIRS NOAA-20")
    assert s["count"] == 2 and s["frp_mw"] == 36.0 and s["max_mw"] == 25.3
    assert s["time"].startswith("2026-11-18T05:48")
    assert hz.thermal_summary(pts, 10.0, 10.0, "x") is None
    merged = hz.merge_thermal(s, {**s, "count": 1, "time": "2026-11-18T06:00:00+00:00", "source": "VIIRS S-NPP"})
    assert merged["count"] == 2 and merged["time"].startswith("2026-11-18T06:00") and merged["source"] == "VIIRS"
    assert hz.parse_firms("latitude,longitude,acq_date,acq_time,confidence,frp\n") == []
    with pytest.raises(hz.FirmsKeyError):
        hz.parse_firms("Invalid MAP_KEY.")
    assert hz.firms_area(-8.108, 112.922) == "112.862,-8.168,112.982,-8.048"


# ------------------------------------------------------------------ wildfires

FIRE_NOW = datetime(2026, 11, 18, 10, 0, tzinfo=timezone.utc)
HOME = (8.08, 98.83)


def _pt(lat, lon, frp, hour=6, src="VIIRS NOAA-20", day=18):
    return {"lat": lat, "lon": lon, "frp": frp, "time": f"2026-11-{day:02d}T{hour:02d}:30:00+00:00", "src": src}


def test_fire_area_box_and_world():
    w, s, e, n = (float(v) for v in hz.fire_area(8.0, 99.0, 1500).split(","))
    assert s == pytest.approx(8.0 - 1500 / 111, abs=0.01)
    assert n == pytest.approx(8.0 + 1500 / 111, abs=0.01)
    assert w < 99.0 - 13 and e > 99.0 + 13
    assert hz.fire_area(8.0, 99.0, 20000) == "world"
    # a box across the date line falls back to the full longitude range
    w, _s, e, _n = hz.fire_area(0.0, 179.0, 500).split(",")
    assert (w, e) == ("-180.000", "180.000")


def test_cluster_fires_groups_near_home_and_uses_one_satellite():
    pts = [
        _pt(8.201, 98.901, 10.0),
        _pt(8.202, 98.902, 20.0),
        _pt(8.203, 98.903, 12.0, hour=7, src="VIIRS S-NPP"),
        _pt(8.70, 99.40, 5.0),
    ]
    out = hz.cluster_fires(pts, HOME, 1500, [], FIRE_NOW)
    assert len(out) == 2
    big = out[0]
    # NOAA-20 saw 30 MW in two pixels, S-NPP 12 MW in one: the larger is used, not the sum
    assert big["count"] == 2 and big["frp_mw"] == 30.0
    assert big["max_mw"] == 20.0
    assert big["time"].startswith("2026-11-18T07:30")
    assert big["cell_deg"] == hz.FIRE_FINE_DEG
    assert big["km"] == pytest.approx(15.6, abs=1.5)
    assert big["satellites"] == ["VIIRS NOAA-20", "VIIRS S-NPP"]
    assert 0 <= big["bearing"] <= 90


def test_cluster_fires_drops_volcanoes_old_and_far_points():
    pts = [
        _pt(-7.54, 110.446, 80.0),  # at Merapi
        _pt(8.30, 98.90, 4.0, day=15),  # three days old
        _pt(30.0, 120.0, 9.0),  # outside the radius
        _pt(8.30, 98.90, 4.0),
    ]
    out = hz.cluster_fires(pts, HOME, 1500, [(-7.542, 110.442)], FIRE_NOW)
    assert len(out) == 1 and out[0]["frp_mw"] == 4.0


def test_cluster_fires_coarse_cells_far_from_home():
    pts = [_pt(0.51, 101.41, 8.0), _pt(0.62, 101.33, 9.0), _pt(0.71, 101.12, 3.0)]
    out = hz.cluster_fires(pts, HOME, 1500, [], FIRE_NOW)
    assert len(out) == 1
    assert out[0]["cell_deg"] == hz.FIRE_COARSE_DEG and out[0]["count"] == 3


def test_fire_summary_counts_last_day():
    clusters = hz.cluster_fires(
        [_pt(8.10, 98.85, 3.0), _pt(8.9, 99.6, 50.0), _pt(9.5, 100.0, 7.0, day=17, hour=1)],
        HOME, 1500, [], FIRE_NOW,
    )
    summ = hz.fire_summary(clusters, FIRE_NOW)
    assert summ["count"] == 2
    assert summ["within_25_km"] == 1
    assert summ["nearest"]["km"] < 5
    assert summ["strongest"]["frp_mw"] == 50.0
    assert hz.compass(0) == "N" and hz.compass(100) == "E" and hz.compass(350) == "N"
