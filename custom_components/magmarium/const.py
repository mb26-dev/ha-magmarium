"""Constants for Magmarium."""

from __future__ import annotations

DOMAIN = "magmarium"
VERSION = "0.1.0b8"

CONF_SOURCES = "sources"
CONF_WATCHED = "watched_volcanoes"

CONF_PLACES = "places"
CONF_RADIUS = "ash_radius_km"

SOURCE_MAGMA = "magma"
SOURCE_GVP_WEEKLY = "gvp_weekly"
SOURCE_OFFICIAL = "official"
SOURCE_SIGMET = "sigmet"
SOURCE_QUAKES = "quakes"
SOURCES = [SOURCE_MAGMA, SOURCE_GVP_WEEKLY, SOURCE_OFFICIAL, SOURCE_SIGMET, SOURCE_QUAKES]
SOURCE_LABELS = {
    SOURCE_MAGMA: "MAGMA Indonesia (PVMBG)",
    SOURCE_GVP_WEEKLY: "Smithsonian / USGS Weekly Volcanic Activity Report",
    SOURCE_OFFICIAL: "Official alert levels: USGS (US), Icelandic Met Office, JMA (Japan)",
    SOURCE_SIGMET: "Volcanic ash SIGMETs (official ash areas for aviation)",
    SOURCE_QUAKES: "USGS earthquakes",
}
DEFAULT_SOURCES = list(SOURCES)
DEFAULT_WATCHED = ""
DEFAULT_PLACES = ["zone.home"]
DEFAULT_RADIUS = 150

# MAGMA Indonesia (Center for Volcanology and Geological Hazard Mitigation, PVMBG)
MAGMA_VONA_URL = "https://magma.esdm.go.id/v1/vona"
MAGMA_LEVEL_URL = "https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas"
MAGMA_HOME_URL = "https://magma.esdm.go.id"
# Smithsonian Global Volcanism Program
GVP_WEEKLY_URL = "https://volcano.si.edu/news/WeeklyVolcanoRSS.xml"
GVP_WEEKLY_PAGE = "https://volcano.si.edu/reports_weekly.cfm"
GVP_VOLCANO_URL = "https://volcano.si.edu/volcano.cfm?vn={number}"
GVP_CATALOG_URL = (
    "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0"
    "&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json"
    "&propertyName=Volcano_Number,Volcano_Name,Country,Latitude,Longitude,Elevation,"
    "Last_Eruption_Year,Primary_Volcano_Type"
)
GVP_CATALOG_URL_FULL = (
    "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0"
    "&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json"
)

# polling (minutes) - kept gentle, every source has its own backoff
UPDATE_INTERVAL_MINUTES = 5
MAGMA_VONA_MINUTES = 10
MAGMA_LEVEL_MINUTES = 60
GVP_WEEKLY_MINUTES = 6 * 60
CATALOG_DAYS = 30
BACKOFF_MINUTES = 60
SOURCE_DOWN_HOURS = 24
# winds aloft for the ash drift simulation (Open-Meteo)
WIND_MINUTES = 60
OFFICIAL_MINUTES = 60
SIGMET_MINUTES = 15
QUAKE_MINUTES = 15
WIKI_DAYS = 30
CAMS_MINUTES = 6 * 60
HISTORY_DAYS = 90

# a VONA ash cloud is shown as a live plume for this long, fading out
ASH_LIVE_HOURS = 4
# a reported eruption keeps the crater glowing for this long
ERUPTION_HOURS = 24
# VONAs older than this are ignored completely
VONA_MAX_AGE_DAYS = 120

LEVEL_KEYS = {0: "unknown", 1: "normal", 2: "advisory", 3: "watch", 4: "warning"}
LEVEL_LABELS = {0: "Unknown", 1: "Normal", 2: "Advisory", 3: "Watch", 4: "Warning"}
COLOR_LEVEL = {"GREEN": 1, "YELLOW": 2, "ORANGE": 3, "RED": 4}

# Earth imagery for the globe view, NASA Earth Observatory (credit "NASA Earth Observatory").
# Downloaded at runtime, not shipped. Re-used from Orbitarium when that is installed.
EARTH_DAY_URL = (
    "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/"
    "bmng-topography-bathymetry/{month_name}/world.topo.bathy.2004{month:02d}.3x5400x2700.jpg"
)
EARTH_DAY_FALLBACK_MONTH = 9
EARTH_NIGHT_URL = (
    "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/"
    "144000/144898/BlackMarble_2016_01deg.jpg"
)
EARTH_DIR = "magmarium"
ORBITARIUM_EARTH_DIR = "orbitarium"

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.cache"

URL_VOLCANOES = "/api/magmarium/volcanoes"
URL_HISTORY = "/api/magmarium/history"
URL_EARTH = "/api/magmarium/earth/{kind}"
URL_FRONTEND = "/magmarium/frontend"
CARD_FILE = "magmarium-card.js"

SIGNAL_UPDATED = f"{DOMAIN}_updated"
