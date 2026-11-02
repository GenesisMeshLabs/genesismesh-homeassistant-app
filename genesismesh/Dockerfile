# One pinned multi-platform base for build and runtime; no floating image tag.
FROM node:24.14.0-trixie-slim@sha256:8c8f12cedb96c3b59642cf30d713943c2b223990c9919b96a141681f62e6e292 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.web.json vite.config.ts ./
COPY src ./src
COPY tests ./tests
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:24.14.0-trixie-slim@sha256:8c8f12cedb96c3b59642cf30d713943c2b223990c9919b96a141681f62e6e292
ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.source="https://github.com/GenesisMeshLabs/genesismesh-homeassistant-app" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION" \
      io.hass.name="Genesis Mesh" io.hass.type="addon"
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 mesh && useradd --uid 10001 --gid mesh --no-create-home mesh \
    && python3 -m venv /opt/authority
COPY authority-requirements.txt authority-constraints.txt /opt/
RUN /opt/authority/bin/pip install --no-cache-dir -r /opt/authority-requirements.txt -c /opt/authority-constraints.txt
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist/src ./dist/src
COPY --from=build /app/web-dist ./web-dist
COPY genesismesh/entrypoint.sh /usr/local/bin/mesh-entrypoint
RUN chmod 755 /usr/local/bin/mesh-entrypoint
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=4 CMD node -e "fetch('http://127.0.0.1:8099/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/mesh-entrypoint"]
