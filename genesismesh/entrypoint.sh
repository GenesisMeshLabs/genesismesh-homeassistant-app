#!/bin/sh
set -eu
umask 077
# HA creates /data as root. Only our fixed private subdirectory is owned by mesh.
mkdir -p /data/runtime
chown -R 10001:10001 /data/runtime
chmod 700 /data/runtime
exec setpriv --reuid=10001 --regid=10001 --init-groups --no-new-privs node /app/dist/src/ha-app.js
