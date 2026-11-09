#!/bin/sh
# Entrypoint for the Phase 0 paper service: wraps the image's own start script.
# Paper keeps the Velocity forwarding secret as a plain string in paper-global.yml,
# so this script writes that file from the Docker secret at container start.
# The secret comes from /run/secrets only: never from an environment value or this file.
set -eu

secret_file=/run/secrets/velocity-forwarding
config=/data/config/paper-global.yml

mkdir -p /data/config
{
  echo 'proxies:'
  echo '  velocity:'
  echo '    enabled: true'
  echo '    online-mode: false'
  printf "    secret: '%s'\n" "$(cat "$secret_file")"
} > "$config"
# The image runs the server as its own user; keep the directory and file owned as /data is,
# so Paper can write its own config files next to this one.
chown --reference=/data /data/config "$config"

exec /image/scripts/start "$@"
