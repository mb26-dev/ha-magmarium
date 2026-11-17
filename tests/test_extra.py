"""Tests for the extra sources and the ash-near check (run with: python3 -m pytest tests)."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "magmarium"
pkg = types.ModuleType("magmarium_extra")
pkg.__path__ = [str(ROOT)]
sys.modules["magmarium_extra"] = pkg
import magmarium_extra.ashnear as ashnear  # noqa: E402
import magmarium_extra.extra as extra  # noqa: E402
import magmarium_extra.model as model  # noqa: E402

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)
CATALOG = [
    [263300, "Semeru", "Indonesia", -8.108, 112.922, 3657, 2026, "Stratovolcano"],
    [268010, "Dukono", "Indonesia", 1.693, 127.894, 1229, 2026, "Complex"],
    [332010, "Kilauea", "United States", 19.421, -155.287, 1222, 2026, "Shield"],
    [371020, "Reykjanes", "Iceland", 63.88, -22.5, 140, 2025, "Crater rows"],
    [282080, "Sakurajima", "Japan", 31.593, 130.657, 1117, 2026, "Caldera"],
]


def test_usgs():
    text = json.dumps([
        {"volcano_name": "Kilauea", "vnum": "332010", "alert_level": "WATCH", "color_code": "ORANGE", "sent_unixtime": 1794900000, "notice_url": "https://x"},
        {"volcano_name": "Amukta", "vnum": "311190", "alert_level": "UNASSIGNED", "color_code": "UNASSIGNED"},
        {"volcano_name": "Akutan", "vnum": "311320", "alert_level": "NORMAL", "color_code": "GREEN"},
    ])
    rows = extra.parse_usgs(text)
    assert [r["name"] for r in rows] == ["Kilauea", "Akutan"]
    assert rows[0]["level"] == 3 and rows[0]["color"] == "ORANGE" and rows[0]["number"] == 332010


def test_imo_newest_wins():
    page = """<table><tr><th>Volcano name</th></tr>
    <tr><td>Reykjanes</td><td>371020</td><td>2026-11-10 11:51</td><td class="vol_hazard_yellow">Yellow</td><td>Yellow</td><td><a href="?nr=705">View</a></td></tr>
    <tr><td>B&aacute;r&eth;arbunga</td><td>373030</td><td>2026-06-15 12:42</td><td>green</td><td>Yellow</td><td><a href="?nr=700">View</a></td></tr>
    <tr><td>Reykjanes</td><td>371020</td><td>2025-07-16 04:05</td><td>Red</td><td>Yellow</td><td><a href="?nr=650">View</a></td></tr>
    </table>"""
    rows = {r["number"]: r for r in extra.parse_imo(page)}
    assert rows[371020]["color"] == "YELLOW" and rows[371020]["level"] == 2
    assert rows[373030]["name"] == "Bárðarbunga" and rows[373030]["level"] == 1
    assert rows[371020]["url"].endswith("?nr=705")


def test_jma_levels():
    warning = json.dumps([
        {"reportDatetime": "2026-11-04T10:00:00+09:00", "volcanoInfos": [
            {"type": "噴火警報・予報（対象火山）", "items": [
                {"name": "レベル３（入山規制）", "code": "13", "areas": [{"name": "桜島", "code": "506"}]}
            ]}
        ]},
        {"reportDatetime": "2026-10-01T10:00:00+09:00", "volcanoInfos": [
            {"type": "噴火警報・予報（対象火山）", "items": [
                {"name": "レベル２", "code": "12", "areas": [{"name": "桜島", "code": "506"}]}
            ]}
        ]},
    ])
    vlist = json.dumps([{"code": "506", "latlon": ["31.581", "130.659"], "name_jp": "桜島", "name_en": "Sakurajima"}])
    rows = extra.parse_jma(warning, vlist)
    assert len(rows) == 1 and rows[0]["level"] == 3 and rows[0]["name"] == "Sakurajima"


def test_sigmet():
    text = json.dumps([{
        "firName": "WAAF UJUNG PANDANG", "hazard": "VA", "qualifier": "ERUPTION MT SEMERU",
        "validTimeFrom": 1794911400, "validTimeTo": 1794933000, "base": 0, "top": 15000,
        "dir": "SW", "spd": "5",
        "coords": [{"lon": 113.017, "lat": -8.167}, {"lon": 112.27, "lat": -8.55}, {"lon": 112.08, "lat": -7.95},
                   {"lon": 112.98, "lat": -7.98}, {"lon": 113.017, "lat": -8.167}],
        "rawSigmet": "WAAF SIGMET 08 VALID 171030/171630 VA ERUPTION MT SEMERU PSN S0806 E11255",
    }])
    rows = extra.parse_sigmets(text, datetime(2026, 11, 17, 11, 0, tzinfo=timezone.utc))
    assert rows[0]["volcano"] == "Semeru" and rows[0]["top_m"] == 4572 and rows[0]["toward_deg"] == 225
    # the forecast position (series id ending in F) belongs to the same SIGMET
    fc = json.loads(text)[0] | {"seriesId": "8F", "coords": [{"lon": 112.0, "lat": -8.5}, {"lon": 111.5, "lat": -8.9}, {"lon": 111.2, "lat": -8.4}]}
    both = json.dumps([json.loads(text)[0] | {"seriesId": "8"}, fc])
    merged = extra.parse_sigmets(both, datetime(2026, 11, 17, 11, 0, tzinfo=timezone.utc))
    assert len(merged) == 1 and merged[0]["forecast_poly"][0] == [-8.5, 112.0]
    # expired ones are dropped
    assert extra.parse_sigmets(text, datetime(2026, 11, 18, 0, 0, tzinfo=timezone.utc)) == []


def test_model_official_and_sigmet():
    official = [
        {"source": "usgs", "number": 332010, "name": "Kilauea", "country": "United States", "level": 3, "color": "ORANGE", "alert": "WATCH", "time": None, "url": "u"},
        {"source": "jma", "number": None, "name": "Sakurajima", "country": "Japan", "lat": 31.581, "lon": 130.659, "level": 3, "color": None, "alert": "JMA Level 3", "time": None, "url": "u"},
        {"source": "imo", "number": 371020, "name": "Reykjanes", "country": "Iceland", "level": 1, "color": "GREEN", "alert": "green", "time": None, "url": "u"},
    ]
    sigmets = [{"volcano": "Semeru", "fir": "WAAF", "from": None, "to": "2026-11-17T16:30:00+00:00", "top_m": 4572, "toward_deg": 225, "poly": [[0, 0], [1, 0], [0, 1]]}]
    res = model.build_volcanoes(CATALOG, [], [], [], NOW, 4, 24, official, sigmets)
    vols = {v["name"]: v for v in res["volcanoes"]}
    assert vols["Kilauea"]["level"] == 3 and vols["Kilauea"]["aviation_color"] == "ORANGE"
    assert vols["Sakurajima"]["level"] == 3
    assert "Reykjanes" not in vols  # normal and nowhere else reported: stays in the background
    assert vols["Semeru"]["ash"]["source"] == "sigmet" and vols["Semeru"]["ash"]["toward_deg"] == 225
    assert res["sigmets"][0]["volcano_id"] == "gvp:263300"


def test_quakes_marked():
    q = [{"id": "a", "lat": 19.40, "lon": -155.28, "mag": 3.1, "depth_km": 2.0, "time": "t", "place": "p", "url": "u"},
         {"id": "b", "lat": 0.0, "lon": 0.0, "mag": 5.0, "depth_km": 10.0, "time": "t", "place": "p", "url": "u"}]
    out = extra.mark_volcanic(q, [(19.421, -155.287, "Kilauea", "gvp:332010")])
    assert out[0]["volcano"] == "Kilauea" and out[1]["volcano"] is None


def test_wiki_choice():
    assert extra.choose_wiki(["Mount_Merapi"], "Merapi") == "Mount_Merapi"
    assert extra.choose_wiki(["Þorbjörn_(mountain)", "Eldvörp–Svartsengi", "Reykjanes_volcanic_system"], "Reykjanes") == "Reykjanes_volcanic_system"
    assert extra.choose_wiki(["Krakatoa", "Anak_Krakatoa"], "Krakatau", "Anak Krakatau") in ("Krakatoa", "Anak_Krakatoa")
    assert extra.choose_wiki(None, "x") is None


def test_ash_near():
    sig = [{"volcano": "Semeru", "poly": [[-8.0, 112.0], [-8.0, 113.0], [-9.0, 113.0], [-9.0, 112.0]], "to": "x", "top_m": 4572}]
    inside = ashnear.ash_threats(-8.5, 112.5, 50, [], sig)
    assert inside[0]["kind"] == "sigmet" and inside[0]["inside"]
    far = ashnear.ash_threats(8.03, 98.82, 150, [], sig)
    assert far == []
    vol = {"id": "x", "name": "Semeru", "lat": -8.108, "lon": 112.922, "ash": {"source": "vona"},
           "wind": {"track": [[-8.108, 112.922], [-8.5, 112.922], [-9.0, 112.922]]}}
    drift = ashnear.ash_threats(-9.0, 113.2, 50, [vol], [])
    assert drift[0]["kind"] == "drift" and drift[0]["eta_hours"] == 2.0
