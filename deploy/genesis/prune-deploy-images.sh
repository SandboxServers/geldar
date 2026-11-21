#!/bin/sh
# Removes old Geldar images from the node's docker, keeping the current and the previous release sets.
# Dry-run by default: it prints the image references it would remove. Pass --apply to remove them.
#   prune-deploy-images.sh [--apply]
# The node is shared with another tenant, so this never runs a global prune (no `docker system prune`, no `docker image prune`).
# It removes one named reference at a time, `docker image rm <repository>@<digest>`, and only a reference whose repository is
# one the kept manifests name and whose digest is in none of them. The manifests are every one that exists of
# $GELDAR_RELEASE_FILE (default /etc/geldar-colo/release.env, root-only on the node), $GELDAR_STATE_DIR/release.env and
# current.env, and previous.env (the rollback target; it may be missing on a first deploy), with $GELDAR_STATE_DIR defaulting to
# /var/lib/geldar-colo; the node's state directory is GELDAR_STATE_DIR=/mnt/nvme/geldar-colo/state, so set it (dry run first). docker itself refuses an image a container uses; that is reported and does not stop the run. If no
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
# A manifest that EXISTS (a file, a directory, a symlink, even a dangling one) but cannot be read as a file, or lists no images,
# REFUSES the run, dry run included: skipping it would hide an image that must be kept (fail closed). Only a manifest that does
# not exist at all is skipped, and so is a record in a directory that cannot be searched, with ONE exception: /etc/geldar-colo is
# a root-only directory on the node, so the operator account cannot look inside it and its copy is skipped (the state directory
# copies are the records that count there). A directory that cannot be searched is otherwise refused.
exists() { # <file>: 0 if the record exists, 1 if it does not; refuses when that cannot be told
  if [ -e "$1" ] || [ -L "$1" ]; then return 0; fi
  dir=$(dirname "$1")
  # A directory the account cannot search hides its records: they would look absent. The one exception is the root-only
  # $RELEASE_FILE directory (/etc/geldar-colo), whose copy the operator account is not meant to read (see manifest_refs).
  if [ "$1" != "$RELEASE_FILE" ] && [ -d "$dir" ] && [ ! -x "$dir" ]; then
    fail "the directory $dir exists but cannot be searched, so its records cannot be checked; nothing removed. Rerun with an account that can search it (for example with sudo)"
  fi
  return 1
}
manifest_refs() { # <file>: prints its image references
  exists "$1" || return 0
  [ -f "$1" ] && [ -r "$1" ] || fail "the record $1 exists but is not a readable file; nothing removed"
  found=$(refs "$1")
  [ -n "$found" ] || fail "the record $1 lists no images; nothing removed"
  printf '%s\n' "$found"
}
# The records of what is live are the root-owned $RELEASE_FILE, the copy colo-cd.sh keeps in the state directory
# ($STATE_DIR/release.env) and current.env; previous.env is the rollback target. Nothing is removed unless a live record exists.
live_a=$(manifest_refs "$RELEASE_FILE")
live_b=$(manifest_refs "$STATE_DIR/release.env")
live_c=$(manifest_refs "$STATE_DIR/current.env")
prev=$(manifest_refs "$STATE_DIR/previous.env")
live=$(printf '%s\n%s\n%s\n' "$live_a" "$live_b" "$live_c" | sed '/^$/d')
[ -n "$live" ] || fail "no record of the current release exists (release.env, current.env in $STATE_DIR); nothing removed. Is GELDAR_STATE_DIR set to the node's state directory (/mnt/nvme/geldar-colo/state)?"
keep=$(printf '%s\n%s\n' "$live" "$prev" | sed '/^$/d')
repos=$(printf '%s\n' "$keep" | sed 's/@.*//' | sort -u)

[ -d "$STATE_DIR" ] || fail "no state directory $STATE_DIR; set GELDAR_STATE_DIR to the node's state directory (/mnt/nvme/geldar-colo/state)"
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
