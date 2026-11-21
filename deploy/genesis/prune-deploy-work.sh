#!/bin/sh
# Prunes old deploy checkouts under <root>/work (default root /var/lib/geldar-deploy). Every deploy leaves one
# directory named by its commit (40 lowercase hex), about 4,400 inodes each, and nothing else removes them.
# Dry-run by default: it prints the names it would remove and deletes nothing. Pass --apply to delete.
#   prune-deploy-work.sh [--keep N] [--apply]
# Rules: only direct children of <root>/work that are real directories (never symlinks) named by exactly 40
# lowercase hex characters are candidates. The newest N by modification time are kept (default 5; N must be 2 to 1000, so an
# in-flight deploy's fresh checkout is never among the removed), and so is every commit a record of the live release names
# (the node's state directory is GELDAR_STATE_DIR=/mnt/nvme/geldar-colo/state, not the default, so set it; dry run first; see
# "The live commit" below: release.commit, the manifests in the state directory, the staged and inbox manifests). Fail closed:
# a record that exists but cannot be read as a file, or whose first line names no valid commit, or whose directory exists but
# cannot be searched, refuses the run; only a record that does not exist is skipped; with no live record, nothing is removed.
# Either way the exit code is 1 and nothing is removed. The deploy lock
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
# (the records of what is live) exists. A record that EXISTS but cannot be read as a file (mode, directory, dangling symlink) or
# whose first line is not a valid commit refuses the run (fail closed); only a record that does not exist is skipped. CR is tolerated.
prefix='# Release manifest for the Colo node (decision 0084). Commit '
cr=$(printf '\r')
protected=
liveknown=0
# A record that exists (a file, a directory, a symlink, even a dangling one) but cannot be read as a file, or whose first line
# does not name a valid commit, REFUSES the run: skipping it would hide a commit that must be kept (fail closed). Only a record
# that does not exist at all is skipped.
exists() { # <file>: 0 if the record exists, 1 if it does not; refuses when that cannot be told
  if [ -e "$1" ] || [ -L "$1" ]; then return 0; fi
  dir=$(dirname "$1")
  # A directory the account cannot search hides its records: they would look absent. Refuse rather than skip.
  if [ -d "$dir" ] && [ ! -x "$dir" ]; then fail "the directory $dir exists but cannot be searched, so its records cannot be checked; nothing removed. Rerun with an account that can search it (for example with sudo)"; fi
  return 1
}
first_line_of() { # <file>: sets $first, or refuses
  [ -f "$1" ] && [ -r "$1" ] || fail "the record $1 exists but is not a readable file; nothing removed"
  first=
  IFS= read -r first <"$1" || true
  first=${first%"$cr"}
}
valid_commit() { # <candidate>
  case $1 in '' | *[!0-9a-f]*) return 1 ;; esac
  [ "${#1}" -eq 40 ]
}
record_commit() { # <live: 1 if the record says what is live> <name>: adds $named
  valid_commit "$named" || fail "the record $2 does not name a valid commit on its first line; nothing removed"
  protected="$protected $named"
  if [ "$1" = 1 ]; then liveknown=1; fi
}
manifest_commit() { # <file> <live>
  exists "$1" || return 0
  first_line_of "$1"
  case $first in
    "$prefix"*.) named=${first#"$prefix"}; named=${named%.} ;;
    *) named= ;;
  esac
  record_commit "$2" "$1"
}
if exists "$STATE_DIR/release.commit"; then
  first_line_of "$STATE_DIR/release.commit"
  named=$first
  record_commit 1 "$STATE_DIR/release.commit"
fi
manifest_commit "$STATE_DIR/release.env" 1
manifest_commit "$STATE_DIR/current.env" 1
manifest_commit "$STATE_DIR/previous.env" 0
manifest_commit "$ROOT/staged/release.env" 0
manifest_commit "$ROOT/inbox/release.env" 0
[ "$liveknown" -eq 1 ] || fail "no record of the live commit exists (release.commit, release.env, current.env in $STATE_DIR); nothing removed. Is GELDAR_STATE_DIR set to the node's state directory (/mnt/nvme/geldar-colo/state)?"

# One run at a time, and never beside a deploy. Two locks: the deploy channel's flock file, and the directory lock
# deploy/colo-cd.sh takes (<state dir>/cd.lock, mkdir-atomic). The directory is taken here too, so a deploy cannot start
# mid-prune, and is removed on exit. The root-owned entrypoint may hold a lock of its own that is not in the repo.
command -v flock >/dev/null 2>&1 || fail "flock is missing; cannot take the deploy lock"
exec 9>>"$ROOT/channel.lock" || fail "the deploy lock cannot be opened"
flock -n 9 || fail "the deploy lock is held; a deploy may be running"
[ -d "$STATE_DIR" ] || fail "the state directory $STATE_DIR is missing; cannot take the colo-cd lock. Set GELDAR_STATE_DIR to the node's state directory (/mnt/nvme/geldar-colo/state)"
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
