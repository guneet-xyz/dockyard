# Dockyard

A self-hosted Docker / OCI registry with a polished Next.js interface, shadcn/ui components, and permissions enforced in both the browser and Docker CLI.

## What’s included

- Responsive dark UI, dashboard, searchable repository list/grid, and tag search with pagination.
- Real registry data: image digests, compressed sizes, platforms, build timestamps, and copyable pull commands. No simulated repositories or metrics.
- Anonymous browsing and pulling of **public** images by default.
- Username/password login with opaque, database-backed, HttpOnly sessions.
- Viewer, maintainer, and administrator roles.
- Public/private repository settings, including reserving a private name **before** its first push.
- Admin user creation, role changes, account disabling, password resets, and audit history.
- Docker Registry V2 token authentication with short-lived RSA-signed JWTs.
- PostgreSQL + Drizzle, checked-in migrations, and a dedicated migration/bootstrap job before web startup.
- One Caddy ingress endpoint for the UI and Docker Registry API, with streaming proxying and optional HTTPS.
- Persistent Compose volumes, health checks, and non-root web/migration containers.
- pnpm and Prettier with `semi: false`.

## Start with Docker Compose

Requires Docker Engine and Docker Compose v2 (v2.24.4+ for the HTTPS override). The environment generator also uses OpenSSL. No host Node.js installation is needed. Run these commands from the repository root:

```sh
./deploy/generate-env.sh
docker compose --env-file .env -f deploy/compose.yaml up --build -d
```

The generator writes `.env` at the repository root, regardless of your working directory, with four distinct random secrets and file permissions `0600`. It refuses to overwrite existing files or symlinks, including concurrent invocations, and never prints passwords. Edit non-secret settings such as domains and ports as needed. Pass an optional output path to create a separate environment file, then point Compose at it with `--env-file`. Keep custom environment files outside the repository or add them to `.gitignore` before use.

Alternatively, copy `.env.example` to `.env` manually and replace the four secret placeholders. Use `openssl rand -hex 32` for each value; the PostgreSQL password must be URL-safe because Compose embeds it in `DATABASE_URL`. The admin password must be 12–72 characters (at most 72 UTF-8 bytes). `.env` is ignored by Git and excluded from the Docker build. **`pnpm env:generate`** is an alias for the same shell generator.

- **Web UI:** <http://localhost:3000>
- **Docker login/push/pull:** `localhost:3000` — the same ingress endpoint as the UI
- **First login:** `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`

The first administrator is created only when the users table is empty. Changing `ADMIN_PASSWORD` in `.env` does **not** reset an existing account; use the admin UI.

```sh
docker compose --env-file .env -f deploy/compose.yaml ps --all
docker compose --env-file .env -f deploy/compose.yaml logs -f ingress web registry
```

The initial UI intentionally starts empty. Create repositories or push real images to populate it.

### Single-endpoint ingress

Only `ingress` publishes a host port. `web`, `registry`, and PostgreSQL remain reachable only within the Compose network:

```text
http://localhost:3000
├── /v2 and /v2/*        → registry:5000 (path preserved)
└── everything else     → web:3000 (UI, API, token endpoint)
```

Ingress forwards client authorization, registry challenges, digests, upload locations, and range responses unchanged. Uploads and downloads stream directly to/from Distribution, not through Next.js. It never inserts the web app's internal service token. Next.js decides permissions when issuing short-lived tokens; Distribution verifies and enforces them on every registry operation. A web session cookie alone does not authorize registry access.

`APP_URL` is the single public origin and determines Docker commands shown in the UI and the registry's token realm. Change `INGRESS_PORT` and `APP_URL` together for a different port. `INGRESS_BIND_ADDRESS` defaults to `0.0.0.0`; set it to `127.0.0.1` for localhost-only access. The registry returns relative upload URLs to keep resumable uploads on this same origin.

### Environment-configured ingress image

`dockyard/ingress` generates and validates `/tmp/dockyard-Caddyfile` at startup, then runs Caddy with that generated file. No user-managed Caddyfile or config bind mount is needed. The default HTTP service has **no mounts** and regenerates configuration whenever its container starts.

