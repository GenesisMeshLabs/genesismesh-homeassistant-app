# Genesis Mesh for Home Assistant

**Delegate useful control of your home to people, AI agents, machines and
devices, with limits you own and decisions you can verify.**

Status: planning scaffold. No runnable app, integration, device enforcement or
security guarantee is implemented in this repository yet.

Home Assistant connects devices, runs automations and supplies the everyday
home interface. This project will add a governed path for delegated requests:
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

These are planned outcomes, not shipped features. Initial implementation will
prove the same enforcement path for a human, an agent and a machine, using
low-risk lighting and climate actions.

## Relationship to Home Assistant

Reuse Home Assistant's integrations, registries, automations, Assist/LLM APIs,
MCP transport where suitable, Companion notifications and native interfaces.
Do not create another general dashboard, voice assistant, automation engine,
mobile app or remote-access subscription.

The proposed app validates requests before dispatching approved actions to
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

## Proposed delivery

Home Assistant OS app with an ingress interface, plus a standalone container
profile for Home Assistant Container. Start with one TypeScript service using
the Genesis Mesh SDK. Add a thin optional Home Assistant integration only where
native LLM tools, automations or identity propagation require it. Validate these
choices in short feasibility spikes before making runtime commitments.

No release, runtime dependency installation or Home Assistant instance has been
created or changed by this planning scaffold.
