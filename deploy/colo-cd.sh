#!/bin/sh
# CD-2a: delta deploy of the Colo stack (decision 0084). Runs on the node as the operator account (never root).
# It applies only what changed in a new release: the release manifest (previous.env / current.env swap), the changed repo
# files in the node's src extract (with .bak-<UTC> copies), a pg dump and the migrations when sql/ changed, and the
# services whose image digest changed, one at a time, each with a health check. A failed health check rolls back: the
# previous release is re-applied to the services already changed, the player hosts are recreated, and the script exits 1.
# Never restarted: Paper, Velocity, Caddy, Postgres, NATS. Never started: mind. Plugin, compose and Caddy/NATS changes are
# printed as "needs manual" and not applied. REGISTER_KILL_SWITCH is never read or written here.
# Usage: colo-cd.sh [--dry-run] [<release.env path> <release sha> <export dir>]
#   With no positional args, the inputs come from the environment: GELDAR_RELEASE_MANIFEST (a validated copy of the
#   release manifest), GELDAR_RELEASE_SHA (the 40-character main sha) and the working directory (the git-less export).
# Env: COLO_CD_NOTICE_SECONDS (default 30; 0 skips the wait). The log is $STATE_DIR/cd.log (no secrets, no addresses).
#   COLO_CD_RELEASE_FILE (the node's manifest copy), GELDAR_COLO_ROOT (the src extract, default /mnt/nvme/geldar-colo/src),
#   COLO_CD_ENV_FILE (default /home/claude/colo-env.sh, sourced when present), COLO_CD_IMAGE_INSPECT (test shim).
set -eu
# The entrypoint runs this with a cleared environment: PATH and HOME are set here when they are empty. An inherited PATH
# is kept (the tests put a shim first on it).
PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
export PATH
if [ -z "${HOME:-}" ]; then HOME=$(getent passwd "$(id -u)" | cut -d: -f6) || true; fi
export HOME
COLO_CD_ENV_FILE=${COLO_CD_ENV_FILE:-/home/claude/colo-env.sh}
if [ -f "$COLO_CD_ENV_FILE" ]; then . "$COLO_CD_ENV_FILE"; fi
GELDAR_COLO_ROOT=${GELDAR_COLO_ROOT:-/mnt/nvme/geldar-colo/src}
export GELDAR_COLO_ROOT
. "$(dirname "$0")/common.sh"
. "$DEPLOY_DIR/colo-cd-verify.sh"
. "$DEPLOY_DIR/colo-cd-players.sh"
# The node's own copy of the release manifest. The root-owned /etc copy is not readable by the operator account on the
# node, so colo-cd reads and writes this one (deploy/README.md). colo-up.sh and colo-rollback.sh still read $GELDAR_RELEASE_FILE.
RELEASE_FILE=${COLO_CD_RELEASE_FILE:-$STATE_DIR/release.env}
HOST_MANIFEST=$RELEASE_FILE

if [ "${1:-}" = --dry-run ]; then
  DRY_RUN=1
  shift
fi
case $# in
  0)
    NEW=${GELDAR_RELEASE_MANIFEST:-}
    SHA=${GELDAR_RELEASE_SHA:-}
    REPO=$(pwd)
    [ -n "$NEW" ] && [ -n "$SHA" ] || die "set GELDAR_RELEASE_MANIFEST and GELDAR_RELEASE_SHA, or pass <release.env> <sha> <repo dir>"
    ;;
  3)
    NEW=$1
    SHA=$2
    REPO=$3
    ;;
  *) die "usage: colo-cd.sh [--dry-run] [<release.env path> <release sha> <export dir>]" ;;
esac
NOTICE_SECS=${COLO_CD_NOTICE_SECONDS:-30}
case $NOTICE_SECS in '' | *[!0-9]*) die "COLO_CD_NOTICE_SECONDS must be a whole number of seconds" ;; esac
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOCK=$STATE_DIR/cd.lock
LOG=$STATE_DIR/cd.log
LOCKED=0
TOUCHED=
CHANGED=
SQL=no
STALE_HOSTS=
PLAYER_WAIT=${COLO_CD_PLAYER_WAIT:-60}
PLAYER_SETTLE=${COLO_CD_PLAYER_SETTLE:-5}
case $PLAYER_WAIT$PLAYER_SETTLE in '' | *[!0-9]*) die "COLO_CD_PLAYER_WAIT and COLO_CD_PLAYER_SETTLE must be whole numbers of seconds" ;; esac
OPEN_SCOPE=
# Restart order: the services that may change. Paper, Velocity, Caddy, Postgres, NATS and mind are never in this list.
ORDER="eventsink register glass geldar-mcp golem-body"
PULL_SET="admin eventsink register glass geldar-mcp golem-body"

