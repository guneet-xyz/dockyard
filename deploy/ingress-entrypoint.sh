#!/bin/sh
set -eu

mode="${1:-run}"
case "$mode" in
  run|validate|--print-config) ;;
  *) exec caddy "$@" ;;
esac
if [ "$#" -gt 0 ]; then
  shift
fi

invalid_url() {
  printf '%s must be a root http:// or https:// URL with a hostname and optional port (1-65535); credentials, paths, queries, and fragments are not supported.\n' "$1" >&2
  exit 1
}

root_url() {
  name="$1"
  value="$2"
  # Reject newlines before matching: grep alone could accept just one valid line.
  if [ "$(printf '%s\n' "$value" | wc -l)" -ne 1 ]; then
    invalid_url "$name"
  fi
  if ! printf '%s\n' "$value" | LC_ALL=C grep -Eq '^https?://([A-Za-z0-9_]([A-Za-z0-9_.-]*[A-Za-z0-9_])?|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?/?$'; then
    invalid_url "$name"
  fi
  value="${value%/}"
  authority="${value#*://}"
  port=""
  case "$authority" in
    \[*\]) ;;
    *:*) port="${authority##*:}" ;;
  esac
  if [ -n "$port" ] && { [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; }; then
    invalid_url "$name"
  fi
  printf '%s\n' "$value"
}

public_url=$(root_url INGRESS_PUBLIC_URL "${INGRESS_PUBLIC_URL-http://localhost:3000}")
web_url=$(root_url WEB_UPSTREAM_URL "${WEB_UPSTREAM_URL-http://web:3000}")
registry_url=$(root_url REGISTRY_UPSTREAM_URL "${REGISTRY_UPSTREAM_URL-http://registry:5000}")
authority="${public_url#*://}"
case "$authority" in
  \[*) public_host="${authority%%]*}]" ;;
  *) public_host="${authority%%:*}" ;;
esac

render_config() {
  case "$public_url" in
    https://*)
      cat <<EOF
{
  auto_https disable_redirects
}
EOF
      ;;
    http://*)
      cat <<'EOF'
{
  auto_https off
}
EOF
      ;;
  esac

  cat <<EOF

(dockyard_routes) {
  @registry path /v2 /v2/*
  handle @registry {
    # Preserve the path, client authorization, and registry response headers.
    # Never insert the web app's privileged service token.
    reverse_proxy $registry_url {
      flush_interval -1
      transport http {
        compression off
      }
    }
  }
  handle {
    encode zstd gzip
    reverse_proxy $web_url
  }
}
EOF

  case "$public_url" in
    https://*)
      cat <<EOF

:80 {
  redir $public_url{uri} 308
}

https://$public_host {
  import dockyard_routes
}
EOF
      ;;
    http://*)
      cat <<'EOF'

:80 {
  import dockyard_routes
}
EOF
      ;;
  esac

  cat <<EOF

http://:8081 {
  bind 127.0.0.1
  handle /healthz {
    rewrite * /api/health
    reverse_proxy $web_url
  }
  handle {
    respond "Not found" 404
  }
}
EOF
}

if [ "$mode" = --print-config ]; then
  render_config
  exit 0
fi

umask 077
config=/tmp/dockyard-Caddyfile
render_config > "$config"
caddy fmt --overwrite "$config"
if [ "$mode" = validate ]; then
  exec caddy validate --config "$config" --adapter caddyfile "$@"
fi
caddy validate --config "$config" --adapter caddyfile
exec caddy run --config "$config" --adapter caddyfile "$@"
