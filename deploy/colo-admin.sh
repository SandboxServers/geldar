#!/bin/sh
# Runs one administration subcommand in the one-shot admin container (decision 0133): `docker compose run --rm --no-deps
# admin` under the profile admin. Only that container is started, and it is removed when the run ends. --no-deps stops
# compose from converging the admin service's depends_on (postgres), so a render that differs from the running postgres
# never recreates it. The postgres container of this project must already be running: the script refuses otherwise and
# starts nothing itself (colo-up.sh starts postgres before its migrate calls). No volume is touched. Every compose call
# names the geldar-colo project. Only token-mint mounts a host directory: GELDAR_TOKENS_DIR, outside the
# repo and mode 0700, bound at /run/tokens by an overlay written to the state directory and removed when the run ends.
# The token value is never printed: the script prints the path and the byte length of the file, and nothing else.
# Set DEPLOY_DRY_RUN=1 to print the plan; it runs only the read-only checks and `config --quiet`.
set -eu
. "$(dirname "$0")/common.sh"

ADMIN_OVERLAY=
# Set by roster_add_args and roster_list_args (decision 0108); empty when not given.
roster_name=
roster_owner=
# Replaces the EXIT trap of common.sh: the generated overlay goes with the work directory.
trap 'rm -f "$ADMIN_OVERLAY"; rm -rf "$WORK"' EXIT

# Runs one compose call for the admin service. The token overlay is added only for token-mint.
adm() {
  compose_call "${ADMIN_OVERLAY:-}" --profile admin -- "$@"
}

# Prints the name of the running postgres container of this project, or nothing. The one-shot never starts postgres.
postgres_running() {
  docker ps --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=postgres" \
    --filter status=running --format '{{.Names}}'
}

