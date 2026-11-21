#!/bin/sh
# Removes old Geldar images from the node's docker, keeping the current and the previous release sets.
# Dry-run by default: it prints the image references it would remove. Pass --apply to remove them.
#   prune-deploy-images.sh [--apply]
# The node is shared with another tenant, so this never runs a global prune (no `docker system prune`, no `docker image prune`).
# It removes one named reference at a time, `docker image rm <repository>@<digest>`, and only a reference whose repository is
# one the kept manifests name (the *_IMAGE repositories of $GELDAR_RELEASE_FILE, default /etc/geldar-colo/release.env) and
# whose digest is in neither the current manifest nor the previous one ($GELDAR_STATE_DIR/previous.env, default
# /var/lib/geldar-colo/previous.env; it may be missing on a first deploy). docker itself refuses an image a container uses;
# that is reported and does not stop the run. A missing or empty current manifest refuses and removes nothing.
# The colo-cd lock directory ($GELDAR_STATE_DIR/cd.lock) must be free and is held for the run. Output is references only. POSIX sh.
set -eu
unset BASH_ENV ENV
RELEASE_FILE=${GELDAR_RELEASE_FILE:-/etc/geldar-colo/release.env}
STATE_DIR=${GELDAR_STATE_DIR:-/var/lib/geldar-colo}
apply=0

fail() {
  echo "prune-deploy-images: $1" >&2
  exit 1
}

for a in "$@"; do
  case $a in
    --apply) apply=1 ;;
    *) fail "unknown argument" ;;
  esac
done

[ -f "$RELEASE_FILE" ] && [ -r "$RELEASE_FILE" ] || fail "the current release manifest is not readable; nothing removed"
# KEY=VALUE lines named *_IMAGE hold name@sha256:<64 hex>; nothing is sourced. CR and quotes are dropped, and a tag
# (name:tag@sha256:...) is removed, because docker lists the repository without it.
refs() {
  [ -f "$1" ] || return 0
  tr -d "\\r\"'" <"$1" |
    sed -n 's/^[A-Z0-9_]*_IMAGE=\([^[:space:]]*@sha256:[0-9a-f]\{64\}\)$/\1/p' |
    sed 's#:[^/@]*@#@#'
}
keep=$(refs "$RELEASE_FILE"; refs "$STATE_DIR/previous.env")
[ -n "$(refs "$RELEASE_FILE")" ] || fail "the current release manifest lists no images; nothing removed"
repos=$(printf '%s\n' "$keep" | sed 's/@.*//' | sort -u)

[ -d "$STATE_DIR" ] || fail "no state directory"
mkdir "$STATE_DIR/cd.lock" 2>/dev/null || fail "the colo-cd lock is held or unavailable; nothing removed"
trap 'rmdir "$STATE_DIR/cd.lock" 2>/dev/null || true' EXIT
# A signal ends the run through exit, so the EXIT trap releases the lock (as deploy/colo-cd.sh does).
trap 'exit 1' HUP INT TERM

all=$(docker images --digests --no-trunc --format '{{.Repository}}@{{.Digest}}') || fail "cannot list docker images; nothing removed"
# The loop runs in this shell (a here-document, not a pipeline), so the trap above stops it at the next step.
while IFS= read -r ref; do
  repo=${ref%%@*}
  case $ref in *@sha256:*) ;; *) continue ;; esac
  printf '%s\n' "$repos" | grep -qxF -- "$repo" || continue
  printf '%s\n' "$keep" | grep -qxF -- "$ref" && continue
  if [ "$apply" = 1 ]; then
    if docker image rm "$ref" >/dev/null 2>&1; then echo "removed $ref"; else echo "kept (in use or refused) $ref"; fi
  else
    echo "would remove $ref"
  fi
done <<EOF
$(printf '%s\n' "$all" | sort -u)
EOF
