#!/bin/sh
set -eu
node dist/migrate.cjs
exec node server.js
