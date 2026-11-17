#!/bin/sh
# Entrypoint for the scratch NeoForge variant (SCRATCH_PLATFORM=neoforge, compose/opt-in/scratch-neoforge.yml): wraps the
# image's own start script. It fetches two artifacts, each checked against a pinned hash before use (fail closed): the
# NeoForge installer, which the image runs, and the Proxy Compatible Forge mod, which provides Velocity's modern
# forwarding. It writes the mod's config from the Docker secret at container start. The secret comes from /run/secrets
# only: never from an environment value or this file, and it is never printed.
# The GELDAR_NF_* variables are seams for the behaviour tests (scratch-neoforge-entrypoint.test.ts). Unset, each one is the
# real value: the data dir, the secret file, the config, the two URLs, the two pinned hashes and the start command.
set -eu

# NeoForge version from the environment (compose/opt-in/scratch-neoforge.yml sets it). Only the 26.1.2 line is accepted,
# and the installer URL is built from it. The pinned sha256 below refuses any other installer, so a different build
# cannot pass even if its URL is valid.
if ! printf '%s\n' "${NEOFORGE_VERSION:-}" | grep -Eq '^26\.1\.2\.[0-9]+$'; then
  echo "neoforge-entrypoint: NEOFORGE_VERSION is unset or not 26.1.2 build N; refusing to start" >&2
  exit 1
fi
INSTALLER_URL="${GELDAR_NF_INSTALLER_URL:-https://maven.neoforged.net/releases/net/neoforged/neoforge/${NEOFORGE_VERSION}/neoforge-${NEOFORGE_VERSION}-installer.jar}"
# Proxy Compatible Forge 1.3.1, published 2026-08-31, Modrinth
MOD_URL=${GELDAR_NF_MOD_URL:-https://cdn.modrinth.com/data/vDyrHl8l/versions/qiZ49HIW/proxy-compatible-forge-1.3.1.jar}
MOD_SHA512=${GELDAR_NF_MOD_SHA512:-dba5b70fedcb0f5fdc014801ab43e6d048f24b531de8aea5b70ea223760b66ae9fba3033c2ccd9d78793b9ea2f9d3b47ae1f4caa95aa129d989f97e63636b4ab}
# NeoForge 26.1.2 build 126 installer sha256, from the NeoForge Maven repository. The image reads NEOFORGE_INSTALLER as a local path.
INSTALLER_SHA256=${GELDAR_NF_INSTALLER_SHA256:-1184ffee181bd7a940691539fea07f237096378da4c94795247ecdb9cb354a1b}

data=${GELDAR_NF_DATA_DIR:-/data}
secret_file=${GELDAR_NF_SECRET_FILE:-/run/secrets/velocity-forwarding}
config=${GELDAR_NF_CONFIG:-$data/config/proxy-compatible-forge.toml}
mod=$data/mods/proxy-compatible-forge.jar
installer=$data/neoforge-installer.jar

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

# fetch URL DEST HASH SUM PIN: keeps DEST when it already has the pinned hash, so a file pre-seeded into the volume with the
# right hash is used and curl is never called. Otherwise downloads (6 retries, 10 s apart, on any error), checks the hash,
# and moves the file into place. A download that does not match is deleted and the script exits 1. PIN names the script
# constant holding the hash, for the error message.
fetch() {
  if [ -f "$2" ] && printf '%s  %s\n' "$3" "$2" | "$4" -c --status; then
    return 0
  fi
  rm -f "$2.part"
  if ! curl -fsSL --connect-timeout 60 --max-time 900 --retry 6 --retry-delay 10 --retry-all-errors -o "$2.part" "$1"; then
    rm -f "$2.part"
    echo "neoforge-entrypoint: download of $2 failed after retries. To pre-seed it, put a file at $2 (inside the container) whose $4 matches the pin $5 in compose/neoforge/neoforge-entrypoint.sh, then start again. See docs/runbooks/scratch-stack.md." >&2
    exit 1
  fi
  if ! printf '%s  %s\n' "$3" "$2.part" | "$4" -c --status; then
    rm -f "$2.part" "$2"
    echo "neoforge-entrypoint: $2 does not match its pinned $4 hash; deleted it" >&2
    exit 1
  fi
  mv -f "$2.part" "$2"
}

mkdir -p "$data/mods"
fetch "$MOD_URL" "$mod" "$MOD_SHA512" sha512sum MOD_SHA512
fetch "$INSTALLER_URL" "$installer" "$INSTALLER_SHA256" sha256sum INSTALLER_SHA256
# The image installs NeoForge from this local file (start-deployNeoForge reads NEOFORGE_INSTALLER as a path).
export NEOFORGE_INSTALLER="$installer"
chown --reference="$data" "$data/mods" "$mod" "$installer"

# The mod's config, from its README layout. Written once; on later starts only the secret line is replaced, because the
# mod may have rewritten the file.
cfgdir=$(dirname "$config")
mkdir -p "$cfgdir"
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
  chown --reference="$data" "$cfgdir" "$config"
else
  sed -i "s|^\( *\)secret = .*|\1secret = \"$secret\"|" "$config"
fi
chmod 600 "$config"

# A file left by an older run may carry another secret or disable forwarding: refuse to start the server if so. The check
# is awk scoped to the [forwarding] section (enabled = true, mode = "MODERN" and the secret line must all be in it), so a
# line in another section cannot pass. The secret is never printed.
if ! awk -v secret="$secret" '
  /^\[/ { inforwarding = ($0 == "[forwarding]") }
  inforwarding && $0 == "enabled = true" { enabled = 1 }
  inforwarding && $0 == "mode = \"MODERN\"" { mode = 1 }
  inforwarding && $0 == "secret = \"" secret "\"" { found = 1 }
  END { exit !(enabled && mode && found) }
' "$config"; then
  echo "neoforge-entrypoint: $config does not enable MODERN forwarding with the current secret; delete it and restart the neoforge service" >&2
  exit 1
fi

exec "${GELDAR_NF_START:-/image/scripts/start}" "$@"
