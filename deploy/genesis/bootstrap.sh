#!/usr/bin/env bash
# G3-01: idempotent bootstrap of a clean Debian 12 or 13 host for one Geldar environment (plan.md section 3, apply
# order: host bootstrap comes first).
#
# Usage: bootstrap.sh ENV_FILE [--dry-run | --apply]
#   --dry-run  (default) prints every action and runs no mutating command.
#   --apply    converges the host (root only). A second --apply on a converged host issues no mutating command.
#
# ENV_FILE holds KEY=VALUE lines with GELDAR_* and BOOTSTRAP_* keys only: non-secret settings, produced from
# envs/<name>.yaml. Any other line stops the run, reported by line number and never by content. Secret values are
# never read, written or printed here: the secrets directory is created with its mode and its files are left alone.
#
# The modules are sourced: bootstrap-packages.sh, bootstrap-users-paths.sh, bootstrap-docker.sh and
# bootstrap-firewall.sh. BOOTSTRAP_ROOT prefixes the /etc paths (tests only; empty on a real host).
set -euo pipefail

BOOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=bootstrap-packages.sh
. "$BOOT_DIR/bootstrap-packages.sh"
# shellcheck source=bootstrap-users-paths.sh
. "$BOOT_DIR/bootstrap-users-paths.sh"
# shellcheck source=bootstrap-docker.sh
. "$BOOT_DIR/bootstrap-docker.sh"
# shellcheck source=bootstrap-firewall.sh
. "$BOOT_DIR/bootstrap-firewall.sh"

MODE=dry-run
BOOT_ROOT=${BOOTSTRAP_ROOT:-}
OS_RELEASE=${BOOTSTRAP_OS_RELEASE:-$BOOT_ROOT/etc/os-release}
CHANGED=0

say() { printf '[bootstrap] %s\n' "$*"; }
die() {
  printf '[bootstrap] FAILED: %s\n' "$*" >&2
  exit 1
}

# mut runs a mutating command with --apply and only prints it in dry-run.
mut() {
  if [ "$MODE" = apply ]; then
    say "apply: $*"
    "$@"
  else
    say "dry-run: $*"
  fi
}

# attr_is PATH MODE UID GID: true when PATH already has that mode (no leading zero) and numeric owner.
attr_is() {
  local got
  got=$(stat -c '%a %u:%g' "$1" 2>/dev/null) || return 1
  [ "$got" = "$2 $3:$4" ]
}

# ensure_dir PATH MODE UID GID: creates a directory or fixes its own attributes. Never touches its contents.
ensure_dir() {
  if ! attr_is "$1" "$2" "$3" "$4"; then
    mut install -d -m "$2" -o "$3" -g "$4" "$1"
  fi
}

# write_if_changed DEST MODE UID GID < CONTENT: installs CONTENT only when DEST differs. Sets CHANGED=1 on a write.
write_if_changed() {
  local dest=$1 tmp
  tmp=$(mktemp)
  cat >"$tmp"
  if [ -f "$dest" ] && cmp -s "$tmp" "$dest" && attr_is "$dest" "$2" "$3" "$4"; then
    rm -f "$tmp"
    return 0
  fi
  CHANGED=1
  if [ ! -d "$(dirname "$dest")" ]; then
    mut install -d -m 755 "$(dirname "$dest")"
  fi
  mut install -m "$2" -o "$3" -g "$4" "$tmp" "$dest"
  rm -f "$tmp"
}

usage() {
  cat <<'USAGE'
Usage: bootstrap.sh ENV_FILE [--dry-run | --apply]
  --dry-run  (default) print the actions; run no mutating command
  --apply    converge the host (root; Debian 12 or 13); safe to re-run
ENV_FILE: KEY=VALUE lines, GELDAR_* and BOOTSTRAP_* keys only, no secrets.
USAGE
}

parse_args() {
  ENV_FILE=
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) MODE=dry-run ;;
      --apply) MODE=apply ;;
      -h | --help)
        usage
        exit 0
        ;;
      -*) die "unknown option $1" ;;
      *)
        [ -z "$ENV_FILE" ] || die "one env file expected"
        ENV_FILE=$1
        ;;
    esac
    shift
  done
  [ -n "$ENV_FILE" ] || {
    usage >&2
    exit 2
  }
  [ -r "$ENV_FILE" ] || die "env file is not readable"
}

# load_env: only GELDAR_* and BOOTSTRAP_* KEY=VALUE lines are accepted; anything else stops the run.
load_env() {
  local line key val n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in
      '' | '#'*) continue ;;
    esac
    if [[ ! "$line" =~ ^((GELDAR|BOOTSTRAP)_[A-Z0-9_]+)=(.*)$ ]]; then
      die "env file line $n is not a GELDAR_ or BOOTSTRAP_ KEY=VALUE setting"
    fi
    key=${BASH_REMATCH[1]}
    val=${BASH_REMATCH[3]}
    printf -v "$key" '%s' "$val"
    export "$key"
  done <"$ENV_FILE"
}

