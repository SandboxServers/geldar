#!/bin/sh
# Per-player host helpers for the Colo CD pipeline. Sourced by colo-cd.sh and colo-cd-plan.sh (needs DEPLOY_DIR).
# A player host is the one-off container geldar-colo-players-host-<player-id> that colo-admin.sh player-start runs. Only the
# ids that `colo-admin.sh player-list` reports as running, or as exited with a non-zero code (a crash that used up its
# restarts), are ever looked at, and only containers with exactly that name are inspected, stopped or started. A hibernating
# player (no container) and a host that exited 0 are not acted on, so they are skipped.

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

# Prints the ids the CD acts on, one listing of player-list: the running hosts, and the exited hosts whose last exit code was
# not 0 (a crash that used up the five restarts), so a deploy brings a crashed host back. A clean exit (0) is not listed,
# so a host that was stopped on purpose stays down. Returns 1 when the list cannot be read.
acted_hosts() {
  out=$(host_admin player-list) || return 1
  printf '%s\n' "$out" | sed -n 's/^\(colo: \)\{0,1\}\(ag-[a-z0-9-]*\): \(running\|exited\).*/\2 \3/p' |
    while read -r id state; do
      if [ "$state" = running ]; then echo "$id"; continue; fi
      code=$(docker inspect -f '{{.State.ExitCode}}' "$(host_name "$id")" 2>/dev/null || echo 0)
      if [ "$code" != 0 ]; then echo "$id"; fi
    done
  return 0
}

# Prints "<id> stale|current" for each acted-on host, comparing its image with the body image ($1) of the new manifest.
host_states() {
  want=$1
  ids=$(acted_hosts) || return 1
  for id in $ids; do
    have=$(host_image "$id")
    if [ "$have" = "$want" ]; then echo "$id current"; else echo "$id stale"; fi
  done
}
