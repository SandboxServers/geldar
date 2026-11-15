#!/bin/sh
# Throwaway scratch stack for the sheet campaign validation (see docs/runbooks/scratch-stack.md).
# Usage: sh deploy/scratch/scratch.sh up|status|down [suffix]
# The project is always scratch-<suffix> (suffix [a-z0-9]{1,8}, default a). Nothing here touches a project that does
# not start with scratch-. Exit codes: 2 usage, 3 resource gate failed (nothing started), 1 anything else.
set -u
umask 077

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TMP_BASE=${TMPDIR:-/tmp}
RAM_MIN_KB=10485760  # 10 GB free RAM gate
DISK_MIN_KB=20971520 # 20 GB free disk gate on the filesystem holding the repo

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
    echo "suffix must match [a-z0-9]{1,8}" >&2
    exit 2
    ;;
esac
if [ "${#suffix}" -gt 8 ]; then
  echo "suffix must match [a-z0-9]{1,8}" >&2
  exit 2
fi
PROJECT="scratch-$suffix"
case "$PROJECT" in
  scratch-*) ;;
  *) exit 2 ;;
esac
POINTER="$TMP_BASE/scratch-$suffix.secretsdir"

# Compose with the phase0 base and the scratch overlay. nats-auth.yml joins only when the caller prepared its files.
compose_run() {
  if [ -n "${SCRATCH_NATS_AUTH_DIR:-}" ]; then
    docker compose -p "$PROJECT" -f "$ROOT/compose/phase0.yml" -f "$ROOT/compose/nats-auth.yml" \
      -f "$ROOT/compose/opt-in/scratch.yml" "$@"
  else
    docker compose -p "$PROJECT" -f "$ROOT/compose/phase0.yml" -f "$ROOT/compose/opt-in/scratch.yml" "$@"
  fi
}

# Sets the variables the overlay reads. Without a secrets pointer (status, down after a failed up) a path that
# does not exist is used: compose only needs the variable to be set, and neither verb reads the secret files.
set_env() {
  GELDAR_WORLD_VOLUME="${PROJECT}_paper-data"
  export GELDAR_WORLD_VOLUME
  if [ -f "$POINTER" ]; then
    SCRATCH_SECRETS_DIR=$(cat "$POINTER")
  else
    SCRATCH_SECRETS_DIR="$TMP_BASE/no-scratch-secrets-$suffix"
  fi
  export SCRATCH_SECRETS_DIR
}

free_ram_kb() {
  if [ "$(uname -s)" = Linux ]; then
    awk '/^MemAvailable:/ { print $2 }' /proc/meminfo
  else
    powershell.exe -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory" | tr -d '\r'
  fi
}

free_disk_kb() {
  df -Pk "$ROOT" | awk 'NR == 2 { print $4 }'
}

gb() {
  awk -v kb="$1" 'BEGIN { printf "%.1f GB", kb / 1048576 }'
}

gate() {
  ram=$(free_ram_kb)
  disk=$(free_disk_kb)
  if [ -z "$ram" ] || [ -z "$disk" ]; then
    echo "gate: could not read free RAM or free disk; nothing started" >&2
    exit 3
  fi
  echo "gate: free RAM $(gb "$ram") (need 10 GB), free disk $(gb "$disk") (need 20 GB)"
  if [ "$ram" -lt "$RAM_MIN_KB" ] || [ "$disk" -lt "$DISK_MIN_KB" ]; then
    echo "gate failed: free RAM below 10 GB or free disk below 20 GB; nothing started" >&2
    exit 3
  fi
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

do_up() {
  gate
  set_env
  existing=$(compose_run ps -aq)
  if [ -n "$existing" ]; then
    echo "project $PROJECT already has containers; run: sh deploy/scratch/scratch.sh down $suffix" >&2
    exit 1
  fi
  if [ -f "$POINTER" ]; then
    echo "a secrets pointer for $PROJECT exists ($POINTER); run down first" >&2
    exit 1
  fi
  SCRATCH_SECRETS_DIR=$(mktemp -d "$TMP_BASE/scratch-$suffix.XXXXXX") || exit 1
  export SCRATCH_SECRETS_DIR
  # The pointer is written before the secrets, so down can always find and remove the directory.
  printf '%s' "$SCRATCH_SECRETS_DIR" >"$POINTER"
  fill_secrets "$SCRATCH_SECRETS_DIR"
  set_env
  if ! compose_run up -d --wait --build; then
    echo "up failed; clean up with: sh deploy/scratch/scratch.sh down $suffix" >&2
    exit 1
  fi
  do_status
}

do_status() {
  set_env
  compose_run ps
  ids=$(compose_run ps -q)
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' $ids
  fi
}

do_down() {
  set_env
  compose_run down -v --remove-orphans
  rc=$?
  if [ -f "$POINTER" ]; then
    dir=$(cat "$POINTER")
    case "$dir" in
      "$TMP_BASE"/scratch-*) rm -rf "$dir" ;;
      *) echo "refusing to remove unexpected secrets path" >&2; rc=1 ;;
    esac
    rm -f "$POINTER"
  fi
  left=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")
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
