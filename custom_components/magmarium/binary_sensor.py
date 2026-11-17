"""Binary sensors for Magmarium: volcanic ash near a place."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import slugify

from .ashnear import ash_threats
from .const import CONF_PLACES, CONF_RADIUS, DEFAULT_PLACES, DEFAULT_RADIUS, DOMAIN
from .coordinator import MagmariumCoordinator
from .entity import MagmariumEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: MagmariumCoordinator = hass.data[DOMAIN][entry.entry_id]
    options = {**entry.data, **entry.options}
    places = options.get(CONF_PLACES, DEFAULT_PLACES) or []
    radius = float(options.get(CONF_RADIUS, DEFAULT_RADIUS) or DEFAULT_RADIUS)
    async_add_entities(AshNearSensor(coordinator, entry, zone, radius) for zone in places)


class AshNearSensor(MagmariumEntity, BinarySensorEntity):
    """On when an ash cloud, an official ash area or a simulated drift track comes near a zone."""

    _attr_translation_key = "ash_near"
    _attr_device_class = BinarySensorDeviceClass.SAFETY
    _attr_icon = "mdi:weather-cloudy-alert"

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry, zone: str, radius_km: float) -> None:
        super().__init__(coordinator, entry, f"ash_near_{slugify(zone)}")
        self._zone = zone
        self._radius = radius_km
        self._threats: list[dict[str, Any]] = []
        self._place = zone.split(".", 1)[-1].replace("_", " ").title()

    def _place_name(self) -> str:
        state = self.hass.states.get(self._zone) if self.hass else None
        if state is not None:
            return state.attributes.get("friendly_name") or state.name or self._place
        return self._place

    @property
    def translation_placeholders(self) -> dict[str, str]:
        return {"place": self._place_name()}

    def _compute(self) -> list[dict[str, Any]]:
        state = self.hass.states.get(self._zone) if self.hass else None
        if state is None:
            return []
        lat = state.attributes.get("latitude")
        lon = state.attributes.get("longitude")
        if lat is None or lon is None:
            return []
        data = self.coordinator.data or {}
        return ash_threats(float(lat), float(lon), self._radius, data.get("volcanoes") or [], data.get("sigmets") or [])

    @property
    def available(self) -> bool:
        return super().available and self.hass is not None and self.hass.states.get(self._zone) is not None

    @property
    def is_on(self) -> bool:
        self._threats = self._compute()
        return bool(self._threats)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        threats = self._threats
        nearest = threats[0] if threats else None
        return {
            "zone": self._zone,
            "radius_km": self._radius,
            "nearest_km": nearest["distance_km"] if nearest else None,
            "volcano": nearest.get("volcano") if nearest else None,
            "kind": nearest.get("kind") if nearest else None,
            "eta_hours": nearest.get("eta_hours") if nearest else None,
            "official": any(t["kind"] == "sigmet" for t in threats),
            "threats": threats[:10],
        }
