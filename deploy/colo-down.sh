#!/bin/sh
# Stops the geldar-colo project and nothing else (decision 0084). Containers stop, volumes and networks are kept.
# It never removes a volume. Set DEPLOY_DRY_RUN=1 to print the plan only.
set -eu
. "$(dirname "$0")/common.sh"

plan_header
need docker
act dc stop
say "stopped: project $PROJECT (volumes kept)"
