# Development-proof verification

Recorded 2026-11-02 on Windows, Node 24.14.0, npm 11.11.1 and Python 3.14.3.
Dependency pins are in the npm manifest/lock and Python authority requirements.
This records P0-B/C evidence, not completion of the entire P0 program or a
production/physical acceptance claim.

| Check | Result | Scope |
| --- | --- | --- |
| TypeScript compilation | Passed | Included in unit and integration commands |
| `npm test` | 25 passed | Authentication/config, strict request validation, finite adapters, concurrent duplicates, uncertain outcomes, writer exclusion across processes, restart/outbox persistence |
| `npm run test:integration` | 18 passed | One top-level test with 17 scenarios; real released NA/SDK plus HA API simulator |
| Actual CLI startup | Passed in integration | Core-format key files, private config, ephemeral loopback listener, authenticated catalog |
| Signed evidence export | Passed | SDK offline verification of actual NA records; tampering refused |
| Evaluator privilege separation | Passed | Standard runtime key refused membership issuance and policy publication |
| `npm audit --omit=dev` | No reported vulnerabilities | Registry advisory result for runtime npm dependencies at this run; not a security certification |
| Python `pip check` | Passed | Installed test environment dependency compatibility |
| Git exclusion | Passed | Private plans, logs, generated fixtures, keys and venv excluded |

## Not performed or incomplete

- Docker/HA OS/container packaging: Docker executable was unavailable here.
- Native HA integration, ingress identity and LLM/MCP identity propagation.
- Real HA instance and physical lighting/climate hardware.
- Linux/arm64 runtime checks, browser/novice UX and independent security review.
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
