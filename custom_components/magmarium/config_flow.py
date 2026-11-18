"""Config flow for Magmarium."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .const import (
    CONF_FIRE_RADIUS,
    CONF_FIRMS_KEY,
    CONF_PLACES,
    CONF_RADIUS,
    CONF_SOURCES,
    CONF_WATCHED,
    DEFAULT_FIRE_RADIUS,
    DEFAULT_FIRMS_KEY,
    DEFAULT_PLACES,
    DEFAULT_RADIUS,
    DEFAULT_SOURCES,
    DEFAULT_WATCHED,
    DOMAIN,
    SOURCE_LABELS,
    SOURCES,
)


def _schema(defaults: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_SOURCES, default=defaults.get(CONF_SOURCES, DEFAULT_SOURCES)): SelectSelector(
                SelectSelectorConfig(
                    options=[SelectOptionDict(value=key, label=SOURCE_LABELS[key]) for key in SOURCES],
                    multiple=True,
                    mode=SelectSelectorMode.LIST,
                )
            ),
            vol.Optional(CONF_WATCHED, default=defaults.get(CONF_WATCHED, DEFAULT_WATCHED)): TextSelector(),
            vol.Optional(CONF_PLACES, default=defaults.get(CONF_PLACES, DEFAULT_PLACES)): EntitySelector(
                EntitySelectorConfig(domain="zone", multiple=True)
            ),
            vol.Optional(CONF_RADIUS, default=defaults.get(CONF_RADIUS, DEFAULT_RADIUS)): NumberSelector(
                NumberSelectorConfig(min=10, max=2000, step=10, unit_of_measurement="km", mode=NumberSelectorMode.BOX)
            ),
            vol.Optional(CONF_FIRMS_KEY, default=defaults.get(CONF_FIRMS_KEY, DEFAULT_FIRMS_KEY)): TextSelector(
                TextSelectorConfig(type=TextSelectorType.PASSWORD)
            ),
            vol.Optional(CONF_FIRE_RADIUS, default=defaults.get(CONF_FIRE_RADIUS, DEFAULT_FIRE_RADIUS)): NumberSelector(
                NumberSelectorConfig(min=0, max=20000, step=50, unit_of_measurement="km", mode=NumberSelectorMode.BOX)
            ),
        }
    )


def _validate(user_input: dict[str, Any]) -> dict[str, str]:
    errors: dict[str, str] = {}
    if not user_input.get(CONF_SOURCES):
        errors[CONF_SOURCES] = "no_sources"
    return errors


class MagmariumConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the initial setup."""

    VERSION = 3

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = _validate(user_input)
            if not errors:
                return self.async_create_entry(title="Magmarium", data=user_input)
        return self.async_show_form(step_id="user", data_schema=_schema(user_input or {}), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return MagmariumOptionsFlow()


class MagmariumOptionsFlow(OptionsFlow):
    """Change sources and watched volcanoes."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = _validate(user_input)
            if not errors:
                return self.async_create_entry(data=user_input)
        current = {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(step_id="init", data_schema=_schema(user_input or current), errors=errors)
