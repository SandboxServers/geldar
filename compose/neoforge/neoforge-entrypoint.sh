#!/bin/sh
# Entrypoint for the scratch NeoForge variant (SCRATCH_PLATFORM=neoforge, compose/opt-in/scratch-neoforge.yml): wraps the
# image's own start script. It fetches two artifacts, each checked against a pinned hash before use (fail closed): the
# NeoForge installer, which the image runs, and the Proxy Compatible Forge mod, which provides Velocity's modern
# forwarding. It writes the mod's config from the Docker secret at container start. The secret comes from /run/secrets
# only: never from an environment value or this file, and it is never printed.
# The GELDAR_NF_* variables are seams for the behaviour tests (scratch-neoforge-entrypoint.test.ts). Unset, each one is the
# real value: the data dir, the secret file, the config, the two URLs, the two pinned hashes and the start command.
# Optional extras (off unless set): a ledger jar (GELDAR_NF_LEDGER_SHA256 = its 64-hex pin, or the literal "off", which removes only
# our own stale copy and starts without the ledger), and the OpenTelemetry agent (GELDAR_NF_OTEL_AGENT=1 with its pin).
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
# The same installer's sha512, from the Maven's published .sha512 file. The installer must match both pins (fail closed).
INSTALLER_SHA512=${GELDAR_NF_INSTALLER_SHA512:-3ecc1cef40def9af5086449249dc621a860fb3c2af36084635396d152b5617560bfa0ace9376ef9ba05bfc9ab3d92348829472548e57e29a1fab4b63ad621bdb}

data=${GELDAR_NF_DATA_DIR:-/data}
secret_file=${GELDAR_NF_SECRET_FILE:-/run/secrets/velocity-forwarding}
config=${GELDAR_NF_CONFIG:-$data/config/proxy-compatible-forge.toml}
mod=$data/mods/proxy-compatible-forge.jar
installer=$data/neoforge-installer.jar
# The offline bundle's list (deploy/scratch/build-neoforge-bundle.sh writes it into the bundle as .geldar-bundle.sha256). Present
# means bundle mode: the bundle is checked before anything is fetched. Absent means the normal path.
bundle_list=${GELDAR_NF_BUNDLE_LIST:-$data/.geldar-bundle.sha256}
# The mod jar that compose/opt-in/scratch-neoforge-mod.yml mounts read-only (only when scratch.sh gets SCRATCH_NEOFORGE_MOD_JAR),
# and the copy of it this script makes in mods/. GELDAR_NF_MOD_JAR is the test seam for the mount path.
mounted_jar=${GELDAR_NF_MOD_JAR:-/geldar/mods/geldar-neoforge.jar}
mod_copy=$data/mods/geldar-neoforge.jar
# The second optional jar, the ledger (compose/opt-in/scratch-neoforge-ledger.yml mounts it read-only), its copy in mods/, and
# the OpenTelemetry agent's jar and properties (mounted outside /data, read-only, used in place, never copied). Same rules as the mod.
ledger_mounted=${GELDAR_NF_LEDGER_JAR:-/geldar/mods/geldar-ledger.jar}
ledger_copy=$data/mods/geldar-ledger.jar
agent_jar=${GELDAR_NF_OTEL_JAR:-/opt/otel/opentelemetry-javaagent.jar}
agent_props=${GELDAR_NF_OTEL_PROPS:-/opt/otel/otel-agent.properties}

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

# A copy left by an earlier start is removed first, but only while a mounted jar is present, so the bundle check below sees mods/
# as the bundle lists it. The copy is made again after that check (see the mounted jar block after the chown). With no mounted
# jar nothing is removed: the refusal in the else branch stops the start instead, in every mode.
if [ -e "$mounted_jar" ] || [ -L "$mounted_jar" ]; then
  rm -f "$mod_copy"
else
  # With no jar mounted, a geldar jar left in mods/ or a hash pin with no jar is refused before the bundle check. Only a
  # mounted jar is checked against the pin, so a foreign jar beside a mounted one is refused only in bundle mode (below).
  if [ -e "$mod_copy" ] || [ -L "$mod_copy" ]; then
    echo "neoforge-entrypoint: a geldar mod jar is present in mods/ but none is mounted; remove it or mount the pinned jar; refusing to start" >&2
    exit 1
  fi
  if [ -n "${GELDAR_NF_MOD_SHA256:-}" ]; then
    echo "neoforge-entrypoint: GELDAR_NF_MOD_SHA256 is set but no mod jar is mounted; refusing to start" >&2
    exit 1
  fi
fi

