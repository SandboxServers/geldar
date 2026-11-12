#!/bin/bash
# Installs, switches and removes the Geldar public sites in the shared Caddy (decisions 0071, 0094; card C2-07).
# Usage: colo-public.sh install [site...] | off <site|all> | on <site|all> | remove | status      (sites: map glass mcp)
# install with no site installs all of map glass mcp (all become live). install mcp names sites: only those get their live file and
# rendered store files; the other sites keep their state (absent stays absent, off stays off, live stays live).
# Caddy is a host-network container that serves other sites. It is validated here and, per GELDAR_PUBLIC_APPLY=reload|restart|none,
# reloaded (default) or, with its admin API off (R39), restarted ONCE and only when GELDAR_PUBLIC_RESTART_OK=1; never recreated or started. Its Caddyfile gets one `import /config/geldar/*.caddy` line.
# Caddy substitutes {$VAR} from its own process environment, which cannot change without a restart, so install renders
# the placeholders into concrete files from a root-only env file (GELDAR_PUBLIC_ENV). The repo files are never edited.
# Environment (names only, no value is printed): GELDAR_CADDY_CONTAINER, GELDAR_CADDY_CONFIG_DIR, GELDAR_CADDY_FILE,
# GELDAR_PUBLIC_ENV (install only), GELDAR_PUBLIC_APPLY (reload|restart|none), GELDAR_PUBLIC_RESTART_OK (1 = restart itself).
# GELDAR_REGISTER_UPSTREAM may be unset: glass then answers 503 on /register* and /roster*. The env file holds KEY=VALUE lines: GELDAR_DOMAIN, GELDAR_MAP_UPSTREAM,
# GELDAR_GLASS_UPSTREAM, GELDAR_REGISTER_UPSTREAM, GELDAR_MCP_UPSTREAM (each 127.0.0.1:<port>). DEPLOY_DRY_RUN=1 prints every state change only.
set -euo pipefail
. "$(dirname "$0")/common.sh"

SITES="map glass mcp"
SRC=${GELDAR_PUBLIC_SRC:-$DEPLOY_DIR/caddy}
IMPORT_LINE='import /config/geldar/*.caddy'
CADDYFILE_IN_CONTAINER=/etc/caddy/Caddyfile
STAMP="$(date +%Y%m%d%H%M%S)-$$"

require_env() {
  for v in "$@"; do
    [ -n "${!v:-}" ] || die "required environment variable is not set: $v"
  done
}

usage() {
  die "usage: colo-public.sh install [map|glass|mcp ...] (no site = all three go live) | off <map|glass|mcp|all> | on <map|glass|mcp|all> | remove | status"
}

site_list() {
  case ${1:-} in
    all) echo "$SITES" ;;
    map | glass | mcp) echo "$1" ;;
    *) usage ;;
  esac
}

# Reads one KEY from the env file as data (the file is never sourced).
env_value() {
  sed -n "s/^$1=//p" "$GELDAR_PUBLIC_ENV" | tail -n 1
}

