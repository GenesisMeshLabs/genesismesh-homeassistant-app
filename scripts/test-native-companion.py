"""Run inside the pinned HA Core image against a fresh, isolated HA object.

No real home API, hardware, config storage or app process is contacted. The
managed app protocol is simulated here; root's app/NA tests prove its boundary.
"""

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from urllib.parse import urlsplit

from aiohttp import ClientSession, web

from homeassistant.auth import auth_manager_from_config
from homeassistant.config_entries import ConfigEntries, ConfigEntry, ConfigEntryState, SOURCE_USER
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError, Unauthorized
from homeassistant.helpers import area_registry, device_registry, entity_registry
from homeassistant.helpers.selector import validate_selector
from homeassistant.setup import async_setup_component
from homeassistant.util.yaml import load_yaml


async def verify_http_transport():
    """Actual aiohttp transport, including chunked/redirect/oversize boundaries."""
    client_module = importlib.import_module("custom_components.genesismesh.client")
    calls = {"post": 0, "redirected": 0}

    async def chunked(request):
        calls["post"] += 1
        assert request.headers.get("Authorization") == "Bearer fixture-secret-not-returned"
        response = web.StreamResponse(headers={"Content-Type": "application/json"})
        await response.prepare(request)
        await response.write(b'{"command')
        await asyncio.sleep(0)
        await response.write(b'State":"observed"}')
        await response.write_eof()
        return response

    async def redirect(request):
        raise web.HTTPFound("/redirect-target")

    async def redirected(request):
        calls["redirected"] += 1
        return web.json_response({"leaked": True})

    async def oversized(request):
        return web.Response(body=b"x" * (1024 * 1024 + 1), content_type="application/json")

    async def denied(request):
        return web.json_response({"credential": "never-surface-server-secret"}, status=403)

    app = web.Application()
    app.router.add_post("/chunked", chunked)
    app.router.add_post("/redirect", redirect)
    app.router.add_get("/redirect-target", redirected)
    app.router.add_get("/oversized", oversized)
    app.router.add_post("/denied", denied)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    try:
        async with ClientSession() as session:
            client = client_module.NativeClient(session, "https://example.invalid", "fixture-secret-not-returned")
            # Test-only loopback transport injection; production construction
            # still enforces the supported private app/HTTPS address policy.
            client.base_url = f"http://127.0.0.1:{port}"
            assert (await client._request("POST", "/chunked", {}))["commandState"] == "observed"
            assert calls["post"] == 1
            for method, path in (("POST", "/redirect"), ("GET", "/oversized"), ("POST", "/denied")):
                try:
                    await client._request(method, path, {})
                except client_module.CompanionError as err:
                    assert "never-surface" not in str(err) and "fixture-secret" not in str(err)
                else:
                    raise AssertionError("Unsafe HTTP response passed")
            assert calls["redirected"] == 0, "Credential-bearing redirect was followed"
    finally:
        await runner.cleanup()


