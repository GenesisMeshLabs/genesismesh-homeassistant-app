#!/usr/bin/env bash
set -euo pipefail
ref="$IMAGE:$VERSION-$ARCH"
if docker manifest inspect "$ref" >/dev/null 2>&1; then
  docker pull "$ref"
else
  docker buildx build --load -f genesismesh/Dockerfile --build-arg VERSION="$VERSION" --build-arg REVISION="$GITHUB_SHA" -t "$ref" .
fi
test "$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$ref")" = "$GITHUB_SHA"
test "$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$ref")" = "$VERSION"
bash scripts/test-container.sh "$ref"
# Immutable version tags: existing tags are tested and reused, never replaced.
if ! docker manifest inspect "$ref" >/dev/null 2>&1; then docker push "$ref"; fi
