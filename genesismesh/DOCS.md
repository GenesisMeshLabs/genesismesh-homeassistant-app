# Install and use

Requires Home Assistant OS (or a supported Supervisor installation), HA 2026.10
or newer, and an amd64 or aarch64 system. This is an experimental preview.

1. Add `https://github.com/GenesisMeshLabs/genesismesh-homeassistant-app` under
   Settings → Apps → App store → Repositories.
2. Install **Genesis Mesh**, start it, then choose **Open Web UI** as an HA
   administrator. No keys, tokens or JSON files need to be copied for setup.
3. Browse the whole-home inventory and choose what to share. Set heating bounds
   if selecting climate entities. Setup itself does not operate a device.
4. Choose resources, permitted operations and expiry for each requester. An
   observer can read without controlling anything. Save its private credential once.
   End access to block subsequent requests. Activity explains each result.

## Service clients

The private app-network service listener is port 8098. Its HA internal hostname
is the app's full slug with underscores replaced by hyphens; Supervisor displays
the full slug in app information. There is no host port, public URL, VPN or
remote enrollment in this preview. A client must be able to reach that internal
network. See the repository's `docs/development.md` for `/v1/resources` and
`/v1/actions`; use only the separate credential created for that client.

## Understand the limits

Only requests routed through this app are governed. HA automations, ordinary HA
controls, physical switches and vendor apps remain independent. Supported
controls include lights/brightness, switches, fans, media, blinds, climate,
humidifiers, vacuums and numeric/selection helpers, subject to native features.
Passive and other entity types can supply separately authorized status reads;
private location/free-text domains remain inventory-only. Scenes and scripts
remain visible but their transitive controls need a dedicated adapter.
HA acceptance is not
proof of a physical result. Never automatically repeat an uncertain action.

An observation is a timestamped snapshot. Its signed execution record binds the
sanitized observation digest without publishing the private raw reading into
the portable receipt. Custom sensor state can itself contain private data;
choose which readings to share deliberately. There is no automatic enrollment
of every discovered physical device and no continuous sensor subscription.

Existing client credentials keep their legacy operations when upgrading. Review
sharing once to finish the update, then use **Edit access** to grant additional
operations explicitly. Editing preserves the client credential and replaces its
signed membership; an interrupted edit leaves that profile disabled. Requests
already sent cannot be undone by editing or revocation.

The app holds its own online authority and signing keys in persistent private
data. Backups include those keys. Protect backups like credentials. Normal
updates preserve state; do not restore stale backups or copy data between
running installations. Backup rollback, recovery, migration, approvals, offline
grants and hardware-attested device enrollment remain future work.

## Updates

Images and release metadata are built and published automatically after the
software and container gates pass on `main`. Use HA's normal update control;
enabling automatic installation is your choice. Future publication requires no
local image builds or file uploads. Cold backups stop the app for consistency.

If startup fails, leave app data intact. Check the app log and report the version
and error without sending credentials, private data or backups. A failed access
update blocks requests until an administrator reviews and saves the selection.
