# Product-owner review and acceptance scope

## Native jobs and installed Home Assistant acceptance

The native increment adds purpose-first observer/media jobs, real registry
room/device grouping, a single reviewed scope, a native companion integration,
one-time pairing and an actual participant-read verification. Each job targets
one resource; system workflows share the configured connection's identity.
Native user calls remain limited to the creator's active HA identity and entity
permissions. Existing native users and external agents are separate follow-ons.

Source review found target-binding bypass through the generic API, scope edits
that could change a job's target, and missing identity-metadata transitions.
All use shared validation now, with regression coverage. Reconnect rotates the
old credential, and reauthentication rejects a wrong-job code before consuming it.

Version `0.1.0-dev.5` passed all CI gates and was installed on the existing HA OS
server with its matching companion. An independent UX reviewer navigated the
real app, selected an existing eligible power measurement, created a read-only
job, paired through native HA configuration and verified the companion's actual
read and acknowledged signed record. No physical control was part of that check.
The original unsaved sharing tab was not navigated or applied.

Installed-server review identified additional experience improvements: reduce
initial picker density, keep navigation reachable, provide code-copy feedback,
preserve the job view during native setup, and show the observer's useful latest
snapshot. These are follow-up acceptance items, not evidence that a non-author
human novice has completed the journey. Future review records must distinguish
the published source from installed browser results and physical outcomes.

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
phone pairing or hardware-attested device enrollment. Advanced service-client
resource and operation selections form a compatible cross-product; native jobs
use one target. More exact per-resource grants across multiple targets,
additional bounds/time windows, human approvals and uncertain-result
reconciliation are follow-on work. Native registry grouping is implemented. Scenes
and scripts need their transitive target footprint reviewed before delegated
execution; generic service passthrough would undermine scoped access.

The accepted increment is a broader governed-access preview, not a claim that
an inventory screen has completed all-device household governance.
