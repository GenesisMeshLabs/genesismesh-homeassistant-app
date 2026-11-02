# Managed Home Assistant profile

The app starts its own pinned Python authority on loopback and persists its keys,
policies, participant scopes, executor journal and evidence outbox under
`/data/runtime`. Initial setup does not need a JSON file or an operator key
copied from another server. Normal app updates reuse this state.

Open the Web UI through HA ingress with an administrator account. Choose lights
and Celsius climate entities, set heating bounds, then create separate limited
access profiles. Access profiles have selected resources and an expiry. The
credential is shown once. Revocation stops subsequent requests; it cannot undo
a command already sent. Activity distinguishes policy refusal, pre-dispatch
failure, accepted-but-unconfirmed commands, and uncertain results.

## Privilege boundary

Only the actual Supervisor peer `172.30.32.2` may supply native identity headers.
Every API call checks the current user through HA's `config/auth/list` WebSocket
command. A native user must be active, non-system and an owner or member of
`system-admin`. Missing headers, unavailable role checks and non-admin accounts
fail closed. Mutations additionally require a short-lived user-bound CSRF nonce.
The sidebar's administrator flag is convenience, not authorization.

The Supervisor Core proxy credential has administrator capability. It stays on
the backend, as do the local root, admin, evaluator and executor keys. These all
share the container trust boundary; process separation is not a security
sandbox. The root is online local custody, not an offline sovereign root. App
backups contain signing keys. Backup rollback, key recovery and migration are
not supported workflows in this preview; preserve current data and avoid
restoring stale authority state.

Service clients use the internal app-network listener on port 8098. No public
host port is opened. Discovery, remote pairing, physical hardware identity and
native HA integrations are future work. Credentials identify possession of an
app profile, not a hardware-attested device. Every service request still goes
through the existing signature, exact-context, scope and policy checks.

Native HA controls, automations and vendor paths are outside this app. This is
not universal interception. An accepted HA HTTP response is not proof that a
physical device changed state. Requests with an unknown post-dispatch outcome
are fenced and never automatically replayed.

## Verification

The managed integration test uses the released real authority and HA simulator:
resource setup, machine access, permitted/refused temperatures, persisted
restart and revocation. Ingress tests cover socket-peer spoofing, native-role
changes and CSRF. Browser tests exercise the shipped bundle at 1280px and 390px,
including nested ingress paths. These are software gates, not HA OS or physical
acceptance. Run `npm test`, `npm run test:integration`, and `npm run test:web`.

The standalone loopback profile remains available and requires explicit
configuration. It never silently assumes Supervisor privileges.
