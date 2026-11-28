#!/bin/sh
# Throwaway scratch stack for the sheet campaign validation (see docs/runbooks/scratch-stack.md).
# Usage: sh deploy/scratch/scratch.sh up|status|down|probe [suffix]
# The project is always scratch-<suffix> (suffix [a-z0-9]{1,9}, default a). Exit codes: 2 usage or NATS auth refused,
# 3 resource gate failed, 1 anything else. On 2 and 3 nothing is started.
# NATS fails closed: up needs SCRATCH_NATS_AUTH_DIR, a readable directory holding the five generated files
# (nats-auth.conf, nats-paper.txt, nats-velocity.txt, nats-eventsink.txt, nats-seed.txt). probe needs six: those five and
# nats-body.txt (the body NATS password, read only by the p0-probe one-shot). Open NATS (SCRATCH_NATS_OPEN=1) is
# refused, exit 2: the identity seed needs the auth dir. Secrets live in a per-user state directory, not a shared temp directory; down removes only that
# directory.
# Ports: deploy/scratch/<suffix>.env (SCRATCH_*_PORT lines only) is read by this script; required for telemetry.
# SCRATCH_PLATFORM=neoforge adds compose/opt-in/scratch-neoforge.yml (the NeoForge game server); unset or paper is the default.
# SCRATCH_NEOFORGE_MOD_JAR and SCRATCH_NEOFORGE_MOD_SHA256 (neoforge only, both or neither) mount one mod jar read-only. up checks
# them on the host (path shape, the jar's sha256) and refuses with exit 2. down, status and probe never refuse on them: a malformed
# or missing pair only leaves the mod overlay out, so a project can always be torn down.
set -u
umask 077

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RAM_MIN_KB=10485760  # 10 GB free RAM gate
DISK_MIN_KB=20971520 # 20 GB free disk gate: the repo filesystem and the Docker data root, the smaller figure counts
MIN_COMPOSE=2.24.4   # the !override tag in compose/opt-in/scratch.yml needs this compose or newer
NATS_FILES="nats-auth.conf nats-paper.txt nats-velocity.txt nats-eventsink.txt nats-seed.txt"
PROBE_NATS_FILES="$NATS_FILES nats-body.txt"
VELOCITY_JAR="plugin/velocity-identity/build/libs/geldar-velocity-identity.jar"
PLUGIN_JARS="plugin/core/build/libs/geldar-core.jar $VELOCITY_JAR"
# The NeoForge game server runs the forwarding mod instead of geldar-core, so only the Velocity identity jar is checked.
NEOFORGE_PLUGIN_JARS="$VELOCITY_JAR"

usage() {
  echo "usage: sh deploy/scratch/scratch.sh up|status|down|probe|mind-up|mind-token|config [suffix] [player]" >&2
  exit 2
}

verb=${1:-}
suffix=${2:-a}
case "$verb" in
  up | status | down | probe | mind-up | mind-token | config) ;;
  *) usage ;;
esac
case "$suffix" in
  '' | *[!a-z0-9]*)
    echo "suffix must match [a-z0-9]{1,9}" >&2
    exit 2
    ;;
esac
if [ "${#suffix}" -gt 9 ]; then
  echo "suffix must match [a-z0-9]{1,9}" >&2
  exit 2
fi
PROJECT="scratch-$suffix"
PLATFORM=${SCRATCH_PLATFORM:-paper}

