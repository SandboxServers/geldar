#!/bin/sh
# Prunes old deploy checkouts under <root>/work (default root /var/lib/geldar-deploy). Every deploy leaves one
# directory named by its commit (40 lowercase hex), about 4,400 inodes each, and nothing else removes them.
# Dry-run by default: it prints the names it would remove and deletes nothing. Pass --apply to delete.
#   prune-deploy-work.sh [--keep N] [--apply]
# Rules: only direct children of <root>/work that are real directories (never symlinks) named by exactly 40
# lowercase hex characters are candidates. The newest N by modification time are kept (default 5; N must be 2 to 1000, so an
# in-flight deploy's fresh checkout is never among the removed), and so is every commit a record of the live release names
# (see "The live commit" below: release.commit, the manifests in the state directory, the staged and inbox manifests). With no
# readable record of the live commit, nothing is removed and the exit code is 1. The deploy lock
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

# The live commit comes first: no live commit, no deletion. The repo records it in more than one place, and which of them a
# node has depends on the path that deployed it, so every record that exists is read and EVERY commit any of them names is kept:
#   $STATE_DIR/release.commit   one line, 40 hex (written by colo-cd.sh on success)
#   $STATE_DIR/release.env, current.env   copies of the release manifest colo-cd.sh installed
#   $STATE_DIR/previous.env     the rollback target
#   <root>/staged/release.env, <root>/inbox/release.env   the manifest being staged or just written by the workflow
# A manifest names its commit on its first line, written by the colo-images workflow: "# Release manifest for the Colo node
# (decision 0084). Commit <40 hex>." Nothing is removed unless at least one of release.commit, release.env or current.env
# (the records of what is live) yields a valid commit; CR is tolerated, anything but 40 lowercase hex is ignored.
prefix='# Release manifest for the Colo node (decision 0084). Commit '
cr=$(printf '\r')
protected=
liveknown=0
add_commit() { # <candidate> <live: 1 if this record says what is live>
  c=${1%"$cr"}
  case $c in '' | *[!0-9a-f]*) return 0 ;; esac
  [ "${#c}" -eq 40 ] || return 0
  protected="$protected $c"
  if [ "$2" = 1 ]; then liveknown=1; fi
}
manifest_commit() { # <file> <live>
  [ -f "$1" ] && [ -r "$1" ] || return 0
  first=
  IFS= read -r first <"$1" || true
  first=${first%"$cr"}
  case $first in
    "$prefix"*.)
      named=${first#"$prefix"}
      add_commit "${named%.}" "$2"
      ;;
  esac
}
if [ -f "$STATE_DIR/release.commit" ] && [ -r "$STATE_DIR/release.commit" ]; then
  one=
  IFS= read -r one <"$STATE_DIR/release.commit" || true
  add_commit "$one" 1
fi
manifest_commit "$STATE_DIR/release.env" 1
manifest_commit "$STATE_DIR/current.env" 1
manifest_commit "$STATE_DIR/previous.env" 0
manifest_commit "$ROOT/staged/release.env" 0
manifest_commit "$ROOT/inbox/release.env" 0
[ "$liveknown" -eq 1 ] || fail "no record of the live commit could be read (release.commit, release.env, current.env in $STATE_DIR); nothing removed"

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
  case " $protected " in *" $name "*) is_protected=1 ;; *) is_protected=0 ;; esac
  if [ "$is_protected" -eq 1 ] || [ "$kept" -lt "$keep" ]; then
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
