# Product-owner review and acceptance scope

Reviewed against the user's requirements: useful whole-home coverage; people,
agents, machines and devices as participants; familiar novice UX; maintainable
access policies; official artwork; and repeatable publication. An independent
product-owner reviewer inspected the expanded implementation and supplied the
following concrete fixes, which were implemented before acceptance testing.

| Finding | Resulting behavior |
| --- | --- |
| Access creation resembles a successful connection | Profiles distinguish unused, last authenticated request, expired, revoked and interrupted edit; service-client boundary and connection steps are explicit |
| Numeric permissions offer little practical control | Profiles can enforce a signed, subject-specific volume ceiling; edits preserve the credential and deliberately change the bound |
| Controls begin with arbitrary/extreme minimums | Controls require intentional values/options; Celsius forms intersect device and household ranges |
| Activity cannot explain what happened | Records show actor, target, operation/value, observation or command outcome, readable refusal/recovery and signed-record delivery |
| Expiry forces needless recreation | Expired access can be reviewed and renewed; revoked credentials require a new profile |
| Large homes require tedious selection | Search/filter and explicit bulk selection show counts and the 256-resource boundary; nothing is automatically shared |
| Mocked screenshots hide real metadata issues | Browser fixtures consume actual backend metadata and a separate acceptance runner uses the real application and authority |

The independent reviewer runs actual browser journeys over the built interface,
including authenticated client requests and signed policy refusals. The lab
simulates Supervisor identity and HA device responses; a separate pinned real
HA Core job checks native identity/API/helper behavior. Neither establishes
physical-device or appliance lifecycle acceptance.

The independent real-backend browser pass covered all 20 shipped capability
categories in 51 resource/option cases, checking actual responses, signed
decision/evidence IDs and simulated command counts. It also proved read-only
refusal, a signed 40% volume ceiling denial, explicit ceiling change, credential
preservation and revocation. It found two additional application gaps during
testing: exact select-label accessibility and the numeric helper context's
generic `value` field conflicting with the SDK metadata guard. The field is now
an explicitly typed `numeric_setting` in decision context; the public/native
numeric value and metadata guard remain intact.

## Remaining product work

The preview does not yet provide native household-user invitations, direct
phone pairing or hardware-attested device enrollment. The current resource and
operation selections form a compatible cross-product; use separate profiles
when different devices need different operation rules. More exact per-resource
grants, additional bounds/time windows, native room/device registry grouping,
human approvals and uncertain-result reconciliation are follow-on work. Scenes
and scripts need their transitive target footprint reviewed before delegated
execution; generic service passthrough would undermine scoped access.

The accepted increment is a broader governed-access preview, not a claim that
an inventory screen has completed all-device household governance.