# Host ports for this project come from deploy/scratch/<suffix>.env, which this script parses itself (never sourced, so
# nothing in it runs). Only the port keys are accepted (SCRATCH_RCON_PORT for paper and neoforge, SCRATCH_MCP_PORT for the mind),
# with digit values 1 to 65535; anything else exits 2. A variable the operator already set wins over the file. The file is required for telemetry and optional otherwise.
load_ports() {
  portfile="$ROOT/deploy/scratch/$suffix.env"
  if [ ! -f "$portfile" ]; then
    if [ "$suffix" = telemetry ]; then
      echo "scratch: deploy/scratch/telemetry.env is missing; nothing started" >&2
      exit 2
    fi
    return 0
  fi
  while IFS='=' read -r key val || [ -n "$key" ]; do
    case "$key" in '' | '#'*) continue ;; esac
    case "$key" in
      SCRATCH_PG_PORT) cur=${SCRATCH_PG_PORT:-} ;;
      SCRATCH_NATS_PORT) cur=${SCRATCH_NATS_PORT:-} ;;
      SCRATCH_NATS_MON_PORT) cur=${SCRATCH_NATS_MON_PORT:-} ;;
      SCRATCH_MC_PORT) cur=${SCRATCH_MC_PORT:-} ;;
      SCRATCH_RCON_PORT) cur=${SCRATCH_RCON_PORT:-} ;;
      SCRATCH_MCP_PORT) cur=${SCRATCH_MCP_PORT:-} ;;
      SCRATCH_HUMAN_PORT) cur=${SCRATCH_HUMAN_PORT:-} ;;
      *)
        echo "scratch: $portfile: unknown key; nothing started" >&2
        exit 2
        ;;
    esac
    case "$val" in
      '' | *[!0-9]*)
        echo "scratch: $portfile: $key must be digits only; nothing started" >&2
        exit 2
        ;;
    esac
    if [ "${#val}" -gt 5 ] || [ "$val" -lt 1 ] || [ "$val" -gt 65535 ]; then
      echo "scratch: $portfile: $key must be 1 to 65535; nothing started" >&2
      exit 2
    fi
    [ -n "$cur" ] || export "$key=$val"
  done <"$portfile"
}
load_ports