release_lock() {
  if [ "$LOCKED" = 1 ]; then rmdir "$LOCK" 2>/dev/null || true; fi
}
trap 'rm -rf "$WORK"; release_lock' EXIT
# A signal ends the run through exit, so the EXIT trap removes the work dir and the lock.
trap 'exit 1' HUP INT TERM

log() {
  say "$*"
  if [ "$DRY_RUN" != 1 ]; then
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"
  fi
}

# One lock directory under the state dir: a second run is refused while the first holds it (mkdir is atomic).
acquire_lock() {
  mkdir -p "$STATE_DIR" || die "cannot create $STATE_DIR"
  mkdir "$LOCK" 2>/dev/null || die "another colo-cd run holds $LOCK; refusing to overlap"
  LOCKED=1
}

# The compose profile a service needs to be seen by compose (empty when it is in the default set).
profile_of() {
  case $1 in
    register) echo register ;;
    admin) echo admin ;;
    animus) echo mind ;;
    players-host) echo sovereign ;;
    *) echo "" ;;
  esac
}

svc_compose() {
  svc=$1
  shift
  p=$(profile_of "$svc")
  if [ -n "$p" ]; then dc --profile "$p" "$@" "$svc"; else dc "$@" "$svc"; fi
}

# True when the service's container is healthy, or running with no health check.
healthy() {
  cid=$(svc_compose "$1" ps -q 2>/dev/null | head -n 1) || return 1
  [ -n "$cid" ] || return 1
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid") || return 1
  case $st in
    healthy | running) return 0 ;;
  esac
  return 1
}

notice() {
  if [ ! -f "$DEPLOY_DIR/colo-notice.sh" ]; then
    log "warning: colo-notice.sh is missing; no maintenance notice sent ($*)"
    return 0
  fi
  sh "$DEPLOY_DIR/colo-notice.sh" "$@" || log "warning: colo-notice.sh $* failed; continuing"
}

pause_scope() {
  notice pause "$1" "$NOTICE_SECS" update
  OPEN_SCOPE=$1
  if [ "$NOTICE_SECS" -gt 0 ]; then sleep "$NOTICE_SECS"; fi
}

close_scope() {
  if [ -n "$OPEN_SCOPE" ]; then
    notice back "$OPEN_SCOPE"
    OPEN_SCOPE=
  fi
}

# Recreates each RUNNING player host, one at a time (stop, then start). Hibernating hosts are left as they are.
recreate_players() {
  running_hosts >"$WORK/players.txt" || {
    log "cannot list the player hosts; check them by hand"
    return 1
  }
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    host_admin player-stop "$id" >/dev/null || { log "cannot stop player host $id"; return 1; }
    host_admin player-start "$id" >/dev/null || { log "cannot start player host $id"; return 1; }
    running_hosts | grep -q "^$id\$" || { log "player host $id is not running after restart"; return 1; }
    log "recreated player host $id"
  done <"$WORK/players.txt"
  return 0
}

# Waits for the player host container to be Up, lets it settle (a host that dies on join is not Up afterwards), then checks
# that its image carries the release revision label.
host_up_and_current() {
  id=$1
  n=0
  until [ "$(host_status "$id")" = running ]; do
    n=$((n + 1))
    [ "$n" -le "$PLAYER_WAIT" ] || return 1
    sleep 1
  done
  if [ "$PLAYER_SETTLE" -gt 0 ]; then sleep "$PLAYER_SETTLE"; fi
  [ "$(host_status "$id")" = running ] || return 1
  [ "$(host_revision "$id")" = "$SHA_FULL" ] || return 1
}

# Puts the player host back on the image it ran before (a copy of the manifest with that body image), when it is known.
restore_host() {
  id=$1
  old=$2
  host_admin player-stop "$id" >/dev/null 2>&1 || true
  if [ -z "$old" ]; then
    log "player host $id: the previous image is unknown; not restored"
    return 1
  fi
  sed "s|^GELDAR_BODY_IMAGE=.*|GELDAR_BODY_IMAGE=$old|" "$RELEASE_FILE" >"$WORK/restore-$id.env" || return 1
  if HOST_MANIFEST="$WORK/restore-$id.env" host_admin player-start "$id" >/dev/null; then
    log "player host $id restored on its previous image"
    return 0
  fi
  log "player host $id could not be restored on its previous image"
  return 1
}

# Refreshes each running player host whose image differs from the new body image, one at a time, after the shared services.
# On a failure the loop stops, the host is put back on its previous image if possible, and the run is needs-manual.
refresh_hosts() {
  want=${GELDAR_BODY_IMAGE:-}
  [ -n "$want" ] || return 0
  ids=$(running_hosts) || { log "cannot list the player hosts; needs manual"; return 1; }
  for id in $ids; do
    old=$(host_image "$id")
    if [ "$old" = "$want" ]; then continue; fi
    log "refresh player host $id (image differs from the release body image)"
    pause_scope bodies
    if host_admin player-stop "$id" >/dev/null &&
      host_admin player-start "$id" >/dev/null &&
      host_up_and_current "$id"; then
      log "refreshed player host $id"
      close_scope
      continue
    fi
    log "player host $id failed to refresh; stopping the loop; needs manual"
    restore_host "$id" "$old" || true
    close_scope
    return 1
  done
  return 0
}