# Renders the live and off files of every site into $WORK/render, then checks them.
render_all() {
  [ -f "$GELDAR_PUBLIC_ENV" ] || die "the env file (GELDAR_PUBLIC_ENV) does not exist"
  domain=$(env_value GELDAR_DOMAIN)
  [ -n "$domain" ] || die "GELDAR_DOMAIN is missing from the env file"
  printf '%s' "$domain" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$' || die "GELDAR_DOMAIN is not a plain host name"
  mkdir -p "$WORK/render"
  for s in $INSTALL_SITES; do
    # Glass also serves the sign-in and roster paths, so its file carries the REGISTER upstream too (decision 0135, R42).
    ups=$(printf '%s' "$s" | tr 'a-z' 'A-Z')
    [ "$s" = glass ] && ups="GLASS REGISTER MAP" # MAP: the Kino textures route /kino/tex/* proxies the map upstream
    sed_up=""
    reg_off=0
    for u in $ups; do
      up_var=GELDAR_${u}_UPSTREAM
      up=$(env_value "$up_var")
      # The register service may not be deployed: glass then answers 503 on its paths (see the marked block in glass.caddy).
      if [ -z "$up" ] && [ "$u" = REGISTER ]; then reg_off=1; continue; fi
      [ -n "$up" ] || die "$up_var is missing from the env file"
      printf '%s' "$up" | grep -Eq '^127\.0\.0\.1:[0-9]{1,5}$' || die "$up_var is not a loopback address (127.0.0.1:<port>)"
      up_port=${up#127.0.0.1:}
      { [ "$up_port" -ge 1 ] && [ "$up_port" -le 65535 ]; } || die "$up_var port is outside 1-65535"
      sed_up="$sed_up -e s|{[\$]$up_var}|$up|g"
    done
    # Glass carries the Kino switch (decision 0075): rendered from the env file, 0 (off) when unset.
    if [ "$s" = glass ]; then
      kino=$(env_value GELDAR_KINO_ENABLED)
      kino=${kino:-0}
      case $kino in 0 | 1) ;; *) die "GELDAR_KINO_ENABLED must be 0 or 1" ;; esac
      sed_up="$sed_up -e s|{[\$]GELDAR_KINO_ENABLED:0}|$kino|g"
    fi
    for f in "$s.caddy" "$s-off.caddy"; do
      [ -f "$SRC/$f" ] || die "site file not found: $f"
      reg_sed=""
      if [ "$reg_off" = 1 ] && [ "$f" = glass.caddy ]; then
        printf '%s\n' '/# register-proxy-begin/,/# register-proxy-end/c\' \
          '	handle @register {\' '		respond "the register service is not deployed" 503\' '	}' >"$WORK/reg503.sed"
        reg_sed="-f $WORK/reg503.sed"
      fi
      # shellcheck disable=SC2086
      sed $reg_sed -e "s|{[\$]GELDAR_DOMAIN}|$domain|g" $sed_up "$SRC/$f" >"$WORK/render/$f"
      if grep -Fq '{$' "$WORK/render/$f"; then die "an unrendered placeholder is left in $f; refusing"; fi
    done
  done
}

caddy_validate() {
  docker exec "$GELDAR_CADDY_CONTAINER" caddy validate --config "$CADDYFILE_IN_CONTAINER"
}

caddy_reload() {
  docker exec "$GELDAR_CADDY_CONTAINER" caddy reload --config "$CADDYFILE_IN_CONTAINER"
}

# GELDAR_PUBLIC_APPLY: reload (default), restart (admin API off, owner ruling R39) or none. Runs after validate passed.
# restart never reloads, and restarts the container itself only when GELDAR_PUBLIC_RESTART_OK=1, and then exactly once.
caddy_apply() {
  case ${GELDAR_PUBLIC_APPLY:-reload} in
    reload) caddy_reload; APPLIED="caddy reloaded" ;;
    none) APPLIED="caddy not reloaded or restarted (GELDAR_PUBLIC_APPLY=none)" ;;
    restart)
      if [ "${GELDAR_PUBLIC_RESTART_OK:-}" = 1 ]; then
        docker restart "$GELDAR_CADDY_CONTAINER" >/dev/null
        caddy_wait_ready || die "$GELDAR_CADDY_CONTAINER did not come back running with a valid config after the restart"
        APPLIED="board-proxy restarted once and validated"
      else
        APPLIED="caddy neither reloaded nor restarted"
        PENDING_NOTE="colo-public: files installed and validated; RESTART board-proxy once to apply (docker restart $GELDAR_CADDY_CONTAINER)"
      fi
      ;;
    *) die "GELDAR_PUBLIC_APPLY must be restart, reload or none" ;;
  esac
}

# Waits (up to 30 s) until the container runs again and caddy validate passes.
caddy_wait_ready() {
  for _ in $(seq 1 30); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$GELDAR_CADDY_CONTAINER" 2>/dev/null)" = true ] && caddy_validate >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
