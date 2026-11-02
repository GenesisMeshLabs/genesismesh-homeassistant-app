"""Bounded HTTP client for the managed app; no automatic action retries."""

import asyncio
from typing import Any
from urllib.parse import quote

from aiohttp import ClientError, ClientSession, ClientTimeout

from .const import MAX_RESPONSE_BYTES, PROTOCOL
from .policy import CompanionError, select_job, validate_app_url, valid_pairing_code


class AuthenticationError(CompanionError):
    """The narrow connection credential expired or was revoked."""


class NativeClient:
    """Credentials remain in HA config entries and are never returned by actions."""

    def __init__(self, session: ClientSession, app_url: str, credential: str = "") -> None:
        self._session = session
        self.base_url = validate_app_url(app_url)
        self._credential = credential

    async def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self._credential}"} if self._credential else {}
        try:
            async with self._session.request(
                method, self.base_url + path, headers=headers, json=body,
                allow_redirects=False, timeout=ClientTimeout(total=15),
            ) as response:
                if response.status == 401:
                    raise AuthenticationError("This connection's access ended. Open Genesis Mesh to renew or replace it.")
                if response.status in (301, 302, 303, 307, 308):
                    raise CompanionError("The app address redirected. Check the connection address; no redirect was followed.")
                chunks = []
                length = 0
                async for chunk in response.content.iter_chunked(65536):
                    length += len(chunk)
                    if length > MAX_RESPONSE_BYTES:
                        raise CompanionError("The app response was too large. No automatic retry was made.")
                    chunks.append(chunk)
                raw = b"".join(chunks)
                import json
                try:
                    data = json.loads(raw)
                except (ValueError, UnicodeError) as err:
                    raise CompanionError("The app returned an invalid response. Review Activity before trying again.") from err
                if not isinstance(data, dict):
                    raise CompanionError("The app returned an invalid response. Review Activity before trying again.")
                if response.status >= 400:
                    # Never surface a server body that might contain credentials or private state.
                    reason = "The request was refused by its access rules." if response.status == 403 else "The app could not complete this request."
                    raise CompanionError(reason + " Review the job's Activity in Genesis Mesh. No automatic retry was made.")
                if not 200 <= response.status < 300:
                    raise CompanionError("The app did not accept this request. Review Activity before trying again.")
                return data
        except (ClientError, asyncio.TimeoutError) as err:
            raise CompanionError("Genesis Mesh is unavailable or its reply was lost. Check Activity and the device before another control request. No automatic retry was made.") from err

    async def pair(self, code: str, *, expected_home_id: str | None = None, expected_job_id: str | None = None) -> dict[str, Any]:
        claim = {"code": valid_pairing_code(code)}
        if expected_home_id is not None:
            claim["expectedHomeId"] = expected_home_id
        if expected_job_id is not None:
            claim["expectedJobId"] = expected_job_id
        data = await self._request("POST", "/v1/native/pair", claim)
        if data.get("protocol") != PROTOCOL or not all(isinstance(data.get(key), str) and data[key] for key in ("credential", "homeId", "jobId")):
            raise CompanionError("The app returned an incompatible pairing response. Update both components and try again.")
        return data

    async def job(self, job_id: str) -> dict[str, Any]:
        return select_job(await self._request("GET", "/v1/native/jobs"), job_id)

    async def act(self, job_id: str, intent: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", f"/v1/native/jobs/{quote(job_id, safe='')}/actions", intent)

