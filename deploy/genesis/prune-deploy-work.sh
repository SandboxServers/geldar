#!/bin/sh
# Prunes old deploy checkouts under <root>/work (default root /var/lib/geldar-deploy). Every deploy leaves one
# directory named by its commit (40 lowercase hex), about 4,400 inodes each, and nothing else removes them.
# Dry-run by default: it prints the names it would remove and deletes nothing. Pass --apply to delete.
#   prune-deploy-work.sh [--keep N] [--apply]
# Rules: only direct children of <root>/work that are real directories (never symlinks) named by exactly 40
# lowercase hex characters are candidates. The newest N by modification time are kept (default 5; N must be 2 to 1000, so an
# in-flight deploy's fresh checkout is never among the removed), and so is the live commit. The live commit is the one line
# of <state dir>/release.commit (default /var/lib/geldar-colo/release.commit), which deploy/colo-cd.sh reads (line 310) and
# writes on success (line 423); it must be 40 lowercase hex. If <root>/staged/release.env exists and its first line is the
# workflow's manifest comment, that commit is kept too (the repo does not show this file, so it is optional).
# With release.commit unreadable, or not 40 hex, nothing is removed and the exit code is 1. The deploy lock
# (<root>/channel.lock, the one the deploy channel takes) and the colo-cd lock directory ($GELDAR_STATE_DIR/cd.lock,
# default /var/lib/geldar-colo) must both be free: they are held for the whole run, and a busy or unavailable lock refuses.
# Output is names only. Nothing here touches docker. POSIX sh.
set -eu
unset BASH_ENV ENV
ROOT=${GELDAR_DEPLOY_ROOT:-/var/lib/geldar-deploy}
STATE_DIR=${GELDAR_STATE_DIR:-/var/lib/geldar-colo}
keep=5
apply=0

fail() {
  echo "prune-deploy-work: $1" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case $1 in
    --apply) apply=1 ;;
    --keep)
      [ "$#" -ge 2 ] || fail "--keep needs a number"
      keep=$2
      shift
      ;;
    *) fail "unknown argument" ;;
  esac
  shift
done
case $keep in
  '' | *[!0-9]* | ?????*) fail "--keep must be a whole number from 2 to 1000" ;;
esac
[ "$keep" -ge 2 ] && [ "$keep" -le 1000 ] || fail "--keep must be a whole number from 2 to 1000"

WORKDIR=$ROOT/work
[ -d "$WORKDIR" ] || fail "no work directory"

# The live commit comes first: no live commit, no deletion. It is the one line of $STATE_DIR/release.commit (colo-cd.sh
# records the commit the node runs there). CR is tolerated; anything but 40 lowercase hex refuses.
live=
if [ -f "$STATE_DIR/release.commit" ] && [ -r "$STATE_DIR/release.commit" ]; then
  IFS= read -r live <"$STATE_DIR/release.commit" || true
  live=${live%"$(printf '\r')"}
fi
case $live in
  '' | *[!0-9a-f]*) fail "the live commit (release.commit) could not be read; nothing removed" ;;
esac
[ "${#live}" -eq 40 ] || fail "the live commit (release.commit) could not be read; nothing removed"
# Optional second keep: the commit on the first line of the staged manifest, when that file exists and has the workflow's shape.
live2=
if [ -f "$ROOT/staged/release.env" ] && [ -r "$ROOT/staged/release.env" ]; then
  IFS= read -r first <"$ROOT/staged/release.env" || true
  prefix='# Release manifest for the Colo node (decision 0084). Commit '
  case $first in
    "$prefix"*.) live2=${first#"$prefix"}; live2=${live2%.} ;;
  esac
  case $live2 in *[!0-9a-f]*) live2= ;; esac
  [ "${#live2}" -eq 40 ] || live2=
fi

# One run at a time, and never beside a deploy. Two locks: the deploy channel's flock file, and the directory lock
# deploy/colo-cd.sh takes (<state dir>/cd.lock, mkdir-atomic). The directory is taken here too, so a deploy cannot start
# mid-prune, and is removed on exit. The root-owned entrypoint may hold a lock of its own that is not in the repo.
command -v flock >/dev/null 2>&1 || fail "flock is missing; cannot take the deploy lock"
exec 9>>"$ROOT/channel.lock" || fail "the deploy lock cannot be opened"
flock -n 9 || fail "the deploy lock is held; a deploy may be running"
[ -d "$STATE_DIR" ] || fail "the state directory is missing; cannot take the colo-cd lock"
CDLOCK=$STATE_DIR/cd.lock
mkdir "$CDLOCK" 2>/dev/null || fail "the colo-cd lock is held (or cannot be created); a deploy may be running"
trap 'rmdir "$CDLOCK" 2>/dev/null || true' EXIT
# A signal ends the run through exit, so the EXIT trap releases the lock (as deploy/colo-cd.sh does).
trap 'exit 1' HUP INT TERM

kept=0
removed=0
# Newest first. ls -t sorts by modification time; the names are checked below, so odd names only get skipped.
# The list comes from a here-document so the loop runs in this shell and the counters survive.
while IFS= read -r name; do
  case $name in
    *[!0-9a-f]*) continue ;;
  esac
  [ "${#name}" -eq 40 ] || continue
  path=$WORKDIR/$name
  if [ -L "$path" ] || [ ! -d "$path" ]; then continue; fi
  # The newest N count every candidate, the live one included; the live commit is kept even when it is older.
  if [ "$name" = "$live" ] || [ "$name" = "$live2" ] || [ "$kept" -lt "$keep" ]; then
    kept=$((kept + 1))
    continue
  fi
  if [ "$apply" -eq 1 ]; then
    rm -rf -- "$path"
    echo "removed $name"
  else
    echo "would remove $name"
  fi
  removed=$((removed + 1))
done <<EOF
$(ls -1t "$WORKDIR")
EOF
if [ "$apply" -eq 1 ]; then
  echo "prune-deploy-work: removed $removed, kept the newest $keep and the live commit"
else
  echo "prune-deploy-work: dry run, $removed would be removed; pass --apply to delete"
fi
