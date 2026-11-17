"""Base entity for Magmarium."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, VERSION
from .coordinator import MagmariumCoordinator


class MagmariumEntity(CoordinatorEntity[MagmariumCoordinator]):
    """Base entity."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: MagmariumCoordinator, entry: ConfigEntry, key: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Magmarium",
            manufacturer="Magmarium",
            model="Volcano activity",
            sw_version=VERSION,
            entry_type=DeviceEntryType.SERVICE,
            configuration_url="https://github.com/mb26-dev/ha-magmarium",
        )