# Re-applies the previous release (previous.env, read from the work copy) to every service this run changed, then
# recreates the player hosts when golem-body was among them. The failed release becomes previous.env (as in
# colo-rollback.sh). Migrations are not reversed: they are forward-only.
rollback() {
  bad=$1
  log "health check failed: $bad; rolling back the services already changed:$TOUCHED"
  (
    umask 077
    cp "$STATE_DIR/previous.env" "$WORK/old.env" &&
      cp "$RELEASE_FILE" "$STATE_DIR/previous.env.new" &&
      mv "$STATE_DIR/previous.env.new" "$STATE_DIR/previous.env" &&
      cp "$WORK/old.env" "$RELEASE_FILE.new" && mv "$RELEASE_FILE.new" "$RELEASE_FILE" &&
      cp "$RELEASE_FILE" "$STATE_DIR/current.env.new" && mv "$STATE_DIR/current.env.new" "$STATE_DIR/current.env"
  ) || log "cannot restore the manifest records in $STATE_DIR; check them by hand"
  load_release "$WORK/old.env"
  for svc in $TOUCHED; do
    if svc_compose "$svc" up -d --no-deps --wait --pull never; then
      log "rolled back: $svc"
    else
      log "rollback failed for $svc; check it by hand"
    fi
  done
  case " $TOUCHED " in
    *" golem-body "*) recreate_players || log "player hosts were not all recreated; check them by hand" ;;
  esac
  close_scope
  die "rolled back after a failed health check on $bad; nothing else was changed (exit 1)"
}

# Stops before any container was restarted: puts the previous manifest back and exits 1.
abort_untouched() {
  log "$*; no container was restarted; restoring the previous manifest"
  (
    umask 077
    cp "$STATE_DIR/previous.env" "$RELEASE_FILE.new" && mv "$RELEASE_FILE.new" "$RELEASE_FILE"
  ) || log "cannot restore $RELEASE_FILE; check it by hand"
  die "$*"
}

restart_one() {
  svc=$1
  TOUCHED="$TOUCHED $svc"
  log "restart $svc (digest changed)"
  if ! svc_compose "$svc" up -d --no-deps --wait || ! healthy "$svc"; then
    rollback "$svc"
  fi
  log "healthy: $svc"
}

# Copies each changed repo file into the src extract. The file it replaces is kept as .bak-<UTC>.
refresh_src() {
  [ -s "$WORK/refresh.txt" ] || return 0
  real_repo=$(readlink -f "$REPO") || { log "cannot resolve $REPO"; return 1; }
  real_root=$(readlink -f "$ROOT") || { log "cannot resolve $ROOT"; return 1; }
  [ "$real_repo" != "$real_root" ] || { log "the checkout is the src extract itself; refusing to copy onto it"; return 1; }
  n=0
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    dst=$ROOT/$rel
    mkdir -p "$(dirname "$dst")" || { log "cannot create the directory for $rel"; return 1; }
    if [ -e "$dst" ]; then cp "$dst" "$dst.bak-$STAMP" || { log "cannot back up $rel"; return 1; }; fi
    cp "$REPO/$rel" "$dst.new" && mv "$dst.new" "$dst" || { log "cannot refresh $rel"; return 1; }
    n=$((n + 1))
  done <"$WORK/refresh.txt"
  log "src extract: $n changed files refreshed (.bak-$STAMP copies kept)"
}

plan_header
need docker
check_prereqs
[ -d "$REPO" ] || die "export dir not found: $REPO"
[ -f "$NEW" ] || die "release manifest not found: $NEW"
[ -f "$RELEASE_FILE" ] || die "no installed release manifest at $RELEASE_FILE; install the first one by hand (deploy/README.md)"
case $SHA in
  '' | *[!0-9a-f]*) die "the release sha must be 40 lowercase hex characters (the main commit)" ;;
esac
[ "${#SHA}" -eq 40 ] || die "the release sha must be 40 lowercase hex characters (the main commit)"
( load_release "$NEW" ) || die "the new release manifest does not validate"
SHA_FULL=$SHA
FROM=$(cat "$STATE_DIR/release.commit" 2>/dev/null || true)
[ -n "$FROM" ] || die "no release.commit in $STATE_DIR; record the commit the node runs there first (deploy/README.md)"