# Backs up the Caddyfile and prints the backup path in $BACKUP. The Caddyfile is written in place (cat >, cp) and never
# replaced by mv, so the single-file bind mount keeps its inode.
backup_caddyfile() {
  [ -f "$GELDAR_CADDY_FILE" ] || die "the Caddyfile does not exist"
  BACKUP="$GELDAR_CADDY_FILE.bak-geldar-$STAMP"
  act cp -p "$GELDAR_CADDY_FILE" "$BACKUP"
}

restore_caddyfile() {
  cat "$BACKUP" >"$GELDAR_CADDY_FILE"
}

add_import() {
  if grep -qxF "$IMPORT_LINE" "$GELDAR_CADDY_FILE"; then return 0; fi
  if [ -s "$GELDAR_CADDY_FILE" ] && [ -n "$(tail -c 1 "$GELDAR_CADDY_FILE")" ]; then echo >>"$GELDAR_CADDY_FILE"; fi
  echo "$IMPORT_LINE" >>"$GELDAR_CADDY_FILE"
}

drop_import() {
  grep -vxF "$IMPORT_LINE" "$GELDAR_CADDY_FILE" >"$WORK/caddyfile.new" || true
  cat "$WORK/caddyfile.new" >"$GELDAR_CADDY_FILE"
}

install_rendered() {
  act mkdir -p "$GEL_DIR/store"
  act chmod 0755 "$GEL_DIR" "$GEL_DIR/store"
  for s in $INSTALL_SITES; do
    for f in "$s.caddy" "$s-off.caddy"; do
      act install -m 0644 "$WORK/render/$f" "$GEL_DIR/store/$f"
    done
    # A site that is off stays off: its top-level file is the refreshed off twin, not the live render.
    top=$s.caddy
    if [ -f "$WORK/prev/store/$s-off.caddy" ] && [ -f "$WORK/prev/$s.caddy" ] && cmp -s "$WORK/prev/$s.caddy" "$WORK/prev/store/$s-off.caddy"; then
      top=$s-off.caddy
    fi
    act install -m 0644 "$WORK/render/$top" "$GEL_DIR/$s.caddy"
  done
}

# Keeps the installed files in $WORK/prev, so a failed install can put them back.
snapshot_geldar() {
  if [ -d "$GEL_DIR" ]; then
    mkdir -p "$WORK/prev"
    cp -pR "$GEL_DIR/." "$WORK/prev/"
    HAD_PREV=1
  fi
}

restore_geldar() {
  rm -rf "$GEL_DIR"
  if [ "$HAD_PREV" = 1 ]; then
    mkdir -p "$GEL_DIR"
    cp -pR "$WORK/prev/." "$GEL_DIR/"
  fi
}

# Validates the site names given to install (none = every site) into $INSTALL_SITES.
install_site_list() {
  INSTALL_SITES=""
  if [ "$#" -eq 0 ]; then INSTALL_SITES=$SITES; return 0; fi
  for s in "$@"; do
    case $s in
      map | glass | mcp) ;;
      *) die "unknown site: $s (sites: map glass mcp)" ;;
    esac
    case " $INSTALL_SITES " in *" $s "*) ;; *) INSTALL_SITES="$INSTALL_SITES $s" ;; esac
  done
}

cmd_install() {
  install_site_list "$@"
  require_env GELDAR_CADDY_CONTAINER GELDAR_CADDY_CONFIG_DIR GELDAR_CADDY_FILE GELDAR_PUBLIC_ENV
  need docker
  load_node_env
  proxies_set || die "GELDAR_GLASS_TRUSTED_PROXIES and GELDAR_MCP_TRUSTED_PROXIES must both be set (deploy env or node.env) to the colo bridge gateway, not 127.0.0.1; refusing"
  render_all
  backup_caddyfile
  HAD_PREV=0
  snapshot_geldar
  act install_rendered
  act add_import
  if [ "$DRY_RUN" = 1 ]; then
    act caddy_validate
    act caddy_apply
    say "dry-run complete: no state was changed"
    return 0
  fi
  if ! caddy_validate; then
    restore_caddyfile
    restore_geldar
    die "caddy validate failed; the Caddyfile is restored from $BACKUP and the previous site files are put back (none if this was the first install)"
  fi
  caddy_apply
  say "installed: ${INSTALL_SITES# } rendered, import present; $APPLIED"
  [ -z "${PENDING_NOTE:-}" ] || say "$PENDING_NOTE"
}

