#!/bin/sh
# Prunes old deploy checkouts under <root>/work (default root /var/lib/geldar-deploy). Every deploy leaves one
# directory named by its commit (40 lowercase hex), about 4,400 inodes each, and nothing else removes them.
# Dry-run by default: it prints the names it would remove and deletes nothing. Pass --apply to delete.
#   prune-deploy-work.sh [--keep N] [--apply]
# Rules: only direct children of <root>/work that are real directories (never symlinks) named by exactly 40
# lowercase hex characters are candidates. The newest N by modification time are kept (default 5), and so is the
# live commit, the first line of <root>/staged/release.env (only that line is read, and it is never printed).
# With the live commit unreadable, or not 40 hex, nothing is removed and the exit code is 1. The deploy lock
# (<root>/channel.lock, the one the deploy channel takes) must be free: it is held for the whole run, and a busy or
# unavailable lock refuses. Output is names only. Nothing here touches docker. POSIX sh.
set -eu
unset BASH_ENV ENV
ROOT=${GELDAR_DEPLOY_ROOT:-/var/lib/geldar-deploy}
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
  '' | *[!0-9]*) fail "--keep must be a whole number" ;;
esac

WORKDIR=$ROOT/work
[ -d "$WORKDIR" ] || fail "no work directory"

# The live commit comes first: no live commit, no deletion.
live=
if [ -f "$ROOT/staged/release.env" ] && [ -r "$ROOT/staged/release.env" ]; then
  IFS= read -r live <"$ROOT/staged/release.env" || true
fi
case $live in
  '' | *[!0-9a-f]*) fail "the live commit could not be read; nothing removed" ;;
esac
[ "${#live}" -eq 40 ] || fail "the live commit could not be read; nothing removed"

# One run at a time, and never beside a deploy.
command -v flock >/dev/null 2>&1 || fail "flock is missing; cannot take the deploy lock"
exec 9>>"$ROOT/channel.lock" || fail "the deploy lock cannot be opened"
flock -n 9 || fail "the deploy lock is held; a deploy may be running"

kept=0
removed=0
# Newest first. ls -t sorts by modification time; the names are checked below, so odd names only get skipped.
for name in $(ls -1t "$WORKDIR"); do
  case $name in
    *[!0-9a-f]*) continue ;;
  esac
  [ "${#name}" -eq 40 ] || continue
  path=$WORKDIR/$name
  if [ -L "$path" ] || [ ! -d "$path" ]; then continue; fi
  # The newest N count every candidate, the live one included; the live commit is kept even when it is older.
  if [ "$name" = "$live" ] || [ "$kept" -lt "$keep" ]; then
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
done
if [ "$apply" -eq 1 ]; then
  echo "prune-deploy-work: removed $removed, kept the newest $keep and the live commit"
else
  echo "prune-deploy-work: dry run, $removed would be removed; pass --apply to delete"
fi
