#!/usr/bin/env bash
# G3-01: idempotent bootstrap of a clean Debian 12 or 13 host for one Geldar environment (plan.md section 3, apply
# order: host bootstrap comes first).
#
# Usage: bootstrap.sh ENV_FILE [--dry-run | --apply]
#   --dry-run  (default) prints every action and runs no mutating command.
#   --apply    converges the host (root only). A second --apply on a converged host issues no mutating command.
#
# Required settings, with no default: the run stops before any call when one is unset, and the message names the
# variable but never its value. They are the four Docker apt pins (GELDAR_DOCKER_CE_VERSION, GELDAR_CONTAINERD_VERSION,
# GELDAR_DOCKER_BUILDX_VERSION, GELDAR_DOCKER_COMPOSE_VERSION), the Docker repository key fingerprint
# (GELDAR_DOCKER_KEY_FPR, 40 hex digits; spaces and case are normalised) and the Docker address pool
# (GELDAR_DOCKER_POOL_BASE, an IPv4 CIDR).
#
# Service and operator ids: the service user is GELDAR_SERVICE_USER (default geldar) with uid GELDAR_SERVICE_UID
# (default 1000; its group takes the same gid, there is no separate gid setting). The operator uid is
# GELDAR_OPERATOR_UID (default 1001) and the docker group gid is GELDAR_DOCKER_GID (default 999). A Debian generic cloud
# image's first user already holds uid 1000, so on that image set GELDAR_SERVICE_UID explicitly to a free uid (and
# GELDAR_OPERATOR_UID and GELDAR_DOCKER_GID when they clash). The run refuses a taken id and names its holder.
#
# First run, by the owner: this repository carries no Docker trust anchor and no package versions. Copy
# GELDAR_DOCKER_KEY_FPR from the Docker Engine installation page on docs.docker.com (Debian), and copy the four package
# versions from the Docker apt repository (download.docker.com/linux/debian, the stable package index for the host's
# codename). Take both before the first --apply. Do not take either value from this file, from a previous run or from
# memory: the key check is only as good as the fingerprint it is given.
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
# The compare is in memory. A dry run writes no temporary file: it prints the install and stops there.
write_if_changed() {
  local dest=$1 content current=
  content=$(
    cat
    printf x
  )
  content=${content%x}
  if [ -f "$dest" ]; then
    current=$(
      cat "$dest"
      printf x
    )
    current=${current%x}
  fi
  if [ -f "$dest" ] && [ "$content" = "$current" ] && attr_is "$dest" "$2" "$3" "$4"; then
    return 0
  fi
  CHANGED=1
  if [ ! -d "$(dirname "$dest")" ]; then
    mut install -d -m 755 "$(dirname "$dest")"
  fi
  if [ "$MODE" = apply ]; then
    local tmp
    tmp=$(mktemp)
    printf '%s' "$content" >"$tmp"
    mut install -m "$2" -o "$3" -g "$4" "$tmp" "$dest"
    rm -f "$tmp"
  else
    say "dry-run: install -m $2 $dest"
  fi
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

# valid_port N: a decimal TCP port, 1 to 65535. The length is checked before any arithmetic.
valid_port() {
  [[ "$1" =~ ^[0-9]{1,5}$ ]] || return 1
  [ "$((10#$1))" -ge 1 ] && [ "$((10#$1))" -le 65535 ]
}

# check_pool_settings: GELDAR_DOCKER_POOL_BASE is an IPv4 CIDR (four octets 0-255, prefix 1-32). GELDAR_DOCKER_POOL_SIZE
# is the pool prefix length, 1 to 32, and not shorter than the base prefix. An octet with a leading zero (08) is refused,
# and the host bits of the base must be zero for its prefix (127.0.0.1/16 is refused, 127.0.0.0/16 is accepted).
check_pool_settings() {
  local re='^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/([0-9]{1,2})$' o bits size ip mask
  [[ "$GELDAR_DOCKER_POOL_BASE" =~ $re ]] || die "GELDAR_DOCKER_POOL_BASE must be an IPv4 CIDR"
  for o in "${BASH_REMATCH[@]:1:4}"; do
    [ "$((10#$o))" -le 255 ] || die "GELDAR_DOCKER_POOL_BASE must be an IPv4 CIDR (octets 0-255)"
    case "$o" in 0?*) die "GELDAR_DOCKER_POOL_BASE must be an IPv4 CIDR (no leading zero in an octet)" ;; esac
  done
  bits=$((10#${BASH_REMATCH[5]}))
  [ "$bits" -ge 1 ] && [ "$bits" -le 32 ] || die "GELDAR_DOCKER_POOL_BASE prefix must be 1 to 32"
  ip=$(( (10#${BASH_REMATCH[1]} << 24) | (10#${BASH_REMATCH[2]} << 16) | (10#${BASH_REMATCH[3]} << 8) | (10#${BASH_REMATCH[4]}) ))
  mask=$(( (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF ))
  [ $(( ip & ~mask & 0xFFFFFFFF )) -eq 0 ] || die "GELDAR_DOCKER_POOL_BASE host bits must be zero for its /$bits prefix"
  [[ "$GELDAR_DOCKER_POOL_SIZE" =~ ^[0-9]{1,2}$ ]] || die "GELDAR_DOCKER_POOL_SIZE must be a number from 1 to 32"
  size=$((10#$GELDAR_DOCKER_POOL_SIZE))
  [ "$size" -ge 1 ] && [ "$size" -le 32 ] || die "GELDAR_DOCKER_POOL_SIZE must be a number from 1 to 32"
  [ "$size" -ge "$bits" ] || die "GELDAR_DOCKER_POOL_SIZE must not be shorter than the GELDAR_DOCKER_POOL_BASE prefix"
}

# check_dir_setting NAME PATH: an absolute, normalised path. The system directories themselves are refused, and so is
# anything under /etc/ssh, /etc/sudoers.d or /usr. Paths under /etc/geldar-*, /var/lib/geldar-* and /opt/geldar-* pass.
check_dir_setting() {
  case "$2" in
    / | /bin | /boot | /dev | /etc | /home | /lib | /opt | /proc | /root | /run | /sbin | /sys | /tmp | /usr | /var | /var/lib)
      die "$1 must not be a system directory" ;;
    /etc/ssh | /etc/ssh/* | /etc/sudoers.d | /etc/sudoers.d/* | /usr/*)
      die "$1 must not be under a system directory" ;;
    /*) ;;
    *) die "$1 must be an absolute path" ;;
  esac
  case "$2" in
    *//* | */ | */. | */.. | */./* | */../*) die "$1 must be a normalised path: no trailing slash, no . or .. or //" ;;
  esac
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
  : "${GELDAR_DOCKER_KEY_FPR:?GELDAR_DOCKER_KEY_FPR is required: the Docker repository key fingerprint, copied from docs.docker.com}"
  [[ "$GELDAR_ENV_NAME" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || die "GELDAR_ENV_NAME must be lowercase letters, digits and dashes"
  [[ "$GELDAR_DOCKER_CE_VERSION$GELDAR_CONTAINERD_VERSION$GELDAR_DOCKER_BUILDX_VERSION$GELDAR_DOCKER_COMPOSE_VERSION" =~ ^[A-Za-z0-9:.+~_-]+$ ]] ||
    die "docker package versions contain characters that are not allowed in an apt version"
  GELDAR_DOCKER_KEY_FPR=$(printf '%s' "$GELDAR_DOCKER_KEY_FPR" | tr -d ' ' | tr 'a-f' 'A-F')
  [[ "$GELDAR_DOCKER_KEY_FPR" =~ ^[0-9A-F]{40}$ ]] ||
    die "GELDAR_DOCKER_KEY_FPR must be the 40 hex digits of the Docker key fingerprint"
  GELDAR_SERVICE_USER=${GELDAR_SERVICE_USER:-geldar}
  GELDAR_SERVICE_UID=${GELDAR_SERVICE_UID:-1000}
  GELDAR_OPERATOR_UID=${GELDAR_OPERATOR_UID:-1001}
  GELDAR_DOCKER_GID=${GELDAR_DOCKER_GID:-999}
  GELDAR_DOCKER_POOL_SIZE=${GELDAR_DOCKER_POOL_SIZE:-24}
  GELDAR_PUBLIC_TCP_PORTS=${GELDAR_PUBLIC_TCP_PORTS:-}
  BOOTSTRAP_SSH_PORT=${BOOTSTRAP_SSH_PORT:-22}
  GELDAR_STATE_DIR=${GELDAR_STATE_DIR:-/var/lib/geldar-$GELDAR_ENV_NAME}
  GELDAR_SECRETS_DIR=${GELDAR_SECRETS_DIR:-/etc/geldar-$GELDAR_ENV_NAME/secrets}
  GELDAR_TOKENS_DIR=${GELDAR_TOKENS_DIR:-/etc/geldar-$GELDAR_ENV_NAME/tokens}
  GELDAR_SRC_DIR=${GELDAR_SRC_DIR:-/opt/geldar-$GELDAR_ENV_NAME/src}
  local v p
  for v in GELDAR_SERVICE_UID GELDAR_OPERATOR_UID GELDAR_DOCKER_GID; do
    [[ "${!v}" =~ ^[0-9]+$ ]] || die "$v must be a number"
  done
  valid_port "$BOOTSTRAP_SSH_PORT" || die "BOOTSTRAP_SSH_PORT must be a TCP port (1-65535)"
  for p in ${GELDAR_PUBLIC_TCP_PORTS//,/ }; do
    valid_port "$p" || die "GELDAR_PUBLIC_TCP_PORTS has an entry that is not a TCP port (1-65535)"
  done
  check_pool_settings
  check_dir_setting GELDAR_STATE_DIR "$GELDAR_STATE_DIR"
  check_dir_setting GELDAR_SECRETS_DIR "$GELDAR_SECRETS_DIR"
  check_dir_setting GELDAR_TOKENS_DIR "$GELDAR_TOKENS_DIR"
  check_dir_setting GELDAR_SRC_DIR "$GELDAR_SRC_DIR"
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
  # Refusals come before any change: a taken uid or gid, and an sshd port the settings do not allow.
  preflight_ids
  firewall_ports_check
  # The docker group exists before the packages, so the Docker postinst reuses GELDAR_DOCKER_GID.
  ensure_group docker "$GELDAR_DOCKER_GID"
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
