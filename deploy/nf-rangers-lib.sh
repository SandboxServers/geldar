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
# The rangers' memory caps in MiB (geldar-mcp and the five Bodies). Added to the project's caps by check_resources, on only.
RANGERS_MEM_CAPS_MIB=2816
RANGERS=0

check_rangers_switch() {
  case ${NF_RANGERS-off} in
    off) RANGERS=0 ;;
    on) RANGERS=1 ;;
    *) die "NF_RANGERS must be on or off (default off); refusing" ;;
  esac
}

# The ranger secret files, on only (they are not in SECRET_FILES): check_secrets reads this list with the base list.
rangers_secret_files() {
  check_rangers_switch
  if [ "$RANGERS" = 1 ]; then echo "$RANGER_SECRETS"; fi
  return 0
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

# On, when NF_MCP_TRUSTED_PROXIES is set: the comma-separated IPv4 literals the MCP trusts for x-geldar-client-ip (the geldar-nf
# gateway, where the host Caddy reaches the loopback port). Strict: no hostname, IPv6, blank or empty entry and no 0.0.0.0.
# Exported, as NF_SERVICE_UID is, so the overlay's ${NF_MCP_TRUSTED_PROXIES:-127.0.0.1} reads it. Unset keeps 127.0.0.1.
check_rangers_proxies() {
  [ -n "${NF_MCP_TRUSTED_PROXIES+set}" ] || return 0
  oct='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
  ip="$oct\\.$oct\\.$oct\\.$oct"
  lines=$(printf '%s' "$NF_MCP_TRUSTED_PROXIES" | wc -l)
  printf '%s' "$NF_MCP_TRUSTED_PROXIES" | grep -qxE "$ip(,$ip)*" && [ "$lines" -eq 0 ] ||
    die "NF_MCP_TRUSTED_PROXIES must be a comma-separated list of IPv4 addresses (the geldar-nf gateway), with no blanks and no hostname; refusing"
  case ",$NF_MCP_TRUSTED_PROXIES," in
    *,0.0.0.0,*) die "NF_MCP_TRUSTED_PROXIES must not contain 0.0.0.0 (name the gateway address); refusing" ;;
  esac
  export NF_MCP_TRUSTED_PROXIES
}

# On: the overlay and the rangers' shard file exist; the four ranger secret files exist, are non-empty and are mode 0600 (the
# account's files). Runs before any docker call. Off returns at once.
check_rangers_inputs() {
  check_rangers_switch
  [ "$RANGERS" = 1 ] || return 0
  check_rangers_proxies
  [ -f "$RANGERS_FILE" ] || die "overlay $RANGERS_FILE is missing; refusing"
  [ -f "$RANGERS_SHARD" ] || die "shards/nf-mind.yaml is missing (the rangers' shard file); refusing"
  # P1 prerequisite: the Bodies read the NeoForge config from golem/src/config.ts. Without it they crash-loop under restart: unless-stopped.
  golem_config=$ROOT/golem/src/config.ts
  [ -f "$golem_config" ] && grep -qF neoforge "$golem_config" ||
    die "golem/src/config.ts under the repo root does not contain 'neoforge' (P1 prerequisite: the five Bodies would crash-loop under restart: unless-stopped); refusing"
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
  check_listener "$RANGERS_PORT" 127.0.0.1 geldar-mcp 8788
}

# Off: plan, up, refresh-secrets and probe refuse while a ranger or geldar-mcp container exists in the project, before any compose
# call. Their calls leave the overlay out, so they would recreate nothing but would leave the Bodies running with no overlay.
# rangers-admin is a one-shot and is not counted. Rows are read by project and service label; a docker failure refuses.
# $1 probe: the probe runs without the rangers overlay, so it refuses while any ranger exists, whatever NF_RANGERS is, and says so.
check_rangers_orphan() {
  if [ "${1-}" != probe ] && [ "$RANGERS" = 1 ]; then return 0; fi
  rows=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
    --format '{{.Label "com.docker.compose.service"}}') ||
    die "cannot list the $PROJECT containers (rangers check); refusing"
  found=$(printf '%s\n' "$rows" | grep -cxE '(ranger-(yellow|green|blue|red|pink)|geldar-mcp)' || true)
  if [ "$found" != 0 ] && [ "${1-}" = probe ]; then
    die "a rangers container exists in $PROJECT; the probe needs rangers-down first (run: nf-deploy.sh rangers-down), whatever NF_RANGERS is; refusing"
  fi
  if [ "$found" != 0 ]; then
    die "a rangers container exists in $PROJECT but NF_RANGERS is off or unset; refusing. Two ways out: rangers-down (removes them) or NF_RANGERS=on (keeps them)"
  fi
}

# up, rangers lane on: the MCP and the five Bodies, with --no-deps so nothing else is started or restarted. The base services
# must already be healthy (cmd_up runs them first).
rangers_up() {
  act dc up -d --wait --no-deps geldar-mcp $RANGER_SERVICES
}

# refresh-secrets, rangers lane on: a bind-mounted secret follows its inode, so geldar-mcp and the five Bodies are force-recreated
# too (the same --no-deps set as rangers_up, never a plain down or rm).
rangers_refresh() {
  act dc up -d --wait --force-recreate --no-deps geldar-mcp $RANGER_SERVICES ||
    die "geldar-mcp or the five ranger Bodies did not recreate or become healthy; refresh-secrets stopped here (run it again)"
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
