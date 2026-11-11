#!/usr/bin/env bash
# Pushes and pulls an image with the Docker CLI through the running stack's
# ingress and checks the pull count. Shared by CI and the release smoke tests.
set -euo pipefail

set -a
# shellcheck source=/dev/null
. ./.env
set +a
registry=$(node -e 'console.log(new URL(process.env.APP_URL).host)')
DOCKER_CONFIG=$(mktemp -d "${RUNNER_TEMP:-/tmp}/dockyard-docker.XXXXXX")
export DOCKER_CONFIG
printf '%s' "$ADMIN_PASSWORD" | docker login "$registry" --username "$ADMIN_USERNAME" --password-stdin
docker pull alpine:3.23
docker tag alpine:3.23 "$registry/ci/alpine:3.23"
docker push "$registry/ci/alpine:3.23"
docker logout "$registry"
docker pull "$registry/ci/alpine:3.23"
# Docker resolves tags with HEAD; the pull counts once and an immediate repeat does not.
docker pull "$registry/ci/alpine:3.23"
pulls() {
  curl -fsS "$APP_URL/api/repositories/ci/alpine" | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).repository.pullCount))'
}
for _ in $(seq 30); do
  [ "$(pulls)" = 1 ] && break
  sleep 1
done
sleep 3
test "$(pulls)" = 1
