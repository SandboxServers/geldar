#!/bin/sh
# The rangers lane for deploy/nf-deploy.sh (compose/nf-live-rangers.yml: geldar-mcp and five players-host Bodies). The script
# sources this file after it sets ROOT, PROJECT and PORT, and calls its die, say, act, dc, check_listener and check_operator.
# Sourcing runs nothing: it defines the lane's paths, its flag and its functions. NF_RANGERS (default off): on adds the overlay;
# unset or off adds nothing; any other value refuses (status and logs read only the switch; plan and up run every check below).
RANGERS_FILE=$ROOT/compose/nf-live-rangers.yml
RANGERS_SHARD=$ROOT/shards/nf-mind.yaml
RANGERS_PORT=46788
RANGER_SERVICES="ranger-yellow ranger-green ranger-blue ranger-red ranger-pink"
RANGER_SECRETS="nats-ranger.txt nats-mcp.txt postgres-mcp.txt mcp-token-pepper.txt"
RANGERS=0

check_rangers_switch() {
  case ${NF_RANGERS-off} in
    off) RANGERS=0 ;;
    on) RANGERS=1 ;;
    *) die "NF_RANGERS must be on or off (default off); refusing" ;;
  esac
}

# Proves the deployed nats-auth.conf names the two users the overlay logs in as, ranger and mcp, once each (names only: the file
# is never printed). The generator never rewrites an existing conf, so a conf from before the rangers existed is caught only here.
check_rangers_conf() {
  conf=$1
  for user in ranger mcp; do
    n=$(grep -cF "user: \"$user\"" "$conf" || true)
    [ "$n" = 1 ] || die "the deployed nats-auth.conf has no single $user user (NF_RANGERS=on needs it); regenerate it (./geldar.ps1 shard nats-auth nf --live) and copy it to the node; refusing"
  done
}

# On: the overlay and the rangers' shard file exist; the four ranger secret files exist, are non-empty and are mode 0600 (the
# account's files). Runs before any docker call. Off returns at once.
check_rangers_inputs() {
  check_rangers_switch
  [ "$RANGERS" = 1 ] || return 0
  [ -f "$RANGERS_FILE" ] || die "overlay $RANGERS_FILE is missing; refusing"
  [ -f "$RANGERS_SHARD" ] || die "shards/nf-mind.yaml is missing (the rangers' shard file); refusing"
  secdir=${NF_SECRETS_DIR:-$ROOT/compose/secrets-nf}
  for f in $RANGER_SECRETS; do
    [ -s "$secdir/$f" ] || die "$f is missing or empty in the NF secrets directory (NF_RANGERS=on needs it); refusing"
    mode=$(stat -c %a "$secdir/$f") || die "cannot read the mode of $f; refusing"
    [ "$mode" = 600 ] || die "$f must be mode 0600 (it is $mode); refusing"
  done
  if [ -f "$secdir/nats-auth.conf" ]; then check_rangers_conf "$secdir/nats-auth.conf"; fi
  say "rangers lane on: geldar-mcp publishes 127.0.0.1:$RANGERS_PORT; the five players-host Bodies publish nothing"
}

# On: the rangers port is free, or held only by geldar-mcp's own mapping on the loopback address.
check_rangers_port() {
  [ "$RANGERS" = 1 ] || return 0
  check_listener "$RANGERS_PORT" 127.0.0.1 geldar-mcp
}

# Off: plan, up, refresh-secrets and probe refuse while a ranger or geldar-mcp container exists in the project, before any compose
# call. Their calls leave the overlay out, so they would recreate nothing but would leave the Bodies running with no overlay.
# rangers-admin is a one-shot and is not counted. Rows are read by project and service label; a docker failure refuses.
check_rangers_orphan() {
  if [ "$RANGERS" = 1 ]; then return 0; fi
  rows=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
    --format '{{.Label "com.docker.compose.service"}}') ||
    die "cannot list the $PROJECT containers (rangers check); refusing"
  found=$(printf '%s\n' "$rows" | grep -cxE '(ranger-(yellow|green|blue|red|pink)|geldar-mcp)' || true)
  if [ "$found" != 0 ]; then
    die "a rangers container exists in $PROJECT but NF_RANGERS is off or unset; refusing. Two ways out: rangers-down (removes them) or NF_RANGERS=on (keeps them)"
  fi
}

# up, rangers lane on: the MCP and the five Bodies, with --no-deps so nothing else is started or restarted. The base services
# must already be healthy (cmd_up runs them first).
rangers_up() {
  act dc up -d --wait --no-deps geldar-mcp $RANGER_SERVICES
}

# rangers-down: stops and removes geldar-mcp and the five Bodies only. The overlay is always included, so it works with NF_RANGERS
# unset, and no other service is named. Plain down is unchanged.
cmd_rangers_down() {
  check_operator
  check_no_colo_labels
  RANGERS=1
  act dc rm -sf $RANGER_SERVICES geldar-mcp
  say "rangers-down: the five Bodies and geldar-mcp stopped and removed (no other service was touched)"
}
