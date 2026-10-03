# URL, TLS, and port configuration

These variables describe **different parts of the request path**. An external HTTPS address does not imply every internal connection also uses HTTPS.

```text
Browser / Docker CLI
        │ https://dockyard.example.com         ← APP_URL
        ▼
Your edge proxy (owns public TLS)
        │ http://127.0.0.1:3000                 ← edge's upstream target
        ▼
Host port 3000 → ingress container port 80     ← INGRESS_PORT / Docker mapping
        │ HTTP ingress mode                   ← INGRESS_PUBLIC_URL=http://...
        ├── /v2/* → http://registry:5000        ← REGISTRY_UPSTREAM_URL
        └── other paths → http://web:3000      ← WEB_UPSTREAM_URL
```

## What each variable actually does

| Variable                | Consumer                       | Meaning                                                                                                                                                    |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`               | Web and registry configuration | The **public origin clients use**: scheme, hostname, and optional public port.                                                                             |
| `INGRESS_PUBLIC_URL`    | Ingress entrypoint             | Selects ingress HTTP or managed-HTTPS mode. In HTTPS mode it also supplies the certificate hostname and full redirect destination.                         |
| `WEB_UPSTREAM_URL`      | Ingress                        | The **actual backend URL ingress connects to** for UI/application/token requests and readiness checks.                                                     |
| `REGISTRY_UPSTREAM_URL` | Ingress                        | The actual backend URL for `/v2` requests, with that prefix preserved.                                                                                     |
| `INGRESS_BIND_ADDRESS`  | Docker Compose                 | The host network interface on which the published ingress port is bound.                                                                                   |
| `INGRESS_PORT`          | Docker Compose                 | The host port forwarded to ingress's container port **80** in the supplied HTTP Compose configuration.                                                     |
| `REGISTRY_INTERNAL_URL` | Web                            | The URL web uses for its own authenticated registry metadata requests. Compose fixes this to `http://registry:5000`; this is not a public client endpoint. |

### `APP_URL`: identity of the public application

For a public HTTPS deployment, use:

```dotenv
APP_URL=https://dockyard.example.com
```

This setting is used to:

- Require an exact browser `Origin` match on mutating web APIs.
- Enable the `Secure` flag on session cookies when its scheme is HTTPS.
- Derive the hostname/port shown in Docker CLI commands in the UI.
- Configure Distribution's token realm as `${APP_URL}/api/registry/token`, which Docker clients must reach.

It **does not** enable TLS, change a server listener, publish a Docker port, or tell ingress which internal transport to use. Setting `APP_URL` to HTTP to avoid a redirect loop is not the right fix when users access HTTPS: it can break origin checks and remove the Secure cookie flag.

Use the exact external origin, including a non-default port if there is one, and no trailing slash. Do not use a container hostname such as `web` as the public origin.

### `INGRESS_PUBLIC_URL`: how ingress itself serves traffic

Despite the word “public” in its name, **this is not necessarily the browser's public URL** in a two-proxy setup.

The generated configuration behaves as follows:

| Value scheme | Generated behavior                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `http://`    | Disable automatic HTTPS, listen on container port **80**, and proxy requests without an HTTP-to-HTTPS redirect.                 |
| `https://`   | Serve managed HTTPS on container port **443**; requests to container port **80** redirect to the complete configured HTTPS URL. |

In **HTTP mode**, the hostname and port in this value do **not** set a listener address or become an upstream target. For example, `INGRESS_PUBLIC_URL=http://localhost:3000` does not make Caddy listen on container port 3000, and Caddy does not connect to that URL. Docker's port mapping is what makes the port-80 listener reachable at host port 3000.

In **HTTPS mode**, the hostname determines the TLS site/certificate, while the full URL—including a custom external port—determines the redirect destination. Changing this variable does not automatically add a port-443 mapping or persistent certificate storage. Managed HTTPS needs a suitable deployment that publishes ports 80/443 and persists `/data`.

The supplied Compose file deliberately defaults ingress to `http://localhost:3000`, **independently of `APP_URL`**, because it publishes only an HTTP listener. The standalone image still supports explicitly selected managed HTTPS.

### Upstream URLs: where requests are sent

For the normal Compose network:

```dotenv
WEB_UPSTREAM_URL=http://web:3000
REGISTRY_UPSTREAM_URL=http://registry:5000
```

These are internal Docker DNS names and container ports. They are not public addresses and are not host-published ports. The public URL does not need to match them. A host-loopback address inside ingress would refer to the ingress container itself, not to the Docker host or another container.

Use root HTTP/HTTPS URLs only. Credentials, non-root paths, query strings, fragments, invalid ports, and configuration syntax are rejected. Ingress preserves client authorization rather than inserting upstream/admin credentials.

