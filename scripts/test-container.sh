#!/usr/bin/env bash
set -euo pipefail
image="${1:?image required}"
suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
network="gm-smoke-$suffix"
app="gm-app-$suffix"
supervisor="gm-supervisor-$suffix"
volume="gm-data-$suffix"
cleanup() {
  docker logs "$app" || true
  docker rm -f "$app" "$supervisor" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create --subnet 172.30.32.0/24 "$network"
docker volume create "$volume"
docker run -d --name "$supervisor" --network "$network" --ip 172.30.32.2 --network-alias supervisor \
  --entrypoint node -v "$PWD:/fixture:ro" -w /fixture "$image" scripts/container-smoke.mjs serve
docker run -d --name "$app" --network "$network" --ip 172.30.32.4 \
  -e SUPERVISOR_TOKEN=container-fixture-only -v "$volume:/data" "$image"
docker exec "$supervisor" node scripts/container-smoke.mjs first
test "$(docker exec "$app" id -u)" = "0" # docker exec defaults root; verify actual application PID separately.
docker exec "$app" node -e "const fs=require('fs');if(!/^Uid:\\s+10001\\s+10001\\s+10001\\s+10001$/m.test(fs.readFileSync('/proc/1/status','utf8')))process.exit(1)"
docker exec "$app" node -e "fetch('http://127.0.0.1:8099/api/status',{headers:{'X-Remote-User-Id':'ha-owner','X-Forwarded-For':'172.30.32.2'}}).then(r=>{if(r.status!==403)process.exit(1)})"
docker restart "$app"
docker exec "$supervisor" node scripts/container-smoke.mjs restart
echo 'Container software smoke passed. Supervisor/Core proxy is simulated; no physical claims.'
