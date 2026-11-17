"""Tests for the pure parsers (run with: python3 -m pytest tests or python3 tests/test_parsing.py)."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "magmarium_parsing", ROOT / "custom_components" / "magmarium" / "parsing.py"
)
parsing = importlib.util.module_from_spec(spec)
sys.modules["magmarium_parsing"] = parsing
spec.loader.exec_module(parsing)

# Markup as rendered by resources/views/v1/home/vona.blade.php of MAGMA Indonesia
VONA_PAGE = """
<div class="timeline-group">
<div class="timeline-item timeline-day">
    <div class="timeline-time">&nbsp;</div>
    <div class="timeline-body"><p class="timeline-date">Today</p></div>
</div>
<div class="timeline-item">
    <div class="timeline-time"><small>2026-11-17 12:18:00 UTC</small>
        <a href="#" class="btn btn-sm btn-warning">Orange</a>
    </div>
    <div class="timeline-body">
        <p class="timeline-title"><a href="#">Semeru - 20261117/1218Z</a></p>
        <p class="timeline-author"><a href="#">Someone</a>, Pos PGA - 2 hours ago </p>
        <p class="timeline-text">Eruption at 1218 UTC (1918 local). Ash-cloud is not observed. Ash-cloud is not observed..</p>
        <a class="card-link m-b-10" href="https://magma.esdm.go.id/v1/vona/23001?signature=abc&amp;x=1">View</a>
    </div>
</div>
<div class="timeline-item">
    <div class="timeline-time"><small>2026-08-30 05:57:00 UTC</small>
        <a href="#" class="btn btn-sm btn-warning">Orange</a>
    </div>
    <div class="timeline-body">
        <p class="timeline-title"><a href="#">Lewotobi Laki-laki - 20260830/0557Z</a></p>
        <p class="timeline-author"><a href="#">Someone</a>, Pos PGA - 3 months ago </p>
        <p class="timeline-text">Eruption with volcanic ash cloud at 0557 UTC (1357 local). Best estimate of ash-cloud top is around 6989 FT (2184 M) above sea level or 1920 FT (600 M) above summit. May be higher than what can be observed clearly. Source of height data: ground observer. Ash cloud moving from southwest to west. Volcanic ash is observed to be gray. The intensity of volcanic ash is observed to be thick..</p>
        <a class="card-link m-b-10" href="https://magma.esdm.go.id/v1/vona/22000?signature=def">View</a>
    </div>
</div>
<div class="timeline-item">
    <div class="timeline-time"><small>2026-08-01 01:00:00 UTC</small>
        <a href="#" class="btn btn-sm btn-danger">Red</a>
    </div>
    <div class="timeline-body">
        <div class="alert alert-outline alert-warning" role="alert">
            <strong>VA EXERCISE VA EXERCISE VA EXERCISE</strong>
        </div>
        <p class="timeline-title"><a href="#">Merapi - 20260801/0100Z</a></p>
        <p class="timeline-text">Eruption with volcanic ash cloud at 0100 UTC. Best estimate of ash-cloud top is around 32000 FT (10000 M) above sea level.</p>
        <a class="card-link m-b-10" href="https://magma.esdm.go.id/v1/vona/21000?signature=ghi">View</a>
    </div>
</div>
</div>
"""

LEVEL_PAGE = """
<div class="media-body"><h1>0</h1><p>Level IV (Awas)</p></div>
<table><tbody>
<tr><td rowspan="1"><a href="" class="tx-inverse tx-14 tx-medium d-block">Level IV (Awas)</a>
<span class="tx-11 d-block">x</span></td><td class="tx-12" rowspan="1">0</td>
<td>Tidak ada gunung api Level IV (Awas)</td></tr>
<tr><td rowspan="4"><a href="" class="tx-inverse tx-14 tx-medium d-block">Level III (Siaga)</a></td><td>3</td></tr>
<tr><td>
 Anak Krakatau - Lampung <a href="https://magma.esdm.go.id/v1/gunung-api/laporan/1?signature=a"><i class="fa fa-angle-right mg-r-5"
 target="_blank"></i>Lihat laporan</a><br>