# Checks the token-mint arguments: <player> [--out /run/tokens/<name>.token]. Sets player, out and TOKEN_REL.
mint_args() {
  [ $# -ge 1 ] || die "token-mint needs a player id"
  player=$1
  shift
  printf '%s' "$player" | grep -Eq '^[A-Za-z0-9_-]+$' || die "player id must use only A-Z a-z 0-9 _ -"
  out=/run/tokens/$player.token
  if [ $# -gt 0 ]; then
    [ $# -eq 2 ] && [ "$1" = --out ] || die "token-mint takes <player> [--out /run/tokens/<name>.token]"
    out=$2
  fi
  case $out in
    /run/tokens/*) ;;
    *) die "--out must be under /run/tokens (the mounted tokens directory): $out" ;;
  esac
  case $out in *..*) die "--out must not contain '..'" ;; esac
  TOKEN_REL=${out#/run/tokens/}
  printf '%s' "$TOKEN_REL" | grep -Eq '^[A-Za-z0-9_-]+\.token$' || die "--out must name one file <name>.token in /run/tokens"
}

# Checks <command> <variable name> <its value>: the host directory must be set, be a directory, sit outside the repo
# checkout, and be mode 0700. Sets TOKENS_REAL (for token-mint) and MOUNT_REAL.
mount_checks() {
  [ -n "$3" ] || die "$1 needs $2: a host directory outside the repo, mode 0700"
  [ -d "$3" ] || die "$2 is not a directory: $3"
  TOKENS_REAL=$(cd "$3" && pwd -P) || die "cannot resolve $2"
  ROOT_REAL=$(cd "$ROOT" && pwd -P) || die "cannot resolve the repo checkout"
  case $TOKENS_REAL in
    "$ROOT_REAL" | "$ROOT_REAL"/*) die "$2 is inside the repo checkout; use a directory outside it" ;;
  esac
  printf '%s' "$TOKENS_REAL" | grep -Eq '^[A-Za-z0-9/._:-]+$' ||
    die "$2 has characters the overlay cannot quote (use A-Z a-z 0-9 / . _ : -)"
  m=$(stat -c %a "$TOKENS_REAL") || die "cannot stat $2"
  [ "$m" = 700 ] || die "$2 has mode $m; it must be 0700"
  MOUNT_REAL=$TOKENS_REAL
}

tokens_checks() { mount_checks token-mint GELDAR_TOKENS_DIR "${GELDAR_TOKENS_DIR:-}"; }

# skin-import <player-id> --file /run/skins/<name>.json. The signed JSON stays in the host directory GELDAR_SKINS_DIR
# (outside the repo, mode 0700), mounted read-only at /run/skins. Its value is never an argument, only its file name.
skin_args() {
  [ $# -eq 3 ] && [ "$2" = --file ] || die "skin-import takes <player-id> --file /run/skins/<name>.json"
  player=$1
  printf "%s" "$player" | grep -Eq "^ag-[a-z0-9-]{1,40}\$" || die "player id must match ^ag-[a-z0-9-]{1,40}\$: $player"
  case $3 in
    /run/skins/*) ;;
    *) die "--file must be under /run/skins (the mounted skins directory): $3" ;;
  esac
  case $3 in *..*) die "--file must not contain ..";; esac
  SKIN_REL=${3#/run/skins/}
  SKIN_REL_PATH=$3
  printf "%s" "$SKIN_REL" | grep -Eq "^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.json\$" || die "--file must name one .json file in /run/skins"
}

skins_checks() {
  mount_checks skin-import GELDAR_SKINS_DIR "${GELDAR_SKINS_DIR:-}"
  [ -f "$MOUNT_REAL/$SKIN_REL" ] || die "the signed skins file is not in GELDAR_SKINS_DIR: $SKIN_REL"
  [ -s "$MOUNT_REAL/$SKIN_REL" ] || die "the signed skins file is empty: $SKIN_REL"
}

# The roster (decision 0108). A Minecraft name is 1 to 16 letters, digits or _; an owner id is 1 to 63 lower-case
# letters, digits or dashes. The checks use case patterns, not grep, so a newline in an argument cannot pass.
roster_name_ok() {
  case $1 in '' | *[!A-Za-z0-9_]*) die "a roster name is 1 to 16 letters, digits or _" ;; esac
  [ "${#1}" -le 16 ] || die "a roster name is 1 to 16 letters, digits or _"
}

roster_owner_ok() {
  case $1 in '' | -* | *[!a-z0-9-]*) die "owner id must be 1 to 63 lower-case letters, digits or dashes" ;; esac
  [ "${#1}" -le 63 ] || die "owner id must be 1 to 63 lower-case letters, digits or dashes"
}

# player-flags <player id>: ag- then 1 to 40 lower-case letters, digits or dashes; looser than the CLI's PLAYER_ID, which
# refuses the rest. Case patterns, so a newline or a space cannot pass.
player_flags_id_ok() {
  case $1 in ag-*) ;; *) return 1 ;; esac
  case ${1#ag-} in '' | *[!a-z0-9-]*) return 1 ;; esac
  [ "${#1}" -le 43 ]
}

# owner-admin set|unset <owner id> | owner-admin list: the admin flag (C7-12). The owner id as roster_owner_ok checks it.
owner_admin_args() {
  case ${1:-} in
    set | unset) [ $# -eq 2 ] || die "owner-admin takes set|unset <owner id> or list"; roster_owner_ok "$2" ;;
    list) [ $# -eq 1 ] || die "owner-admin takes set|unset <owner id> or list" ;;
    *) die "owner-admin takes set|unset <owner id> or list" ;;
  esac
}

# roster-add <name> --owner <owner>: sets roster_name and roster_owner.
roster_add_args() {
  [ $# -eq 3 ] && [ "$2" = --owner ] || die "roster-add takes <name> --owner <owner>"
  roster_name_ok "$1"
  roster_owner_ok "$3"
  roster_name=$1
  roster_owner=$3
}

# roster-list [--owner <owner>]: sets roster_owner only when the filter is given.
roster_list_args() {
  [ $# -eq 0 ] && return 0
  [ $# -eq 2 ] && [ "$1" = --owner ] || die "roster-list takes no arguments or --owner <owner>"
  roster_owner_ok "$2"
  roster_owner=$2
}

# owner-set-cap <owner id> <N>: the owner id as roster_owner_ok checks it; N a whole number from 0 to 50 with no leading
# zero (the CLI's set-cap range, decision 0052). The shard's owner_cap_owner (20) is not applied: set-cap takes N as given.
owner_set_cap_args() {
  [ $# -eq 2 ] || die "owner-set-cap takes <owner id> <N>"
  roster_owner_ok "$1"
  case $2 in 0 | [1-9] | [1-4][0-9] | 50) ;; *) die "N must be a whole number from 0 to 50" ;; esac
  owner_cap=$2
}

# player-set-owner <player id> <owner id> (assign-cmd): the player id as player-flags checks it, the owner id as
# roster_owner_ok checks it. The CLI does the move in one transaction and refuses a retired player or a full owner.
player_set_owner_args() {
  [ $# -eq 2 ] || die "player-set-owner takes <player-id> <owner-id>"
  printf '%s' "$1" | grep -Eq '^ag-[a-z0-9-]{1,40}$' || die "player id must match ^ag-[a-z0-9-]{1,40}\$: $1"
  roster_owner_ok "$2"
  set_owner_player=$1
  set_owner_owner=$2
}

# Writes the overlay that mounts a host directory into the admin service only: $1 is the target, $2 is "" or
# "read_only: true", $3 names the file (tokens or skins). It is written with mode 0600.
write_overlay() {
  ADMIN_OVERLAY=$STATE_DIR/admin-$3.override.yml
  (
    umask 077
    mkdir -p "$STATE_DIR" &&
      printf '%s\n' "# Generated by deploy/colo-admin.sh for one $cmd run; removed when the run ends." \
        "services:" "  admin:" "    volumes:" "      - type: bind" "        source: \"$MOUNT_REAL\"" \
        "        target: $1" "        $2" >"$ADMIN_OVERLAY"
  ) || die "cannot write the admin overlay in $STATE_DIR"
  [ "$(stat -c %a "$ADMIN_OVERLAY")" = 600 ] || die "the admin overlay is not mode 0600; refusing"
}

# Checks the minted file by its metadata only: it exists, is not empty, and is mode 0600. Its value is never read out.
verify_token() {
  f=$TOKENS_REAL/$TOKEN_REL
  [ -f "$f" ] && [ -s "$f" ] || die "the token file was not written: $TOKEN_REL"
  m=$(stat -c %a "$f") || die "cannot stat the token file"
  [ "$m" = 600 ] || die "the token file has mode $m; it must be 0600 (the value is not shown)"
  n=$(wc -c <"$f" | tr -d ' ')
  say "token file written: $f ($n bytes); the value is not printed"
}

# Per-player hosts (C1-10b). The compose service players-host is one service; one host per player is a one-off
# container named geldar-colo-players-host-<player-id>, started with `run -d --no-deps` and then given the restart policy
# `unless-stopped` (docker update; decision 0342, which supersedes the on-failure:5 part of 0169). A crash restarts it, and so
# does a clean exit by a node reboot (SIGTERM exits 0), so the hosts come back after an unattended reboot. Docker backs off
# exponentially between restarts. There is no five-restart cap any more: a crash loop keeps restarting with a growing delay,
# and its restart count shows it. `player-stop` stops the host and removes its container, so nothing restarts it until
# player-start. A raw `docker stop` leaves an exited container, which unless-stopped keeps down. The container is kept
# after it exits (no --rm), so its logs survive; player-start removes a stopped leftover with `rm -f` before it starts again.
# Only containers that carry the geldar-colo compose project label and that exact name are ever listed, started or stopped.
SHARD_FILE=${GELDAR_COLO_SHARD:-$ROOT/shards/colo-mind.yaml}

# Checks <player-id> for player-start and player-stop: the id pattern, and that the shard file lists it.
host_args() {
  [ $# -eq 1 ] || die "$cmd takes one player id"
  player=$1
  printf '%s' "$player" | grep -Eq '^ag-[a-z0-9-]{1,40}$' || die "player id must match ^ag-[a-z0-9-]{1,40}\$: $player"
  [ -f "$SHARD_FILE" ] || die "shard file not found: $SHARD_FILE"
  grep -Eq "player_id:[[:space:]]*$player[[:space:]]*[,}]" "$SHARD_FILE" ||
    die "player $player is not listed under sovereign.players in $SHARD_FILE; add it first"
  hname=$PROJECT-players-host-$player
}

# Project-labelled containers with exactly the name $2; $1 is -a to include stopped ones, or empty.
host_ps() {
  docker ps $1 --filter "label=com.docker.compose.project=$PROJECT" --filter "name=^$2\$" --format '{{.Names}}'
}

sov() {
  compose_call '' --profile sovereign -- "$@"
}

run_hosts() {
  case $cmd in
    player-list)
      for id in $(grep -Eo 'player_id:[[:space:]]*ag-[a-z0-9-]+' "$SHARD_FILE" | sed 's/.*:[[:space:]]*//'); do
        if [ -n "$(host_ps '' "$PROJECT-players-host-$id")" ]; then
          say "$id: running ($PROJECT-players-host-$id)"
        elif [ -n "$(host_ps -a "$PROJECT-players-host-$id")" ]; then
          st=$(docker inspect -f '{{.State.Status}}' "$PROJECT-players-host-$id" 2>/dev/null || echo unknown)
          say "$id: $st ($PROJECT-players-host-$id)"
        else
          say "$id: not running"
        fi
      done
      ;;
    player-start)
      # A bare `-e GELDAR_TELEMETRY_URL` (no value) makes compose copy the value from this shell, so the value never
      # reaches the command line, the logs or the dry run. It is passed only when the variable is set and non-empty.
      telemetry_flag=
      if [ -n "${GELDAR_TELEMETRY_URL:-}" ]; then telemetry_flag="-e GELDAR_TELEMETRY_URL"; fi
      if [ "$DRY_RUN" = 1 ]; then
        say "dry-run, not run: docker compose -p $PROJECT ... --profile sovereign run -d --no-deps --name $hname -e GELDAR_PLAYER_ID=$player${telemetry_flag:+ $telemetry_flag} players-host --player $player; docker update --restart unless-stopped $hname"
        exit 0
      fi
      if [ -n "$(host_ps '' "$hname")" ]; then
        say "$hname is already running; left as it is"
        exit 0
      fi
      if [ -n "$(host_ps -a "$hname")" ]; then docker rm -f "$hname" >/dev/null || die "cannot remove the stopped $hname"; fi
      if [ -n "$telemetry_flag" ]; then
        GELDAR_PLAYER_ID=$player sov run -d --no-deps --name "$hname" -e "GELDAR_PLAYER_ID=$player" $telemetry_flag players-host --player "$player" ||
          die "cannot start $hname"
      else
        GELDAR_PLAYER_ID=$player sov run -d --no-deps --name "$hname" -e "GELDAR_PLAYER_ID=$player" players-host --player "$player" ||
          die "cannot start $hname"
      fi
      # The host is up either way. A failed update leaves it without the policy (a crash or a reboot does not restart it), so
      # say so and exit 0: the CD must not treat a healthy host as failed and restore it.
      if docker update --restart unless-stopped "$hname" >/dev/null; then
        say "started $hname"
      else
        say "started $hname, but cannot set its restart policy (docker update failed); a crash or a reboot will not restart it"
      fi
      ;;
    player-stop)
      if [ "$DRY_RUN" = 1 ]; then
        say "dry-run, not run: docker stop $hname"
        exit 0
      fi
      if [ -z "$(host_ps -a "$hname")" ]; then
        say "$hname does not exist; nothing to stop"
        exit 0
      fi
      docker stop "$hname" >/dev/null || die "cannot stop $hname"
      if [ -n "$(host_ps -a "$hname")" ]; then docker rm "$hname" >/dev/null || die "cannot remove $hname"; fi
      say "stopped $hname"
      ;;
  esac
  exit 0
}

cmd=${1:-}
case $cmd in
  migrate | owner-add | owner-set-cap | owner-admin | player-add | token-mint | token-revoke | players-status | ensure-skins-bucket | whitelist-house-body | skin-import | player-start | player-stop | player-list | roster-add | roster-list | player-flags | player-set-owner) shift ;;
  *) die "unknown subcommand '$cmd'; use migrate, owner-add, owner-set-cap, owner-admin, player-add, token-mint, token-revoke, players-status, ensure-skins-bucket, whitelist-house-body, skin-import, player-start, player-stop, player-list, roster-add, roster-list, player-flags or player-set-owner" ;;
