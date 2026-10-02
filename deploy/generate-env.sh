#!/bin/sh
set -eu

usage() {
  printf 'Usage: %s [output-file]\n' "$0"
  printf 'Generates a private .env with random secrets. Defaults to the repository root.\n'
  printf 'Existing files and symlinks are never overwritten. Requires OpenSSL.\n'
}

if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi
case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

if ! command -v openssl >/dev/null 2>&1; then
  printf 'OpenSSL is required. Install it or copy .env.example and set the secrets manually.\n' >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
template="$repo_dir/.env.example"
output="${1:-$repo_dir/.env}"

if [ -e "$output" ] || [ -L "$output" ]; then
  printf '%s already exists. It was not changed.\n' "$output" >&2
  exit 1
fi
if [ ! -r "$template" ]; then
  printf 'Cannot read template: %s\n' "$template" >&2
  exit 1
fi

postgres_password=$(openssl rand -hex 32)
admin_password=$(openssl rand -hex 32)
http_secret=$(openssl rand -hex 32)
webhook_secret=$(openssl rand -hex 32)

# Noclobber also prevents a concurrent invocation from replacing the output.
# Hex secrets are URL-safe and safe to substitute into the template with sed.
if ! (
  umask 077
  set -C
  sed \
    -e "s/replace-with-a-random-url-safe-password/$postgres_password/g" \
    -e "s/replace-with-a-strong-admin-password/$admin_password/g" \
    -e "s/replace-with-a-random-secret-at-least-32-characters/$http_secret/g" \
    -e "s/replace-with-a-different-random-secret-at-least-32-characters/$webhook_secret/g" \
    "$template" > "$output"
); then
  printf 'Could not create %s. Existing files are never overwritten.\n' "$output" >&2
  exit 1
fi

printf 'Created %s with random secrets and owner-only permissions.\n' "$output"
printf 'Read ADMIN_PASSWORD in that file to sign in. Keep the file private.\n'
printf 'Next (local build): docker compose --env-file "%s" -f "%s/compose.yaml" -f "%s/compose.build.yaml" up --build -d\n' "$output" "$script_dir" "$script_dir"
