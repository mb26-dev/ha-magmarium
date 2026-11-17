"""Coordinator for Magmarium."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN, UPDATE_INTERVAL_MINUTES
from .data import MagmariumData

_LOGGER = logging.getLogger(__name__)


class MagmariumCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Polls the feeds that are due and publishes the merged volcano list."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, data: MagmariumData) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(minutes=UPDATE_INTERVAL_MINUTES),
        )
        self.store = data

    async def _async_update_data(self) -> dict[str, Any]:
        # every feed has its own interval and backoff, a failing feed keeps its cached data
        await self.store.async_refresh()
        if self.store.earth_status() != "ready":
            # retried at most every few hours inside async_ensure_earth
            self.config_entry.async_create_background_task(
                self.hass, self.store.async_ensure_earth(), f"{DOMAIN}_earth_retry"
            )
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        """Current merged data as published to the entities."""
        return {
            **self.store.result,
            "updated": self.store.updated,
            "sources": self.store.source_status(),
        }

    def volcano_by_name(self, name: str) -> dict[str, Any] | None:
        from .parsing import MAGMA_ALIASES, normalize_name

        key = normalize_name(name)
        alias = MAGMA_ALIASES.get(key, key)
        volcanoes = (self.data or {}).get("volcanoes", [])
        for vol in volcanoes:
            if normalize_name(vol["name"]) in (key, alias) or normalize_name(vol.get("local_name") or "") == key:
                return vol
        return None