esac
if [ "$cmd" = token-mint ]; then
  mint_args "$@"
fi
if [ "$cmd" = skin-import ]; then
  skin_args "$@"
fi
case $cmd in
  player-start | player-stop) host_args "$@" ;;
  player-list) [ $# -eq 0 ] || die "player-list takes no arguments" ;;
  owner-set-cap) owner_set_cap_args "$@" ;;
  owner-admin) owner_admin_args "$@" ;;
  roster-add) roster_add_args "$@" ;;
  roster-list) roster_list_args "$@" ;;
  player-set-owner) player_set_owner_args "$@" ;;
  player-flags) [ "$#" -ge 2 ] && player_flags_id_ok "$1" || die "player-flags takes <player-id> (ag-...) and --public-camera on|off and/or --thoughts-delayed-public on|off" ;;
esac

plan_header
[ -n "$PROJECT" ] || die "no compose project name; refusing"
say "admin subcommand: $cmd (one-shot container, profile admin, decision 0133)"
need docker
check_prereqs
load_release "$RELEASE_FILE"
case $cmd in
  player-start | player-stop | player-list) ;;
  *) [ -n "${GELDAR_ADMIN_IMAGE:-}" ] || die "the release manifest has no GELDAR_ADMIN_IMAGE; pin the admin image by digest" ;;