</td></tr>
<tr><td>
 Merapi - Daerah Istimewa Yogyakarta dan Jawa Tengah <a href="https://magma.esdm.go.id/v1/gunung-api/laporan/2?signature=b"><i class="fa"></i>Lihat laporan</a><br>
</td></tr>
<tr><td>
 Semeru - Jawa Timur <a href="https://magma.esdm.go.id/v1/gunung-api/laporan/3?signature=c"><i class="fa"></i>Lihat laporan</a><br>
</td></tr>
<tr><td rowspan="2"><a href="" class="tx-inverse tx-14 tx-medium d-block">Level II (Waspada)</a></td><td>1</td></tr>
<tr><td>
 Sinabung - Sumatera Utara <a href="https://magma.esdm.go.id/v1/gunung-api/laporan/4?signature=d"><i class="fa"></i>Lihat laporan</a><br>
</td></tr>
<tr><td rowspan="2"><a href="" class="tx-inverse tx-14 tx-medium d-block">Level I (Normal)</a></td><td>1</td></tr>
<tr><td>
 Tangkuban Parahu - Jawa Barat <a href="https://magma.esdm.go.id/v1/gunung-api/laporan/5?signature=e"><i class="fa"></i>Lihat laporan</a><br>
</td></tr>
</tbody></table>
"""

GVP_RSS = b"""<?xml version="1.0" encoding="ISO-8859-1"?>
<rss version="2.0" xmlns:georss="http://www.georss.org/georss" xmlns:atom="https://www.w3.org/2005/Atom">
<channel>
<title>Smithsonian / USGS Weekly Volcanic Activity Report</title>
<link>https://volcano.si.edu/reports_weekly.cfm</link>
<pubDate>Thu, 15 Oct 2026 03:11:08 -0500</pubDate>
<item>
<title>Krakatau (Indonesia) - Report for 8 October-14 October 2026 - New Eruptive Activity</title>
<description>&lt;p&gt;PVMBG reported that eruptive events were recorded; dense gray ash plumes rose 1-1.5 km (3,300-4,900 ft) above the summit and drifted N.&lt;/p&gt;</description>
<link>https://volcano.si.edu/reports_weekly.cfm</link>
<guid isPermaLink="true">https://volcano.si.edu/reports_weekly.cfm#vn_262000</guid>
<pubDate>Thu, 15 Oct 2026 03:11:08 -0400</pubDate>
<georss:point>-6.1009 105.4233</georss:point>
</item>
<item>
<title>Kilauea (United States) - Report for 8 October-14 October 2026 - Ongoing Activity</title>
<description>&lt;p&gt;Lava fountaining continued; no ash was reported.&lt;/p&gt;</description>
<guid isPermaLink="true">https://volcano.si.edu/reports_weekly.cfm#vn_332010</guid>
<georss:point>19.421 -155.287</georss:point>
</item>
<item>
<title>Sakurajima (Japan) - Report for 8 October-14 October 2026 - Ongoing Activity</title>
<description>&lt;p&gt;Ash plumes rose as high as 2.4 km (7,900 ft) a.s.l.&lt;/p&gt;</description>
<guid isPermaLink="true">https://volcano.si.edu/reports_weekly.cfm#vn_282080</guid>
<georss:point>31.593 130.657</georss:point>
</item>
</channel>
</rss>
"""


def test_vona_list() -> None:
    items = parsing.parse_vona_list(VONA_PAGE)
    assert len(items) == 3, items
    semeru, lewotobi, exercise = items
    assert semeru["name"] == "Semeru"
    assert semeru["color"] == "ORANGE"
    assert semeru["issued"].isoformat() == "2026-11-17T12:18:00+00:00"
    assert semeru["magma_id"] == 23001
    assert semeru["url"].endswith("signature=abc&x=1")
    assert semeru["text"].endswith("not observed.")
    assert not semeru["exercise"]
    assert lewotobi["name"] == "Lewotobi Laki-laki"
    assert exercise["exercise"]

    a = parsing.analyse_vona_text(semeru["text"])
    assert a["eruption"] and not a["ash"]
    b = parsing.analyse_vona_text(lewotobi["text"])
    assert b["eruption"] and b["ash"]
    assert b["top_m"] == 2184 and b["above_summit_m"] == 600
    assert b["toward"] == "west" and b["toward_deg"] == 270.0
    assert b["ash_color"] == "gray" and b["intensity"] == "thick"
    c = parsing.analyse_vona_text("Increasing in volcanic activity. Ash-cloud is not observed. Ash-cloud is not observed.")
    assert not c["eruption"] and not c["ash"]
    d = parsing.analyse_vona_text(
        "Eruption with volcanic ash cloud at 1425 UTC (2125 local). Best estimate of ash-cloud top is around "
        "14323 FT (4476 M) above sea level or 2560 FT (800 M) above summit. Ash cloud moving to north. "
        "Volcanic ash is observed to be white to gray. The intensity of volcanic ash is observed to be medium."
    )
    assert d["toward_deg"] == 0.0 and d["ash_color"] == "white to gray" and d["intensity"] == "medium"
    e = parsing.analyse_vona_text("Eruption with volcanic ash cloud. Ash cloud moving from north to northeast.")
    assert e["ash"] and e["toward_deg"] == 45.0


def test_level_page() -> None:
    rows = parsing.parse_level_page(LEVEL_PAGE)
    by_name = {r["name"]: r for r in rows}
    assert set(by_name) == {"Anak Krakatau", "Merapi", "Semeru", "Sinabung", "Tangkuban Parahu"}, rows
    assert by_name["Merapi"]["level"] == 3
    assert by_name["Merapi"]["province"] == "Daerah Istimewa Yogyakarta dan Jawa Tengah"
    assert by_name["Sinabung"]["level"] == 2
    assert by_name["Tangkuban Parahu"]["level"] == 1


def test_gvp_weekly() -> None:
    data = parsing.parse_gvp_weekly(GVP_RSS)
    items = {i["name"]: i for i in data["items"]}
    assert set(items) == {"Krakatau", "Kilauea", "Sakurajima"}
    k = items["Krakatau"]
    assert k["country"] == "Indonesia" and k["status_key"] == "new_eruptive"
    assert abs(k["lat"] + 6.1009) < 1e-6 and k["ash"]
    assert k["ash_above_summit_m"] == 1500
    assert not items["Kilauea"]["ash"]
    assert items["Sakurajima"]["status_key"] == "ongoing"
    assert items["Sakurajima"]["ash_top_m"] == 2400


def test_matching() -> None:
    rows = [
        [262000, "Krakatau", "Indonesia", -6.102, 105.423, 155, 2026, "Caldera"],
        [264180, "Lewotobi", "Indonesia", -8.542, 122.775, 1703, 2026, "Stratovolcano"],
        [263250, "Merapi", "Indonesia", -7.54, 110.446, 2910, 2026, "Stratovolcano"],
        [261140, "Marapi", "Indonesia", -0.381, 100.473, 2885, 2026, "Stratovolcano"],
        [261171, "Sorikmarapi", "Indonesia", 0.686, 99.539, 2145, 1986, "Stratovolcano"],
        [263300, "Semeru", "Indonesia", -8.108, 112.922, 3657, 2026, "Stratovolcano"],
        [266100, "Lokon-Empung", "Indonesia", 1.358, 124.792, 1580, 2024, "Stratovolcano"],
        [264230, "Lewotolok", "Indonesia", -8.272, 123.505, 1431, 2026, "Stratovolcano"],
    ]
    index = parsing.build_index(rows)
    m = lambda n: (parsing.match_catalog(n, "Indonesia", index) or [None, None])[1]  # noqa: E731
    assert m("Anak Krakatau") == "Krakatau"
    assert m("Lewotobi Laki-laki") == "Lewotobi"
    assert m("Merapi") == "Merapi"
    assert m("Marapi") == "Marapi"
    assert m("Sorik Marapi") == "Sorikmarapi"
    assert m("Lokon") == "Lokon-Empung"
    assert m("Ili Lewotolok") == "Lewotolok"
    assert m("Unknown Hill") is None
    assert parsing.fallback_row("Anak Krakatau")[1] == "Krakatau"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
