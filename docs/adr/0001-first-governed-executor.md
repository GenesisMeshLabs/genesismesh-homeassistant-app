# 0001: Prove the delegated executor before an HA interface

Status: accepted for the development proof, 2026-11-02. Production boundary
and independent security review remain pending.

## Decision

Use one TypeScript/Fastify service with the released Genesis Mesh SDK, a durable
SQLite operation journal implementing the SDK outbox interface, and two finite
HA REST adapters. Use a standard-tier evaluator broker to evaluate each mapped
participant's attestation. Keep a separate executor signing key. All subject
classes take the same path.

Current participants authenticate with distinct app-scoped random bearers. This
proves separation and the original-subject binding without falsely treating a
shared execution host's Mesh node identity as every person/agent behind it.
HA-user ingress authentication and native node enrollment will be separate
identity adapters when their actual assurance has been demonstrated.

Pin known policy versions/digests and NA signing identity explicitly. A changed
policy/key causes refusal pending deliberate update, rather than silent trust.
Fetch the stored evaluated context and compare its SDK digest and fields with
the exact request before dispatch. Reuse core protocol verification unchanged.

## Alternatives and tradeoffs

- An edge agent/node-scoped route naturally speaks for its enrolled node; it
  does not by itself attribute every guest/AI/device behind a multi-actor host.
  Leave that composition and grants for a separately proven profile.
- A new Python governed-lifecycle wrapper would duplicate mature SDK helpers.
  Use Python later only for a thin native HA integration when required.
- A full HA frontend now would obscure unresolved auth/privilege behavior.
  Begin with a backend proof and disposable real NA; use HA's native interfaces
  after the ingress/LLM spikes, rather than inventing another general dashboard.
- The standard evaluator remains a trusted, relatively broad NA credential.
  This is not per-user cryptographic administrative isolation; deploy per-home
  authority/custody boundaries and keep all privileged setup keys outside it.
- `node:sqlite` is experimental in the tested Node line. Its lock, transactions
  and crash behavior are tested here; support/migration strategy needs review
  before a supported release. It avoids a native addon in this first proof.

## Evidence and limits

The integration lab uses the released NA's CLI/API, real signed policies and
revocation, actual SDK evidence admission and offline verification. HA behavior
is simulated. Unit tests separately cover authentication, schema attacks,
duplicate concurrency, uncertain outcomes, writer locking and restart fencing.

No Docker runtime was available on this host, so HA OS/container packaging,
ingress security, native LLM identity and physical behavior remain open gates.
The proof does not replace or intercept existing HA/physical/vendor paths.