esac
if [ "$cmd" = token-mint ]; then
  tokens_checks
fi
if [ "$cmd" = skin-import ]; then
  skins_checks
fi
check_merged_config
check_secrets
case $cmd in player-start | player-stop | player-list) run_hosts ;; esac

if [ "$DRY_RUN" = 1 ]; then
  case $cmd in
    roster-add) say "dry-run, not run: docker compose -p $PROJECT ... --profile admin run --rm --no-deps admin roster add $roster_name --owner $roster_owner" ;;
    roster-list) say "dry-run, not run: docker compose -p $PROJECT ... --profile admin run --rm --no-deps admin roster list${roster_owner:+ --owner $roster_owner}" ;;
    player-set-owner) say "dry-run, not run: docker compose -p $PROJECT ... --profile admin run --rm --no-deps admin player-set-owner $set_owner_player $set_owner_owner" ;;
    *) say "dry-run, not run: docker compose -p $PROJECT ... --profile admin run --rm --no-deps admin $cmd $*" ;;
  esac
  if [ "$cmd" = token-mint ]; then
    say "dry-run, not run: write $STATE_DIR/admin-tokens.override.yml (mount $TOKENS_REAL at /run/tokens)"
  fi
  if [ "$cmd" = skin-import ]; then
    say "dry-run, not run: write $STATE_DIR/admin-skins.override.yml (mount $MOUNT_REAL read-only at /run/skins)"
  fi
  adm config --quiet || die "admin service config does not validate"
  exit 0
