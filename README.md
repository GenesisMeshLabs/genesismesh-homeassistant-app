# Genesis Mesh for Home Assistant

**Delegate useful control of your home to people, AI agents, machines and
devices, with limits you own and decisions you can verify.**

Status: **experimental preview**. The backend and HA ingress interface are
implemented, including automatic local-authority setup, scoped access and
activity. Software tests use real HA Core, the companion and Genesis Mesh
authority with simulated device responses. Native pairing and signed reads have
also been reviewed on an installed HA OS server. Physical controls and
non-author novice acceptance remain separate gates; see
[the verification record](docs/verification.md).

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

The app uses the same enforcement path for a person, agent, machine, device or
service. Its whole-home entity inventory offers governed observations and
finite controls for lighting, switches, fans, media, blinds, climate,
humidifiers, vacuums and numeric/selection helpers. Each profile chooses
resources and permitted operations, with signed decisions, exact request
binding, durable deduplication and execution evidence. Requests that time out
after dispatch remain uncertain and are never automatically repeated.

Read-only and unsupported entity types stay visible with explanations rather
than disappearing from the home. Discovery does not enroll a physical device as
a Mesh node. See [device coverage and permissions](docs/device-coverage.md).

The guided **Jobs** journey supports a native HA workflow connection: choose a
purpose, familiar room/device, enforced limits and expiry, pair the companion
integration, then verify its actual first read. Native observe, volume and
playback actions work in HA's existing automation editor. Each job has one
target. See [the native integration journey](docs/native-integration.md).

Service clients use separate app-issued bearer credentials mapped to authority
attestations. The ingress interface verifies a fresh native HA administrator
role for management and native-user requests. Native Mesh enrollment, hardware
identity, approvals and offline grants remain planned. See
[the managed app profile](docs/managed-app.md) and
[the backend boundary](docs/architecture.md).

## Home Assistant app

[Add this app repository to Home Assistant](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FGenesisMeshLabs%2Fgenesismesh-homeassistant-app),
then install **Genesis Mesh** and open its Web UI as an HA administrator.
See [installation and preview limits](genesismesh/DOCS.md).

Each push to `main` automatically verifies, builds and publishes versioned
amd64/aarch64 images, a prerelease, and install metadata. Failed checks preserve
the advertised version. See [release automation](docs/releases.md).

## Run the software checks

Requires Node.js 24.14 or newer within the 24.x line, and Python 3.12 or newer
for the disposable authority. Node's SQLite API is experimental in the verified
runtime; this is one reason the current build is a development preview.

```powershell
npm ci
npm test
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r authority-requirements.txt
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

The app is a TypeScript/Fastify service with an HA administrator interface,
released Genesis Mesh SDK, managed Python authority and SQLite journal/outbox.
The standalone service profile remains available. Native LLM tool identity,
household-user onboarding, approvals, recovery and federation remain next
steps. Tests do not operate an existing home. Published releases are
experimental; installation and physical acceptance are reported separately.
