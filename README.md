# Dockyard

A self-hosted Docker / OCI registry with a polished Next.js + shadcn UI, PostgreSQL + Drizzle, guest browsing, and role-based access control for both the browser and Docker CLI.

## Features

- Searchable repositories and image tags, platform/digest details, and copyable Docker commands.
- Public guest pulls and authenticated access to private repositories.
- Viewer, maintainer, and admin roles; user management and audit history.
- One public endpoint for the UI and registry API, with streaming image transfers.
- Separate `init`, `migrate`, `web`, and environment-configured `ingress` images.
- Docker Compose deployment, persistent data, pnpm, and Prettier with `semi: false`.

## Choose a setup

| Setup                   | When to use it                                                                                       | Instructions                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Build setup**         | Build the images from this checkout and run Dockyard with its own HTTP ingress.                      | [Build and run locally](docs/deployment/build.md)                   |
| **Two-proxy setup**     | Your existing edge proxy terminates HTTPS, then forwards all paths to Dockyard's HTTP ingress.       | [External proxy + Dockyard ingress](docs/deployment/two-proxies.md) |
| **Your own proxy only** | Your proxy routes `/v2/*` to the registry and everything else to web; Dockyard ingress does not run. | [Replace Dockyard ingress](docs/deployment/custom-proxy.md)         |

Both proxy setups keep the UI, token endpoint, and Docker Registry API on the **same public hostname**. Dockyard still issues scoped authorization tokens and Distribution still enforces them; your proxy must not replace client authorization with an admin/service token.

## Quick start: build setup

Requires Docker Engine, Docker Compose v2, and OpenSSL. No host Node.js installation is needed. Run from the repository root:

```sh
./deploy/generate-env.sh
docker compose --env-file .env \
  -f deploy/compose.yaml \
  -f deploy/compose.build.yaml \
  up --build --wait --wait-timeout 240
```

If `.env` already exists, keep it and skip generation. The generator refuses to overwrite existing configuration. For localhost-only access, set `INGRESS_BIND_ADDRESS=127.0.0.1` before starting.

- **UI:** <http://localhost:3000>
- **Docker endpoint:** `localhost:3000`
- **First login:** `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env`

```sh
docker login localhost:3000
docker pull alpine:latest
docker tag alpine:latest localhost:3000/library/alpine:latest
docker push localhost:3000/library/alpine:latest
```

The base `deploy/compose.yaml` uses prebuilt images. Add `deploy/compose.build.yaml` to build the four Dockyard images locally; PostgreSQL and Distribution still use upstream images. Prebuilt tags must already exist in your local cache or an image registry—this repository does not publish images automatically.

## Documentation

The detailed documentation lives in [`docs/`](docs/README.md):

- [Build setup](docs/deployment/build.md): requirements, image builds, startup jobs, prebuilt images, upgrades, and verification.
- [Two-proxy setup](docs/deployment/two-proxies.md): HTTPS at an external proxy, HTTP behind it, and host/container networking.
- [Own proxy without ingress](docs/deployment/custom-proxy.md): disabling ingress, backend access, Caddy/Nginx routing, and auth checks.
- [URL and TLS configuration](docs/configuration.md): what each URL/port variable controls and why incorrect TLS ownership causes redirect loops.
- [Reference](docs/reference.md): ingress variables, authentication/RBAC, persistence, maintenance, local development, tests, and architecture.

**Production:** use HTTPS before sending credentials over an untrusted network. **Persistence:** never run `docker compose down -v` unless you intend to delete the database, registry images, and signing keys.