async def verify_real_application(hass, native):
    """Optional CI chain: actual HA services -> companion HTTP -> app -> real NA.

    Physical HA responses and the Supervisor peer are explicitly simulated by
    browser-lab. A strict loopback fixture marker prevents targeting a home.
    """
    url = os.environ.get("GM_NATIVE_LAB_URL")
    if not url:
        return
    parsed = urlsplit(url)
    assert parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "::1")
    assert not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in ("", "/")
    client_module = importlib.import_module("custom_components.genesismesh.client")
    async with ClientSession() as session:
        async def fixture(path, body=None, csrf=None):
            headers = {"x-gm-csrf": csrf} if csrf else {}
            async with session.request("GET" if body is None else "POST", url.rstrip("/") + path, json=body, headers=headers, allow_redirects=False) as response:
                assert response.status == 200, f"Disposable native fixture request failed: {path} ({response.status})"
                return await response.json()

        marker = await fixture("/fixture/status")
        assert marker["profile"] == "real-app-real-NA-simulated-Supervisor-and-HA"
        csrf = (await fixture("/api/session"))["csrf"]
        catalog = (await fixture("/api/catalog"))["resources"]
        target = next(resource for resource in catalog if resource["entityId"] == "media_player.lab_speaker")
        created = await fixture("/api/jobs", {
            "name": "Native Core media acceptance", "purpose": "media", "resources": [target["id"]],
            "capabilities": ["ha.entity.read", "ha.media.volume", "ha.media.transport"], "hours": 1, "limits": {"maxVolumePct": 40},
        }, csrf)
        job_id = created["job"]["id"]
        pairing = await fixture("/api/jobs/pair", {"id": job_id}, csrf)
        unpaired = client_module.NativeClient(session, "http://127.0.0.1:8098")
        paired = await unpaired.pair(pairing["code"])
        assert paired["jobId"] == job_id
        client = client_module.NativeClient(session, "http://127.0.0.1:8098", paired["credential"])
        job = await client.job(job_id)
        assert job["resourceId"] == target["id"] and job["limits"]["maxVolumePct"] == 40
        entry = ConfigEntry(
            version=1, minor_version=1, domain="genesismesh", title=job["name"],
            data={"app_url": client.base_url, "credential": paired["credential"], "home_id": paired["homeId"], "job_id": job_id},
            source=SOURCE_USER, unique_id=f"{paired['homeId']}:{job_id}", options={}, discovery_keys={}, subentries_data=None,
        )
        coordinator = native.NativeCoordinator(hass, entry, client)
        hass.data["genesismesh"][entry.entry_id] = coordinator
        try:
            before = (await fixture("/fixture/status"))["simulatedCommands"]
            await fixture("/api/jobs/test", {"id": job_id}, csrf)
            await coordinator._async_update_data()
            status = await fixture("/api/status")
            verified = next(item for item in status["jobs"] if item["id"] == job_id)
            assert verified["connectionState"] == "verified"
            assert verified["lastTest"]["commandState"] == "observed" and verified["lastTest"]["evidenceState"] == "acknowledged"
            assert (await fixture("/fixture/status"))["simulatedCommands"] == before

            async def call(service, data):
                return await hass.services.async_call("genesismesh", service, {"connection": entry.entry_id, **data}, blocking=True, return_response=True, context=Context())

            result = await call("set_volume", {"volume_pct": 35})
            assert result["commandState"] == "accepted" and result["evidenceState"] == "acknowledged" and result["decisionId"]
            assert (await fixture("/fixture/status"))["simulatedCommands"] == before + 1
            try:
                await call("set_volume", {"volume_pct": 41})
            except ServiceValidationError:
                pass
            else:
                raise AssertionError("Real authority volume cap did not refuse 41%")
            assert (await fixture("/fixture/status"))["simulatedCommands"] == before + 1
            denial = (await fixture("/api/status"))["activity"][0]
            assert denial["commandState"] == "denied" and denial["decisionId"]

            # Same native entry renews its credential after an intentional re-pair.
            reconnect = await fixture("/api/jobs/pair", {"id": job_id}, csrf)
            try:
                await unpaired.pair(reconnect["code"], expected_home_id=paired["homeId"], expected_job_id=f"job-{uuid4()}")
            except client_module.CompanionError:
                pass
            else:
                raise AssertionError("Wrong-job reauth unexpectedly consumed a pairing")
            repaired = await unpaired.pair(reconnect["code"], expected_home_id=paired["homeId"], expected_job_id=job_id)
            coordinator.client = client_module.NativeClient(session, "http://127.0.0.1:8098", repaired["credential"])
            result = await call("observe", {})
            assert result["commandState"] == "observed"
            await fixture("/api/jobs/revoke", {"id": job_id}, csrf)
            try:
                await call("observe", {})
            except ServiceValidationError:
                pass
            else:
                raise AssertionError("Revoked native connection still worked")
            assert (await fixture("/fixture/status"))["simulatedCommands"] == before + 1
        finally:
            hass.data["genesismesh"].pop(entry.entry_id, None)
            await coordinator.async_shutdown()
    print("Native E2E: real Core actions + actual companion HTTP + managed app + released authority: pairing, safe verification, signed allowed35/refused41 with exact device counts, re-pair mismatch preservation, and revocation passed. Supervisor identity and device responses simulated.")


