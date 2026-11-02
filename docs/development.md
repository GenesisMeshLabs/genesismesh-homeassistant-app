# Development and service clients

The managed app offers visual resource selection and access profiles; see
[the managed profile](managed-app.md). This document covers development and
service clients. Tests use a disposable authority and simulated devices rather
than an existing home.

## Requirements and checks

Node runtime requirements and exact npm dependency pins are in `package.json`;
`package-lock.json` locks their resolution. The Python authority pin exists
once in `authority-requirements.txt`. The runner checks the installed
distribution against that file and uses its public CLI, not a sibling checkout.
The Python transitive environment is not fully locked by that one core pin.

```powershell
npm ci
npm test
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r authority-requirements.txt
npm run test:integration
```

Use `.venv/bin/python` on Linux/macOS. `GM_TEST_PYTHON` may point to a specific
interpreter containing the pinned core. Docker and an existing HA instance are
not needed for this lab. Docker availability is still required to verify the
planned HA OS/container packaging, which has not been implemented here.

The integration proof shows:

- Five subject classes use one executor, with separate authority attestations.
- Standard-tier evaluator cannot mint membership or publish policies.
- Allowed light/setpoint requests execute; temperatures outside 19..23 C get
  signed DENY without HA dispatch. Boundaries themselves pass.
- Subject substitution, signed decision alteration, stored-context alteration,
  stale policy configuration and authority connection failure cannot open access.
- Repeated concurrent requests produce one HA command.
- Revocation stops a fresh agent request.
- Evidence upload failure stays pending and can be acknowledged without replay.
- A lost HA reply remains unknown and fences the target.
- An actual authority evidence export verifies offline; tampering is rejected.

The top-level integration test plus its nested scenarios appear separately in
Node's test count. Do not present that count as independently deployed features.

## Lab lifecycle and private artifacts

The runner creates a new `temp/authority-lab-*` directory, root/NA/setup/evaluator
keys, policies, memberships and executor. All listeners are numeric loopback.
No existing authority, user's HA configuration or hardware is contacted. Setup
uses a privileged disposable operator; the executor uses only a standard-tier
evaluator and separate execution signer.

The authority and simulator are stopped when the run finishes. Fixture data
including generated lab signing keys remains ignored locally. Initial teardown
encountered Windows `EPERM`; a separate recursive-removal command was refused
by automatic approval review with only "blocked by policy" supplied. No policy
settings were changed or alternate deletion route used. Fixture retention is
explicit in the runner output, rather than reporting cleanup as passed.
These fixtures are not production keys and must never be reused for a home.
Restrict local filesystem access; POSIX modes do not establish Windows ACLs.

## Standalone service-client profile

The executable entry point is `npm start -- <private-config.json>` after
`npm run build`. It listens only on `127.0.0.1:8099`. This is not an ingress
listener or public guest portal. Configuration is validated without coercion
or silently dropping unknown fields. The exact structure is `RuntimeConfig`
and `configSchema` in `src/contracts.ts`.

`GM_HA_PORT` changes only the numeric loopback port; `0` chooses an ephemeral
port for smoke tests. The bind host remains `127.0.0.1`.

An operator must provision:

- `homeId` and one persistent, privately accessible data directory.
- `authority`: URL, trusted public key, audience, sovereign ID, standard evaluator
  key ID/file, executor ID/key ID/file, and exact expected signed policy
  references per capability. Register the executor with a matching resource
  prefix such as `ha:home-id/`. Required policy enforcement and evidence store
  must be enabled on the authority.
- `homeAssistant`: API base URL and private token-file path. Endpoints require
  HTTPS outside numeric loopback. The Supervisor HTTP proxy is intentionally
  not accepted by this standalone profile; ingress requires separate testing.
- `principals`: unique ID, kind, random bearer digest, credential expiry,
  corresponding attestation ID, explicit resource IDs and `enabled` flag.
- `resources`: finite ID/name, HA entity ID and its exact domain as `kind`.
  Profiles also store explicit `capabilities`; a legacy missing field retains
  only original light/setpoint operations. See [coverage](device-coverage.md).

Dates use UTC ISO strings with millisecond precision. Private paths resolve
relative to the config file. Core key files may contain their standard comment
headers. Generate a different random >=32-byte bearer credential per subject;
store only its SHA-256 digest in config and deliver the credential privately.
Config changes require a restart in this preview. Membership/policy status is
checked live; no admin, invitation or policy-editing endpoint is exposed.

The local config is trusted operator input, not model-generated configuration.
Do not put it, signing keys or HA credentials in a model prompt or browser.

## Finite API

`GET /health` is liveness only; it does not establish authority/device readiness.
Other routes require `Authorization: Bearer <participant-credential>`.

- `GET /v1/resources`: this participant's configured resources and identity
  assurance. It does not promise the core will allow every listed action.
- `POST /v1/actions`: one exact request, below.
- `GET /v1/operations/<id>`: only the same subject may retrieve its operation.

```json
{
  "requestId": "00603e99-26b8-4d22-9af6-0f09cddbad80",
  "resourceId": "living-room-heating",
  "expiresAt": "2030-01-01T12:00:00.000Z",
  "capability": "ha.climate.set_temperature",
  "parameters": { "temperatureC": 21 }
}
```

Replace the example expiry with a time in the next two minutes and use a fresh
UUIDv4 request ID for a new intent. A retry of an existing intent must preserve
the entire body. Once it has expired, inspect its operation instead of sending
a new intent blindly. Light requests use `ha.light.set` and
`"parameters": {"state": "on"}` or `"off"`.

The response separates `commandState` and `evidenceState`, carries decision/
evidence IDs and lists failed policy gate names on a signed refusal. HTTP 200
means either an `observed` snapshot or that HA accepted a command; inspect
`commandState`. It does not establish a physical outcome. HTTP 202 means an
unknown command outcome. HTTP 403 is used for signed denial or refused local
scope/auth; inspect the response type. HTTP 503 is a blocked pre-dispatch or
executor failure. HTTP 409 means intent conflict or target reconciliation is
required. No response is permission to override a DENY or retry an unknown action.

## Remaining acceptance gates

P0-A: real HA OS ingress/user propagation, credential isolation and container
privileges. P0-D: native governed LLM tools and actual agent identity granularity.
Then P1: usable resource/participant onboarding and real-device verification.
Approvals, offline grants, recovery/restore and federation follow the local plan.

Checks passed on the current Windows host must not be described as Linux/arm64,
HA OS, native integration or physical acceptance. Existing HA automations and
direct/vendor/physical paths remain outside this executor's enforcement.
