# Genesis Mesh for Home Assistant

**Delegate useful control of your home to people, AI agents, machines and
devices, with limits you own and decisions you can verify.**

Status: **development proof**. A runnable authenticated executor and a disposable
real-authority integration lab are implemented. This is not yet an installable
Home Assistant OS app, native integration or finished household interface.

Home Assistant connects devices, runs automations and supplies the everyday
home interface. This project adds a governed path for delegated requests:
identity, narrowly scoped access, parameter limits, approvals, expiry,
revocation and portable evidence. Participants can be people, agents, services,
controllers, computers or independently identified devices. A requesting device
and the device being controlled are separate concepts.

## Why this should exist

- Give a heating agent permission to set selected thermostats within a range,
  without giving it a general Home Assistant credential.
- Let a machine or controller request a specific action under its own identity,
  with the same policy checks as a human or AI agent.
- Give guests and technicians temporary, understandable access profiles.
- Explain which rule allowed or refused a request and what the executor
  subsequently reported, with independently verifiable records.
- Extend toward bounded offline operation and scoped cooperation between
  independently operated homes.

The first backend proof uses the same enforcement path for a person, agent,
machine, device or service. It supports explicit light on/off and Celsius
climate setpoints, with signed authority decisions, exact request binding,
durable request deduplication and signed execution evidence. Requests that time
out after dispatch remain uncertain and are never automatically repeated.

Authentication currently uses separate app-issued bearer credentials mapped to
authority attestations. Native Mesh enrollment, HA-user/ingress authentication,
hardware identity, visual access editing, approvals and offline grants are
planned. See [the implementation boundary](docs/architecture.md).

## Run the proof

Requires Node.js 24.14 or newer within the 24.x line, and Python 3.12 or newer
for the disposable authority. Node's SQLite API is experimental in the verified
runtime; this is one reason the current build is a development preview.

```powershell
npm ci
npm test
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r tests/authority-requirements.txt
npm run test:integration
```

On Linux/macOS use `.venv/bin/python` for pip. The integration runner selects
the platform's venv automatically, or accepts an explicit `GM_TEST_PYTHON` path.
It starts a new loopback authority from the pinned released core, exercises the
actual SDK and a finite **HA API simulator**, verifies the evidence export, and
stops its services. It does not connect to your existing authority or home.

Generated lab keys and artifacts remain under gitignored `temp/` for inspection.
They belong only to the disposable lab. A Windows cleanup permission failure
and a separately blocked cleanup command are recorded in the development notes;
the runner retains fixtures explicitly rather than silently ignoring teardown
errors or attempting to bypass policy. Never use lab keys in a real deployment.

See [development and API usage](docs/development.md) and the
[Genesis Mesh contract map](docs/genesis-mesh-contract.md). The
[verification record](docs/verification.md) separates passed software checks from
the remaining HA, platform and physical-device gates.

## Relationship to Home Assistant

Reuse Home Assistant's integrations, registries, automations, Assist/LLM APIs,
MCP transport where suitable, Companion notifications and native interfaces.
Do not create another general dashboard, voice assistant, automation engine,
mobile app or remote-access subscription.

The executor validates requests before dispatching approved actions to
Home Assistant. Existing direct Home Assistant access, automations, physical
controls and vendor paths do not automatically pass through it. Observing an
outside change is different from enforcing or attributing that change.

Genesis Mesh supplies the trust and governance primitives; the application
supplies Home Assistant semantics, trustworthy context, execution and UX.
The Python Network Authority remains the issuer of its signed decisions.

## Planning

The full local plan is [temp/plan.md](temp/plan.md). The entire `temp/` directory
is gitignored deliberately, alongside local data and credentials. It includes
the product proposition, overlap analysis, participant model, Genesis Mesh
capability map, architecture, ambitious scenarios, staged delivery, acceptance
criteria, risks and research references.

The plan is local working material and will not appear in a clone. Before
implementation milestones ship, promote their accepted decisions and user
documentation to tracked `docs/` files. Never ship a feature whose only operating
instructions remain in ignored planning files.

## Delivery direction

The first implementation is one TypeScript/Fastify service using the released
Genesis Mesh SDK and a SQLite journal/outbox. Next are the HA OS ingress and
privilege spike, then a small interface and a thin Python integration where
native LLM tools, automations or identity propagation require it. A standalone
container profile is also planned. No Docker/HA packaging acceptance is claimed
by the backend proof.

No live Home Assistant instance is changed by the development proof, and no
supported application release has been published.
