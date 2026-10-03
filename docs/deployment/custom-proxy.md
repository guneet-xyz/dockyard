# Your own proxy, without Dockyard ingress

Use this when your proxy should do all public routing. Dockyard ingress is **not required for authentication**: Next.js decides permissions and signs tokens; Distribution verifies them on every registry request.

```text
Browser / Docker CLI → HTTPS: dockyard.example.com → your proxy
                                                   ├── /v2 and /v2/* → registry:5000
                                                   └── other paths  → web:3000
```

This guide assumes a proxy running on the Docker host. A container-network alternative is described below. Run commands from the repository root and preserve an existing `.env`.

## 1. Set the shared public origin

Generate `.env` only if it does not exist, as described in [build setup](build.md). Set:

```dotenv
APP_URL=https://dockyard.example.com
DOCKYARD_IMAGE_TAG=local
```

The default internal registry URL and authenticated push-notification URL already connect web and registry through the Compose network; leave those connections in place. No `INGRESS_PUBLIC_URL` or upstream-ingress URL setting is needed when ingress is disabled. Do not set `APP_URL` to `http://web:3000` or to a private registry port.

## 2. Disable ingress and expose private backend ports

Create a deployment-specific file **`deploy/compose.proxy.yaml`** with:

```yaml
services:
  ingress:
    profiles: [dockyard-ingress]

  web:
    ports:
      - "127.0.0.1:3100:3000"

  registry:
    ports:
      - "127.0.0.1:5100:5000"
```

The base file has no published web/registry ports, so this adds only loopback mappings. Ingress now has an inactive profile and is not started by a normal `up`. Do **not** enable that profile or explicitly select `ingress`. Leave PostgreSQL private.

If ingress is already running from a previous setup, changing its profile does not stop that existing container. Before switching, coordinate any downtime, then stop it explicitly:

```sh
docker compose --env-file .env -f deploy/compose.yaml stop ingress
```

This does not delete any data volumes.

## 3. Start the backend stack

```sh
docker compose --env-file .env \
  -f deploy/compose.yaml \
  -f deploy/compose.build.yaml \
  -f deploy/compose.proxy.yaml \
  up --build --wait --wait-timeout 240
```

For available prebuilt images, omit `-f deploy/compose.build.yaml` and `--build`. On a fresh deployment, only web, registry, PostgreSQL, init, and migrate are created; ingress is inactive. Successful init/migrate job exits remain prerequisites for web startup.

Use the same deployment override for operational commands so the selected services and published ports remain consistent:

```sh
docker compose --env-file .env -f deploy/compose.yaml -f deploy/compose.proxy.yaml ps --all
docker compose --env-file .env -f deploy/compose.yaml -f deploy/compose.proxy.yaml logs --tail=100 web registry
```

## 4. Configure your proxy

Route **both `/v2` and `/v2/*`** directly to the registry without stripping the prefix. Route every other path—including `/api/registry/token`—to web.

### Caddy example

This configuration belongs to your proxy deployment. It does not use the `dockyard/ingress` image:

```caddyfile
dockyard.example.com {
    @registry path /v2 /v2/*
    handle @registry {
        reverse_proxy 127.0.0.1:5100 {
            flush_interval -1
            transport http {
                compression off
            }
        }
    }
    handle {
        encode zstd gzip
        reverse_proxy 127.0.0.1:3100
    }
}
```

Use `handle`, **not `handle_path`**, because Distribution expects `/v2` in the request path. Keep your proxy's TLS certificate/ACME state persistent.

### Nginx example

Use real certificates from your TLS deployment:

```nginx
server {
    listen 443 ssl;
    server_name dockyard.example.com;
    ssl_certificate /etc/nginx/tls/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/privkey.pem;
    client_max_body_size 0;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;

    location ~ ^/v2(?:/|$) {
        proxy_pass http://127.0.0.1:5100;
    }
    location / {
        proxy_pass http://127.0.0.1:3100;
    }
}
```

The registry `proxy_pass` has **no URI suffix**, which is required in a regex location and preserves paths/query strings. Add HTTP-to-HTTPS redirection separately. Do not compress or otherwise transform registry blobs or manifests. Adjust timeouts for your image sizes and transfer speeds.

### Required proxy behavior

- Preserve client `Authorization`, `Host`, `Origin`, and cookies where applicable.
- Return `WWW-Authenticate`, `Docker-Distribution-Api-Version`, `Docker-Content-Digest`, `Location`, and range headers unchanged.
- Allow GET, HEAD, POST, PATCH, PUT, and DELETE, streaming bodies and downloads without inappropriate buffering or small body limits.
- Do not insert Dockyard's privileged internal service token, registry admin credentials, or a proxy-generated authorization header into `/v2` requests.
- Do not redirect Docker clients to an unrelated browser/SSO login page. Docker needs the registry challenge and its token endpoint.

The configured registry returns relative upload URLs, so uploads continue through your public endpoint rather than leaking an internal hostname. A UI admin session cookie alone cannot authorize raw registry operations; Docker needs a scoped signed token.

## 5. Verify the public endpoint and access control

```sh
curl -fsS https://dockyard.example.com/api/health
curl -i https://dockyard.example.com/v2/
docker login dockyard.example.com
docker pull alpine:latest
docker tag alpine:latest dockyard.example.com/library/alpine:latest
docker push dockyard.example.com/library/alpine:latest
docker logout dockyard.example.com
docker pull dockyard.example.com/library/alpine:latest
```

An unauthenticated `/v2/` should return **401** with a bearer realm of `https://dockyard.example.com/api/registry/token`. It must not return web HTML, a public backend port, or an SSO page. Confirm web login uses a Secure/HttpOnly cookie and does not fail origin checks. Guest/viewer pushes and guest private pulls should remain blocked. Open the UI at the same hostname to inspect your image.

Do not open ports 3100/5100 to untrusted networks just because a proxy is in front of them. Prefer loopback or private container networking, while retaining registry token authentication on the backend itself.

## Containerized proxy alternative

If the proxy is a container, host-loopback addresses will not point to Dockyard. Instead:

1. Keep the inactive ingress profile, but omit the web/registry `ports` blocks from your override.
2. Attach the proxy to Dockyard's network (`dockyard_default` for the default project name), or configure an appropriate shared private network in your deployment.
3. Use `web:3000` and `registry:5000` as proxy upstreams.

Do not publish PostgreSQL or the backend service ports. If the proxy is managed by a separate Compose project, use an explicit shared-network configuration rather than assuming its own `web`/`registry` DNS names resolve to this stack.

## Troubleshooting and maintenance

- **Ingress still running:** stop the old container; an inactive profile prevents new startup but does not stop an already-running service.
- **Docker login returns HTML/404:** `/v2` was sent to web, or the proxy stripped its prefix.
- **Wrong auth URL or origin rejected:** fix the exact public `APP_URL` and recreate the registry/web containers.
- **Private data exposed or writes unexpectedly allowed:** remove any proxy-injected admin authorization and verify the registry still uses token auth.
- **Upload fails partway:** check PATCH/PUT support, body-size limits, buffering, timeouts, and `Location` handling.

Keep your override in subsequent deployment commands. `down` without `-v` preserves database, blobs, and signing keys. See [maintenance](../reference.md#persistence-and-maintenance) for backups and safe garbage collection.

[Documentation index](../README.md) · [Two-proxy setup](two-proxies.md)
