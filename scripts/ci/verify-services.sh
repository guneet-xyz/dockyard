#!/usr/bin/env bash
# Checks a running Compose stack (started from deploy/compose.yaml with .env):
# one-off jobs succeeded, web has no migration leftovers or admin secret, and
# only ingress publishes ports. Shared by CI and the release smoke tests.
set -euo pipefail

compose() {
  docker compose --env-file .env -f deploy/compose.yaml "$@"
}

for service in init migrate; do
  container=$(compose ps --all --quiet "$service")
  test "$(docker inspect --format '{{.State.Status}}' "$container")" = exited
  test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0
done
# shellcheck disable=SC2016 # Expanded inside the web container.
compose exec -T web sh -c 'test ! -e dist/migrate.cjs && test ! -d drizzle && test -z "$ADMIN_PASSWORD"'
for service in web registry; do
  container=$(compose ps --quiet "$service")
  test "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$container")" = 0
done
container=$(compose ps --quiet ingress)
test "$(docker inspect --format '{{len .Mounts}}' "$container")" = 0