# The same for the ledger jar, with GELDAR_NF_LEDGER_SHA256 as its pin: a stale copy with no mounted jar, or a pin with no jar, stops the start.
# GELDAR_NF_LEDGER_SHA256=off is the operator's explicit soft kill: our own previous copy (exact name, no glob) is removed, no jar is
# required and the ledger is not copied. A regular file or a symlink (dangling too) is unlinked by rm -f, which never follows a link.
# A directory or any other non-file there is refused with exit 1: it is not ours to remove. An unset pin with a stale copy still refuses.
case "${GELDAR_NF_LEDGER_SHA256:-}" in
  off)
    if [ -L "$ledger_copy" ] || [ -f "$ledger_copy" ]; then
      rm -f "$ledger_copy"
    elif [ -e "$ledger_copy" ]; then
      echo "neoforge-entrypoint: the geldar ledger path in mods/ is a directory or other non-file; remove it; refusing to start" >&2
      exit 1
    fi
    ;;
  *)
    if [ -e "$ledger_mounted" ] || [ -L "$ledger_mounted" ]; then
      rm -f "$ledger_copy"
    else
      if [ -e "$ledger_copy" ] || [ -L "$ledger_copy" ]; then
        echo "neoforge-entrypoint: a geldar ledger jar is present in mods/ but none is mounted; remove it or mount the pinned jar, or set GELDAR_NF_LEDGER_SHA256=off; refusing to start" >&2
        exit 1
      fi
      if [ -n "${GELDAR_NF_LEDGER_SHA256:-}" ]; then
        echo "neoforge-entrypoint: GELDAR_NF_LEDGER_SHA256 is set but no ledger jar is mounted; refusing to start" >&2
        exit 1
      fi
    fi
    ;;
esac

# Bundle mode, before any fetch. The list holds the bundle's immutable files with their hashes; the image's start script rewrites
# some other files on every start, so they are not listed. The list is checked in this order: paths (no entry may reach outside
# the data dir), the required files, symlinks, strict hashes, then mods/ holds exactly the jars the list names. Only file names
# are printed, never contents. libraries/ may hold extra files: the classpath is fixed by unix_args.txt, so they are not on it.
if [ -f "$bundle_list" ]; then
  bad=$(awk '$2 ~ /^\// || $2 ~ /^[A-Za-z]:/ || $2 ~ /^-/ || $2 ~ /(^|\/)\.\.(\/|$)/ { print $2; exit }' "$bundle_list")
  if [ -n "$bad" ]; then
    echo "neoforge-entrypoint: offline bundle list names an absolute (/ or drive letter), dash-led or ../ path ($bad); refusing to start" >&2
    exit 1
  fi
  for f in .neoforge-manifest.json neoforge-installer.jar mods/proxy-compatible-forge.jar run.sh; do
    if ! awk -v f="$f" '$2 == f { found = 1 } END { exit !found }' "$bundle_list"; then
      echo "neoforge-entrypoint: offline bundle is incomplete: its list does not name $f; refusing to start" >&2
      exit 1
    fi
  done
  links=$(cd "$data" && find mods libraries -type l 2>/dev/null || true)
  if [ -n "$links" ]; then
    first_link=$(printf '%s\n' "$links" | head -n 1)
    echo "neoforge-entrypoint: offline bundle has symlinks under mods/ or libraries/ (first: $first_link); refusing to start" >&2
    exit 1
  fi
  # --strict: a malformed or truncated line is a failure, not a skipped line.
  if ! (cd "$data" && sha256sum -c --strict --status "$bundle_list"); then
    first=$(cd "$data" && sha256sum -c --strict "$bundle_list" 2>&1 | grep -v ': OK$' | head -n 1 || true)
    echo "neoforge-entrypoint: offline bundle check failed: ${first:-no listed file verified}; refusing to start" >&2
    exit 1
  fi
  listed_mods=$(awk '$2 ~ /^mods\// { print $2 }' "$bundle_list" | LC_ALL=C sort)
  extra=""
  for f in $(cd "$data" && find mods -type f | LC_ALL=C sort); do
    printf '%s\n' "$listed_mods" | grep -qxF -- "$f" || extra="$extra $f"
  done
  if [ -n "$extra" ]; then
    echo "neoforge-entrypoint: mods/ holds files the offline bundle does not list:$extra; refusing to start" >&2
    exit 1
  fi
  export NEOFORGE_FORCE_REINSTALL=false
fi

mkdir -p "$data/mods"
fetch "$MOD_URL" "$mod" "$MOD_SHA512" sha512sum MOD_SHA512
fetch "$INSTALLER_URL" "$installer" "$INSTALLER_SHA256" sha256sum INSTALLER_SHA256
# The installer must match its sha512 pin too. A file that passes the sha256 but not the sha512 is deleted, so the image never uses it.
if ! printf '%s  %s\n' "$INSTALLER_SHA512" "$installer" | sha512sum -c --status; then
  rm -f "$installer"
  echo "neoforge-entrypoint: $installer does not match its pinned sha512sum hash (INSTALLER_SHA512); deleted it" >&2
  exit 1
fi
# The image installs NeoForge from this local file (start-deployNeoForge reads NEOFORGE_INSTALLER as a path).
export NEOFORGE_INSTALLER="$installer"
chown --reference="$data" "$data/mods" "$mod" "$installer"

# True for exactly 64 lowercase hex digits. The case pattern (not a command substitution) so a newline anywhere is refused.
is_sha256_hex() {
  case "$1" in
    *[!0-9a-f]* | '') return 1 ;;
  esac
  [ "${#1}" -eq 64 ]
}

