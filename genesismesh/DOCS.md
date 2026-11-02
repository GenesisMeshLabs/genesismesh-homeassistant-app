# Install and use

Requires Home Assistant OS (or a supported Supervisor installation), HA 2026.10
or newer, and an amd64 or aarch64 system. This is an experimental preview.

1. Add `https://github.com/GenesisMeshLabs/genesismesh-homeassistant-app` under
   Settings → Apps → App store → Repositories.
2. Install **Genesis Mesh**, start it, then choose **Open Web UI** as an HA
   administrator. No keys, tokens or JSON files need to be copied for setup.
3. Choose the lights and Celsius heating entities to expose and set heating
   limits. Setup itself does not operate a device.
4. Create limited access for each requester. Save its private credential once.
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
controls, physical switches and vendor apps remain independent. Only lights
on/off and Celsius setpoints are currently implemented. HA acceptance is not
proof of a physical result. Never automatically repeat an uncertain action.

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