| Image environment variable | Default                 | Purpose                                                                                                                    |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `INGRESS_PUBLIC_URL`       | `http://localhost:3000` | Public origin; `http://` selects development HTTP, `https://` selects managed HTTPS. Compose supplies this from `APP_URL`. |
| `WEB_UPSTREAM_URL`         | `http://web:3000`       | Root URL for the UI, token endpoint, and internal readiness probe.                                                         |
| `REGISTRY_UPSTREAM_URL`    | `http://registry:5000`  | Root URL for `/v2` requests.                                                                                               |

Upstream URLs support HTTP/HTTPS, custom ports, and bracketed IPv6 addresses. An optional trailing root slash is normalized. Credentials, non-root paths, query strings, fragments, invalid ports, and configuration syntax are rejected before Caddy starts. HTTPS upstream certificates are verified normally; client authorization is never replaced with an upstream credential.

Inside the image, public HTTP listens on port 80 and HTTPS on port 443. An HTTPS public URL can include an external port, such as `https://dockyard.example.com:8443`; map that host port to container port 443. HTTP redirects use the complete public URL, including its external port. The public origin must also match the web app's `APP_URL` and registry token realm.

To use the image independently on a Docker network:

```sh
docker run --rm --network your-network -p 3000:80 \
  -e INGRESS_PUBLIC_URL=http://localhost:3000 \
  -e WEB_UPSTREAM_URL=http://your-web:3000 \
  -e REGISTRY_UPSTREAM_URL=http://your-registry:5000 \
  dockyard/ingress:local
```

Inspect generated configuration without running a server using `docker run --rm dockyard/ingress:local --print-config`, or validate it using `docker run --rm dockyard/ingress:local validate`. Pass the same environment variables to inspect/validate a custom setup. Environment changes take effect when the container is recreated.

### Images and startup jobs

One multi-stage `Dockerfile` builds four Dockyard images. `DOCKYARD_IMAGE_TAG` defaults to `local`:

| Image                    | Compose service | Responsibility                                                                                          |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------- |
| `dockyard/init:local`    | `init`          | Generate missing registry signing material and set volume permissions; exit successfully.               |
| `dockyard/migrate:local` | `migrate`       | Wait for PostgreSQL, apply Drizzle migrations, and create the first admin if needed; exit successfully. |
| `dockyard/web:local`     | `web`           | Serve the Next.js UI, API, and token endpoint. Does not run migrations.                                 |
| `dockyard/ingress:local` | `ingress`       | Generate Caddy configuration from URLs, then proxy web and registry traffic on one public origin.       |

`init` and `migrate` are independent one-off jobs. `Exited (0)` is their normal state, not a failure. The migration image builds without compiling Next.js and has no signing-key volume. Bootstrap admin credentials are passed only to `migrate`, not to `web`.

```text
init ───────────────────────► registry
  └─────────────────────────► web
postgres (healthy) ─► migrate ─► web
registry (healthy) ──────────► web
web + registry (healthy) ────► ingress
```

Compose waits for both jobs to complete successfully before starting `web`. A failed migration prevents web startup; inspect `docker compose --env-file .env -f deploy/compose.yaml logs migrate`, resolve the error, then retry the startup command above. Existing signing material, database data, and the admin account are preserved on reruns.

To run migrations explicitly against the Compose database:

```sh
docker compose --env-file .env -f deploy/compose.yaml run --rm migrate
```

To build the images individually:

```sh
docker build --target init -t dockyard/init:local .
docker build --target migrate -t dockyard/migrate:local .
docker build --target web -t dockyard/web:local .
docker build --target ingress -t dockyard/ingress:local .
```

**Upgrading from previous deployments:** keep your existing root `.env` and secrets, set `APP_URL` to the shared public origin, and use `docker compose --env-file .env -f deploy/compose.yaml up --build --remove-orphans -d`. This replaces direct web/registry port publishing with ingress and removes obsolete `app`, `certificates`, or standalone `caddy` containers. Database, registry, signing-key, and HTTPS certificate-volume names are unchanged. The ingress Caddyfile bind mounts and `caddy_config` mount are gone; generated configuration is ephemeral, and the old unused `caddy_config` volume is not deleted automatically. Docker clients should log in to the new shared hostname/port. `REGISTRY_PORT`, `REGISTRY_BIND_ADDRESS`, `APP_PORT`, and `APP_BIND_ADDRESS` are no longer used. Compose derives the public registry host from `APP_URL`; the old `REGISTRY_PUBLIC_HOST` setting is not passed to `web`. For HTTPS, replace `UI_DOMAIN` and `REGISTRY_DOMAIN` with one `DOCKYARD_DOMAIN`. Do not regenerate secrets or pass `-v` to `down`.

