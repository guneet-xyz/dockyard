# Build setup

This recipe builds Dockyard from source and runs the default HTTP ingress. For HTTPS, follow [two-proxy setup](two-proxies.md) or [your own proxy only](custom-proxy.md) after preparing the environment.

```text
Browser / Docker CLI → localhost:3000 → Dockyard ingress
                                        ├── /v2/* → registry:5000
                                        └── other paths → web:3000
```

## 1. Requirements and checkout

- Docker Engine and Docker Compose v2.
- OpenSSL for secret generation.
- Free host port 3000, or choose a different ingress port.
- Internet access for upstream container images and build dependencies.

Node.js and pnpm are needed only for local application development, not for Docker builds. Run all commands below from the repository root.

```sh
git clone https://github.com/guneet-xyz/dockyard.git
cd dockyard
```

## 2. Generate and configure `.env`

```sh
./deploy/generate-env.sh
```

Skip this step if `.env` already exists. The script uses `.env.example`, generates four independent random secrets, sets file permissions to `0600`, never prints passwords, and refuses to replace files or symlinks. Keep this file out of Git.

For a local-only setup, use:

```dotenv
DOCKYARD_IMAGE_TAG=local
APP_URL=http://localhost:3000
INGRESS_BIND_ADDRESS=127.0.0.1
INGRESS_PORT=3000
```

The default template binds ingress to `0.0.0.0`; choose that intentionally if other machines need access. For a different port, change both `APP_URL` and `INGRESS_PORT`. For a remote deployment, `APP_URL` must be the URL reachable by browsers **and** Docker clients, not an internal container URL. It must have no trailing slash.

Keep `WEB_UPSTREAM_URL=http://web:3000` and `REGISTRY_UPSTREAM_URL=http://registry:5000` for the standard Compose network. Never send passwords over untrusted HTTP; use a proxy recipe for production HTTPS.

## 3. Build and start

```sh
docker compose --env-file .env \
  -f deploy/compose.yaml \
  -f deploy/compose.build.yaml \
  config --quiet

docker compose --env-file .env \
  -f deploy/compose.yaml \
  -f deploy/compose.build.yaml \
  up --build --wait --wait-timeout 240
```

`--wait` runs the stack detached and waits for health checks. On a slow machine, increase the timeout.

The build override selects four targets in the root `Dockerfile`:

| Image              | Responsibility                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `dockyard/init`    | Generate missing registry signing material, then exit.                                      |
| `dockyard/migrate` | Apply Drizzle migrations and create the first admin if the users table is empty, then exit. |
| `dockyard/web`     | Serve the UI, application APIs, and token endpoint.                                         |
| `dockyard/ingress` | Generate Caddy configuration from environment URLs and route public traffic.                |

PostgreSQL and Distribution use upstream images rather than local build targets. `init` and `migrate` showing **`Exited (0)` is normal**. Failed migrations prevent web startup. The default HTTP ingress has no mounts and does not need a Caddyfile.

The base Compose file has no build definitions. `--build` without `-f deploy/compose.build.yaml` does not build these images.

## 4. Verify the stack

```sh
docker compose --env-file .env -f deploy/compose.yaml ps --all
docker compose --env-file .env -f deploy/compose.yaml logs --tail=100 init migrate ingress web registry
curl -fsS http://localhost:3000/api/health
curl -i http://localhost:3000/v2/
```

Expected results:

- Web, registry, PostgreSQL, and ingress are healthy.
- Init and migration jobs exited successfully.
- `/api/health` returns `200` and a healthy status.
- Unauthenticated `/v2/` returns **`401`**, `Docker-Distribution-Api-Version: registry/2.0`, and a bearer challenge whose realm is `http://localhost:3000/api/registry/token`. A registry challenge is normal, not a failed deployment.

Open <http://localhost:3000> and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`. Accounts work in both the UI and Docker CLI. The initial UI has no fabricated images.

```sh
docker login localhost:3000
docker pull alpine:latest
docker tag alpine:latest localhost:3000/library/alpine:latest
docker push localhost:3000/library/alpine:latest
docker logout localhost:3000
docker pull localhost:3000/library/alpine:latest
```

Refresh the repository browser to see the pushed image. Public pulls work without signing in. Pushing requires a maintainer or admin. For a private image, reserve a private repository in the UI **before** its first push.

## Using prebuilt images

CI publishes all four images under `cr.guneet.dev/dockyard/` for `linux/amd64` and `linux/arm64`. See [CI/CD and releases](../releases.md) for the release/tag policy. In `.env`, set `DOCKYARD_IMAGE_PREFIX=cr.guneet.dev/dockyard` and `DOCKYARD_IMAGE_TAG` to an existing full released version (without the Git tag's `v` prefix), or `latest` to follow stable releases. Prefer a pinned full version in production, and wait for all four image-publication jobs to finish successfully.

```sh
docker compose --env-file .env -f deploy/compose.yaml pull
docker compose --env-file .env -f deploy/compose.yaml up --wait --wait-timeout 240
```

Do not include the build override in this mode. `local` is never published remotely. If the images are private, sign in to `cr.guneet.dev` before pulling, using a pull-only automation key. For an existing local cache using unqualified `dockyard/*` names, set `DOCKYARD_IMAGE_PREFIX=dockyard`; the new default prefix is `cr.guneet.dev/dockyard`. Changing the image prefix does not change volume names or runtime URLs.

## Rebuild, upgrade, and stop

Preserve `.env`, database data, registry blobs, and signing keys when upgrading:

```sh
docker compose --env-file .env \
  -f deploy/compose.yaml \
  -f deploy/compose.build.yaml \
  up --build --remove-orphans --wait --wait-timeout 240
```

If using a deployment-specific override, include that file in startup and operational commands too. Coordinate upgrades with your backup and maintenance process, especially when database migrations change the schema.

```sh
docker compose --env-file .env -f deploy/compose.yaml down
```

`down` preserves named volumes. **Do not add `-v` unless you intend to delete all persistent data.** Changing `ADMIN_PASSWORD` in `.env` does not reset an existing account; use the admin UI.

If startup fails, inspect `logs init migrate web registry ingress`. Check secret placeholders, port conflicts, the public URL, and job exit codes. Do not delete volumes to resolve a routine startup failure.

Next: [two proxies](two-proxies.md), [custom proxy without ingress](custom-proxy.md), or [reference](../reference.md).
