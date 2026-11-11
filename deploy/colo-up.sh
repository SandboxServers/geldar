#!/bin/sh
# Deploys the Colo stack by pull (decision 0084). Idempotent: the same release twice changes nothing.
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
act dc up -d --wait
if [ "$DRY_RUN" = 1 ]; then
  say "dry-run complete: no state was changed"
else
  say "deployed: project $PROJECT (no volume was removed)"
fi
