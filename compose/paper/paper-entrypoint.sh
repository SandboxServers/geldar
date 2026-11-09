#!/bin/sh
# Entrypoint for the Phase 0 paper service: wraps the image's own start script.
# Paper keeps the Velocity forwarding secret as a plain string in paper-global.yml,
# so this script writes that file from the Docker secret at container start.
# The secret comes from /run/secrets only: never from an environment value or this file.
set -eu

secret_file=/run/secrets/velocity-forwarding
config=/data/config/paper-global.yml

# Drop the CR/LF that editors and echo leave behind; nothing else is removed.
secret=$(tr -d '\r\n' < "$secret_file")
if [ -z "$secret" ]; then
  echo "paper-entrypoint: $secret_file is empty; run ./geldar.ps1 shard secrets phase0" >&2
  exit 1
fi
# The value is written unquoted into YAML and sed, so refuse anything outside this set.
case "$secret" in
  *[!a-zA-Z0-9_-]*)
    echo "paper-entrypoint: $secret_file holds characters outside [A-Za-z0-9_-]; run ./geldar.ps1 shard secrets phase0" >&2
    exit 1
    ;;
esac

# Files written below are readable by their owner only.
umask 077
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

# A file left by an older run may still disable the forwarding or carry another secret.
# Check the proxies.velocity block itself, and refuse to start Paper if it is not what Velocity needs.
quote="'"
if ! awk -v secret="$secret" -v q="$quote" '
  /^proxies:/ { inproxies = 1; next }
  /^[^ #]/ { inproxies = 0; invelocity = 0 }
  inproxies && /^  velocity:/ { invelocity = 1; next }
  inproxies && /^  [^ #]/ { invelocity = 0 }
  invelocity && $0 == "    enabled: true" { enabled = 1 }
  invelocity && $0 == "    online-mode: false" { online = 1 }
  invelocity && $0 == "    secret: " q secret q { found = 1 }
  END { exit !(enabled && online && found) }
' "$config"; then
  echo "paper-entrypoint: $config does not enable Velocity forwarding with the current secret; delete it and restart the paper service" >&2
  exit 1
fi

exec /image/scripts/start "$@"
