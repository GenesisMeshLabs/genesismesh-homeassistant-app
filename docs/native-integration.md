# Give your existing Home Assistant a bounded job

The app keeps the authority, policies and signed records. The native **Genesis
Mesh** integration makes a scoped connection available in HA's existing action
and automation editor. No general HA token is handed to a service client.

## First setup

1. Install/start the Genesis Mesh app and open its Web UI as an HA administrator.
2. Choose **Give something a job**, then an observer or media purpose. Pick one
   device, its operations, expiry and volume cap where applicable. Review the
   complete permission sentence before creating it.
3. If the device is not already eligible for Mesh, explicitly confirm that one
   addition during review. Other devices and existing participants do not gain
   permission. New discoveries are never automatically granted.
4. Install the companion integration once. With HACS already available, add
   this repository as a custom **Integration**, enable prereleases and install
   **Genesis Mesh**; subsequent versions use its normal update controls. This is
   a custom repository, not a claim of inclusion in the official catalog.
   Alternatively download the integration ZIP from the job's connection guide
   or the matching release. Extract it into HA's configuration directory so
   `custom_components/genesismesh/manifest.json` exists, then restart Core.
5. Choose **Get a connection code** and **Open Home Assistant integration setup**.
   Add **Genesis Mesh** and enter the short-lived code. The usual flow needs no
   internal address. Advanced address supports a nonstandard app slug.
6. Return to the job, check the connection, then choose **Test this connection**.
   The actual companion performs a permitted status read. Only its acknowledged
   signed observation marks the first request verified. This check sends no
   device control.

Each native integration entry is named after its job. Pairing codes expire after
ten minutes and are single use; the actual credential stays server-side. Use the
job's deliberate reconnect flow if its integration was removed or lost. Replacing
the connection invalidates its previous credential. Existing HA automations may
need to select the replacement integration entry if its entry ID changed.

## Use normal Home Assistant actions

In HA's automation editor or Developer tools → Actions, choose one of:

- **Genesis Mesh: Observe a job's device** — a curated status snapshot.
- **Genesis Mesh: Set volume within a job's limits** — a bounded volume request.
- **Genesis Mesh: Control playback for a job** — supported play/pause/stop/track.

Choose the paired connection in the native selector. Its target and Mesh
identity are bound by the connection; actions cannot accept arbitrary profiles,
credentials, actors or targets. HA's existing triggers and schedules choose
when to invoke it. Responses include decisions, results and evidence state;
app policy refusals appear as native action errors and are explained in Activity.
Native HA permission or local scope checks can refuse before the app is called;
those appear in HA's action error/trace rather than a Mesh execution record.

The authenticated actor is the **HA workflow connection**, not an individual
automation. HA system workflows using that connection share its permission.
Native user calls are limited to the creating owner's active native identity
and applicable entity permissions. A missing user context is accepted only on
this explicitly configured system-workflow route.

An accepted control is not proof of a physical change. A lost response is never
automatically retried with a new request. Check Activity and the device first.

## Change or end access

Use **Edit limits** to change expiry or volume ceiling; repeat verification
after a change. The target stays fixed. Create a new job for another device.
**End this job** refuses subsequent requests; it cannot undo a sent command.
Registry/device identity changes stop requests instead of silently following a
replacement. Unregistered entities are entity-bound, not hardware-attested.

Ordinary HA dashboards, existing automations, Assist tools and vendor paths
remain independent unless explicitly connected through a governed route.
Household-user onboarding, Assist tools, approvals and offline grants are later
increments, not enabled by this workflow connector.

## Compatibility and updates

Initial tested native baseline: HA Core **2026.10.4**, protocol **1**. Every tested
app release automatically publishes a matching integration ZIP/checksum and a
HACS-format ZIP. HACS can handle subsequent integration updates; the app uses
normal HA app updates. Neither silently overwrites HA configuration code.
Manual ZIP installations require replacing that integration's files on update.

The existing service-client API remains under Advanced. No public host port is
opened. Config-entry credentials and app authority keys are included in their
respective HA backups; protect backups.

Software verification uses real Core actions, actual companion HTTP, the app
and released authority with simulated device responses. Installed HA OS, novice
usability and physical-device outcomes are separate acceptance gates.
