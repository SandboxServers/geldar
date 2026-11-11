#!/bin/sh
# Deploys the Colo stack by pull (decision 0084). Idempotent: the same release twice changes nothing.
# Order: Postgres and NATS first, then the SQL migrations and the geldar_mcp login step (both through the admin
# container, deploy/colo-admin.sh), and only then the full core. sql/0002 creates geldar_mcp NOLOGIN, so the MCP
# cannot start before --set-role-password has run.
# Touches only the geldar-colo project. Removes no volume. Set DEPLOY_DRY_RUN=1 to print the plan only.
set -eu
. "$(dirname "$0")/common.sh"

plan_header
need docker
check_prereqs
load_release "$RELEASE_FILE"
check_merged_config
check_secrets
fetch_bluemap
record_release
act dc pull
act dc --profile admin pull admin
act dc up -d --wait postgres nats
act sh "$DEPLOY_DIR/colo-admin.sh" migrate
act sh "$DEPLOY_DIR/colo-admin.sh" migrate --set-role-password geldar_mcp --password-file /run/secrets/postgres-mcp.txt
act dc up -d --wait
if [ "$DRY_RUN" = 1 ]; then
  say "dry-run complete: no state was changed"
else
  say "deployed: project $PROJECT (no volume was removed)"
fi