async def main():
    # The invocation must put the repository root on PYTHONPATH or copy its
    # custom_components tree under /tmp/test-config for this isolated HA object.
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    native = importlib.import_module("custom_components.genesismesh")
    flow_module = importlib.import_module("custom_components.genesismesh.config_flow")
    diagnostics = importlib.import_module("custom_components.genesismesh.diagnostics")
    policy = importlib.import_module("custom_components.genesismesh.policy")
    metadata = load_yaml(root / "custom_components/genesismesh/services.yaml")
    assert set(metadata) == {"observe", "set_volume", "playback"}
    for description in metadata.values():
        for field in description["fields"].values():
            validate_selector(field["selector"])
    await verify_http_transport()

    with tempfile.TemporaryDirectory(prefix="gm-native-core-") as directory:
        hass = HomeAssistant(directory)
        hass.config.components.add("genesismesh")
        hass.config_entries = ConfigEntries(hass, {})
        device_registry.async_setup(hass)
        await device_registry.async_load(hass, load_empty=True)
        await entity_registry.async_load(hass, load_empty=True)
        await area_registry.async_load(hass, load_empty=True)
        hass.auth = await auth_manager_from_config(hass, [], [])
        owner = await hass.auth.async_create_user("Native owner")
        outsider = await hass.auth.async_create_user("Unbound native user")
        job = {
            "id": "job-native", "name": "Bounded media helper", "purpose": "media",
            "resourceId": "native-speaker", "entityId": "media_player.native_speaker",
            "resources": [{"id": "native-speaker", "entityId": "media_player.native_speaker", "name": "Speaker"}],
            "capabilities": ["ha.entity.read", "ha.media.volume", "ha.media.transport"],
            "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "enabled": True, "allowSystem": True, "allowedHaUserIds": [owner.id],
        }

        class FixtureClient:
            calls = []
            uncertain = False

            async def job(self, job_id):
                assert job_id == "job-native"
                return deepcopy(job)

            async def act(self, job_id, intent):
                assert job_id == job["id"] and intent["resourceId"] == job["resourceId"]
                self.calls.append(deepcopy(intent))
                if self.uncertain:
                    return {"commandState": "outcome_unknown"}
                if intent["capability"] == "ha.media.volume" and intent["parameters"]["volumePct"] > 40:
                    raise policy.CompanionError("The request was refused by its access rules.")
                return {"commandState": "observed" if intent["capability"] == "ha.entity.read" else "accepted", "requestId": intent["requestId"], "decisionId": "fixture-decision", "evidenceState": "acknowledged"}

        entry = ConfigEntry(
            version=1, minor_version=1, domain="genesismesh", title=job["name"],
            data={"app_url": "http://3e2ad153-genesismesh:8098", "credential": "never-print-fixture-secret", "home_id": "native-home", "job_id": job["id"]},
            source=SOURCE_USER, unique_id="native-home:job-native", options={}, discovery_keys={}, subentries_data=None,
        )
        client = FixtureClient()
        coordinator = native.NativeCoordinator(hass, entry, client)
        coordinator.async_set_updated_data(deepcopy(job))
        await native.async_setup(hass, {})
        hass.data["genesismesh"][entry.entry_id] = coordinator

        async def call(service, data, context=Context(user_id=owner.id)):
            return await hass.services.async_call("genesismesh", service, {"connection": entry.entry_id, **data}, blocking=True, return_response=True, context=context)

        response = await call("observe", {})
        assert response["commandState"] == "observed"
        response = await call("set_volume", {"volume_pct": 35})
        assert response["commandState"] == "accepted"
        await call("playback", {"action": "pause"})
        job["allowedHaUserIds"].append(outsider.id)
        previous = len(client.calls)
        try:
            await call("observe", {}, Context(user_id=outsider.id))
        except Unauthorized:
            pass
        else:
            raise AssertionError("Mesh allowlist bypassed native entity permissions")
        assert len(client.calls) == previous
        job["allowedHaUserIds"].remove(outsider.id)
        for service, data, context in (
            ("observe", {}, Context(user_id=outsider.id)),
            ("observe", {}, Context(user_id="missing-user")),
            ("observe", {"user_id": owner.id}, Context()),
            ("set_volume", {"volume_pct": 41}, Context(user_id=owner.id)),
            ("playback", {"action": "run_shell"}, Context(user_id=owner.id)),
        ):
            try:
                await call(service, data, context)
            except Exception:
                pass
            else:
                raise AssertionError("Invalid caller/action unexpectedly passed")
        await call("observe", {}, Context())
        job["allowSystem"] = False
        try:
            await call("observe", {}, Context())
        except ServiceValidationError:
            pass
        else:
            raise AssertionError("System context was promoted into a user")
        job["allowSystem"] = True
        job["enabled"] = False
        previous = len(client.calls)
        try:
            await call("observe", {})
        except ServiceValidationError:
            pass
        else:
            raise AssertionError("Disabled access passed")
        assert len(client.calls) == previous
        job["enabled"] = True
        client.uncertain = True
        previous = len(client.calls)
        try:
            await call("set_volume", {"volume_pct": 30})
        except HomeAssistantError:
            pass
        else:
            raise AssertionError("Unknown outcome looked successful")
        assert len(client.calls) == previous + 1
        client.uncertain = False
        job["verification"] = policy.make_intent(job, "ha.entity.read", {})
        await coordinator._async_update_data()
        previous = len(client.calls)
        await coordinator._async_update_data()
        assert len(client.calls) == previous, "Automatic check was repeated"
        diagnostic = await diagnostics.async_get_config_entry_diagnostics(hass, entry)
        assert "never-print" not in str(diagnostic) and owner.id not in str(diagnostic)

        # Config-flow selectors and response shape use the pinned real Core.
        flow = flow_module.GenesisMeshConfigFlow()
        flow.hass = hass
        initial = await flow.async_step_user()
        assert initial["type"] == "form" and initial["step_id"] == "user"
        assert "app_url" not in str(initial["data_schema"])
        with patch.object(flow_module, "NativeClient") as pairing, patch.object(flow_module, "async_get_clientsession", return_value=object()):
            pairing.return_value.pair = AsyncMock(side_effect=policy.CompanionError("no"))
            failed = await flow.async_step_user({"pairing_code": "A-_bcDEF12345678"})
            assert failed["errors"] == {"base": "cannot_pair"}
        await coordinator.async_shutdown()
        await verify_real_application(hass, native)
        await hass.async_stop()
        print("Native companion: real Core service schemas, bounded identity, native-user rejection, system binding, disable, uncertain outcome, one-shot verification, diagnostics and pairing form passed. App/physical responses simulated.")


asyncio.run(main())
