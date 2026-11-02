"""Native actions for bounded Genesis Mesh workflow connections.

The connection is the authenticated actor. A service selector and HA context
are not cryptographic proof of an individual automation's identity.
"""

from datetime import timedelta
from typing import Any

import probatio

from homeassistant.auth.permissions.const import POLICY_CONTROL, POLICY_READ
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError, ServiceValidationError, Unauthorized
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .client import AuthenticationError, NativeClient
from .const import CONF_APP_URL, CONF_CREDENTIAL, CONF_JOB_ID, DOMAIN, POLL_SECONDS
from .policy import CompanionError, make_intent, require_current_job, verification_intent


class NativeCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Refresh one scoped job and execute only explicitly queued safe reads."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: NativeClient) -> None:
        import logging
        super().__init__(hass, logging.getLogger(__name__), name="Genesis Mesh workflow", config_entry=entry, update_interval=timedelta(seconds=POLL_SECONDS))
        self.client = client
        self.job_id = entry.data[CONF_JOB_ID]
        self._attempted_checks: set[str] = set()

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            job = await self.client.job(self.job_id)
            check = verification_intent(job) if job.get("verification") else None
            if check and job.get("allowSystem") is True and check["requestId"] not in self._attempted_checks:
                # Mark before sending. A lost reply never causes a fresh request
                # or automatic retry, and an app-restored UUID is deduplicated.
                self._attempted_checks.add(check["requestId"])
                if len(self._attempted_checks) > 512:
                    self._attempted_checks = {check["requestId"]}
                await self.client.act(self.job_id, check)
                job = await self.client.job(self.job_id)
            return job
        except AuthenticationError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except CompanionError as err:
            raise UpdateFailed(str(err)) from err


async def _authorize(hass: HomeAssistant, call: ServiceCall, job: dict[str, Any], capability: str) -> None:
    """Native access is an upper bound, not replaced by Mesh allowance."""
    require_current_job(job, capability)
    user_id = call.context.user_id
    if user_id is None:
        if job.get("allowSystem") is not True:
            raise ServiceValidationError("This job does not allow Home Assistant system workflows.")
        return
    user = await hass.auth.async_get_user(user_id)
    if user is None or not user.is_active or user.system_generated or user_id not in job["allowedHaUserIds"]:
        raise Unauthorized(context=call.context, user_id=user_id)
    permission = POLICY_READ if capability == "ha.entity.read" else POLICY_CONTROL
    if not user.permissions.check_entity(job["entityId"], permission):
        raise Unauthorized(context=call.context, user_id=user_id, entity_id=job["entityId"], permission=permission)


async def _handle(hass: HomeAssistant, call: ServiceCall, capability: str, parameters: dict[str, Any]) -> ServiceResponse:
    coordinator = hass.data.get(DOMAIN, {}).get(call.data["connection"])
    if not isinstance(coordinator, NativeCoordinator):
        raise ServiceValidationError("Choose a paired Genesis Mesh connection in Settings → Devices & services.")
    try:
        # Re-read scope before every request; stale coordinator data cannot
        # revive a revoked job or silently restore broader native permissions.
        job = await coordinator.client.job(coordinator.job_id)
        await _authorize(hass, call, job, capability)
        result = await coordinator.client.act(coordinator.job_id, make_intent(job, capability, parameters))
        if result.get("commandState") in ("denied", "blocked"):
            raise ServiceValidationError("Genesis Mesh refused the request. Review this job's Activity for the rule and next step.")
        if result.get("commandState") == "outcome_unknown":
            raise HomeAssistantError("The device outcome is uncertain. Check the device and Genesis Mesh Activity before another request. No automatic retry was made.")
        if result.get("commandState") not in ("observed", "accepted"):
            raise HomeAssistantError("The app did not confirm a completed observation or accepted command. Check Activity before another request.")
        # This response contains scoped operation data, never the stored secret.
        coordinator.async_set_updated_data(job)
        return result
    except AuthenticationError as err:
        raise ServiceValidationError(str(err)) from err
    except CompanionError as err:
        raise ServiceValidationError(str(err)) from err


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    hass.data.setdefault(DOMAIN, {})

    async def observe(call: ServiceCall) -> ServiceResponse:
        return await _handle(hass, call, "ha.entity.read", {})

    async def set_volume(call: ServiceCall) -> ServiceResponse:
        return await _handle(hass, call, "ha.media.volume", {"volumePct": call.data["volume_pct"]})

    async def playback(call: ServiceCall) -> ServiceResponse:
        return await _handle(hass, call, "ha.media.transport", {"action": call.data["action"]})

    common = {probatio.Required("connection"): cv.string}
    for name, handler, schema in (
        ("observe", observe, common),
        ("set_volume", set_volume, {**common, probatio.Required("volume_pct"): probatio.All(probatio.Coerce(float), probatio.Range(min=0, max=100))}),
        ("playback", playback, {**common, probatio.Required("action"): probatio.In(["play", "pause", "stop", "next", "previous"])}),
    ):
        hass.services.async_register(DOMAIN, name, handler, schema=probatio.Schema(schema), supports_response=SupportsResponse.OPTIONAL)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    client = NativeClient(async_get_clientsession(hass), entry.data[CONF_APP_URL], entry.data[CONF_CREDENTIAL])
    coordinator = NativeCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    # No entities subscribe to this coordinator, so own its periodic refresh.
    entry.async_on_unload(coordinator.async_add_listener(lambda: None))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if coordinator is not None:
        await coordinator.async_shutdown()
    return True

