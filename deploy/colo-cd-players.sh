#!/bin/sh
# Per-player host helpers for the Colo CD pipeline. Sourced by colo-cd.sh and colo-cd-plan.sh (needs DEPLOY_DIR).
# A player host is the one-off container geldar-colo-players-host-<player-id> that colo-admin.sh player-start runs. Only the
# ids that `colo-admin.sh player-list` reports as running are ever looked at, and only containers with exactly that name
# are inspected, stopped or started. A hibernating player (no container) is not listed, so it is skipped.

# colo-admin reads the manifest named by GELDAR_RELEASE_FILE (the root-owned /etc copy on the node, which colo-cd does not update).
# Player hosts are therefore started with HOST_MANIFEST, the node's copy that colo-cd keeps current, so the image pin is the new one.
host_admin() {
  GELDAR_RELEASE_FILE=${HOST_MANIFEST:-${GELDAR_RELEASE_FILE:-}} sh "$DEPLOY_DIR/colo-admin.sh" "$@"
}

host_name() {
  echo "geldar-colo-players-host-$1"
}

# The image reference a running player host was started with (empty when the container is gone).
host_image() {
  docker inspect -f '{{.Config.Image}}' "$(host_name "$1")" 2>/dev/null || true
}

host_revision() {
  docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(host_name "$1")" 2>/dev/null || true
}

host_status() {
  docker inspect -f '{{.State.Status}}' "$(host_name "$1")" 2>/dev/null || true
}

# Prints the ids of the running player hosts, one per line. Returns 1 when the list cannot be read.
running_hosts() {
  out=$(host_admin player-list) || return 1
  # colo-admin prints each line through say, which prefixes "colo: ".
  printf '%s\n' "$out" | sed -n 's/^\(colo: \)\{0,1\}\(ag-[a-z0-9-]*\): running.*/\2/p'
}

# Prints "<id> stale|current" for each running host, comparing its image with the body image ($1) of the new manifest.
host_states() {
  want=$1
  ids=$(running_hosts) || return 1
  for id in $ids; do
    have=$(host_image "$id")
    if [ "$have" = "$want" ]; then echo "$id current"; else echo "$id stale"; fi
  done
}