### Bind address and host port: network exposure

For a TLS proxy running on the Docker host:

```dotenv
INGRESS_BIND_ADDRESS=127.0.0.1
INGRESS_PORT=3000
```

Compose publishes `127.0.0.1:3000:80`. The outer proxy should therefore forward to `http://127.0.0.1:3000`.

If the outer proxy is a container on the same Docker network, its upstream is normally `http://ingress:80`, not `http://127.0.0.1:3000`. See [containerized edge proxies](deployment/two-proxies.md#containerized-edge-proxies).

Changing the internal host port behind an edge proxy does not necessarily change `APP_URL`: the browser may still use standard HTTPS port 443. Only when clients connect directly to the changed host port should the public `APP_URL` port change with it.

## Recommended combinations

### Local development through ingress

```dotenv
APP_URL=http://localhost:3000
INGRESS_PUBLIC_URL=http://localhost:3000
INGRESS_BIND_ADDRESS=127.0.0.1
INGRESS_PORT=3000
```

Clients and ingress both use HTTP. Keep this local/trusted; do not send passwords over untrusted HTTP.

### External HTTPS edge plus HTTP ingress

```dotenv
APP_URL=https://dockyard.example.com
INGRESS_PUBLIC_URL=http://localhost:3000
INGRESS_BIND_ADDRESS=127.0.0.1
INGRESS_PORT=3000
```

The browser's transport is HTTPS; the backend hop is HTTP. Only the outer proxy enforces HTTPS. Web still issues Secure cookies and the registry still advertises an HTTPS token endpoint.

### Your own proxy, no Dockyard ingress

Keep `APP_URL=https://dockyard.example.com`, disable ingress as described in [the custom-proxy guide](deployment/custom-proxy.md), and route your proxy directly to web and registry. Ingress variables have no effect on services that are not running. Web's internal registry connection and registry token authentication remain necessary.

## Why the redirect loop happens

If the outer proxy terminates HTTPS but ingress is also set to HTTPS, this can occur:

```text
1. Browser requests https://dockyard.example.com/.
2. Edge forwards the request over HTTP to ingress.
3. Ingress responds: 308 Location: https://dockyard.example.com/.
4. Browser follows that same URL, and the sequence repeats.
```

The public URL is already HTTPS, but the inner proxy only sees the HTTP backend connection. Setting a forwarded-protocol header alone does not turn off the explicit redirect generated for ingress's HTTPS mode.

The fix is **not** to downgrade `APP_URL`. Keep the public origin HTTPS and configure ingress to serve its internal HTTP hop:

```dotenv
APP_URL=https://dockyard.example.com
INGRESS_PUBLIC_URL=http://localhost:3000
```

Older Compose versions coupled these two variables by inheriting the ingress value from `APP_URL`. Current Compose defaults them independently, but an explicit HTTPS ingress value in an existing `.env` still needs to be changed.

## Applying and verifying a change

Docker container environment is fixed when the container is created. Editing `.env` and running `docker compose restart` does not update those values. Recreate the affected services using the same environment file, project name, and Compose files as the original deployment:

```sh
# Ingress-mode-only changes:
docker compose --env-file .env -f deploy/compose.yaml \
  up -d --force-recreate --no-deps ingress

# APP_URL changes must also reach web and the registry token realm:
docker compose --env-file .env -f deploy/compose.yaml \
  up -d --force-recreate --no-deps web registry ingress

docker compose --env-file .env -f deploy/compose.yaml \
  exec -T ingress printenv INGRESS_PUBLIC_URL
docker compose --env-file .env -f deploy/compose.yaml \
  exec -T ingress cat /tmp/dockyard-Caddyfile
```

Include your deployment-specific overrides and `-p` project name if you used them. Do not regenerate secrets or delete volumes. These targeted `--no-deps` examples assume the required startup jobs and database are already initialized and healthy; for a fresh deployment, use the normal startup recipe.

For an HTTP inner gateway, generated configuration should contain `auto_https off` and no `redir` directive. Inspect both hops without automatically following redirects:

```sh
curl -I http://127.0.0.1:3000/
curl -I https://dockyard.example.com/
curl -i https://dockyard.example.com/v2/
```

The internal HTTP endpoint must not redirect to the public HTTPS origin. The public HTTPS endpoint must not redirect to itself. An unauthenticated registry request should return **401 with a bearer challenge**, not an HTTPS redirect or web HTML. Adapt addresses for your actual ports/network. If there is still a loop, check whether the edge forwards to itself or adds conflicting scheme/hostname redirects.

[Documentation index](README.md) · [Two-proxy recipe](deployment/two-proxies.md)