# copy_pinned_jar SRC DEST SHA LABEL ENVNAME: a mounted jar (the mod or the ledger) is copied into mods/ only after it matches SHA,
# the value of ENVNAME (the pin scratch.sh also checks on the host). A symlink or a non-file is refused; a missing, short, long or
# non-lowercase-hex hash is refused. Nothing is copied on a refusal. The copy is mode 644 with the data dir's owner, like the other
# written files, and is read back and hashed once more. Only file names and the fixed messages are printed, never the jar's bytes.
copy_pinned_jar() {
  rm -f "$2.part"
  if [ -L "$1" ] || [ ! -f "$1" ]; then
    echo "neoforge-entrypoint: $1 is a symlink or not a regular file; refusing to start" >&2
    exit 1
  fi
  if ! is_sha256_hex "$3"; then
    echo "neoforge-entrypoint: $5 is not 64 lowercase hex digits; refusing to start with a mounted $4 jar" >&2
    exit 1
  fi
  actual=$(sha256sum "$1" 2>/dev/null || true)
  actual=${actual%% *}
  if [ "$actual" != "$3" ]; then
    echo "neoforge-entrypoint: the mounted $4 jar does not match $5; not copied; refusing to start" >&2
    exit 1
  fi
  # The copy goes to $2.part and is renamed onto $2 only once its hash matches, so a kill or a full disk never leaves a partial jar
  # under the final name. A mismatch removes the .part and any final file.
  cp "$1" "$2.part"
  chmod 644 "$2.part"
  chown --reference="$data" "$2.part"
  copied=$(sha256sum "$2.part" 2>/dev/null || true)
  if [ "${copied%% *}" != "$3" ]; then
    rm -f "$2.part" "$2"
    echo "neoforge-entrypoint: the copy of the $4 jar in mods/ does not match $5; removed it; refusing to start" >&2
    exit 1
  fi
  mv -f "$2.part" "$2"
}

if [ -e "$mounted_jar" ] || [ -L "$mounted_jar" ]; then
  copy_pinned_jar "$mounted_jar" "$mod_copy" "${GELDAR_NF_MOD_SHA256:-}" mod GELDAR_NF_MOD_SHA256
fi
if [ "${GELDAR_NF_LEDGER_SHA256:-}" != off ] && { [ -e "$ledger_mounted" ] || [ -L "$ledger_mounted" ]; }; then
  copy_pinned_jar "$ledger_mounted" "$ledger_copy" "${GELDAR_NF_LEDGER_SHA256:-}" ledger GELDAR_NF_LEDGER_SHA256
fi

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

# The OpenTelemetry Java agent, only with GELDAR_NF_OTEL_AGENT=1 (unset or 0 adds nothing). The itzg image's JVM_OPTS
# (appended to, never replaced) is meant to reach the java command (the start script writes it into user_jvm_args.txt for the
# NeoForge run.sh branch); that is UNVERIFIED on the pinned image, and no check or command run runs it. The jar is mounted read-only outside /data and is never copied; it must match GELDAR_NF_OTEL_AGENT_SHA256.
# The properties file must be present. Only the fixed messages are printed, never either file's contents.
case "${GELDAR_NF_OTEL_AGENT:-0}" in
  0) ;;
  1)
    case "$agent_jar$agent_props" in
      *[[:space:]]*)
        echo "neoforge-entrypoint: the OpenTelemetry agent paths must not contain whitespace (JVM_OPTS splits on it); refusing to start" >&2
        exit 1
        ;;
    esac
    if [ -L "$agent_jar" ] || [ ! -f "$agent_jar" ]; then
      echo "neoforge-entrypoint: $agent_jar is missing, a symlink or not a regular file; refusing to start" >&2
      exit 1
    fi
    if [ -L "$agent_props" ] || [ ! -f "$agent_props" ]; then
      echo "neoforge-entrypoint: $agent_props is missing, a symlink or not a regular file; refusing to start" >&2
      exit 1
    fi
    agent_sha=${GELDAR_NF_OTEL_AGENT_SHA256:-}
    if ! is_sha256_hex "$agent_sha"; then
      echo "neoforge-entrypoint: GELDAR_NF_OTEL_AGENT_SHA256 is not 64 lowercase hex digits; refusing to start with the OpenTelemetry agent" >&2
      exit 1
    fi
    actual=$(sha256sum "$agent_jar" 2>/dev/null || true)
    actual=${actual%% *}
    if [ "$actual" != "$agent_sha" ]; then
      echo "neoforge-entrypoint: the OpenTelemetry agent jar does not match GELDAR_NF_OTEL_AGENT_SHA256; refusing to start" >&2
      exit 1
    fi
    JVM_OPTS="${JVM_OPTS:-} -javaagent:$agent_jar -Dotel.javaagent.configuration-file=$agent_props"
    export JVM_OPTS
    ;;
  *)
    echo "neoforge-entrypoint: GELDAR_NF_OTEL_AGENT must be 1 or 0 (or unset); refusing to start" >&2
    exit 1
    ;;
esac

exec "${GELDAR_NF_START:-/image/scripts/start}" "$@"