# Copies the stored live or off file of each site over its top-level file; on validate failure puts the old ones back.
cmd_switch() {
  mode=$1
  require_env GELDAR_CADDY_CONTAINER GELDAR_CADDY_CONFIG_DIR GELDAR_CADDY_FILE
  need docker
  list=$(site_list "${2:-}")
  [ -d "$GEL_DIR/store" ] || die "the sites are not installed (run install first)"
  mkdir -p "$WORK/snap"
  for s in $list; do
    twin="$s.caddy"
    [ "$mode" = off ] && twin="$s-off.caddy"
    [ -f "$GEL_DIR/store/$twin" ] || die "stored file missing: $twin"
    if [ "$DRY_RUN" != 1 ]; then cp -p "$GEL_DIR/$s.caddy" "$WORK/snap/$s.caddy" 2>/dev/null || true; fi
    act install -m 0644 "$GEL_DIR/store/$twin" "$GEL_DIR/$s.caddy"
  done
  if [ "$DRY_RUN" = 1 ]; then
    act caddy_validate
    act caddy_apply
    return 0
  fi
  if ! caddy_validate; then
    for s in $list; do [ -f "$WORK/snap/$s.caddy" ] && cat "$WORK/snap/$s.caddy" >"$GEL_DIR/$s.caddy"; done
    die "caddy validate failed; the previous site files are put back"
  fi
  caddy_apply
  say "$mode: $list; $APPLIED"
  [ -z "${PENDING_NOTE:-}" ] || say "$PENDING_NOTE"
}

cmd_remove() {
  require_env GELDAR_CADDY_CONTAINER GELDAR_CADDY_CONFIG_DIR GELDAR_CADDY_FILE
  need docker
  backup_caddyfile
  act drop_import
  if [ "$DRY_RUN" = 1 ]; then
    act caddy_validate
    act rm -rf "$GEL_DIR"
    act caddy_apply
    return 0
  fi
  if ! caddy_validate; then
    restore_caddyfile
    die "caddy validate failed; the Caddyfile is restored from $BACKUP and nothing is removed"
  fi
  rm -rf "$GEL_DIR"
  caddy_apply
  say "removed: import line and $GEL_DIR gone (backup: $BACKUP); $APPLIED"
  [ -z "${PENDING_NOTE:-}" ] || say "$PENDING_NOTE"
}

cmd_status() {
  require_env GELDAR_CADDY_CONFIG_DIR GELDAR_CADDY_FILE
  # The lines below describe the files on disk; they do not prove what Caddy has loaded (R4-07).
  say "files say (the live state in Caddy is not checked here; run caddy validate and reload to be sure):"
  if [ -f "$GELDAR_CADDY_FILE" ] && grep -qxF "$IMPORT_LINE" "$GELDAR_CADDY_FILE"; then
    say "import line: present"
  else
    say "import line: absent"
  fi
  for s in $SITES; do
    if [ ! -f "$GEL_DIR/$s.caddy" ]; then
      say "$s: not installed"
    elif [ -f "$GEL_DIR/store/$s-off.caddy" ] && cmp -s "$GEL_DIR/$s.caddy" "$GEL_DIR/store/$s-off.caddy"; then
      say "$s: off"
    else
      say "$s: on"
    fi
  done
}

cmd=${1:-}
require_env GELDAR_CADDY_CONFIG_DIR
GEL_DIR=$GELDAR_CADDY_CONFIG_DIR/geldar
if [ "$DRY_RUN" = 1 ]; then say "DEPLOY_DRY_RUN=1: nothing is changed"; fi
case $cmd in
  install) shift; cmd_install "$@" ;;
  off | on) cmd_switch "$cmd" "${2:-}" ;;
  remove) cmd_remove ;;
  status) cmd_status ;;
  *) usage ;;
esac