### Push your first image

```sh
docker login localhost:3000
docker pull alpine:latest
docker tag alpine:latest localhost:3000/library/alpine:latest
docker push localhost:3000/library/alpine:latest
```

Refresh the repository browser. A public image can be pulled without signing in:

```sh
docker logout localhost:3000
docker pull localhost:3000/library/alpine:latest
```

Docker treats localhost as a development exception. For a non-local HTTP registry, configure Docker’s `insecure-registries` explicitly and restart Docker. **Do not use HTTP for passwords over an untrusted network.**

## Access model

| Capability                          | Guest | Viewer | Maintainer | Admin |
| ----------------------------------- | :---: | :----: | :--------: | :---: |
| Browse/pull public images           |   ✓   |   ✓    |     ✓      |   ✓   |
| Browse/pull private images          |   —   |   ✓    |     ✓      |   ✓   |
| Push/delete images                  |   —   |   —    |     ✓      |   ✓   |
| Create/configure repositories       |   —   |   —    |     ✓      |   ✓   |
| Manage users and read audit history |   —   |   —    |     —      |   ✓   |

Roles are registry-wide. “Private” means **all active authenticated users**, not per-user or per-team ACLs. Guest catalog results filter out private names; raw Docker catalog access is admin-only. The UI uses a server-only service token to fetch and filter registry data.

New, unconfigured repositories are public by default. For a private image, create the repository as private in the UI **before the first push**. Set `DEFAULT_REPOSITORY_VISIBILITY=private` to make unconfigured names private instead. The UI remains accessible to guests, but they only see explicitly public repositories.

Disabling an account, changing its role, or resetting its password revokes its web sessions. Issued registry tokens last 5 minutes, so existing Docker authorization can remain valid until expiry. Changing visibility has the same token-expiry delay. Previously downloaded images cannot be revoked.

### Authentication and security

- Passwords are hashed with bcrypt (cost 12); no password hashes are sent to the browser.
- Session cookies are HttpOnly, SameSite=Lax, and Secure when `APP_URL` uses HTTPS. Sessions last 7 days; their hashes are stored in PostgreSQL.
- Mutating browser endpoints require an exact `Origin` match with `APP_URL`.
- Failed credential attempts are throttled per username in PostgreSQL (20 attempts per 15 minutes); successful authentication resets the counter. Apply IP-level rate limits at the reverse proxy for internet deployments as well.
- Registry tokens use RS256 with an X.509 chain trusted by Distribution. The private signing key is never served to clients and is mounted read-only into the app.
- Registry notifications use a separate shared secret, timing-safe checks, and event-ID deduplication. Audit history records UI administration, logins, UI image deletion, and CLI manifest pushes; it does not record every pull/blob operation or direct CLI deletions.
- Self-disabling/self-demotion is blocked, and admin updates are serialized to protect the last active administrator.

## Production HTTPS

The default ingress is HTTP for development. The optional override enables managed HTTPS on the **same ingress service**, for a **single domain** shared by the UI, token endpoint, and Docker Registry API:

1. Point DNS for your Dockyard domain at the server.
2. Set these additional values in `.env`:

   ```dotenv
   DOCKYARD_DOMAIN=dockyard.example.com
   ```

3. Allow inbound TCP 80/443 (and optionally UDP 443).
4. Start the HTTPS stack:

   ```sh
   docker compose --env-file .env -f deploy/compose.yaml -f deploy/compose.tls.yaml up --build -d
   ```

Open `https://dockyard.example.com`, then `docker login dockyard.example.com`. The override publishes only ports 80/443, replaces the development port mapping, and supplies the same HTTPS public URL to web, registry, and ingress. Signing certificates from `init` are separate from ingress TLS certificates.

Managed HTTPS is the only mode that mounts `caddy_data:/data`. This single volume preserves TLS certificate keys and the ACME account across container recreation, avoiding repeated issuance and certificate-authority rate limits. Back it up; do not treat it as a cache. The generated Caddyfile and autosaved configuration are ephemeral and need no persistent config volume. The default HTTP deployment needs no ingress volume at all.

If using your own TLS reverse proxy in front of ingress, bind ingress to localhost and set `APP_URL=https://your-dockyard-domain`. Forward all paths to ingress, allow large bodies and long-running uploads, and leave client `Authorization` headers intact. Do not add an auth redirect that blocks Docker's token-authentication protocol. `APP_URL` must have no trailing slash and must be reachable by both browsers and Docker clients. No separate registry port or domain is needed.

