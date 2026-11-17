"""Magmarium - active volcanoes on a living globe for Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path

from aiohttp import web

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.http import KEY_HASS
from homeassistant.helpers.typing import ConfigType

from .const import (
    CARD_FILE,
    CONF_SOURCES,
    DEFAULT_SOURCES,
    DOMAIN,
    URL_EARTH,
    URL_FRONTEND,
    URL_VOLCANOES,
    VERSION,
)
from .coordinator import MagmariumCoordinator
from .data import MagmariumData

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the frontend card and the API views once."""
    hass.data.setdefault(DOMAIN, {})
    frontend_dir = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_FRONTEND, str(frontend_dir), False)]
    )
    add_extra_js_url(hass, f"{URL_FRONTEND}/{CARD_FILE}?v={VERSION}")
    hass.http.register_view(MagmariumVolcanoView())
    hass.http.register_view(MagmariumEarthView())
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Magmarium from a config entry."""
    options = {**entry.data, **entry.options}
    sources = options.get(CONF_SOURCES, DEFAULT_SOURCES)

    data = MagmariumData(hass, sources)
    await data.async_load()

    coordinator = MagmariumCoordinator(hass, entry, data)
    hass.data[DOMAIN]["data"] = data
    hass.data[DOMAIN][entry.entry_id] = coordinator

    # start with the cached data, the downloads run in the background so startup is never blocked
    coordinator.async_set_updated_data(coordinator.snapshot())
    entry.async_create_background_task(hass, coordinator.async_refresh(), f"{DOMAIN}_initial_refresh")
    # the NASA images are large: load them in the background as well
    entry.async_create_background_task(hass, data.async_ensure_earth(), f"{DOMAIN}_earth")

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        hass.data[DOMAIN].pop("data", None)
    return unloaded


class MagmariumVolcanoView(HomeAssistantView):
    """Serve the merged volcano list to the card."""

    url = URL_VOLCANOES
    name = "api:magmarium:volcanoes"
    requires_auth = True

    @callback
    def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app[KEY_HASS]
        data: MagmariumData | None = hass.data.get(DOMAIN, {}).get("data")
        if data is None:
            return web.json_response({"error": "Magmarium is not configured"}, status=404)
        if data.payload_json is None or data.payload_gzip is None:
            return web.json_response({"error": "Volcano data not loaded yet"}, status=503)
        headers = {"Cache-Control": "no-cache", "Content-Type": "application/json"}
        if "gzip" in request.headers.get("Accept-Encoding", ""):
            headers["Content-Encoding"] = "gzip"
            return web.Response(body=data.payload_gzip, headers=headers)
        return web.Response(body=data.payload_json, headers=headers)


class MagmariumEarthView(HomeAssistantView):
    """Serve the NASA Earth images (day and night) for the globe."""

    url = URL_EARTH
    name = "api:magmarium:earth"
    requires_auth = True

    async def get(self, request: web.Request, kind: str) -> web.StreamResponse:
        hass: HomeAssistant = request.app[KEY_HASS]
        data: MagmariumData | None = hass.data.get(DOMAIN, {}).get("data")
        if data is None:
            return web.json_response({"error": "Magmarium is not configured"}, status=404)
        path = data.earth_path(kind)
        if path is None:
            return web.json_response({"error": "Earth image not downloaded yet"}, status=503)
        return web.FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})
