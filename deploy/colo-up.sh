#!/bin/sh
# Deploys the Colo stack by pull (decision 0084). Idempotent: the same release twice changes nothing.
# Order: Postgres and NATS first, then the SQL migrations and the geldar_mcp and geldar_glass login steps (all through the admin
# container, deploy/colo-admin.sh), and only then the full core. sql/0002 creates geldar_mcp NOLOGIN, so the MCP
# cannot start before --set-role-password has run.
# Touches only the geldar-colo project. Removes no volume. Set DEPLOY_DRY_RUN=1 to print the plan only.
set -eu
. "$(dirname "$0")/common.sh"

HOLD_PUBLIC=1
export HOLD_PUBLIC
plan_header
need docker
check_prereqs
load_release "$RELEASE_FILE"
load_node_env
# Glass is part of the stack: its image comes from the manifest like the others (load_release already refused a
# value that is not a digest reference).
[ -n "${GELDAR_GLASS_IMAGE:-}" ] || die "release manifest has no GELDAR_GLASS_IMAGE; refusing"
[ -n "${GELDAR_ADMIN_IMAGE:-}" ] || die "release manifest has no GELDAR_ADMIN_IMAGE; refusing"
check_merged_config
check_secrets
check_jar_sources
fetch_bluemap
record_release
save_node_env
say_node_env
act dc pull
act dc --profile admin pull admin
# bluemap-web mounts the Paper volume's bluemap/web subpath (ruling R28), and a subpath mount fails when the directory is
# missing. A one-shot compose run of the pinned admin service (project-scoped; it keeps the service's read-only root and
# cap_drop ALL, adding back only the capabilities mkdir and chown need; the one volume is the project's Paper volume)
# makes it and gives it to the service uid. mkdir -p and a chown of the two directories (not -R): a second run changes nothing.
act dc run --rm --no-deps --user 0:0 --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER -v "${PROJECT}_paper-data:/data" \
  --entrypoint sh admin -c "mkdir -p /data/bluemap/web && chown $GELDAR_SERVICE_UID:$GELDAR_SERVICE_UID /data/bluemap /data/bluemap/web"
# A changed network config makes compose recreate the project network; project containers that were stopped keep the old
# network id and then fail to start ("network <id> not found"). When any container of this project (the label filter
# keeps other projects out) points at a network that is gone, `up` recreates the containers. Volumes are never touched.
recreate_flag() {
  for cid in $(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"); do
    for nid in $(docker inspect -f '{{range .NetworkSettings.Networks}}{{.NetworkID}} {{end}}' "$cid"); do
      if ! docker network inspect "$nid" >/dev/null 2>&1; then
        echo "--force-recreate"
        return 0
      fi
    done
  done
}
FORCE=$(recreate_flag)
[ -z "$FORCE" ] || say "a project container is on a removed network; up will recreate containers (volumes are kept)"
# shellcheck disable=SC2086
act dc up -d --wait $FORCE postgres nats
act sh "$DEPLOY_DIR/colo-admin.sh" migrate
act sh "$DEPLOY_DIR/colo-admin.sh" migrate --set-role-password geldar_mcp --password-file /run/secrets/postgres-mcp.txt
act sh "$DEPLOY_DIR/colo-admin.sh" migrate --set-role-password geldar_glass --password-file /run/secrets/postgres-glass.txt
# The velocity plugin only reads geldar-skins (decision 0087 correction, C2-02e), so the bucket is made here, by the body
# NATS user through the admin container, before velocity starts. Creating an existing bucket changes nothing.
act sh "$DEPLOY_DIR/colo-admin.sh" ensure-skins-bucket
# The house Body is whitelisted on Paper before golem-body starts (C2-07k): Paper (and the services it needs) come up and
# healthy first, the admin one-shot adds the name over RCON (idempotent), and only then does the full core start.
FORCE=$(recreate_flag)
# shellcheck disable=SC2086
act dc up -d --wait $FORCE paper
act sh "$DEPLOY_DIR/colo-admin.sh" whitelist-house-body
FORCE=$(recreate_flag)
# shellcheck disable=SC2086
act dc up -d --wait $FORCE
# The public Minecraft port (decision 0096) is published only now, after the whole stack is healthy: a second `up` with
# the overlay merged recreates velocity alone with the extra publish.
HOLD_PUBLIC=0
public_overlay
if [ -n "$PUBLIC_OVERLAY" ]; then
  act dc config --quiet
  act dc up -d --wait velocity
  say "public Minecraft port published on ${GELDAR_MC_BIND}:${GELDAR_MC_PORT}"
fi
if [ "$DRY_RUN" = 1 ]; then
  say "dry-run complete: no state was changed"
else
  say "deployed: project $PROJECT (no volume was removed)"
fi
