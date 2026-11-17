#!/bin/sh
# Throwaway scratch stack for the sheet campaign validation (see docs/runbooks/scratch-stack.md).
# Usage: sh deploy/scratch/scratch.sh up|status|down [suffix]
# The project is always scratch-<suffix> (suffix [a-z0-9]{1,9}, default a). Exit codes: 2 usage or NATS auth refused,
# 3 resource gate failed, 1 anything else. On 2 and 3 nothing is started.
# NATS fails closed: up needs SCRATCH_NATS_AUTH_DIR, a readable directory holding the four generated files
# (nats-auth.conf, nats-paper.txt, nats-velocity.txt, nats-eventsink.txt). Open NATS needs SCRATCH_NATS_OPEN=1 and
# prints a warning. Secrets live in a per-user state directory, not a shared temp directory; down removes only that
# directory.
# Ports: deploy/scratch/<suffix>.env (SCRATCH_*_PORT lines only) is read by this script; required for telemetry.
# SCRATCH_PLATFORM=neoforge adds compose/opt-in/scratch-neoforge.yml (the NeoForge game server); unset or paper is the default.
set -u
umask 077

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RAM_MIN_KB=10485760  # 10 GB free RAM gate
DISK_MIN_KB=20971520 # 20 GB free disk gate: the repo filesystem and the Docker data root, the smaller figure counts
MIN_COMPOSE=2.24.4   # the !override tag in compose/opt-in/scratch.yml needs this compose or newer
NATS_FILES="nats-auth.conf nats-paper.txt nats-velocity.txt nats-eventsink.txt"
VELOCITY_JAR="plugin/velocity-identity/build/libs/geldar-velocity-identity.jar"
PLUGIN_JARS="plugin/core/build/libs/geldar-core.jar $VELOCITY_JAR"
# The NeoForge game server runs the forwarding mod instead of geldar-core, so only the Velocity identity jar is checked.
NEOFORGE_PLUGIN_JARS="$VELOCITY_JAR"

usage() {
  echo "usage: sh deploy/scratch/scratch.sh up|status|down [suffix]" >&2
  exit 2
}

verb=${1:-}
suffix=${2:-a}
case "$verb" in
  up | status | down) ;;
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
# nothing in it runs). Only the five port keys are accepted (the four, and SCRATCH_RCON_PORT for neoforge),
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

open_warning() {
  cat >&2 <<EOF
!!! WARNING: NATS IS OPEN for $PROJECT !!!
  No role ACLs. Any local user or process can connect to 127.0.0.1:${SCRATCH_NATS_PORT:-14222}, publish to the
  subjects Paper consumes and read JetStream. Not approved for any run on the shared node.
  This run cannot test the NATS roles (item 5).
EOF
}

nats_dir_ok() {
  [ -d "$SCRATCH_NATS_AUTH_DIR" ] && [ -r "$SCRATCH_NATS_AUTH_DIR" ] || return 1
  for f in $NATS_FILES; do
    [ -f "$SCRATCH_NATS_AUTH_DIR/$f" ] && [ -r "$SCRATCH_NATS_AUTH_DIR/$f" ] && [ -s "$SCRATCH_NATS_AUTH_DIR/$f" ] || return 1
  done
  return 0
}

# The NATS gate. Runs first, before any file is written or any container is started.
check_nats() {
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
  if [ "${SCRATCH_NATS_OPEN:-}" = 1 ]; then
    open_warning
    return 0
  fi
  echo "scratch: NATS auth is required. Set SCRATCH_NATS_AUTH_DIR to a directory holding the four files made by" >&2
  echo "scratch: ./geldar.ps1 shard nats-auth <shard>, or set SCRATCH_NATS_OPEN=1 for open NATS (not approved on the" >&2
  echo "scratch: shared node; see the runbook). Nothing started." >&2
  exit 2
}

write_nats_override() {
  {
    echo "# Written by deploy/scratch/scratch.sh. Points the nats-auth.yml secrets at the caller's auth dir."
    echo "secrets:"
    for f in $NATS_FILES; do
      echo "  $f:"
      echo "    file: \"$SCRATCH_NATS_AUTH_DIR/$f\""
    done
  } >"$NATS_OVERRIDE"
}

# Compose with the phase0 base and the scratch overlay. The -f list is built by prepending, last file first, so the
# command line reads: -p, phase0, nats-auth (only when the override exists), scratch, the NeoForge overlay (only for
# SCRATCH_PLATFORM=neoforge), and the NATS override last so its file paths win. The verb arguments follow unchanged.
compose_run() {
  if [ -f "$NATS_OVERRIDE" ]; then
    set -- -f "$NATS_OVERRIDE" "$@"
  fi
  if [ "$PLATFORM" = neoforge ]; then
    set -- -f "$ROOT/compose/opt-in/scratch-neoforge.yml" "$@"
  fi
  set -- -f "$ROOT/compose/opt-in/scratch.yml" "$@"
  if [ -f "$NATS_OVERRIDE" ]; then
    set -- -f "$ROOT/compose/nats-auth.yml" "$@"
  fi
  set -- -p "$PROJECT" -f "$ROOT/compose/phase0.yml" "$@"
  docker compose "$@"
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
  check_nats
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
    echo "NATS auth: the four files from the SCRATCH_NATS_AUTH_DIR given to up"
  elif [ -d "$SECRETS" ]; then
    open_warning
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

case "$verb" in
  up) do_up ;;
  status) do_status ;;
  down) do_down ;;
esac
