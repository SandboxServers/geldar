#!/bin/sh
# Removes old Geldar images from the node's docker, keeping the current and the previous release sets.
# Dry-run by default: it prints the image references it would remove. Pass --apply to remove them.
#   prune-deploy-images.sh [--apply]
# The node is shared with another tenant, so this never runs a global prune (no `docker system prune`, no `docker image prune`).
# It removes one named reference at a time, `docker image rm <repository>@<digest>`, and only a reference whose repository is
# one the kept manifests name and whose digest is in none of them. The manifests are every one that exists of
# $GELDAR_RELEASE_FILE (default /etc/geldar-colo/release.env, root-only on the node), $GELDAR_STATE_DIR/release.env and
# current.env, and previous.env (the rollback target; it may be missing on a first deploy), with $GELDAR_STATE_DIR defaulting to
# /var/lib/geldar-colo. docker itself refuses an image a container uses; that is reported and does not stop the run. If no
# record of the current release lists images, nothing is removed and the exit code is 1.
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

# KEY=VALUE lines named *_IMAGE hold name@sha256:<64 hex>; nothing is sourced. CR and quotes are dropped, and a tag
# (name:tag@sha256:...) is removed, because docker lists the repository without it.
refs() {
  [ -f "$1" ] || return 0
  tr -d "\\r\"'" <"$1" |
    sed -n 's/^[A-Z0-9_]*_IMAGE=\([^[:space:]]*@sha256:[0-9a-f]\{64\}\)$/\1/p' |
    sed 's#:[^/@]*@#@#'
}
# Every manifest that exists is read, and every image any of them names is kept. The records of what is live are the root-owned
# $RELEASE_FILE (the operator account usually cannot read it), the copy colo-cd.sh keeps in the state directory
# ($STATE_DIR/release.env) and current.env; previous.env is the rollback target. Nothing is removed unless a live record lists images.
live=$(refs "$RELEASE_FILE"; refs "$STATE_DIR/release.env"; refs "$STATE_DIR/current.env")
[ -n "$live" ] || fail "no readable record of the current release lists images (release.env, current.env); nothing removed"
keep=$(printf '%s
' "$live"; refs "$STATE_DIR/previous.env")
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
