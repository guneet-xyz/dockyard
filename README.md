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
- PostgreSQL + Drizzle, checked-in migrations, and automatic migrations/bootstrap at startup.
- Persistent Compose volumes, health checks, non-root app container, and optional Caddy HTTPS deployment.
- pnpm and Prettier with `semi: false`.

## Start with Docker Compose

Requires Docker Engine and Docker Compose v2. No host Node.js installation is needed.

```sh
cp .env.example .env
# Edit .env: replace POSTGRES_PASSWORD, ADMIN_PASSWORD,
# REGISTRY_HTTP_SECRET, and REGISTRY_WEBHOOK_SECRET with unique random values.
docker compose up --build -d
```

Use `openssl rand -hex 32` to generate each secret. Keep the PostgreSQL password URL-safe, because Compose embeds it in `DATABASE_URL`. The admin password must be 12–72 characters (at most 72 UTF-8 bytes). `.env` is ignored by Git and excluded from the Docker build.

Alternatively, with Node.js 22 and pnpm installed, **`pnpm env:generate`** creates `.env` with random secrets. It refuses to overwrite an existing file.

- **Web UI:** <http://localhost:3000>
- **Registry:** `localhost:5000`
- **First login:** `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`

The first administrator is created only when the users table is empty. Changing `ADMIN_PASSWORD` in `.env` does **not** reset an existing account; use the admin UI.

```sh
docker compose ps
docker compose logs -f app registry
```

The initial UI intentionally starts empty. Create repositories or push real images to populate it.

### Push your first image

```sh
docker login localhost:5000
docker pull alpine:latest
docker tag alpine:latest localhost:5000/library/alpine:latest
docker push localhost:5000/library/alpine:latest
```

Refresh the repository browser. A public image can be pulled without signing in:

```sh
docker logout localhost:5000
docker pull localhost:5000/library/alpine:latest
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

The default ports bind **only to `127.0.0.1`**. An optional Caddy override provides TLS for two domains:

1. Point DNS for your UI and registry domains at the server.
2. Set these additional values in `.env`:

   ```dotenv
   UI_DOMAIN=containers.example.com
   REGISTRY_DOMAIN=registry.example.com
   ```

3. Allow inbound TCP 80/443 (and optionally UDP 443).
4. Start the HTTPS stack:

   ```sh
   docker compose -f compose.yaml -f compose.tls.yaml up --build -d
   ```

Open `https://containers.example.com`, then `docker login registry.example.com`. Caddy obtains/renews certificates. Its volumes must also be backed up.

If using your own reverse proxy, set `APP_URL=https://your-ui-domain` and `REGISTRY_PUBLIC_HOST=your-registry-domain` (no scheme). Preserve `Host` and `X-Forwarded-Proto`, allow large bodies and long-running uploads, and proxy the registry directly, not through Next.js. `APP_URL` must have no trailing slash and must be reachable by Docker clients for token exchange.

## Persistence and maintenance

Compose creates volumes for PostgreSQL, registry blobs, and signing certificates. `docker compose down` preserves them. **Do not use `down -v` unless you intend to permanently delete all data.**

- Back up PostgreSQL with `pg_dump` and back up the registry data and signing certificate volumes. Restore them as a consistent set.
- Database migrations run before the app starts and use a PostgreSQL advisory lock to coordinate startup.
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

Configure your registry with the same certificate, issuer `dockyard`, service `dockyard-registry`, and token realm `$APP_URL/api/registry/token`. `deploy/registry.yml` is the reference configuration. Do not run a second registry against the same writable storage directory.

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

Unit tests cover the role matrix, repository names, origin validation, body limits, and presentation utilities. Integration checks exercise real PostgreSQL sessions and actual OCI uploads/pulls/deletions against Distribution:

```sh
TEST_ADMIN_PASSWORD='your-test-admin-password' pnpm test:integration
```

Use an **isolated test stack**: the smoke test creates uniquely named users and repositories and leaves those records behind. Override `TEST_APP_URL`, `TEST_REGISTRY_URL`, and `TEST_ADMIN_USERNAME` as needed.

Browser checks cover guest navigation, responsive layout, login, repository creation, and admin pages:

```sh
pnpm exec playwright install chromium
TEST_ADMIN_PASSWORD='your-test-admin-password' pnpm test:e2e
```

## Architecture

```text
Browser ──► Next.js / shadcn UI ──► PostgreSQL / Drizzle
                    │
                    └──► Distribution API (server-only service token)

Docker CLI ──► Distribution registry
    │              │
    └──► Next.js token endpoint ──► credentials + RBAC ──► signed JWT
                   ▲
                   └── authenticated registry push notifications
```

`src/components/ui` contains shadcn-style Radix primitives configured by `components.json`. `src/lib` owns auth, permissions, database access, and the registry client; `src/app/api` enforces those permissions. Image layers stay in Distribution storage, not PostgreSQL.
