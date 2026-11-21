# Free-space floors for the deploy scripts. Sourced by common.sh after die() and say(); it defines functions only.
# POSIX sh. Blocks AND inodes run out independently: on 2026-11-20 /var was at 100% inodes and 64% bytes and 22 deploys failed.
#
# space_floor LABEL PATH MIN_KB CHECK_INODES: blocks free on the filesystem holding PATH (df -Pk) against MIN_KB, and, when
# CHECK_INODES is 1, inodes free (df -Pi) against MIN_FREE_INODES. A missing PATH is skipped with a message (never a pass for
# another filesystem); a filesystem that reports no inode count skips only the inode half. A refusal prints measured and required.
space_floor() {
  sf_label=$1
  sf_path=$2
  sf_min=$3
  sf_inodes_too=$4
  if [ ! -d "$sf_path" ]; then
    say "space check skipped for the $sf_label: $sf_path is missing"
    return 0
  fi
  sf_free=$(df -Pk "$sf_path" | awk 'NR == 2 {print $4}')
  case $sf_free in '' | *[!0-9]*) die "cannot read free blocks of the $sf_label ($sf_path)" ;; esac
  if [ "$sf_free" -lt "$sf_min" ]; then
    die "free disk $sf_free KiB (blocks) of the $sf_label ($sf_path) is below the threshold of $sf_min KiB"
  fi
  [ "$sf_inodes_too" = 1 ] || return 0
  sf_inodes=$(df -Pi "$sf_path" | awk 'NR == 2 {print $2, $4}')
  sf_total=${sf_inodes%% *}
  sf_ifree=${sf_inodes#* }
  case $sf_total$sf_ifree in *[!0-9]* | '') sf_total=0 ;; esac
  if [ "$sf_total" -gt 0 ] && [ "$sf_ifree" -lt "$MIN_FREE_INODES" ]; then
    die "free inodes $sf_ifree of the $sf_label ($sf_path) is below the threshold of $MIN_FREE_INODES; run deploy/genesis/prune-deploy-work.sh (dry run first)"
  fi
}

# The three filesystems a deploy writes to: the checkout (MIN_FREE_KB), the deploy volume (/var/lib/geldar-deploy) and
# Docker's data root (both MIN_FREE_KB_DEPLOY, much smaller: /var is a small volume). Docker's data root is read by
# docker_data_root, in this order: the data-root key of the daemon config (GELDAR_DOCKER_DAEMON_JSON, default
# /etc/docker/daemon.json; an absent or unreadable file or a file without the key falls through), then `docker info`,
# then `sudo -n docker info` (the node needs passwordless sudo for it, see docs/runbooks/node-only-config.md). Prints
# nothing when none of them answers. Fail closed: space_floors refuses then (CI-DR1, #866).
docker_data_root() {
  local d
  d=$(sed -n 's/.*"data-root"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${GELDAR_DOCKER_DAEMON_JSON:-/etc/docker/daemon.json}" 2>/dev/null | head -n 1) || d=
  [ -n "$d" ] || d=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null) || d=
  [ -n "$d" ] || d=$(sudo -n docker info --format '{{.DockerRootDir}}' 2>/dev/null) || d=
  printf '%s' "$d"
}

space_floors() {
  if [ "${SPACE_FLOORS_DONE:-0}" = 1 ]; then return 0; fi
  SPACE_FLOORS_DONE=1
  space_floor "repo checkout" "$ROOT" "$MIN_FREE_KB" 1
  space_floor "deploy volume" "$DEPLOY_VOLUME" "$MIN_FREE_KB_DEPLOY" 1
  droot=$(docker_data_root)
  if [ -z "$droot" ]; then
    die "cannot determine Docker's data root: docker info, sudo -n docker info and the daemon config all failed; refusing"
  fi
  space_floor "docker data root" "$droot" "$MIN_FREE_KB_DEPLOY" 1
}

# What check_prereqs runs. The deploy scripts (COLO_SPACE_FLOOR_FIRST=1, which also runs them before the first write) check all
# three filesystems. The others (colo-admin, colo-rollback) keep the original checkout block floor only: they do not write to the
# deploy volume or Docker's data root, so a low /var must not stop a rollback.
prereq_space() {
  if [ "${COLO_SPACE_FLOOR_FIRST:-0}" = 1 ]; then
    space_floors
  else
    space_floor "repo checkout" "$ROOT" "$MIN_FREE_KB" 0
  fi
}
