#!/bin/sh
# Read-only status of the geldar-colo project (decision 0084). Containers are found by the compose project label,
# never by name, so containers of other projects on the node are not listed or measured.
set -eu
. "$(dirname "$0")/common.sh"

need docker
load_node_env
say_node_env
filter="label=com.docker.compose.project=$PROJECT"
say "containers of $PROJECT (state and health):"
docker ps -a --filter "$filter" --format '{{.Names}}\t{{.State}}\t{{.Status}}'
say "published ports of $PROJECT (host side):"
docker ps -a --filter "$filter" --format '{{.Names}}\t{{.Ports}}'
ids=$(docker ps -q --filter "$filter")
if [ -n "$ids" ]; then
  say "resource use of $PROJECT (one sample):"
  # The ids are hex container ids from the label filter above; they are passed one per word on purpose.
  # shellcheck disable=SC2086
  docker stats --no-stream $ids
else
  say "no containers in $PROJECT"
fi
# Inode headroom of the deploy volume (the 2026-11-20 deploys failed on inodes, not bytes). Silent below the threshold,
# so the output above is unchanged on a healthy node. A failed df never fails the status.
inode_path=${GELDAR_INODE_PATH:-/var/lib/geldar-deploy}
[ -d "$inode_path" ] || inode_path=/var
inode_pct=$(df -Pi "$inode_path" 2>/dev/null | awk 'NR == 2 {gsub("%", "", $5); print $5}') || inode_pct=
case $inode_pct in
  '' | *[!0-9]*) ;;
  *)
    if [ "$inode_pct" -ge "${GELDAR_INODE_WARN_PCT:-80}" ]; then
      say "WARNING: inodes of the deploy volume are ${inode_pct}% used; run deploy/genesis/prune-deploy-work.sh (dry run first)"
    fi
    ;;
esac
