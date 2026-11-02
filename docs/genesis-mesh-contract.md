# Genesis Mesh contract used by the first proof

The actual SDK dependency pin is in `package.json`; the test authority pin is in
`authority-requirements.txt`. The implementation consumes released packages.
Compatibility claims below refer to the pinned core's classified public surface,
not to every feature in the longer local roadmap.

| Operation | Runtime use | Classified maturity |
| --- | --- | --- |
| `GET /admin/boundary-policies/active` | Require healthy enforcement and configured signed policy versions | Stable |
| `GET /attestations/<attestation_id>` | Verify the mapped subject; refresh current status before dispatch | Stable |
| `POST /admin/boundary/evaluate` | Exact attestation-backed policy decision, through standard-tier broker | Stable |
| `GET /admin/evidence` | Retrieve context committed by the signed decision, compare exact request | Stable |
| `GET /admin/evidence/resource-heads/<resource_id>` | SDK resource/evidence ordering | Stable |
| `POST /evidence/execution` | Signed executor report and durable pending delivery | Stable |

The lab additionally uses the public initialization/key-generation CLI and setup
routes for policy publication/activation, membership issuance/revocation and
executor registration; export/executor-key reads exercise offline verification.
Those privileged setup functions are not exposed by the runtime API.

SDK reuse includes strict JSON/canonicalization/digests, signature verification,
policy and attestation binding, `governedAction`, `ExecutionRecorder` and the
public evidence-outbox interface. The application stores SDK outbox entries in
SQLite with operation-delivery updates in the same transaction.

No custom core gate, signature format, core record kind or trust resolution
algorithm has been added. The app compares the complete stored ContextRecord
digest using SDK canonicalization because the generic helper's context ID check
alone does not compare every HA parameter. App operation digests are distinct
from core context digests and are carried as evaluated request metadata.

Not integrated yet: node enrollment/renewal, key history/horizons, root bootstrap,
native ingress/users, native AI tools, treaties, agreements, data-usage policies,
approval workflow, observations/reviews/remediation, audit packs/anchors,
offline grants or the edge agent. No beta route is required by this proof.
The runtime supplies no break-glass fallback; offline execution is unsupported.
