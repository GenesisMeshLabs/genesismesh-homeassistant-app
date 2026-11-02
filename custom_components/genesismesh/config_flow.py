"""Owner-confirmed, per-job pairing with the managed Genesis Mesh app."""

from typing import Any

import probatio

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.service_info.hassio import HassioServiceInfo
from homeassistant.helpers import selector

from .client import NativeClient
from .const import (
    CONF_APP_URL, CONF_CREDENTIAL, CONF_HOME_ID, CONF_JOB_ID, CONF_PAIRING_CODE,
    DEFAULT_APP_URL, DOMAIN,
)
from .policy import CompanionError, validate_app_url


class GenesisMeshConfigFlow(ConfigFlow, domain=DOMAIN):
    """Each config entry authenticates exactly one bounded workflow connection."""

    VERSION = 1

    def __init__(self) -> None:
        self._app_url = DEFAULT_APP_URL
        self._pairing_code = ""

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            if user_input.get("use_custom_address"):
                self._pairing_code = user_input[CONF_PAIRING_CODE]
                return await self.async_step_address()
            try:
                result = await NativeClient(async_get_clientsession(self.hass), self._app_url).pair(user_input[CONF_PAIRING_CODE])
                await self.async_set_unique_id(f"{result['homeId']}:{result['jobId']}")
                # An intentional new owner-issued code can reconnect an existing
                # job; don't consume it and leave its newly rotated secret lost.
                self._abort_if_unique_id_configured(updates={CONF_CREDENTIAL: result["credential"], CONF_APP_URL: self._app_url}, error="reauth_successful")
                return self.async_create_entry(
                    title=str(result.get("name", "Genesis Mesh workflow"))[:120],
                    data={
                        CONF_APP_URL: self._app_url,
                        CONF_CREDENTIAL: result["credential"],
                        CONF_HOME_ID: result["homeId"],
                        CONF_JOB_ID: result["jobId"],
                    },
                )
            except CompanionError:
                errors["base"] = "cannot_pair"
        return self.async_show_form(
            step_id="user",
            data_schema=probatio.Schema({
                probatio.Required(CONF_PAIRING_CODE): selector.TextSelector(selector.TextSelectorConfig()),
                probatio.Optional("use_custom_address", default=False): selector.BooleanSelector(),
            }),
            errors=errors,
        )

    async def async_step_address(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Keep internal addresses out of the usual owner's setup journey."""
        errors: dict[str, str] = {}
        if user_input:
            try:
                self._app_url = validate_app_url(user_input[CONF_APP_URL])
                return await self.async_step_user({CONF_PAIRING_CODE: self._pairing_code})
            except CompanionError:
                errors["base"] = "cannot_pair"
        return self.async_show_form(
            step_id="address",
            data_schema=probatio.Schema({probatio.Required(CONF_APP_URL, default=self._app_url): selector.TextSelector(selector.TextSelectorConfig())}),
            errors=errors,
        )

    async def async_step_hassio(self, discovery_info: HassioServiceInfo) -> ConfigFlowResult:
        """Discovery suggests a private address; it does not grant access."""
        config = discovery_info.config
        try:
            self._app_url = validate_app_url(config.get("url", DEFAULT_APP_URL))
        except CompanionError:
            return self.async_abort(reason="invalid_discovery")
        # No secret from discovery is silently consumed. The owner reviews a job
        # in the app and supplies its current single-use pairing code.
        return await self.async_step_user()

    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        self._app_url = str(entry_data.get(CONF_APP_URL, DEFAULT_APP_URL))
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input:
            entry = self._get_reauth_entry()
            try:
                result = await NativeClient(async_get_clientsession(self.hass), self._app_url).pair(
                    user_input[CONF_PAIRING_CODE], expected_home_id=entry.data[CONF_HOME_ID], expected_job_id=entry.data[CONF_JOB_ID]
                )
                if result["homeId"] != entry.data[CONF_HOME_ID] or result["jobId"] != entry.data[CONF_JOB_ID]:
                    return self.async_abort(reason="wrong_job")
                return self.async_update_reload_and_abort(entry, data_updates={CONF_CREDENTIAL: result["credential"]})
            except CompanionError:
                errors["base"] = "cannot_pair"
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=probatio.Schema({probatio.Required(CONF_PAIRING_CODE): selector.TextSelector(selector.TextSelectorConfig())}),
            errors=errors,
        )

