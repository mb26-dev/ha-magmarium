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
