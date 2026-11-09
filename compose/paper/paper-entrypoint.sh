#!/bin/sh
# Entrypoint for the Phase 0 paper service: wraps the image's own start script.
# Paper keeps the Velocity forwarding secret as a plain string in paper-global.yml,
# so this script writes that file from the Docker secret at container start.
# The secret comes from /run/secrets only: never from an environment value or this file.
set -eu

secret_file=/run/secrets/velocity-forwarding
config=/data/config/paper-global.yml

secret=$(cat "$secret_file")
if [ -z "$secret" ]; then
  echo "paper-entrypoint: $secret_file is empty; run ./geldar.ps1 shard secrets phase0" >&2
  exit 1
fi

mkdir -p /data/config
if [ ! -e "$config" ]; then
  {
    echo 'proxies:'
    echo '  velocity:'
    echo '    enabled: true'
    echo '    online-mode: false'
    printf "    secret: '%s'\n" "$secret"
  } > "$config"
  # The image runs the server as its own user; keep the directory and file owned as /data is,
  # so Paper can write its own config files next to this one.
  chown --reference=/data /data/config "$config"
else
  # Paper may have rewritten the file on an earlier start: change only the secret line.
  sed -i "s|^\( *\)secret: .*|\1secret: '$secret'|" "$config"
fi
chmod 600 "$config"

exec /image/scripts/start "$@"
