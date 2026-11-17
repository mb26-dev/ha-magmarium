"""Tests for the official volcano cameras (run with: python3 -m pytest tests)."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "magmarium"
pkg = types.ModuleType("magmarium_cams")
pkg.__path__ = [str(ROOT)]
sys.modules["magmarium_cams"] = pkg
import magmarium_cams.cams as cams  # noqa: E402

NOW = 1795000000.0
CATALOG = [
    [332010, "Kilauea", "United States", 19.421, -155.287, 1222, 2026, "Shield"],
    [282080, "Kirishimayama", "Japan", 31.934, 130.862, 1700, 2026, "Shield"],
    [263300, "Semeru", "Indonesia", -8.108, 112.922, 3657, 2026, "Stratovolcano"],
    [241100, "Ruapehu", "New Zealand", -39.28, 175.57, 2797, 2007, "Stratovolcano"],
]


def test_usgs_cams():
    text = json.dumps({"webcams": [
        {"webcamCode": "kilauea-f1-cam", "webcamName": "Kilauea F1", "vnum": "332010", "hasImages": "Y",
         "lastImageTimestamp": NOW - 600, "currentMediumImageUrl": "https://x/f1/current-medium.jpg"},
        {"webcamCode": "old", "webcamName": "Old", "vnum": "332010", "hasImages": "Y",
         "lastImageTimestamp": NOW - 10 * 86400, "currentMediumImageUrl": "https://x/old.jpg"},
        {"webcamCode": "novnum", "webcamName": "Airport", "vnum": None, "hasImages": "Y",
         "lastImageTimestamp": NOW, "currentMediumImageUrl": "https://x/a.jpg"},
    ]})
    rows = cams.parse_usgs_cams(text, NOW)
    assert [r["name"] for r in rows] == ["Kilauea F1"]
    assert rows[0]["number"] == 332010 and rows[0]["page"].endswith("webcam=kilauea-f1-cam")


def test_jma_cams():
    page = '<a href="./volcam.php?VC=50501">霧島山 猪子石(新燃岳)</a><a href="./volcam.php?VC=99901">x</a>'
    vlist = json.dumps([{"code": "505", "latlon": ["31.931", "130.870"], "name_en": "Kirishimayama"}])
    rows = cams.parse_jma_cams(page, vlist)
    assert len(rows) == 1 and rows[0]["page"].endswith("VC=50501") and rows[0]["lat"] == 31.931


def test_jma_cams_single_quotes():
    # the real JMA page writes href='...'
    page = "<li><a href='./volcam.php?VC=50601'>桜島 牛根</a></li>"
    vlist = json.dumps([{"code": "506", "latlon": ["31.593", "130.657"]}])
    rows = cams.parse_jma_cams(page, vlist)
    assert len(rows) == 1 and rows[0]["page"].endswith("VC=50601") and rows[0]["name"] == "桜島 牛根"


def test_magma_cctv():
    page = ('<a href="https://magma.esdm.go.id/v1/gunung-api/cctv/SMR" type="button" class="btn">Semeru (5)</a>'
            '<a href="https://magma.esdm.go.id/v1/gunung-api/cctv/AWU" class="btn">Awu (1)</a>')
    rows = cams.parse_magma_cctv(page)
    assert rows[0]["volcano"] == "Semeru" and rows[0]["name"] == "5 CCTV cameras"
    assert rows[1]["name"] == "1 CCTV camera"


def test_link():
    usgs = cams.parse_usgs_cams(json.dumps({"webcams": [
        {"webcamCode": "k", "webcamName": "K", "vnum": "332010", "hasImages": "Y",
         "lastImageTimestamp": NOW, "currentMediumImageUrl": "https://x/k.jpg"}]}), NOW)
    jma = cams.parse_jma_cams('<a href="volcam.php?VC=50501">A B</a>',
                              json.dumps([{"code": "505", "latlon": ["31.931", "130.870"]}]))
    magma = cams.parse_magma_cctv('<a href="/v1/gunung-api/cctv/SMR">Semeru (5)</a>')
    linked = cams.link_cams(CATALOG, usgs + jma + magma + cams.geonet_cams())
    assert linked["gvp:332010"][0]["img"] == "https://x/k.jpg"
    assert linked["gvp:282080"][0]["src"] == "jma"
    assert linked["gvp:263300"][0]["src"] == "magma"
    ruapehu = linked["gvp:241100"]
    assert len(ruapehu) == 3 and all(c["img"] for c in ruapehu)
