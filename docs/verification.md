# Experimental app verification

Recorded 2026-11-02. Local checks ran on Windows, Node 24.14.0 and Python 3.14.3;
publication gates ran independently on GitHub-hosted Linux amd64/arm64 runners.
Dependency pins are in npm metadata, Python requirements/constraints, the
Dockerfile and the HA Core image fixture. This is software preview evidence,
not completion of the entire P0 program or physical/production acceptance.

## Product-owner increment

Fresh Windows verification after the independent review and fixes:

| Gate | Result and scope |
| --- | --- |
| Unit and contract tests | 39 passed |
| Real authority integration | 18 + 1 passed; expanded assertions cover signed volume ceilings, explicit changes, observation digest, usage, expiry/renewal, revocation and interrupted-edit recovery |
| Mocked browser regressions | Desktop 1280px, phone 390px, existing-home migration and 300-entity explicit selection/capacity passed; fixtures consume backend metadata |
| Independent real-backend browser acceptance | All 20 shipped capabilities across 51 resource/option cases passed through actual forms and signed authority decisions; access/read/limit/edit/revoke and desktop/phone flows passed |
| Product-owner review | Fix-now criteria accepted for experimental preview; remaining gaps recorded in [product acceptance](product-acceptance.md) |

`npm run test:browser:live` starts its own disposable app and real released
authority, then performs the browser acceptance. Supervisor peer/identity and
HA device responses are simulated. The independent browser test found and
verified fixes for select-label accessibility and the numeric-helper context
field; numeric intent remains strictly typed and the SDK metadata guard stays
enabled. No existing household devices are operated by these tests.

The increment was published as
[`0.1.0-dev.3`](https://github.com/GenesisMeshLabs/genesismesh-homeassistant-app/releases/tag/v0.1.0-dev.3).
Its [publication run](https://github.com/GenesisMeshLabs/genesismesh-homeassistant-app/actions/runs/41489172362)
passed the Linux software/browser gates, native amd64 and arm64 image smoke,
real HA Core identity and software helper controls, and native feature constants.
Anonymous access to the two-platform public image was independently verified.
The image index digest is
`sha256:a395a5184a7785a119d38ad5f17e73ffcd1166a81cc154de12caaaddfefc022d`;
tested source `eaa916cd525805a5fe95c4ee1defc791f59d89b3`.
The earlier published baseline evidence below is retained separately.

## Published 0.1.0-dev.2 baseline

| Check | Result | Scope |
| --- | --- | --- |
| TypeScript compilation | Passed | Included in unit and integration commands |
| `npm test` | 29 passed | Original executor boundaries plus native-role protocol, ingress peer and CSRF boundaries |
| `npm run test:integration` | 18 + 1 passed | Real released NA/SDK, HA API simulator, managed setup, scope/parameter denial, restart and revocation |
| Browser journeys | Passed at 1280px and 390px | Shipped Lit bundle; mocked API, setup/access/revoke/action/activity and nested ingress paths |
| Native amd64 and arm64 images | Passed on both runners | Fresh automatic authority, scoped machine, signed temperature denial, fresh native-role check, non-root PID 1, header spoofing refusal, persistent restart and revoke without dispatch |
| Real HA Core 2026.10.4 | Passed | Actual onboarding/auth, native owner/admin/regular/inactive users, role changes, unknown users and REST catalog; no physical dispatch |
| Anonymous image access | Passed independently | Public OCI index contains Linux amd64 and arm64; digest matches release |
| Automatic publication | Two iterations passed | Push to main produced immutable images, GitHub prerelease and bot-updated install metadata without manual tagging/uploads |
| Actual CLI startup | Passed in integration | Core-format key files, private config, ephemeral loopback listener, authenticated catalog |
| Signed evidence export | Passed | SDK offline verification of actual NA records; tampering refused |
| Evaluator privilege separation | Passed | Standard runtime key refused membership issuance and policy publication |
| `npm audit --omit=dev` | No reported vulnerabilities | Registry advisory result for runtime npm dependencies at this run; not a security certification |
| Python `pip check` | Passed | Installed test environment dependency compatibility |
| Git exclusion | Passed | Private plans, logs, generated fixtures, keys and venv excluded |

## Not performed or incomplete

- Actual HA OS/Supervisor app installation, ingress identity-header injection,
  appliance update/backup lifecycle, and physical lighting/climate hardware.
- Native LLM/MCP identity propagation and full native device enrollment.
- Novice household acceptance and independent security review.
- Node enrollment, key succession, approvals, offline grants, backup restore,
  federation, quotas and media/security-sensitive control.

The current service-client identity is app-bearer possession mapped to signed
membership, not native Mesh device enrollment or hardware attestation. A signed
executor report proves what the executor stated, not a physical device result.

## Environment issue and fixture retention

Initial Windows recursive fixture teardown failed with `EPERM`. A separate
automatic approval review rejected a removal attempt and supplied only
"blocked by policy". The cause of the filesystem error is not inferred to be
that policy. No security setting was changed and no alternate deletion route
was used. The runner now explicitly retains generated private lab fixtures under
ignored `temp/` for inspection, while stopping the services. Cleanup is not
reported as passed. Do not reuse those lab keys in a real home.

Local run logs: `temp/unit-results.log`, `temp/integration-results.log` and
`temp/python-install.log`. Independent review and deployment acceptance remain
future gates; software tests do not substitute for them.

## Published evidence

- [First automatic publication](https://github.com/GenesisMeshLabs/genesismesh-homeassistant-app/actions/runs/41412223157): `0.1.0-dev.1`.
- [Second automatic publication](https://github.com/GenesisMeshLabs/genesismesh-homeassistant-app/actions/runs/41412749024): `0.1.0-dev.2`, including real HA Core compatibility.
- [Release and immutable image digest](https://github.com/GenesisMeshLabs/genesismesh-homeassistant-app/releases/tag/v0.1.0-dev.2).

The second version's public index digest is
`sha256:dd23f3ad135705e4bfca9617d6a532f36faa698631e0b3e1c36db8fab2e2da46`.
Its tested source is `89435583fcf323481ac36aa66a073d61887ebe0c`.
Container smoke uses a simulated Supervisor proxy; the additional real Core
test establishes API/role compatibility, not HA OS or physical acceptance.
