"""Sensors for Magmarium."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import slugify

from .const import CONF_FIRMS_KEY, CONF_WATCHED, DEFAULT_WATCHED, DOMAIN, LEVEL_KEYS
from .coordinator import MagmariumCoordinator
from .entity import MagmariumEntity
from .extra import wiki_url
from .model import nearest
from .parsing import haversine_km

MAX_LIST = 40


def parse_watched(value: str | list | None) -> list[str]:
    if not value:
        return []
    items = value if isinstance(value, list) else str(value).replace(";", ",").split(",")
    out: list[str] = []
    for item in items:
        name = str(item).strip()
        if name and name.lower() not in [o.lower() for o in out]:
            out.append(name)
    return out


def _short(vol: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": vol["name"],
        "country": vol["country"],
        "level": vol["level"],
        "level_key": vol["level_key"],
        "alert": vol.get("alert"),
        "aviation_color": vol.get("aviation_color"),
        "erupting": vol["erupting"],
        "ash_cloud": bool(vol.get("ash") and vol["ash"].get("source") in ("vona", "sigmet")),
    }


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: MagmariumCoordinator = hass.data[DOMAIN][entry.entry_id]
    options = {**entry.data, **entry.options}
    entities: list[SensorEntity] = [
        ElevatedSensor(coordinator, entry),
        EruptingSensor(coordinator, entry),
        AshCloudSensor(coordinator, entry),
        NearestSensor(coordinator, entry),
        LatestVonaSensor(coordinator, entry),
        StatusSensor(coordinator, entry),
        SigmetSensor(coordinator, entry),
        QuakeSensor(coordinator, entry),
        TsunamiSensor(coordinator, entry),
    ]
    if (options.get(CONF_FIRMS_KEY) or "").strip():
        entities.append(ThermalSensor(coordinator, entry))
    for name in parse_watched(options.get(CONF_WATCHED, DEFAULT_WATCHED)):
        entities.append(VolcanoSensor(coordinator, entry, name))
    async_add_entities(entities)


class ElevatedSensor(MagmariumEntity, SensorEntity):
    """Number of volcanoes above normal level."""

    _attr_translation_key = "elevated"
    _attr_icon = "mdi:volcano"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "volcanoes"

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "elevated")

    def _list(self) -> list[dict[str, Any]]:
        return [v for v in (self.coordinator.data or {}).get("volcanoes", []) if v["level"] >= 2]

    @property
    def native_value(self) -> int:
        return len(self._list())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        vols = self._list()
        return {
            "warning": len([v for v in vols if v["level"] == 4]),
            "watch": len([v for v in vols if v["level"] == 3]),
            "advisory": len([v for v in vols if v["level"] == 2]),
            "volcanoes": [_short(v) for v in vols[:MAX_LIST]],
        }


class EruptingSensor(MagmariumEntity, SensorEntity):
    """Volcanoes with a reported eruption (last 24 h from VONA, or the current weekly report)."""

    _attr_translation_key = "erupting"
    _attr_icon = "mdi:fire"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "volcanoes"

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "erupting")

    def _list(self) -> list[dict[str, Any]]:
        return [v for v in (self.coordinator.data or {}).get("volcanoes", []) if v["erupting"]]

    @property
    def native_value(self) -> int:
        return len(self._list())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        vols = self._list()
        return {
            "live": [v["name"] for v in vols if (v.get("eruption") or {}).get("source") == "vona"],
            "volcanoes": [
                {
                    **_short(v),
                    "eruption_time": (v.get("eruption") or {}).get("time"),
                    "source": (v.get("eruption") or {}).get("source"),
                    "distance_km": _home_km(self.hass, v),
                }
                for v in vols[:MAX_LIST]
            ],
        }


class AshCloudSensor(MagmariumEntity, SensorEntity):
    """Ash clouds observed in the last hours (VONA)."""

    _attr_translation_key = "ash_clouds"
    _attr_icon = "mdi:weather-fog"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "clouds"

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "ash_clouds")

    def _list(self) -> list[dict[str, Any]]:
        return [
            v for v in (self.coordinator.data or {}).get("volcanoes", [])
            if v.get("ash") and v["ash"].get("source") == "vona"
        ]

    @property
    def native_value(self) -> int:
        return len(self._list())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "clouds": [
                {
                    "volcano": v["name"],
                    "time": v["ash"].get("time"),
                    "top_m": v["ash"].get("top_m"),
                    "above_summit_m": v["ash"].get("above_summit_m"),
                    "moving_to": v["ash"].get("toward"),
                    "intensity": v["ash"].get("intensity"),
                }
                for v in self._list()
            ],
            "weekly_report": [
                v["name"] for v in (self.coordinator.data or {}).get("volcanoes", [])
                if v.get("ash") and v["ash"].get("source") == "weekly"
            ],
        }


class SigmetSensor(MagmariumEntity, SensorEntity):
    """Valid volcanic ash SIGMETs: official ash areas for aviation."""

    _attr_translation_key = "sigmets"
    _attr_icon = "mdi:airplane-alert"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "areas"

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "sigmets")

    @property
    def native_value(self) -> int:
        return len((self.coordinator.data or {}).get("sigmets") or [])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "areas": [
                {
                    "volcano": s.get("volcano"),
                    "fir": s.get("fir"),
                    "valid_until": s.get("to"),
                    "top_m": s.get("top_m"),
                    "moving_deg": s.get("toward_deg"),
                    "speed_kmh": s.get("speed_kmh"),
                }
                for s in ((self.coordinator.data or {}).get("sigmets") or [])[:MAX_LIST]
            ]
        }


def _home_km(hass: HomeAssistant, vol: dict[str, Any]) -> int | None:
    lat, lon = hass.config.latitude, hass.config.longitude
    if lat is None or lon is None or vol.get("lat") is None:
        return None
    return round(haversine_km(lat, lon, vol["lat"], vol["lon"]))


TSUNAMI_KEYS = {4: "warning", 3: "watch", 2: "advisory", 1: "information"}


class TsunamiSensor(MagmariumEntity, SensorEntity):
    """Tsunami bulletins in force (NOAA PTWC / NTWC, BMKG InaTEWS); the state counts warnings, watches and advisories."""

    _attr_translation_key = "tsunami"
    _attr_icon = "mdi:waves-arrow-up"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "alerts"

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "tsunami")

    def _events(self) -> list[dict[str, Any]]:
        return (self.coordinator.data or {}).get("tsunami") or []

    @property
    def native_value(self) -> int:
        return len([e for e in self._events() if e["level"] >= 2])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        events = self._events()
        top = max((e["level"] for e in events), default=0)
        near = [e["home_km"] for e in events if e["level"] >= 2 and e.get("home_km") is not None]
        return {
            "highest": TSUNAMI_KEYS.get(top, "none"),
            "nearest_km": min(near) if near else None,
            "events": [
                {
                    "level": TSUNAMI_KEYS.get(e["level"]),
                    "category": e.get("category"),
                    "region": e.get("region"),
                    "magnitude": e.get("mag"),
                    "time": e.get("time"),
                    "distance_km": e.get("home_km"),
                    "latitude": e.get("lat"),
                    "longitude": e.get("lon"),
                    "sources": e.get("sources"),
                    "bulletin": e.get("bulletin"),
                    "url": e.get("url"),
                }
                for e in events[:MAX_LIST]
            ],
        }


class ThermalSensor(MagmariumEntity, SensorEntity):
    """Volcanoes with satellite hotspots at the summit in the last 48 h (NASA FIRMS, VIIRS)."""

    _attr_translation_key = "thermal"
    _attr_icon = "mdi:satellite-variant"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "volcanoes"

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "thermal")

    def _list(self) -> list[dict[str, Any]]:
        vols = [v for v in (self.coordinator.data or {}).get("volcanoes", []) if v.get("thermal")]
        return sorted(vols, key=lambda v: -v["thermal"]["frp_mw"])

    @property
    def native_value(self) -> int:
        return len(self._list())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "volcanoes": [
                {
                    "name": v["name"],
                    "country": v["country"],
                    "hotspots": v["thermal"]["count"],
                    "radiative_power_mw": v["thermal"]["frp_mw"],
                    "time": v["thermal"]["time"],
                    "satellite": v["thermal"]["source"],
                    "distance_km": _home_km(self.hass, v),
                }
                for v in self._list()[:MAX_LIST]
            ]
        }


class QuakeSensor(MagmariumEntity, SensorEntity):
    """Earthquakes of the last 7 days within 30 km of a volcano (USGS)."""

    _attr_translation_key = "volcanic_quakes"
    _attr_icon = "mdi:pulse"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "quakes"

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "volcanic_quakes")

    def _list(self) -> list[dict[str, Any]]:
        return [q for q in (self.coordinator.data or {}).get("quakes") or [] if q.get("volcano")]

    @property
    def native_value(self) -> int:
        return len(self._list())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        quakes = self._list()
        all_quakes = (self.coordinator.data or {}).get("quakes") or []
        return {
            "all_quakes_7d": len(all_quakes),
            "strongest": max((q["mag"] for q in quakes), default=None),
            "quakes": [
                {
                    "volcano": q["volcano"],
                    "magnitude": q["mag"],
                    "depth_km": q["depth_km"],
                    "distance_km": q["volcano_km"],
                    "time": q["time"],
                    "place": q["place"],
                }
                for q in quakes[:MAX_LIST]
            ],
        }


class NearestSensor(MagmariumEntity, SensorEntity):
    """Nearest volcano with elevated activity or an eruption."""

    _attr_translation_key = "nearest"
    _attr_icon = "mdi:map-marker-radius"

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "nearest")

    def _hit(self) -> tuple[dict[str, Any], float] | None:
        return nearest(
            (self.coordinator.data or {}).get("volcanoes", []),
            self.hass.config.latitude,
            self.hass.config.longitude,
        )

    @property
    def native_value(self) -> str | None:
        hit = self._hit()
        return hit[0]["name"] if hit else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        hit = self._hit()
        if not hit:
            return {}
        vol, dist = hit
        return {
            **_short(vol),
            "distance_km": round(dist, 1),
            "latitude": vol["lat"],
            "longitude": vol["lon"],
        }


class LatestVonaSensor(MagmariumEntity, SensorEntity):
    """Time of the newest VONA (Volcano Observatory Notice for Aviation) from MAGMA Indonesia."""

    _attr_translation_key = "latest_vona"
    _attr_icon = "mdi:airplane-alert"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "latest_vona")

    @property
    def native_value(self) -> datetime | None:
        latest = (self.coordinator.data or {}).get("latest_vona")
        if not latest:
            return None
        return datetime.fromisoformat(latest["time"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        latest = (self.coordinator.data or {}).get("latest_vona") or {}
        return {
            "volcano": latest.get("volcano"),
            "local_name": latest.get("local_name"),
            "aviation_color": latest.get("color"),
            "text": latest.get("text"),
            "ash_cloud": latest.get("ash"),
            "ash_top_m": latest.get("ash_top_m"),
            "url": latest.get("url"),
        }


class StatusSensor(MagmariumEntity, SensorEntity):
    """Health of the data sources."""

    _attr_translation_key = "status"
    _attr_icon = "mdi:database-check"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = ["ok", "degraded", "waiting"]

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "status")

    @property
    def native_value(self) -> str:
        sources = (self.coordinator.data or {}).get("sources", {})
        enabled = [s for s in sources.values() if s["enabled"]]
        if not enabled or all(not s["last_ok"] for s in enabled):
            return "waiting"
        if any(s["error"] for s in enabled):
            return "degraded"
        return "ok"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data or {}
        store = self.coordinator.store
        return {
            "feeds": data.get("sources", {}),
            "volcanoes": len(data.get("volcanoes", [])),
            "catalogue": len(store.catalog),
            "vona_cached": len(store.vonas),
            "earth_imagery": store.earth_status(),
        }


class VolcanoSensor(MagmariumEntity, SensorEntity):
    """Alert level of one watched volcano."""

    _attr_translation_key = "volcano"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = list(LEVEL_KEYS.values())

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry, name: str) -> None:
        super().__init__(coordinator, entry, f"volcano_{slugify(name)}")
        self._name = name
        self._attr_translation_placeholders = {"volcano": name}

    def _vol(self) -> dict[str, Any] | None:
        return self.coordinator.volcano_by_name(self._name)

    @property
    def icon(self) -> str:
        vol = self._vol()
        if vol and vol["erupting"]:
            return "mdi:volcano"
        return "mdi:volcano-outline"

    @property
    def native_value(self) -> str:
        vol = self._vol()
        return vol["level_key"] if vol else "unknown"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        vol = self._vol()
        if not vol:
            return {"volcano": self._name, "note": "No current report for this volcano"}
        ash = vol.get("ash") or {}
        notice = vol.get("notice") or {}
        attrs: dict[str, Any] = {
            "volcano": vol["name"],
            "local_name": vol.get("local_name"),
            "country": vol["country"],
            "level": vol["level"],
            "alert": vol.get("alert"),
            "aviation_color": vol.get("aviation_color"),
            "erupting": vol["erupting"],
            "eruption_time": (vol.get("eruption") or {}).get("time"),
            "ash_cloud": ash.get("source") in ("vona", "sigmet"),
            "ash_source": ash.get("source"),
            "ash_sigmets": len(vol.get("sigmets") or []),
            "ash_top_m": ash.get("top_m"),
            "ash_above_summit_m": ash.get("above_summit_m"),
            "ash_moving_to": ash.get("toward"),
            "ash_intensity": ash.get("intensity"),
            "last_notice": notice.get("time"),
            "notice_text": notice.get("text"),
            "source": notice.get("source"),
            "url": notice.get("url") or vol.get("report_url"),
            "official_alert": (vol.get("official") or {}).get("alert"),
            "quakes_7d": vol.get("quakes_7d") or 0,
            "wikipedia": wiki_url(vol.get("wiki")),
            "camera_image": next((c["img"] for c in vol.get("cams") or [] if c.get("img")), None),
            "cameras": [c["page"] for c in vol.get("cams") or []],
            "thermal_hotspots": (vol.get("thermal") or {}).get("count", 0),
            "thermal_power_mw": (vol.get("thermal") or {}).get("frp_mw"),
            "thermal_time": (vol.get("thermal") or {}).get("time"),
            "elevation_m": vol.get("elevation"),
            "latitude": vol["lat"],
            "longitude": vol["lon"],
        }
        if vol["lat"] is not None:
            attrs["distance_km"] = round(
                haversine_km(self.hass.config.latitude, self.hass.config.longitude, vol["lat"], vol["lon"]), 1
            )
        return attrs
