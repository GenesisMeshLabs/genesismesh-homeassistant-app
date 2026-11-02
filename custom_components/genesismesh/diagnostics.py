"""Diagnostics intentionally exclude credentials, native user IDs and state."""

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    job = coordinator.data if coordinator and coordinator.data else {}
    return {
        "protocol": 1,
        "loaded": coordinator is not None,
        "last_update_success": bool(coordinator and coordinator.last_update_success),
        "job_enabled": job.get("enabled") is True,
        "purpose": job.get("purpose"),
        "capability_count": len(job.get("capabilities", [])),
        "identity_boundary": "configured_workflow_connection_not_individual_automation",
    }

