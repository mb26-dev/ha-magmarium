"""Tests for the Italian sources (run with: python3 -m pytest tests or python3 tests/test_italy.py)."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "magmarium"
pkg = types.ModuleType("magmarium_italy")
pkg.__path__ = [str(ROOT)]
sys.modules["magmarium_italy"] = pkg
import magmarium_italy.extra as extra  # noqa: E402
import magmarium_italy.italy as italy  # noqa: E402
import magmarium_italy.model as model  # noqa: E402

NOW = datetime(2026, 11, 21, 4, 0, tzinfo=timezone.utc)


def _feature(name, slug, level, link, lon, lat):
    return {
        "type": "Feature",
        "properties": {
            "Vulcano": f'<a href="https://rischi.protezionecivile.gov.it/it/vulcanico/vulcani-italia/{slug}/" target="_blank" >{name}</a>',
            "Caratteristiche": "...",
            "livello_allerta": level,
            "livello_allerta_link": link,
            "Comportamenti corretti": "",
            "Pianificazione nazionale": "",
        },
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


# structure of vulcani_liv_allerta_maplite.geojson (pcm-dpc/DPC-Mappe), state of 9 November 2026
DPC = json.dumps({
    "type": "FeatureCollection",
    "name": "vulcani_liv_allerta_maplite",
    "features": [
        _feature("Campi Flegrei", "campi-flegrei", "giallo",
                 '<a href="https://www.protezionecivile.gov.it/it/approfondimento/tabella-dei-livelli-di-allerta-lo-stato-di-attivita-del-vulcano-campi-flegrei-2025/" target="_blank" >Giallo</a>',
                 14.166656341189041, 40.83330471628396),
        _feature("Etna", "etna", "verde",
                 '<a href="https://rischi.protezionecivile.gov.it/static/6d78c59c10fa6c7d4896d75ee9bf98f1/2021-vals-etna-ita.pdf" target="_blank" >Verde</a>',
                 14.99736516849712, 37.756316817370696),
        _feature("Stromboli", "stromboli", "giallo",
                 '<a href="javascript:alert(1)" target="_blank" >Giallo</a>',
                 15.211630212763412, 38.79279498410714),
        _feature("Ischia", "ischia", "non definito", "In via di definizione.", 13.919213311651152, 40.72973729296251),
    ],
})

# structure of https://www.ct.ingv.it/sezioniesterne/Comunicati/ComunicatiVonaN.php (newest first, UTC)
VONA_ROW = (
    '<tr><td width="20%" bgcolor="#FFFFFF" align="center">{name}</td>'
    '<td width="20%" bgcolor="#FFFFFF" align="center">{when}</td>'
    '<td width="40%" bgcolor="#FFFFFF" align="center">Aviation Color Code: {color}</td>'
    '<td width="20%" bgcolor="#FFFFFF" align="center"><a target="_blank" href="{href}">DOWNLOAD PDF</a></td></tr>'
)
VONA_PAGE = (
    '<table><tbody><tr><td>VOLCANO</td><td>DATE</td><td>DESCRIPTION</td><td>FILE TYPE</td></tr>'
    + VONA_ROW.format(name="ETNA", when="2026-11-11 09:36:19", color="GREEN",
                      href="../../Dati/informative/vona/VONA_Etna_202611110936Z_2026014008T00.pdf")
    + VONA_ROW.format(name="ETNA", when="2026-11-08 11:44:19", color="YELLOW",
                      href="../../Dati/informative/vona/VONA_Etna_202611081144Z_2026013908G00.pdf")
    + VONA_ROW.format(name="STROMBOLI", when="2026-11-03 08:02:09", color="ORANGE",
                      href="../../Dati/informative/vona/VONA_Stromboli_202611030802Z_2026013701N48.pdf")
    + VONA_ROW.format(name="STROMBOLI", when="2026-11-02 12:19:01", color="ORANGE",
                      href="javascript:alert(1)")
    + VONA_ROW.format(name="ETNA", when="2026-05-01 06:44:05", color="RED",
                      href="../../Dati/informative/vona/VONA_Etna_old.pdf")
    + "</tbody></table>"
)

# INGV FDSN event service, format=text
QUAKES = """#EventID|Time|Latitude|Longitude|Depth/Km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType
48011762|2026-11-19T12:14:33.370000|38.4293|14.4425|203.8|SURVEY-INGV||||ML|3.5|--|Isole Eolie (Messina)|earthquake
48004632|2026-11-18T23:37:23.670000|38.7125|14.0917|8.4|SURVEY-INGV||||ML|2.6|--|Tirreno Meridionale [Mare]|earthquake
48000001|2026-11-18T10:00:00.000000|40.828|14.140|2.1|SURVEY-INGV||||Md|2.1|--|Campi Flegrei|earthquake
48000002|2026-11-18T09:00:00.000000|44.0|11.0|0.0|SURVEY-INGV||||ML|2.4|--|Cava|quarry blast
broken|line
"""


def test_dpc_levels():
    rows = italy.parse_dpc_levels(DPC)
    by = {r["name"]: r for r in rows}
    assert set(by) == {"Campi Flegrei", "Etna", "Stromboli"}  # Ischia has no levels yet
    cf = by["Campi Flegrei"]
    assert cf["level"] == 2 and cf["source"] == "dpc" and cf["country"] == "Italy"
    assert cf["alert"] == "Civil Protection alert level Yellow (Giallo)"
    assert cf["url"].startswith("https://www.protezionecivile.gov.it/")
    assert abs(cf["lat"] - 40.8333) < 1e-3 and abs(cf["lon"] - 14.1667) < 1e-3
    assert by["Etna"]["level"] == 1
    # a link that is not http(s) falls back to the volcano page
    assert by["Stromboli"]["url"] == "https://rischi.protezionecivile.gov.it/it/vulcanico/vulcani-italia/stromboli/"


def test_ingv_vona():
    rows = italy.parse_ingv_vona(VONA_PAGE, NOW)
    by = {r["name"]: r for r in rows}
    assert set(by) == {"Etna", "Stromboli"}
    etna = by["Etna"]
    assert etna["color"] == "GREEN" and etna["level"] == 1
    assert etna["time"] == "2026-11-11T09:36:19+00:00"
    assert etna["url"] == "https://www.ct.ingv.it/Dati/informative/vona/VONA_Etna_202611110936Z_2026014008T00.pdf"
    strom = by["Stromboli"]
    assert strom["level"] == 3 and strom["alert"] == "Aviation colour code Orange (VONA)"
    assert strom["url"].endswith("VONA_Stromboli_202611030802Z_2026013701N48.pdf")
    assert strom["lat"] is not None


def test_ingv_vona_too_old():
    later = datetime(2027, 6, 1, tzinfo=timezone.utc)
    assert italy.parse_ingv_vona(VONA_PAGE, later) == []


def test_ingv_quakes():
    qs = italy.parse_ingv_quakes(QUAKES)
    assert [q["id"] for q in qs] == ["ingv:48011762", "ingv:48004632", "ingv:48000001"]
    q = qs[0]
    assert q["time"] == "2026-11-19T12:14:33+00:00" and q["mag"] == 3.5 and q["depth_km"] == 203.8
    assert q["url"] == "https://terremoti.ingv.it/event/48011762"
    assert q["place"] == "Isole Eolie (Messina)"


def test_ingv_quake_url():
    url = italy.ingv_quake_url(NOW)
    assert url.startswith("https://webservices.ingv.it/fdsnws/event/1/query?")
    assert "starttime=2026-11-14T04%3A00%3A00" in url and "format=text" in url and "minlat=35" in url


def test_merge_and_keep():
    ingv = italy.parse_ingv_quakes(QUAKES)
    usgs = [
        # the same Eolie quake as seen by USGS: dropped
        {"id": "us1", "lat": 38.45, "lon": 14.40, "mag": 3.6, "time": "2026-11-19T12:14:40+00:00", "place": "", "url": ""},
        {"id": "us2", "lat": -10.6, "lon": -75.9, "mag": 6.5, "time": "2026-11-21T00:09:18+00:00", "place": "Peru", "url": ""},
    ]
    merged = italy.merge_quakes(usgs, ingv)
    ids = [q["id"] for q in merged]
    assert "us1" not in ids and "us2" in ids and ids[0] == "us2"
    points = [(40.827, 14.139, "Campi Flegrei", "gvp:211010")]
    marked = extra.mark_volcanic(merged, points)
    kept = [q["id"] for q in marked if italy.keep_ingv_quake(q)]
    # M3.5 kept for its size, M2.1 Campi Flegrei kept near the volcano, M2.6 at sea dropped
    assert "ingv:48011762" in kept and "ingv:48000001" in kept and "ingv:48004632" not in kept and "us2" in kept


def test_model_both_italian_sources():
    catalog = [
        [211040, "Stromboli", "Italy", 38.789, 15.213, 924, 2026, "Stratovolcano"],
        [211060, "Etna", "Italy", 37.748, 14.999, 3357, 2026, "Stratovolcano"],
        [211010, "Campi Flegrei", "Italy", 40.827, 14.139, 458, 1538, "Caldera"],
    ]
    official = italy.parse_dpc_levels(DPC) + italy.parse_ingv_vona(VONA_PAGE, NOW)
    result = model.build_volcanoes(catalog, [], [], [], NOW, 4, 24, official, [])
    by = {v["name"]: v for v in result["volcanoes"]}
    strom = by["Stromboli"]
    # Civil Protection yellow, VONA orange: the higher level wins, both are kept for the info box
    assert strom["level"] == 3 and strom["official"]["source"] == "ingv"
    assert strom["aviation_color"] == "ORANGE"
    assert {o["source"] for o in strom["officials"]} == {"dpc", "ingv"}
    assert by["Campi Flegrei"]["level"] == 2
    assert "Etna" not in by or by["Etna"]["level"] <= 1


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