## Persistence and maintenance

Compose creates volumes for PostgreSQL, registry blobs, and signing certificates. `docker compose --env-file .env -f deploy/compose.yaml down` preserves them. **Do not use `down -v` unless you intend to permanently delete all data.**

- Back up PostgreSQL with `pg_dump` and back up the registry data and signing certificate volumes. Restore them as a consistent set.
- The `migrate` job runs before `web` starts and uses a PostgreSQL advisory lock to coordinate migrations/bootstrap. The web image contains neither the migration bundle nor the SQL migration directory.
- Deleting a manifest removes **all tags pointing to the same digest**. Blob files are not immediately freed.
- Run Distribution garbage collection only during a maintenance window with **all registry writes stopped**. See the [official garbage collection guidance](https://distribution.github.io/distribution/about/garbage-collection/). Never run GC alongside active pushes.
- Generated signing certificates are valid for 10 years. Plan certificate/key rotation before expiry and restart the app and registry together; existing tokens may become invalid. Do not delete the signing volume casually.

## Local development

Requires Node.js 22, pnpm 10, PostgreSQL 17, and a token-authenticated Distribution registry.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm env:generate
```

Set `DATABASE_URL`, `APP_URL`, `REGISTRY_INTERNAL_URL`, `REGISTRY_TOKEN_KEY_PATH`, and `REGISTRY_TOKEN_CERT_PATH` in `.env`. For local signing material:

```sh
mkdir -p .certs
openssl req -newkey rsa:4096 -nodes -keyout .certs/token.key \
  -x509 -sha256 -days 365 -out .certs/token.crt \
  -subj '/CN=Dockyard local token signing' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,digitalSignature,keyCertSign'
```

Configure your registry with the same certificate, issuer `dockyard`, service `dockyard-registry`, and token realm `$APP_URL/api/registry/token`. `deploy/registry.yml` is the reference configuration. Do not run a second registry against the same writable storage directory. When using a separate development registry instead of ingress, set `REGISTRY_PUBLIC_HOST=localhost:5000` explicitly in your local `.env` so the UI shows that CLI endpoint; production Compose does not pass this development override to `web`.

```sh
pnpm db:migrate
pnpm dev
```

`pnpm db:migrate` and Drizzle CLI commands load `.env` automatically. Create a schema change in `src/lib/db/schema.ts`, run `pnpm db:generate`, and commit the generated SQL and Drizzle metadata. `pnpm db:studio` opens Drizzle Studio.

### Quality checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Unit tests cover the role matrix, repository names, origin validation, body limits, presentation utilities, single-origin configuration, and environment generation (POSIX shell and OpenSSL required). Integration checks exercise real PostgreSQL sessions and registry authorization through ingress, including forged-token rejection, private image access, an 8 MiB streamed PATCH upload, upload continuation URLs, HEAD requests, and byte-range downloads:

```sh
TEST_ADMIN_PASSWORD='your-test-admin-password' pnpm test:integration
```

Use an **isolated test stack**: the smoke test creates uniquely named users, repositories, and blobs and leaves those records behind. `TEST_REGISTRY_URL` defaults to `TEST_APP_URL`, exercising the same ingress origin. Override `TEST_APP_URL` and `TEST_ADMIN_USERNAME` as needed; use `TEST_REGISTRY_URL` only when testing separate local-development services.

Browser checks cover guest navigation, responsive layout, login, repository creation, and admin pages:

```sh
pnpm exec playwright install chromium
TEST_ADMIN_PASSWORD='your-test-admin-password' pnpm test:e2e
```

## Architecture

```text
Browser / Docker CLI ──► ingress (one public origin)
                           ├── /v2/* ──► Distribution (verifies scoped JWT)
                           └── other paths ──► Next.js / shadcn UI
                                                  ├── PostgreSQL / Drizzle
                                                  ├── credentials + RBAC ──► signed JWT
                                                  └── internal registry metadata requests

Distribution ──► authenticated push notifications ──► Next.js
```

`src/components/ui` contains shadcn-style Radix primitives configured by `components.json`. `src/lib` owns auth, permissions, database access, and the registry client; `src/app/api` enforces those permissions. Image layers stay in Distribution storage, not PostgreSQL.
