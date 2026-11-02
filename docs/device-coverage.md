# Whole-home roles and device coverage

Home Assistant exposes entities: one physical device may have several, while a
helper may have no physical device. The administrator inventory shows every
valid entity domain returned by HA, including read-only, unavailable and
unsupported types. Discovery does not enroll devices as Genesis Mesh nodes or
authorize them to act.

Choose resources, then give each person, agent, machine, device or service an
explicit set of operations and an expiry. Operation selections apply wherever
supported across that profile's selected resources. The released authority
checks signed capability claims; the app additionally narrows resources and
operations locally. An observer can read without writing. Templates fill a
reviewable selection; they do not override policies.

| Entity type | Current controls |
| --- | --- |
| Lights | On/off, brightness |
| Switches and on/off helpers | Explicit on/off |
| Fans | On/off, speed where supported |
| TVs and media players | Playback, power, mute, volume where supported |
| Blinds, shades, curtains, shutters | Open/close/stop/position where supported |
| Climate | Bounded Celsius setpoint and native mode selection |
| Humidifiers | On/off and target humidity |
| Vacuums | Start/pause/stop/return to base where supported |
| Numeric entities/helpers | Native-range value and step |
| Selection entities/helpers | Native option selection |
| Sensors and other readable types | Separately authorized current state |
| Scenes, scripts, automations and buttons | Status; transitive action scope not yet implemented |
| Locks, alarms, entry doors and garages | Status; no entry/security control adapter |
| People, device trackers and free-text entities | Inventory only pending dedicated private-data adapters |

Every control rechecks native service availability, entity identity, supported
features/options, ranges and applicable native steps before one exact target is
sent. There is no generic service, URL, template or multi-target passthrough.
An unknown post-dispatch result is never automatically replayed.

## Observation evidence

`ha.entity.read` returns only a bounded state, curated attributes and observation
time after a fresh authority decision. Pictures, coordinates, media URLs,
credentials and arbitrary attributes are not forwarded. An arbitrary custom
sensor's state may itself contain private text: deliberately choose what to
share rather than treating all state as public. This is request-based access,
not continuous telemetry, a historian or proof of physical correctness.

The pinned SDK has no resource-chain `read` action. Each governed observation
therefore creates its own observation artifact under the home's registered
prefix, with the exact target/request in decision context and the observation
digest in the signed executor report. This uses released APIs and does not
invent a core protocol action. Read evidence failures do not fence physical
writes or clear an existing uncertain-write fence.

## Existing homes

Profiles saved without explicit operation fields retain only the original
light on/off and temperature capabilities, still limited by their original
signed membership and resource list. They never inherit new reads/controls.
The administrator reviews and saves sharing to pin the expanded policy set.
Editing an access profile deliberately replaces membership and preserves its
bearer credential. Edits disable access durably before issuing replacement
membership, so an interrupted edit cannot silently widen access.

The management queue is bounded to 32 pending operations and activity queries
read at most 50 recent records. Persistent evidence history has no automatic
retention policy; high-frequency monitoring is not a supported workload yet.

API and feature references: [HA REST](https://contributors.home-assistant.io/core/internals/rest-api/),
[media player](https://www.home-assistant.io/integrations/media_player/),
[fan](https://www.home-assistant.io/integrations/fan/).
