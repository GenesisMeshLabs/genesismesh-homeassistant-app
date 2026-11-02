"""Finite native requests and validation, independent of Home Assistant imports."""

from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
import math
import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4


class CompanionError(Exception):
    """A bounded, user-readable error that never contains credentials or bodies."""


def validate_app_url(value: str) -> str:
    """Allow HTTPS or the private app transport, never credentials or redirects."""
    try:
        parsed = urlsplit(value.strip())
        host = parsed.hostname
        port = parsed.port
        if (
            not host
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path not in ("", "/")
            or parsed.scheme not in ("http", "https")
        ):
            raise ValueError
        if parsed.scheme == "http":
            private_host = bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,80}-genesismesh(?:\.local\.hass\.io)?", host))
            try:
                address = ip_address(host)
                private_host = address.is_private and not address.is_unspecified and not address.is_multicast
            except ValueError:
                pass
            if not private_host or port != 8098:
                raise ValueError
        if port is not None and not 1 <= port <= 65535:
            raise ValueError
        return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
    except (AttributeError, TypeError, ValueError) as err:
        raise CompanionError("Use the private Genesis Mesh app address, or a valid HTTPS address without a path or credentials.") from err


def valid_pairing_code(value: str) -> str:
    code = "".join(value.split())
    if not re.fullmatch(r"[A-Za-z0-9_-]{16}", code):
        raise CompanionError("Enter the current pairing code shown by Genesis Mesh.")
    return code


def select_job(data: dict[str, Any], expected_job_id: str) -> dict[str, Any]:
    """A credential belongs to precisely one connection, never a whole home."""
    jobs = data.get("jobs")
    if data.get("protocol") != 1 or not isinstance(jobs, list) or len(jobs) != 1:
        raise CompanionError("The app and integration are not compatible. Update both and pair again.")
    job = jobs[0]
    if not isinstance(job, dict) or job.get("id") != expected_job_id:
        raise CompanionError("This connection does not match the paired job. Pair it again.")
    resource = job.get("resourceId")
    entity = job.get("entityId")
    resources = job.get("resources")
    if (
        not isinstance(resource, str)
        or not re.fullmatch(r"[a-z0-9][a-z0-9_.:-]{0,79}", resource)
        or not isinstance(entity, str)
        or not re.fullmatch(r"[a-z0-9_]+\.[a-z0-9_]+", entity)
        or not isinstance(resources, list)
        or len(resources) != 1
        or not isinstance(resources[0], dict)
        or resources[0].get("id") != resource
        or resources[0].get("entityId") != entity
        or not isinstance(job.get("capabilities"), list)
        or not all(isinstance(cap, str) for cap in job["capabilities"])
        or not isinstance(job.get("allowedHaUserIds"), list)
        or not all(isinstance(user_id, str) for user_id in job["allowedHaUserIds"])
        or not isinstance(job.get("allowSystem"), bool)
    ):
        raise CompanionError("The app returned an invalid connection scope. No device request was sent.")
    return job


def require_current_job(job: dict[str, Any], capability: str) -> None:
    try:
        expires = datetime.fromisoformat(job["expiresAt"].replace("Z", "+00:00"))
        if job.get("enabled") is not True or expires.tzinfo is None or expires <= datetime.now(timezone.utc):
            raise ValueError
    except (KeyError, TypeError, AttributeError, ValueError) as err:
        raise CompanionError("This job's access has ended. Review or renew it in Genesis Mesh.") from err
    if capability not in job["capabilities"]:
        raise CompanionError("This job does not allow that action. Review its permissions in Genesis Mesh.")


def make_intent(job: dict[str, Any], capability: str, parameters: dict[str, Any]) -> dict[str, Any]:
    """The integration, never the service caller, chooses identity and target."""
    require_current_job(job, capability)
    valid = False
    if capability == "ha.entity.read":
        valid = parameters == {}
    elif capability == "ha.media.volume":
        value = parameters.get("volumePct")
        valid = set(parameters) == {"volumePct"} and type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 100
    elif capability == "ha.media.transport":
        valid = set(parameters) == {"action"} and parameters["action"] in ("play", "pause", "stop", "next", "previous")
    if not valid:
        raise CompanionError("Choose a supported action and value. No device request was sent.")
    return {
        "requestId": str(uuid4()),
        "resourceId": job["resourceId"],
        "capability": capability,
        "parameters": parameters,
        "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def verification_intent(job: dict[str, Any]) -> dict[str, Any] | None:
    """Only a fresh read can be requested by automatic onboarding verification."""
    value = job.get("verification")
    if value is None:
        return None
    require_current_job(job, "ha.entity.read")
    try:
        expires = datetime.fromisoformat(value["expiresAt"].replace("Z", "+00:00"))
        if (
            set(value) != {"requestId", "resourceId", "capability", "parameters", "expiresAt"}
            or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", value["requestId"])
            or value["resourceId"] != job["resourceId"]
            or value["capability"] != "ha.entity.read"
            or value["parameters"] != {}
            or expires.tzinfo is None
            or not datetime.now(timezone.utc) < expires <= datetime.now(timezone.utc) + timedelta(minutes=5)
        ):
            raise ValueError
    except (KeyError, TypeError, AttributeError, ValueError) as err:
        raise CompanionError("The connection check expired or has invalid scope. Start a new check in Genesis Mesh.") from err
    return dict(value)

