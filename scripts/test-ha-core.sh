#!/usr/bin/env bash
set -euo pipefail
name="gm-ha-core-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
fixture="$(mktemp -d)"
cleanup() { docker logs "$name" || true; docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cat > "$fixture/configuration.yaml" <<'CONFIG'
homeassistant:
  name: Genesis Mesh disposable compatibility test
  unit_system: metric
  country: SE
http:
api:
websocket_api:
auth:
config:
onboarding:
person:
input_boolean:
  mesh_fixture:
    name: Disposable native switch
    initial: false
input_number:
  mesh_fixture:
    name: Disposable native number
    min: 0
    max: 20
    step: 1
    initial: 5
input_select:
  mesh_fixture:
    name: Disposable native choice
    options: [Quiet, Normal]
    initial: Quiet
CONFIG
image="$(cat tests/ha-core-image.txt)"
docker run -d --name "$name" -p 127.0.0.1:8123:8123 -v "$fixture:/config" "$image"
node scripts/test-ha-core.mjs
docker exec -i "$name" python - <<'PY'
from homeassistant.components.media_player.const import MediaPlayerEntityFeature as M
from homeassistant.components.fan.const import FanEntityFeature as F
from homeassistant.components.cover.const import CoverEntityFeature as C
from homeassistant.components.vacuum.const import VacuumEntityFeature as V
from homeassistant.components.climate.const import ClimateEntityFeature as H
assert [int(v) for v in (M.PLAY, M.PAUSE, M.STOP, M.NEXT_TRACK, M.PREVIOUS_TRACK, M.TURN_ON, M.TURN_OFF, M.VOLUME_SET, M.VOLUME_MUTE)] == [16384, 1, 4096, 32, 16, 128, 256, 4, 8]
assert [int(v) for v in (F.SET_SPEED, F.TURN_OFF, F.TURN_ON)] == [1, 16, 32]
assert [int(v) for v in (C.OPEN, C.CLOSE, C.SET_POSITION, C.STOP)] == [1, 2, 4, 8]
assert [int(v) for v in (V.START, V.PAUSE, V.STOP, V.RETURN_HOME)] == [8192, 4, 8, 16]
assert int(H.TARGET_TEMPERATURE) == 1
print('Finite adapter feature constants match the pinned real HA Core release.')
PY
