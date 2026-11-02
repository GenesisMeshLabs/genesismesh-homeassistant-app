# Working on Genesis Mesh for Home Assistant

## Scope and product boundary

This repository is an application adapter, not Genesis Mesh core and not a
replacement for Home Assistant. Read `README.md` and the local `temp/plan.md`
when present. Distinguish proposed, implemented, tested and physically verified
behavior. A research baseline is not a dependency pin.

People, agents, machines and devices are first-class requesters. Keep requester,
owner, delegator, executor, observer, approver and target resource distinct.
Do not collapse all participants into one Home Assistant or executor identity.

## Trust and execution

- Consume released Genesis Mesh SDKs and classified public APIs. Do not copy
  signature verification, policy resolution, grants or evidence protocols.
- New application policy may narrow authority permission; it never expands it.
- Authenticate the original requester and bind exact targets, parameters,
  policy versions, approvals and context to the request that will execute.
- A healthy connection or join certificate does not authorize an action.
- Never silently turn a DENY or an outage into execution. Default to no
  break-glass fallback. Offline grants require a separately proven profile.
- Treat Home Assistant API credentials as privileged. Keep them, authority
  operator keys and root material out of the browser, model context and logs.
- Preserve native HA permissions where a native user is involved. Document
  paths outside the app; do not claim universal interception.
- An accepted command, a signed executor report and a physical outcome are
  different evidence levels. Never advertise physical exactly-once execution.

## Delivery

- Keep private plans, logs and local evidence under gitignored `temp/`.
- Work in small, reviewed features, starting each new feature with a clean
  worktree. Preserve others' changes; do not reset or silently include them.
- Create focused local commits after meaningful verification. Do not push,
  publish or change a live home merely because planning authorizes local work.
- Pin each dependency once in machine-readable metadata at implementation;
  update the lockfile through normal tooling. Keep stable and beta API use
  explicit. Do not claim a pinned release before it has been tested.
- Use official Genesis Mesh artwork. No generated replacement logos.
- Keep normal UI task-oriented. Raw keys, routes and protocol detail belong
  in collapsed diagnostics, with explanations and recovery actions.

## Verification

Test real boundaries: subject substitution, target expansion, parameter/unit
changes, expired/revoked access, replay, stale state, policy races, approval
binding, crashes around dispatch and unavailable evidence storage. Use a
disposable authority and HA simulator before physical devices. Report mocks,
real API integration, platform packaging and physical outcomes separately.

Before production claims, obtain independent review and physical acceptance.
Do not request or spawn background agents without user authorization or an
applicable instruction authorizing delegation.
