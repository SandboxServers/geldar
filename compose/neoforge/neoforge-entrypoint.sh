#!/bin/sh
# Entrypoint for the scratch NeoForge variant (SCRATCH_PLATFORM=neoforge, compose/opt-in/scratch-neoforge.yml): wraps the
# image's own start script. It fetches two artifacts, each checked against a pinned hash before use (fail closed): the
# NeoForge installer, which the image runs, and the Proxy Compatible Forge mod, which provides Velocity's modern
# forwarding. It writes the mod's config from the Docker secret at container start. The secret comes from /run/secrets
# only: never from an environment value or this file, and it is never printed.
set -eu

# Proxy Compatible Forge 1.3.1, published 2026-08-31, Modrinth
MOD_URL=https://cdn.modrinth.com/data/vDyrHl8l/versions/qiZ49HIW/proxy-compatible-forge-1.3.1.jar
MOD_SHA512=dba5b70fedcb0f5fdc014801ab43e6d048f24b531de8aea5b70ea223760b66ae9fba3033c2ccd9d78793b9ea2f9d3b47ae1f4caa95aa129d989f97e63636b4ab
# NeoForge 26.1.2.126 installer, from the NeoForge Maven repository. The image reads NEOFORGE_INSTALLER as a local path.
INSTALLER_URL=https://maven.neoforged.net/releases/net/neoforged/neoforge/26.1.2.126/neoforge-26.1.2.126-installer.jar
INSTALLER_SHA256=1184ffee181bd7a940691539fea07f237096378da4c94795247ecdb9cb354a1b

secret_file=/run/secrets/velocity-forwarding
config=/data/config/proxy-compatible-forge.toml
mod=/data/mods/proxy-compatible-forge.jar
installer=/data/neoforge-installer.jar

# Drop the CR/LF that editors and echo leave behind; nothing else is removed.
secret=$(tr -d '\r\n' < "$secret_file")
if [ -z "$secret" ]; then
  echo "neoforge-entrypoint: $secret_file is empty; regenerate the scratch secrets (down, then up)" >&2
  exit 1
fi
# The value is written unquoted into TOML and sed, so refuse anything outside this set.
case "$secret" in
  *[!a-zA-Z0-9_-]*)
    echo "neoforge-entrypoint: $secret_file holds characters outside [A-Za-z0-9_-]; regenerate the scratch secrets" >&2
    exit 1
    ;;
esac

# Files written below are readable by their owner only.
umask 077

# fetch URL DEST HASH SUM: keeps DEST when it already has the pinned hash; otherwise downloads, checks the hash, and moves
# the file into place. A download that does not match is deleted and the script exits 1.
fetch() {
  if [ -f "$2" ] && printf '%s  %s\n' "$3" "$2" | "$4" -c -s; then
    return 0
  fi
  rm -f "$2.part"
  if ! curl -fsSL -o "$2.part" "$1"; then
    rm -f "$2.part"
    echo "neoforge-entrypoint: download of $2 failed" >&2
    exit 1
  fi
  if ! printf '%s  %s\n' "$3" "$2.part" | "$4" -c -s; then
    rm -f "$2.part" "$2"
    echo "neoforge-entrypoint: $2 does not match its pinned $4 hash; deleted it" >&2
    exit 1
  fi
  mv -f "$2.part" "$2"
}

mkdir -p /data/mods
fetch "$MOD_URL" "$mod" "$MOD_SHA512" sha512sum
fetch "$INSTALLER_URL" "$installer" "$INSTALLER_SHA256" sha256sum
# The image installs NeoForge from this local file (start-deployNeoForge reads NEOFORGE_INSTALLER as a path).
export NEOFORGE_INSTALLER="$installer"
chown --reference=/data /data/mods "$mod" "$installer"

# The mod's config, from its README layout. Written once; on later starts only the secret line is replaced, because the
# mod may have rewritten the file.
mkdir -p /data/config
if [ ! -e "$config" ]; then
  {
    echo '[forwarding]'
    echo 'enabled = true'
    echo 'mode = "MODERN"'
    printf 'secret = "%s"\n' "$secret"
    echo 'approvedProxyHosts = []'
    echo
    echo '[crossStitch]'
    echo 'enabled = true'
    echo
    echo '[advanced]'
    echo 'modernForwardingVersion = "NO_OVERRIDE"'
  } > "$config"
  chown --reference=/data /data/config "$config"
else
  sed -i "s|^\( *\)secret = .*|\1secret = \"$secret\"|" "$config"
fi
chmod 600 "$config"

# A file left by an older run may carry another secret or disable forwarding: refuse to start the server if so.
# The check is by grep; the secret is never printed.
if ! grep -Fq '[forwarding]' "$config" || ! grep -Fqx 'enabled = true' "$config" \
  || ! grep -Fqx 'mode = "MODERN"' "$config" || ! grep -Fq "secret = \"$secret\"" "$config"; then
  echo "neoforge-entrypoint: $config does not enable MODERN forwarding with the current secret; delete it and restart the neoforge service" >&2
  exit 1
fi

exec /image/scripts/start "$@"
