# First executor architecture

Status: P0-B/C development proof, not the entire product plan. The remaining P0
gates are real HA OS ingress/privilege testing and native LLM/MCP identity
propagation. There is no end-user UI, HA integration or physical acceptance yet.

## Product boundary

The service accepts an authenticated participant's exact requested action,
obtains a policy-bound Genesis Mesh decision, verifies the evaluated request,
dispatches through a finite HA adapter and records the executor's report.
HA remains the device integration and automation system.

The same implementation accepts `person`, `agent`, `machine`, `device` and
`service` participants. These labels describe separately credentialled subjects;
they do not prove a human is present, an AI is independent or a device holds a
hardware key. Current assurance is **app-bearer-possession**.

## Authentication and authority

Each participant has a different high-entropy bearer credential. The operator
configures only its SHA-256 digest, expiry, subject, attestation and resources.
These must not be passwords. Callers cannot choose their subject, attestation,
home, HA entity ID, policy context, service name or credentials in an action.

The server maps the authenticated subject to its attestation and verifies the
attestation signature and subject. The authority then evaluates its current
status and policies. Online revocation is exercised against the actual NA.

The broker uses a **standard-tier evaluator key**, separate from its executor
key. The real test proves that this evaluator cannot mint memberships or publish
policy. It can still evaluate/read more of its NA than the application exposes:
this is a trusted broker, not a cryptographically per-home-scoped core operator.
Use isolated per-home authority/process custody until stronger narrowing is
proven. Do not give this key or the HA API credential to a participant or agent.

The current trust profile pins one explicitly configured NA public key and
audience. It does not perform root ceremony, key-history succession or automatic
re-pinning. A signing-key change fails verification until deliberately configured
and tested; this profile must not be advertised as full key lifecycle support.

Native HA users/permissions and ingress identity are not implemented. There is
no claim that these app credentials restrict an ordinary unrestricted HA account
or that their subjects have completed native Mesh node enrollment.

## Exact request, policy and dispatch

The compiler accepts two finite action contracts: `ha.light.set` (`on`/`off`)
and `ha.climate.set_temperature` (explicit Celsius setpoint). Each targets one
configured resource/entity. Additional fields, type coercion, duplicate JSON
keys, implicit "all", templates, arbitrary services and arbitrary URLs are
refused. Requests expire within two minutes; dispatch is not delayed indefinitely.

The app digest commits to the requester, home, resource/entity, action,
parameters, compiled HA command, adapter version, request ID and expiry. These
fields are carried through the authority-evaluated context. The SDK signs and
verifies protocol records; the app does not implement its own trust verifier.

Before dispatch:

1. Require a healthy NA policy set with required enforcement and the exact
   configured policy IDs, versions and digests. Verify policy signatures.
2. Use SDK `governedAction` with the authenticated subject's attestation and
   explicit expected policies and attestation. No break-glass fallback is set.
3. Read the authority-stored decision context. Verify its digest against the
   signed `policy_binding.context_digest` using SDK canonicalization; compare
   every expected context field, exact operation parameters, subject and parties.
   The request-context maximum age is ten seconds.
4. Preflight the exact HA entity. For climate, verify HA's Celsius unit system
   and device min/max. The adapter does not infer units or switch HVAC modes.
5. Check active expected policies and membership again, plus signed decision,
   intent and credential expiry immediately before reserving dispatch state.

A policy change can make the app refuse until its expected-policy configuration
is updated. It never silently accepts a broader policy. Any additional applicable
policy must also match the SDK's expected decision bindings.

The HA call is one exact REST service invocation. Native automations may react
to it, and devices may have their own behavior. The app does not constrain every
indirect physical effect. No atomic transaction spans NA, HA and hardware; a
small revocation/policy race remains between the final check and dispatch.

## Journal and outbox

`node:sqlite` stores operation state, verified context artifacts and a custom
implementation of the SDK's **public EvidenceOutbox storage interface**. It is
not a new evidence format. SQLite uses full synchronous writes. A separate
exclusive SQLite writer lock prevents concurrent executors using one directory.
The whole executor queue is serialized to keep resource/evidence ordering clear.

An operation is durably reserved by subject + request ID + digest before external
dispatch. Concurrent identical requests return the same operation; changing an
existing request ID's intent produces a conflict. HA calls have no automatic
retries or redirect following. Origin-bearing browser calls are refused in this
service-client preview; ingress/session authorization is a future profile.

State axes are independent:

| Command | Meaning |
| --- | --- |
| `reserved` | Has not entered dispatch |
| `denied` | Signed authority decision refused the request |
| `blocked` | Pre-dispatch verification/availability failed; no HA action sent |
| `dispatching` | Durable marker written immediately before HA request |
| `accepted` | HA returned success; physical effect unconfirmed |
| `outcome_unknown` | Response uncertain, or restart interrupted dispatch; do not repeat |

Evidence is `none`, `pending`, `acknowledged` or `needs_attention`. SDK outbox
add/update/ack updates the operation in the same local transaction, including
failure records from an executor callback that stopped before HA dispatch.
Evidence delivery is not physical outcome confirmation.

On restart, an interrupted reservation becomes blocked and interrupted dispatch
becomes unknown. A resource with an unknown action or accepted action whose
evidence needs attention is fenced against new requests. There is deliberately
no unsafe "clear and retry" endpoint. Recovery/reconciliation UX remains work.
Do not restore/clone an old operation database and advertise replay protection;
backup recovery and offline grants are not supported in this first profile.

The queue is bounded at 32 jobs. API bodies are limited to 4 KiB and HA preflight
responses to 64 KiB. Data retention, operator diagnostics, richer health, rate
limits and target-specific concurrency require later product work.

## What verification establishes

Unit tests exercise identity/scope/schema, finite adapters, request concurrency,
storage failures, writer exclusion and restart behavior. Integration runs use
the pinned **released Python NA** via its public CLI and the released SDK,
including actual signed policies, revocation, evidence admission and offline
export verification. HA is a local API simulator, not a real installation.

No test establishes HA OS ingress behavior, native HA-user restriction,
native AI/client identity, app sandboxing, Docker image behavior, Linux/arm64
execution or physical device results. Independent review is still required.

## Sources

- [Genesis Mesh governed actions](https://github.com/GenesisMeshLabs/sdk-typescript/blob/v1.8.1/docs/governance.md)
- [Attestation evaluation boundary](https://github.com/GenesisMeshLabs/genesismesh/blob/v1.8.1/docs/examples/attestation-backed-evaluation.md)
- [HA REST API](https://contributors.home-assistant.io/core/internals/rest-api/)
- [HA app Core API privilege](https://contributors.home-assistant.io/apps/guides/communication/)
- [HA ingress identity boundary](https://contributors.home-assistant.io/apps/guides/ingress/)