# Paths the script uses must be absolute and one line: a relative or multi-line path would reach the compose files.
# A drive-letter path counts only where uname does not say Linux: the Windows host runs this script under MSYS sh.
is_abs() {
  case "$1" in
    /*) return 0 ;;
  esac
  if [ "$(uname -s)" != Linux ]; then
    case "$1" in
      [A-Za-z]:/* | [A-Za-z]:\\*) return 0 ;;
    esac
  fi
  return 1
}

has_newline() {
  nl=$(printf '\n_')
  nl=${nl%_}
  case "$1" in
    *"$nl"*) return 0 ;;
  esac
  return 1
}

check_state_base() {
  if ! is_abs "$STATE_BASE" || has_newline "$STATE_BASE"; then
    echo "scratch: XDG_STATE_HOME must be an absolute path with no newline; nothing started" >&2
    exit 2
  fi
}

# Per-user state. The secrets of one project live in $STATE_ROOT/$PROJECT, created 0700 by mkdir (which fails on an
# existing file or symlink). The NATS override that points at the caller's auth dir lives inside that directory too.
STATE_BASE="${XDG_STATE_HOME:-${HOME:?HOME must be set}/.local/state}"
check_state_base
STATE_ROOT="$STATE_BASE/geldar-scratch"
SECRETS="$STATE_ROOT/$PROJECT"
NATS_OVERRIDE="$SECRETS/nats-override.yml"
STARTED=0

# Takes the list of file names to check; up checks NATS_FILES (five), probe checks PROBE_NATS_FILES (six).
nats_dir_ok() {
  files=${1:-$NATS_FILES}
  [ -d "$SCRATCH_NATS_AUTH_DIR" ] && [ -r "$SCRATCH_NATS_AUTH_DIR" ] || return 1
  for f in $files; do
    [ -f "$SCRATCH_NATS_AUTH_DIR/$f" ] && [ -r "$SCRATCH_NATS_AUTH_DIR/$f" ] && [ -s "$SCRATCH_NATS_AUTH_DIR/$f" ] || return 1
  done
  return 0
}

# The NATS gate. Runs first, before any file is written or any container is started.
check_nats() {
  if [ "${SCRATCH_NATS_OPEN:-}" = 1 ]; then
    echo "scratch: open NATS (SCRATCH_NATS_OPEN=1) is not supported: the identity seed needs the NATS auth dir. Set SCRATCH_NATS_AUTH_DIR to a directory holding the five files made by ./geldar.ps1 shard nats-auth phase0 --scratch in a clean git archive export. Nothing started." >&2
    exit 2
  fi
  if [ -n "${SCRATCH_NATS_AUTH_DIR:-}" ]; then
    if ! is_abs "$SCRATCH_NATS_AUTH_DIR" || has_newline "$SCRATCH_NATS_AUTH_DIR"; then
      echo "scratch: SCRATCH_NATS_AUTH_DIR must be an absolute path with no newline; nothing started" >&2
      exit 2
    fi
    if ! nats_dir_ok; then
      echo "scratch: SCRATCH_NATS_AUTH_DIR must be a readable directory holding non-empty $NATS_FILES; nothing started" >&2
      exit 2
    fi
    case "$SCRATCH_NATS_AUTH_DIR" in
      *'"'* | *'\'* | *'$'*)
        echo "scratch: SCRATCH_NATS_AUTH_DIR must not contain quotes, backslashes or dollar signs; nothing started" >&2
        exit 2
        ;;
    esac
    return 0
  fi
  echo "scratch: NATS auth is required. Set SCRATCH_NATS_AUTH_DIR to a directory holding the five files made by" >&2
  echo "scratch: run ./geldar.ps1 shard nats-auth phase0 --scratch in a clean git archive export (no .git), not in a checkout; see the runbook, NATS auth section. Nothing started." >&2
  exit 2
}

write_nats_override() {
  files=${1:-$NATS_FILES}
  {
    echo "# Written by deploy/scratch/scratch.sh. Points the nats-auth.yml secrets at the caller's auth dir."
    echo "secrets:"
    for f in $files; do
      echo "  $f:"
      echo "    file: \"$SCRATCH_NATS_AUTH_DIR/$f\""
    done
  } >"$NATS_OVERRIDE"
}

# Compose with the phase0 base and the scratch overlay. The -f list is built by prepending, last file first, so the
# command line reads: -p, phase0, nats-auth (only when the override exists), scratch, compose/opt-in/scratch-telemetry.yml
# (only for the project scratch-telemetry), the NeoForge overlay (only for SCRATCH_PLATFORM=neoforge; its ledger, mod and telemetry-sink overlays follow it, in that order), and the NATS override last so its file paths win. The verb arguments follow unchanged.
compose_run() {
  if [ -f "$NATS_OVERRIDE" ]; then
    set -- -f "$NATS_OVERRIDE" "$@"
  fi
  [ "$PLATFORM" = neoforge ] && [ -n "${GELDAR_NF_SINK_FILE:-}" ] && set -- -f "$GELDAR_NF_SINK_FILE" "$@"
  [ "$PLATFORM" = neoforge ] && [ -n "${GELDAR_NF_MOD_JAR_HOST:-}" ] && set -- -f "$ROOT/compose/opt-in/scratch-neoforge-mod.yml" "$@"
  [ "$PLATFORM" = neoforge ] && [ -n "${GELDAR_NF_LEDGER_FILE:-}" ] && set -- -f "$GELDAR_NF_LEDGER_FILE" "$@"
  [ "$PLATFORM" = neoforge ] && [ "${SCRATCH_EXTRA_MODS:-}" = 1 ] && set -- -f "$ROOT/compose/opt-in/scratch-neoforge-extra-mods.yml" "$@"
  [ "$PLATFORM" = neoforge ] && set -- -f "$ROOT/compose/opt-in/scratch-neoforge.yml" "$@"
  if [ "$PROJECT" = scratch-telemetry ]; then
    set -- -f "$ROOT/compose/opt-in/scratch-telemetry.yml" "$@"
  fi
  if [ "$verb" = probe ]; then
    set -- -f "$ROOT/compose/opt-in/scratch-probe.yml" "$@"
  fi
  if [ "$verb" = mind-up ] || [ "$verb" = mind-token ]; then
    set -- -f "$ROOT/compose/opt-in/scratch-mind.yml" "$@"
  fi
  set -- -f "$ROOT/compose/opt-in/scratch.yml" "$@"
  # The human listener (scratch-human.sh): up adds it only with SCRATCH_HUMAN_LANE=1; down and status always do, so its volume and container go with the project.
  { [ "${SCRATCH_HUMAN_LANE:-}" = 1 ] || [ "$verb" = down ] || [ "$verb" = status ]; } && set -- -f "$ROOT/compose/opt-in/scratch-human.yml" "$@"
  if [ -f "$NATS_OVERRIDE" ]; then
    set -- -f "$ROOT/compose/nats-auth.yml" "$@"
  fi
  set -- -p "$PROJECT" -f "$ROOT/compose/phase0.yml" "$@"
  docker compose "$@"
}

# True for exactly 64 lowercase hex digits. A case pattern, not a command substitution: $(...) would drop a trailing newline.
is_sha256_hex() {
  case "$1" in
    *[!0-9a-f]* | '') return 1 ;;
  esac
  [ "${#1}" -eq 64 ]
}

# SCRATCH_NEOFORGE_MOD_JAR and SCRATCH_NEOFORGE_MOD_SHA256 mount one mod jar into the NeoForge server, read-only. Both or
# neither, and only with SCRATCH_PLATFORM=neoforge. The jar must be a readable regular file (not a symlink) at an absolute path
# with no newline, quotes, backslashes or dollar signs; the hash must be 64 lowercase hex digits. Refusals exit 2, before compose.
check_mod_env() {
  jar=${SCRATCH_NEOFORGE_MOD_JAR:-}
  sha=${SCRATCH_NEOFORGE_MOD_SHA256:-}
  if [ -z "$jar" ] && [ -z "$sha" ]; then
    return 0
  fi
  if [ "$PLATFORM" != neoforge ]; then
    echo "scratch: the mod jar variables need SCRATCH_PLATFORM=neoforge; nothing started" >&2
    exit 2
  fi
  if [ -z "$jar" ] || [ -z "$sha" ]; then
    echo "scratch: set both SCRATCH_NEOFORGE_MOD_JAR and SCRATCH_NEOFORGE_MOD_SHA256, or neither; nothing started" >&2
    exit 2
  fi
  if ! is_abs "$jar" || has_newline "$jar"; then
    echo "scratch: SCRATCH_NEOFORGE_MOD_JAR must be an absolute path with no newline; nothing started" >&2
    exit 2
  fi
  case "$jar" in
    *'"'* | *'\'* | *'$'*)
      echo "scratch: SCRATCH_NEOFORGE_MOD_JAR must not contain quotes, backslashes or dollar signs; nothing started" >&2
      exit 2
      ;;
  esac
  if [ -L "$jar" ] || [ ! -f "$jar" ] || [ ! -r "$jar" ]; then
    echo "scratch: SCRATCH_NEOFORGE_MOD_JAR must be a readable regular file, not a symlink; nothing started" >&2
    exit 2
  fi
  if ! is_sha256_hex "$sha"; then
    echo "scratch: SCRATCH_NEOFORGE_MOD_SHA256 must be exactly 64 lowercase hex digits; nothing started" >&2
    exit 2
  fi
}

# True when the pair is well formed enough to render the overlay: both set, the path shape check_mod_env applies, the hash shape.
# The file is not read here, and nothing exits, so status, down and probe run whatever the jar's state.
mod_render_ok() {
  mjar=${SCRATCH_NEOFORGE_MOD_JAR:-}
  msha=${SCRATCH_NEOFORGE_MOD_SHA256:-}
  [ "$PLATFORM" = neoforge ] || return 1
  [ -n "$mjar" ] && [ -n "$msha" ] || return 1
  is_abs "$mjar" && ! has_newline "$mjar" || return 1
  case "$mjar" in
    *'"'* | *'\'* | *'$'*) return 1 ;;
  esac
  is_sha256_hex "$msha"
}

# up only, before compose: the jar's real sha256 on the host must equal SCRATCH_NEOFORGE_MOD_SHA256. The entrypoint checks it
# again inside the container. The jar's bytes are never printed.
check_mod_sha() {
  [ -n "${SCRATCH_NEOFORGE_MOD_JAR:-}" ] || return 0
  actual=$(sha256sum "$SCRATCH_NEOFORGE_MOD_JAR" 2>/dev/null || true)
  actual=${actual%% *}
  if [ "$actual" != "$SCRATCH_NEOFORGE_MOD_SHA256" ]; then
    echo "scratch: the sha256 of SCRATCH_NEOFORGE_MOD_JAR does not match SCRATCH_NEOFORGE_MOD_SHA256; nothing started" >&2
    exit 2
  fi
}

# Sets the variables the overlay reads. Status and down use the same paths; compose only needs them set.
set_env() {
  case "$PLATFORM" in
    paper | neoforge) ;;
    *)
      echo "scratch: SCRATCH_PLATFORM must be paper or neoforge; nothing started" >&2
      exit 2
      ;;
  esac
  GELDAR_WORLD_VOLUME="${PROJECT}_paper-data"
  SCRATCH_SECRETS_DIR="$SECRETS"
  # The eventsink runs as this account's uid:gid (compose/opt-in/scratch.yml), so it reads the 0600 files this account owns.
  SCRATCH_RUN_UID=$(id -u)
  SCRATCH_RUN_GID=$(id -g)
  export GELDAR_WORLD_VOLUME SCRATCH_SECRETS_DIR SCRATCH_RUN_UID SCRATCH_RUN_GID
  # Empty unless the pair is well formed (mod_render_ok); compose_run adds the mod overlay only for a non-empty jar path.
  # do_up runs check_mod_env, which refuses a malformed pair. The other verbs never refuse on the pair.
  GELDAR_NF_MOD_JAR_HOST=
  GELDAR_NF_MOD_SHA256=
  if mod_render_ok; then
    GELDAR_NF_MOD_JAR_HOST=$SCRATCH_NEOFORGE_MOD_JAR
    GELDAR_NF_MOD_SHA256=$SCRATCH_NEOFORGE_MOD_SHA256
  fi
  export GELDAR_NF_MOD_JAR_HOST GELDAR_NF_MOD_SHA256
  # The ledger jar, the telemetry agent and the OTLP sink (SCRATCH_NEOFORGE_TELEMETRY_SINK; scratch-ledger.sh, sourced only when one of their variables is set; up refuses on them there).
  GELDAR_NF_SINK_FILE=; [ -z "${SCRATCH_NEOFORGE_LEDGER_JAR:-}${SCRATCH_NEOFORGE_LEDGER_SHA256:-}${SCRATCH_LEDGER_PROPS:-}${SCRATCH_NEOFORGE_OTEL_AGENT_JAR:-}${SCRATCH_NEOFORGE_TELEMETRY:-}${SCRATCH_NEOFORGE_OTEL_AGENT_PROPS:-}${SCRATCH_NEOFORGE_TELEMETRY_SINK:-}" ] || { . "$ROOT/deploy/scratch/scratch-ledger.sh"; ledger_set_env; }
}

# Any non-root account may run. GELDAR_SERVICE_UID, when set, must be this account's uid. The secret modes never change:
# the eventsink is started as the account (set_env), so no file is made readable to another uid.
check_uid() {
  if [ -n "${GELDAR_SERVICE_UID:-}" ]; then
    case "$GELDAR_SERVICE_UID" in
      *[!0-9]*)
        echo "scratch: GELDAR_SERVICE_UID must be digits only (a uid such as 1001); nothing started" >&2
        exit 2
        ;;
    esac
  fi
  if [ "$SCRATCH_RUN_UID" = 0 ]; then
    echo "scratch: run as a non-root account; nothing started" >&2
    exit 1
  fi
  if [ -n "${GELDAR_SERVICE_UID:-}" ] && [ "$GELDAR_SERVICE_UID" != "$SCRATCH_RUN_UID" ]; then
    echo "scratch: run as uid $GELDAR_SERVICE_UID (GELDAR_SERVICE_UID), but this account is uid $SCRATCH_RUN_UID; nothing started" >&2
    exit 1
  fi
  check_container_uid
}

# SCRATCH_CONTAINER_UID is the uid the eventsink image was built for (its Dockerfile says node, 1000). It is only checked
# and reported: the eventsink runs as this account whatever it says, so nothing else depends on it.
check_container_uid() {
  if [ -n "${SCRATCH_CONTAINER_UID+set}" ]; then
    case "$SCRATCH_CONTAINER_UID" in
      '' | *[!0-9]*)
        echo "scratch: SCRATCH_CONTAINER_UID must be digits only (the uid the eventsink image was built for); nothing started" >&2
        exit 2
        ;;
    esac
    if [ "$SCRATCH_CONTAINER_UID" -eq 0 ]; then
      echo "scratch: SCRATCH_CONTAINER_UID must not be 0 (root); nothing started" >&2
      exit 2
    fi
    if [ "$SCRATCH_CONTAINER_UID" != "$SCRATCH_RUN_UID" ]; then
      echo "scratch: the eventsink runs as uid $SCRATCH_RUN_UID (this account), not the image's uid $SCRATCH_CONTAINER_UID" >&2
    fi
  fi
}

check_plugins() {
  jars=$PLUGIN_JARS
  if [ "$PLATFORM" = neoforge ]; then
    jars=$NEOFORGE_PLUGIN_JARS
  fi
  for jar in $jars; do
    if [ ! -f "$ROOT/$jar" ]; then
      echo "scratch: missing $jar; build the plugins first: cd plugin; ./gradlew build (see the runbook). Nothing started." >&2
      exit 1
    fi
  done
}

check_compose() {
  v=$(docker compose version --short 2>/dev/null) || {
    echo "scratch: docker compose is not available; nothing started" >&2
    exit 1
  }
  v=${v%%-*}
  case "$v" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *)
      echo "scratch: cannot read the compose version; need $MIN_COMPOSE or newer; nothing started" >&2
      exit 1
      ;;
  esac
  if ! awk -v have="$v" -v need="$MIN_COMPOSE" 'BEGIN {
      split(have, h, "."); split(need, n, ".")
      for (i = 1; i <= 3; i++) {
        if (h[i] + 0 > n[i] + 0) exit 0
        if (h[i] + 0 < n[i] + 0) exit 1
      }
      exit 0 }'; then
    echo "scratch: compose $v is older than $MIN_COMPOSE; nothing started" >&2
    exit 1
  fi
}

free_ram_kb() {
  if [ "$(uname -s)" = Linux ]; then
    awk '/^MemAvailable:/ { print $2 }' /proc/meminfo 2>/dev/null
  else
    powershell.exe -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory" 2>/dev/null | tr -d '\r'
  fi
}

free_kb() {
  df -Pk "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

# A value the gate can compare: digits only, not empty.
is_kb() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
  esac
  return 0
}

gb() {
  awk -v kb="$1" 'BEGIN { printf "%.1f GB", kb / 1048576 }'
}

gate() {
  root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null) || root=""
  ram=$(free_ram_kb)
  disk_repo=$(free_kb "$ROOT")
  disk_docker=""
  if [ -n "$root" ]; then
    disk_docker=$(free_kb "$root")
  fi
  if ! is_kb "$ram" || ! is_kb "$disk_repo" || ! is_kb "$disk_docker"; then
    echo "gate: could not read free RAM or free disk as numbers (Docker root: '${root:-unknown}'); nothing started" >&2
    exit 3
  fi
  disk=$disk_repo
  if [ "$disk_docker" -lt "$disk" ]; then
    disk=$disk_docker
  fi
  echo "gate: free RAM $(gb "$ram") (need 10 GB), free disk $(gb "$disk") (need 20 GB, the smaller of $ROOT and Docker root $root)"
  if [ "$ram" -ge "$RAM_MIN_KB" ] && [ "$disk" -ge "$DISK_MIN_KB" ]; then
    return 0
  fi
  echo "gate failed: free RAM below 10 GB or free disk below 20 GB; nothing started" >&2
  exit 3
}

# Per-user state directory: created 0700, refused if it is a symlink or not owned by the caller.
ensure_state() {
  mkdir -p "$STATE_ROOT" || {
    echo "scratch: cannot create $STATE_ROOT; nothing started" >&2
    exit 1
  }
  if [ -L "$STATE_ROOT" ] || [ ! -O "$STATE_ROOT" ]; then
    echo "scratch: $STATE_ROOT is a symlink or not owned by you; nothing started" >&2
    exit 1
  fi
  chmod 700 "$STATE_ROOT"
}

# A 64-hex-digit random value. Written to files only, never printed.
random_secret() {
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

fill_secrets() {
  dir=$1
  printf '%s' "$(random_secret)" >"$dir/postgres.txt"
  printf '%s' "$(random_secret)" >"$dir/rcon.txt"
  printf '%s' "$(random_secret)" >"$dir/velocity-forwarding.txt"
}

# Removes the secrets directory of a failed up that never reached compose up.
on_exit() {
  if [ "$STARTED" = 0 ] && [ -d "$SECRETS" ] && [ ! -L "$SECRETS" ] && [ -O "$SECRETS" ]; then
    rm -rf "$SECRETS"
  fi
}

# True only for the one directory this script makes for this project: a real directory the caller owns.
secrets_removable() {
  case "$SECRETS" in
    "$STATE_ROOT"/scratch-*) ;;
    *) return 1 ;;
  esac
  case "$SECRETS" in
    *..*) return 1 ;;
  esac
  [ -d "$SECRETS" ] && [ ! -L "$SECRETS" ] && [ -O "$SECRETS" ]
}

do_up() {
  set_env
  check_mod_env; [ -z "${SCRATCH_EXTRA_MODS:-}" ] || { . "$ROOT/deploy/scratch/scratch-extra-mods.sh"; extra_mods_check; }
  check_nats
  check_mod_sha
  if [ -n "${SCRATCH_HUMAN_LANE:-}" ]; then
    . "$ROOT/deploy/scratch/scratch-human.sh"
    check_human_lane
  fi
  check_compose
  gate
  check_plugins
  check_uid
  ensure_state
  # Leftover containers are listed by the compose project label, so no compose project is loaded before the secrets exist.
  existing=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT") || {
    echo "scratch: docker ps failed (is docker running?); nothing started" >&2
    exit 1
  }
  if [ -n "$existing" ]; then
    echo "project $PROJECT already has containers; run: sh deploy/scratch/scratch.sh down $suffix" >&2
    exit 1
  fi
  if [ -e "$SECRETS" ] || [ -L "$SECRETS" ]; then
    echo "secrets for $PROJECT already exist ($SECRETS); run down first" >&2
    exit 1
  fi
  mkdir "$SECRETS" || {
    echo "scratch: cannot create $SECRETS; nothing started" >&2
    exit 1
  }
  trap on_exit EXIT
  fill_secrets "$SECRETS"
  if [ -n "${SCRATCH_NATS_AUTH_DIR:-}" ]; then
    write_nats_override
  fi
  STARTED=1
  if ! compose_run up -d --wait --build; then
    echo "up failed; clean up with: sh deploy/scratch/scratch.sh down $suffix" >&2
    exit 1
  fi
  do_status
}

do_status() {
  set_env
  if [ -f "$NATS_OVERRIDE" ]; then
    echo "NATS auth: the five files from the SCRATCH_NATS_AUTH_DIR given to up"
  elif [ -d "$SECRETS" ]; then
    echo "NATS auth: no override for $PROJECT (not started with SCRATCH_NATS_AUTH_DIR); run down to remove its state"
  else
    echo "no scratch stack state for $PROJECT (never started, or down has run)"
  fi
  compose_run ps
  ids=$(compose_run ps -q)
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' $ids
  fi
}

do_down() {
  set_env
  if ! compose_run down -v --rmi local --remove-orphans; then
    echo "compose down failed; the secrets directory is kept: $SECRETS" >&2
    exit 1
  fi
  rc=0
  if [ -e "$SECRETS" ] || [ -L "$SECRETS" ]; then
    if secrets_removable; then
      rm -rf "$SECRETS"
    else
      echo "refusing to remove $SECRETS: not a real directory owned by you" >&2
      rc=1
    fi
  fi
  left=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT") || {
    echo "could not list volumes for $PROJECT" >&2
    exit 1
  }
  echo "volumes left for $PROJECT:"
  printf '%s\n' "$left"
  if [ -n "$left" ]; then
    echo "volumes remain for $PROJECT" >&2
    rc=1
  fi
  exit "$rc"
}

# The probe verb: one run of the p0-probe one-shot (compose/opt-in/scratch-probe.yml) against a project that up started.
# It needs six files, rewrites the project's NATS override to name them, and exits with the probe's exit code. Every
# refusal exits 2 before compose runs. It never touches the colo stack: the project is the scratch-<suffix> one.
check_probe_project() {
  case "$PROJECT" in
    scratch-?*) ;;
    *)
      echo "scratch: probe refuses $PROJECT: it is not a scratch-<suffix> project; nothing started" >&2
      exit 2
      ;;
  esac
}

check_probe_nats() {
  if [ -z "${SCRATCH_NATS_AUTH_DIR:-}" ]; then
    echo "scratch: probe needs SCRATCH_NATS_AUTH_DIR, a readable directory holding the six files $PROBE_NATS_FILES; nothing started" >&2
    exit 2
  fi
  if ! is_abs "$SCRATCH_NATS_AUTH_DIR" || has_newline "$SCRATCH_NATS_AUTH_DIR"; then
    echo "scratch: SCRATCH_NATS_AUTH_DIR must be an absolute path with no newline; nothing started" >&2
    exit 2
  fi
  case "$SCRATCH_NATS_AUTH_DIR" in
    *'"'* | *'\'* | *'$'*)
      echo "scratch: SCRATCH_NATS_AUTH_DIR must not contain quotes, backslashes or dollar signs; nothing started" >&2
      exit 2
      ;;
  esac
  if ! nats_dir_ok "$PROBE_NATS_FILES"; then
    echo "scratch: probe needs nats-body.txt (the body NATS password) in SCRATCH_NATS_AUTH_DIR: a readable directory holding the six files $PROBE_NATS_FILES, all non-empty; nothing started" >&2
    exit 2
  fi
}

# Up must have started this project: a running container, the NATS override that up wrote, and a healthy nats, velocity
# and paper container. The probe runs with --no-deps, so compose does not wait on those services; this check does.
check_probe_up() {
  running=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT") || {
    echo "scratch: docker ps failed (is docker running?); nothing started" >&2
    exit 1
  }
  if [ -z "$running" ]; then
    echo "scratch: $PROJECT is not up (no running container); run: sh deploy/scratch/scratch.sh up $suffix first. Nothing started." >&2
    exit 2
  fi
  if [ ! -f "$NATS_OVERRIDE" ]; then
    echo "scratch: $PROJECT has no NATS override (it was not started with SCRATCH_NATS_AUTH_DIR); nothing started" >&2
    exit 2
  fi
  for svc in nats velocity paper; do
    healthy=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$svc" --filter health=healthy) || {
      echo "scratch: docker ps failed (is docker running?); nothing started" >&2
      exit 1
    }
    if [ -z "$healthy" ]; then
      echo "scratch: $PROJECT has no healthy $svc container; run: sh deploy/scratch/scratch.sh up $suffix and wait for healthy; nothing started" >&2
      exit 2
    fi
  done
}

do_probe() {
  set_env
  check_probe_project
  check_probe_nats
  check_uid
  check_probe_up
  write_nats_override "$PROBE_NATS_FILES"
  COMPOSE_PROJECT_NAME="$PROJECT"
  GELDAR_P0_IMAGE="geldar-body:$PROJECT"
  export COMPOSE_PROJECT_NAME GELDAR_P0_IMAGE
  compose_run --profile p0 run --rm --no-deps --build p0-probe
  exit $?
}
case "$verb" in
  up) do_up ;;
  status) do_status ;;
  down) do_down ;;
  probe) do_probe ;;
  mind-up) . "$ROOT/deploy/scratch/scratch-mind.sh"; do_mind_up ;;
  mind-token) . "$ROOT/deploy/scratch/scratch-mind.sh"; do_mind_token "${3:-}" ;;
  config) . "$ROOT/deploy/scratch/scratch-config.sh"; do_config ;;
esac