fi

# Refuses before anything is written or run. Nothing has changed when this stops the script.
if [ -z "$(postgres_running)" ]; then
  die "postgres is not running in $PROJECT; start it first (colo-up.sh starts it before its migrate calls). This one-shot never starts it. Nothing was changed."
fi

if [ "$cmd" = skin-import ]; then
  write_overlay /run/skins "read_only: true" skins
  adm config --quiet || die "admin service config does not validate"
  adm run --rm --no-deps admin skin-import "$player" "$SKIN_REL_PATH" || die "skin-import failed; nothing is shown of the signed value"
  say "skin-import: done for $player (the signed value is not printed)"
elif [ "$cmd" = token-mint ]; then
  write_overlay /run/tokens "" tokens
  adm config --quiet || die "admin service config does not validate"
  adm run --rm --no-deps admin token-mint "$player" --out "$out" || die "token-mint failed"
  verify_token
elif [ "$cmd" = roster-add ]; then
  adm config --quiet || die "admin service config does not validate"
  adm run --rm --no-deps admin roster add "$roster_name" --owner "$roster_owner" || die "roster-add failed"
  say "roster-add: done for $roster_name on the roster of $roster_owner (the admin container was removed)"
elif [ "$cmd" = player-set-owner ]; then
  adm config --quiet || die "admin service config does not validate"
  adm run --rm --no-deps admin player-set-owner "$set_owner_player" "$set_owner_owner" || die "player-set-owner refused or failed; a refused move writes nothing"
  say "player-set-owner: done for $set_owner_player to owner $set_owner_owner (ids only; the admin container was removed)"
elif [ "$cmd" = roster-list ]; then
  adm config --quiet || die "admin service config does not validate"
  if [ -n "$roster_owner" ]; then
    adm run --rm --no-deps admin roster list --owner "$roster_owner" || die "roster-list failed"
  else
    adm run --rm --no-deps admin roster list || die "roster-list failed"
  fi
else
  adm config --quiet || die "admin service config does not validate"
  adm run --rm --no-deps admin "$cmd" "$@" || die "admin $cmd failed"
  say "admin $cmd: done (the admin container was removed; no volume was touched)"
fi
