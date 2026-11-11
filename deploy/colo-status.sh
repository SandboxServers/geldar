#!/bin/sh
# Read-only status of the geldar-colo project (decision 0084). Containers are found by the compose project label,
# never by name, so containers of other projects on the node are not listed or measured.
set -eu
. "$(dirname "$0")/common.sh"

need docker
filter="label=com.docker.compose.project=$PROJECT"
say "containers of $PROJECT (state and health):"
docker ps -a --filter "$filter" --format '{{.Names}}\t{{.State}}\t{{.Status}}'
say "published ports of $PROJECT (host side):"
docker ps -a --filter "$filter" --format '{{.Names}}\t{{.Ports}}'
ids=$(docker ps -q --filter "$filter")
if [ -n "$ids" ]; then
  say "resource use of $PROJECT (one sample):"
  # The ids are hex container ids from the label filter above; they are passed one per word on purpose.
  # shellcheck disable=SC2086
  docker stats --no-stream $ids
else
  say "no containers in $PROJECT"
fi
