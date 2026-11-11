#!/bin/sh
# Deploys the Colo stack by pull (decision 0084). Idempotent: the same release twice changes nothing.
# Order: Postgres and NATS first, then the SQL migrations and the geldar_mcp and geldar_glass login steps (all through the admin
# container, deploy/colo-admin.sh), and only then the full core. sql/0002 creates geldar_mcp NOLOGIN, so the MCP
# cannot start before --set-role-password has run.
# Touches only the geldar-colo project. Removes no volume. Set DEPLOY_DRY_RUN=1 to print the plan only.
set -eu
. "$(dirname "$0")/common.sh"

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
act dc up -d --wait postgres nats
act sh "$DEPLOY_DIR/colo-admin.sh" migrate
act sh "$DEPLOY_DIR/colo-admin.sh" migrate --set-role-password geldar_mcp --password-file /run/secrets/postgres-mcp.txt
act sh "$DEPLOY_DIR/colo-admin.sh" migrate --set-role-password geldar_glass --password-file /run/secrets/postgres-glass.txt
act dc up -d --wait
if [ "$DRY_RUN" = 1 ]; then
  say "dry-run complete: no state was changed"
else
  say "deployed: project $PROJECT (no volume was removed)"
fi