# The security check: every image is under the Colo namespace and was built from SHA_FULL (reads the registry only).
# It runs before the delta, the manifest write, any file copy, any pull and any restart.
verify_images "$NEW" "$SHA_FULL"
say "release images verified against $SHA_FULL"

# The delta: plan lines from colo-cd-plan.sh (read-only). Nothing is changed before this point.
sh "$DEPLOY_DIR/colo-cd-plan.sh" "$RELEASE_FILE" "$NEW" "$REPO" "$ROOT" >"$WORK/plan.txt" ||
  die "cannot compute the delta plan"
say "delta: $FROM -> $SHA_FULL"
while IFS= read -r line; do
  case $line in
    "image "*)
      set -- $line
      if [ "$3" = changed ]; then CHANGED="$CHANGED $2"; fi
      say "plan: image $2 $3"
      ;;
    "player-host "*)
      set -- $line
      if [ "$3" = stale ]; then STALE_HOSTS="$STALE_HOSTS $2"; fi
      say "plan: player host $2 $3"
      ;;
    "sql "*) SQL=${line#sql } ;;
    "refresh "*) printf '%s\n' "${line#refresh }" >>"$WORK/refresh.txt" ;;
    "manual "*) say "needs manual: ${line#manual }" ;;
  esac
done <"$WORK/plan.txt"
say "plan: migrations $SQL (a pg dump is taken first when yes)"
for svc in $ORDER; do
  case " $CHANGED " in
    *" $svc "*) say "plan: restart $svc" ;;
    *) say "plan: $svc unchanged; not touched" ;;
  esac
done
for id in $STALE_HOSTS; do say "plan: refresh player host $id (after the shared services, one at a time)"; done
say "plan: animus (mind) is never started; its digest is recorded only"

if [ "$DRY_RUN" = 1 ]; then
  say "dry-run complete: nothing was changed (no lock, no manifest, no copies, no dump, no restart)"
  exit 0
fi

acquire_lock
trap 'rm -rf "$WORK"; release_lock' EXIT
log "start: $FROM -> $SHA_FULL"
load_node_env
load_release "$NEW"
check_merged_config
check_secrets
check_jar_sources

# The manifest: the installed one becomes previous.env, the new one is installed and recorded as current.env.
(
  umask 077
  cp "$RELEASE_FILE" "$RELEASE_FILE.bak-$STAMP" &&
    cp "$RELEASE_FILE" "$STATE_DIR/previous.env.new" &&
    mv "$STATE_DIR/previous.env.new" "$STATE_DIR/previous.env" &&
    cp "$NEW" "$RELEASE_FILE.new" && mv "$RELEASE_FILE.new" "$RELEASE_FILE" &&
    cp "$RELEASE_FILE" "$STATE_DIR/current.env.new" && mv "$STATE_DIR/current.env.new" "$STATE_DIR/current.env"
) || die "cannot write the release manifest and its records; nothing was restarted"
log "release manifest updated (backup $RELEASE_FILE.bak-$STAMP)"

refresh_src || abort_untouched "cannot refresh the src extract"

# Pulls come first, so a failed pull stops the run before any container is restarted.
for svc in $PULL_SET; do
  case " $CHANGED " in
    *" $svc "*) svc_compose "$svc" pull || abort_untouched "cannot pull the image for $svc" ;;
  esac
done

if [ "$SQL" = yes ]; then
  mkdir -p "$STATE_DIR/backups" || die "cannot create $STATE_DIR/backups"
  DUMP=$STATE_DIR/backups/pre-cd-$STAMP.sql
  if ! (umask 077; dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' >"$DUMP") || [ ! -s "$DUMP" ]; then
    abort_untouched "pg dump failed; migrations not applied"
  fi
  log "pg dump written before the migrations: $DUMP"
  sh "$DEPLOY_DIR/colo-admin.sh" migrate || abort_untouched "migrations failed"
  log "migrations applied"
fi

for svc in $ORDER; do
  case " $CHANGED " in
    *" $svc "*) ;;
    *) continue ;;
  esac
  if [ "$svc" = golem-body ]; then pause_scope bodies; fi
  if [ "$svc" = geldar-mcp ]; then pause_scope mcp; fi
  restart_one "$svc"
  if [ "$svc" = golem-body ]; then recreate_players || rollback golem-body; fi
  close_scope
done

HOST_FAILED=
refresh_hosts || HOST_FAILED=1

printf '%s\n' "$SHA_FULL" >"$STATE_DIR/release.commit.new" && mv "$STATE_DIR/release.commit.new" "$STATE_DIR/release.commit"
if [ -n "$HOST_FAILED" ]; then
  die "the services are deployed, but a player host refresh failed: needs manual (see $LOG); the rest of the hosts were not refreshed (exit 1)"
fi
log "deployed $SHA_FULL (no volume was removed; the manual items above were not applied)"
