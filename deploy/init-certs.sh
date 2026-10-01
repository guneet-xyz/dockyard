#!/bin/sh
set -eu
umask 077
mkdir -p /certs
if [ ! -s /certs/token.key ] || [ ! -s /certs/token.crt ]; then
  openssl req -newkey rsa:4096 -nodes -keyout /certs/token.key \
    -x509 -sha256 -days 3650 -out /certs/token.crt \
    -subj "/CN=Dockyard registry token signing" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,digitalSignature,keyCertSign"
fi
chown -R 1001:1001 /certs
chmod 750 /certs
chmod 600 /certs/token.key
chmod 644 /certs/token.crt
echo "Registry signing certificate ready."
