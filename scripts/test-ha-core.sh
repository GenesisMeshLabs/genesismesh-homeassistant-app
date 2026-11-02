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
CONFIG
image="$(cat tests/ha-core-image.txt)"
docker run -d --name "$name" -p 127.0.0.1:8123:8123 -v "$fixture:/config" "$image"
node scripts/test-ha-core.mjs