# apply_defaults: the required pins stop the run when unset; everything else has a default.
apply_defaults() {
  : "${GELDAR_ENV_NAME:?GELDAR_ENV_NAME is required in the environment file}"
  : "${GELDAR_OPERATOR_USER:?GELDAR_OPERATOR_USER is required in the environment file}"
  : "${GELDAR_DOCKER_CE_VERSION:?GELDAR_DOCKER_CE_VERSION is required: pin the docker-ce apt version (never latest)}"
  : "${GELDAR_CONTAINERD_VERSION:?GELDAR_CONTAINERD_VERSION is required: pin the containerd.io apt version}"
  : "${GELDAR_DOCKER_BUILDX_VERSION:?GELDAR_DOCKER_BUILDX_VERSION is required: pin the docker-buildx-plugin apt version}"
  : "${GELDAR_DOCKER_POOL_BASE:?GELDAR_DOCKER_POOL_BASE is required: the Docker address pool as an IPv4 CIDR}"
  : "${GELDAR_DOCKER_COMPOSE_VERSION:?GELDAR_DOCKER_COMPOSE_VERSION is required: pin the docker-compose-plugin apt version}"
  [[ "$GELDAR_ENV_NAME" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || die "GELDAR_ENV_NAME must be lowercase letters, digits and dashes"
  [[ "$GELDAR_DOCKER_CE_VERSION$GELDAR_CONTAINERD_VERSION$GELDAR_DOCKER_BUILDX_VERSION$GELDAR_DOCKER_COMPOSE_VERSION" =~ ^[A-Za-z0-9:.+~_-]+$ ]] ||
    die "docker package versions contain characters that are not allowed in an apt version"
  GELDAR_SERVICE_USER=${GELDAR_SERVICE_USER:-geldar}
  GELDAR_SERVICE_UID=${GELDAR_SERVICE_UID:-1000}
  GELDAR_OPERATOR_UID=${GELDAR_OPERATOR_UID:-1001}
  GELDAR_DOCKER_GID=${GELDAR_DOCKER_GID:-999}
  GELDAR_DOCKER_POOL_SIZE=${GELDAR_DOCKER_POOL_SIZE:-24}
  GELDAR_DOCKER_KEY_FPR=${GELDAR_DOCKER_KEY_FPR:-9DC858229FC7DD38854AE2D88D81803C0EBFCD88}
  GELDAR_PUBLIC_TCP_PORTS=${GELDAR_PUBLIC_TCP_PORTS:-}
  BOOTSTRAP_SSH_PORT=${BOOTSTRAP_SSH_PORT:-22}
  GELDAR_STATE_DIR=${GELDAR_STATE_DIR:-/var/lib/geldar-$GELDAR_ENV_NAME}
  GELDAR_SECRETS_DIR=${GELDAR_SECRETS_DIR:-/etc/geldar-$GELDAR_ENV_NAME/secrets}
  GELDAR_TOKENS_DIR=${GELDAR_TOKENS_DIR:-/etc/geldar-$GELDAR_ENV_NAME/tokens}
  GELDAR_SRC_DIR=${GELDAR_SRC_DIR:-/opt/geldar-$GELDAR_ENV_NAME/src}
  local v
  for v in GELDAR_SERVICE_UID GELDAR_OPERATOR_UID GELDAR_DOCKER_GID GELDAR_DOCKER_POOL_SIZE BOOTSTRAP_SSH_PORT; do
    [[ "${!v}" =~ ^[0-9]+$ ]] || die "$v must be a number"
  done
  [[ "$GELDAR_DOCKER_POOL_BASE" =~ ^[0-9.]+/[0-9]+$ ]] || die "GELDAR_DOCKER_POOL_BASE must be an IPv4 CIDR"
}

# check_os: Debian 12 or 13 only. The os-release file is read from BOOTSTRAP_OS_RELEASE when set (tests).
check_os() {
  [ -r "$OS_RELEASE" ] || die "no readable os-release file"
  local id version
  id=$(sed -n 's/^ID=//p' "$OS_RELEASE" | tr -d '"')
  version=$(sed -n 's/^VERSION_ID=//p' "$OS_RELEASE" | tr -d '"')
  if [ "$id" != debian ] || { [ "$version" != 12 ] && [ "$version" != 13 ]; }; then
    die "refusing to run: this bootstrap needs Debian 12 or 13 (os-release ID=$id VERSION_ID=$version)"
  fi
  OS_VERSION=$version
  OS_CODENAME=$(sed -n 's/^VERSION_CODENAME=//p' "$OS_RELEASE" | tr -d '"')
  [ -n "$OS_CODENAME" ] || die "os-release has no VERSION_CODENAME"
}

main() {
  parse_args "$@"
  load_env
  apply_defaults
  check_os
  if [ "$MODE" = apply ] && [ "$(id -u)" != 0 ]; then
    die "--apply must run as root"
  fi
  say "mode=$MODE environment=$GELDAR_ENV_NAME debian=$OS_VERSION"
  packages_step
  verify_git_floor
  users_step
  paths_step
  docker_step
  timesync_step
  sysctl_step
  logrotate_step
  unattended_step
  firewall_step
  say "done ($MODE)"
}

main "$@"
