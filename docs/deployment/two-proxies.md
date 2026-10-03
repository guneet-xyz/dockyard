# Two-proxy setup

Use this when you already run a TLS edge proxy and want Dockyard ingress to retain responsibility for routing the UI and registry API.

```text
Browser / Docker CLI
        │ HTTPS: dockyard.example.com
        ▼
Your edge proxy (TLS termination)
        │ HTTP: 127.0.0.1:3000
        ▼
Dockyard ingress (no TLS, no mounts)
        ├── /v2 and /v2/* → registry:5000
        └── other paths  → web:3000
```

The examples below assume your edge proxy runs **on the Docker host**. See [containerized edge proxies](#containerized-edge-proxies) for the networking difference. Start by following the environment-generation steps in [build setup](build.md), preserving any existing secrets.

## 1. Set the public and internal URLs

Point DNS for `dockyard.example.com` at the edge proxy. Set these non-secret values in the repository-root `.env`:

```dotenv
APP_URL=https://dockyard.example.com
INGRESS_PUBLIC_URL=http://localhost:3000
INGRESS_BIND_ADDRESS=127.0.0.1
INGRESS_PORT=3000
WEB_UPSTREAM_URL=http://web:3000
REGISTRY_UPSTREAM_URL=http://registry:5000
```

The two URL values intentionally differ:

- `APP_URL` is the public HTTPS origin. Web uses it for origin checks, secure cookies, Docker commands, and the registry's token realm.
- `INGRESS_PUBLIC_URL` selects **HTTP** for the internal gateway. The current Compose file defaults this independently to HTTP, even when `APP_URL` is HTTPS. Older versions inherited `APP_URL`, so explicitly setting it remains important when upgrading those deployments.

In HTTP mode, `localhost:3000` in the ingress URL does not tell Caddy to connect to localhost or listen on container port 3000. Ingress listens on container port 80; the Compose port mapping publishes it on host port 3000. The outer proxy's actual upstream must match that published address, or `ingress:80` on a shared container network. See [URL, TLS, and port configuration](../configuration.md) for the full variable logic and redirect-loop explanation.

The loopback binding prevents outside clients from bypassing your edge proxy. Keep any administrative restrictions and IP-level rate limits at the edge. The supplied ingress does not trust arbitrary forwarded headers as an authentication source; its HTTP backend hop does not determine the app's configured public origin.

## 2. Start Dockyard

```sh
docker compose --env-file .env \
  -f deploy/compose.yaml \
  -f deploy/compose.build.yaml \
  up --build --wait --wait-timeout 240
```

For available prebuilt images, omit the build file and `--build`. There is no project-provided TLS Compose file and no Caddyfile to manage for Dockyard ingress.

## 3. Forward all paths at the edge

Your edge proxy needs one upstream. Do not split `/v2/*` at this layer; Dockyard ingress already routes it. Preserve paths, query strings, `Host`, `Authorization`, `Origin`, and cookies. Pass registry response headers through unchanged, including `WWW-Authenticate`, `Location`, `Docker-Content-Digest`, and `Range` responses.

### Caddy edge example

This is configuration for **your existing edge Caddy**, not a bind mount for Dockyard ingress:

```caddyfile
dockyard.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy's normal reverse proxy forwards client authorization and streams request bodies. Persist the edge proxy's certificate/ACME data according to your deployment.

### Nginx edge example

Supply real TLS certificate paths managed by your infrastructure:

```nginx
server {
    listen 443 ssl;
    server_name dockyard.example.com;
    ssl_certificate /etc/nginx/tls/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/privkey.pem;
    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
    }
}
```

`proxy_pass` has no path suffix, so requests retain their original paths and query strings. Add HTTP-to-HTTPS redirection separately in your edge deployment. Do not replace `Authorization` with proxy credentials, redirect Docker requests to an SSO login page, or apply small request-body limits to image transfers. Adjust timeouts and limits to suit your largest images and network speeds.

## 4. Verify through HTTPS

```sh
curl -fsS https://dockyard.example.com/api/health
curl -i https://dockyard.example.com/v2/
docker login dockyard.example.com
docker pull alpine:latest
docker tag alpine:latest dockyard.example.com/library/alpine:latest
docker push dockyard.example.com/library/alpine:latest
```

`/v2/` should return a `401` bearer challenge advertising **`https://dockyard.example.com/api/registry/token`**, not a container hostname or HTTP URL. Docker login should complete; an authorized push should appear in the UI at the same HTTPS hostname.

Web login should work without origin errors and should set a Secure/HttpOnly session cookie. Viewer and guest pushes should still be rejected. Private images require active authenticated accounts.

## Containerized edge proxies

`127.0.0.1` inside a proxy container refers to **that container**, not the Docker host. Choose an appropriate private connection:

- Attach the edge proxy to Dockyard's Compose network and proxy to `ingress:80`. The default project network is `dockyard_default`; it changes if you use `-p`. Use a managed/shared Docker network in production if that fits your infrastructure.
- Or explicitly configure a reachable Docker host gateway address and a private/firewalled host binding. A localhost-only published port is not generally reachable from an unrelated container.

Do not expose a plaintext gateway to the public internet merely to connect another container. Web and registry remain internal; the edge should target **ingress**, not `web` alone.

## Troubleshooting

- **`ERR_TOO_MANY_REDIRECTS`:** an inner HTTP-to-HTTPS redirect can send the browser back to the exact same public URL on every request. Keep `APP_URL=https://your-domain` but set `INGRESS_PUBLIC_URL=http://localhost:3000`. The outer proxy should use HTTP to reach ingress; only the outer proxy should enforce HTTPS. Recreate ingress after changing environment variables; `restart` alone does not update them:

  ```sh
  docker compose --env-file .env -f deploy/compose.yaml up -d --force-recreate --no-deps ingress
  docker compose --env-file .env -f deploy/compose.yaml exec -T ingress printenv INGRESS_PUBLIC_URL
  docker compose --env-file .env -f deploy/compose.yaml exec -T ingress cat /tmp/dockyard-Caddyfile
  curl -I http://127.0.0.1:3000/
  curl -I https://dockyard.example.com/
  ```

  The generated ingress config should contain `auto_https off` and no `redir` directive. The internal HTTP response should not redirect to the public HTTPS origin. The public HTTPS response should not redirect to itself. Adapt the host/port to your deployment; for a containerized edge, inspect from the shared network instead of assuming host loopback access. If the settings are already correct, check whether the edge is forwarding to itself or has a conflicting scheme/hostname redirect.

- **Origin rejected or insecure session cookie:** set `APP_URL` to the exact public HTTPS origin and recreate web. Keep `INGRESS_PUBLIC_URL` HTTP for the backend hop.
- **TLS handshake failure on the internal hop:** ensure the edge uses HTTP to the gateway and the gateway public URL setting selects HTTP.
- **Docker login gets HTML or an SSO redirect:** let the registry's bearer challenge and Next.js token endpoint reach the client unchanged.
- **413 or interrupted uploads:** remove inappropriate body limits, turn off request buffering, and increase proxy timeouts.
- **Wrong token realm:** check the public `APP_URL`, then recreate the registry so its configured realm updates.

See [authentication and access control](../reference.md#access-model) and [the own-proxy-only recipe](custom-proxy.md).
