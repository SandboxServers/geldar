#!/bin/sh
# Publishes one maintenance notice (CD-1d) on geldar.<shard>.maintenance before the deploy restarts a part of the world.
#   deploy/colo-notice.sh [--dry-run] <pause|restart|back> <bodies|world|mcp> [seconds 0-600 | -] [update|plugin_update|config]
# The arguments are checked against the enums and the range of contract/schemas/maintenance-notice.schema.json before
# anything else runs; `-` in the seconds place means no countdown. The notice id is generated here. The publish runs in the
# one-shot admin container as the deploy NATS user (nats-deploy.txt, which may publish the maintenance subject only).
# A failed publish is a warning and exit 0, so a missing notice never fails a deploy; COLO_NOTICE_STRICT=1 exits 1 instead.
# --dry-run (or DEPLOY_DRY_RUN=1) prints the payload and publishes nothing. No password is read or printed here: the
# password file is named by its path only. The shard is GELDAR_SHARD (default colo).
set -eu
. "$(dirname "$0")/common.sh"

usage() {
  die "usage: colo-notice.sh [--dry-run] <pause|restart|back> <bodies|world|mcp> [seconds 0-600|-] [update|plugin_update|config]"
}

DRY=0
if [ "${1:-}" = --dry-run ]; then
  DRY=1
  shift
fi
[ "$DRY_RUN" = 1 ] && DRY=1
[ $# -ge 2 ] && [ $# -le 4 ] || usage
kind=$1
scope=$2
seconds=${3:--}
reason=

case $kind in
  pause | restart | back) ;;
  *) die "kind must be pause, restart or back: $kind" ;;
esac
case $scope in
  bodies | world | mcp) ;;
  *) die "scope must be bodies, world or mcp: $scope" ;;
esac
if [ "$seconds" != - ]; then
  # Whole numbers only: no sign, no leading zero, at most three digits, then the 0..600 range.
  case $seconds in
    0 | [1-9] | [1-9][0-9] | [1-9][0-9][0-9]) ;;
    *) die "seconds must be a whole number 0-600, or - for none: $seconds" ;;
  esac
  [ "$seconds" -le 600 ] || die "seconds must be 0-600: $seconds"
fi
if [ $# -eq 4 ]; then
  reason=$4
  case $reason in
    update | plugin_update | config) ;;
    *) die "reason must be update, plugin_update or config: $reason" ;;
  esac
fi

SHARD=${GELDAR_SHARD:-colo}
case $SHARD in
  '' | -* | *[!a-z0-9-]*) die "GELDAR_SHARD must be lowercase letters, digits and hyphens: $SHARD" ;;
esac

# The id is one per notice: kind, scope, a UTC stamp and four random bytes (the schema pattern is lowercase, 64 at most).
stamp=$(date -u +%Y%m%d%H%M%S) || die "cannot read the clock"
rand=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n') || die "cannot read random bytes"
id="cd-$kind-$scope-$stamp-$rand"

# Every value is an enum word or a digit string, so no JSON escaping is needed.
PAYLOAD="{\"id\":\"$id\",\"kind\":\"$kind\",\"scope\":\"$scope\""
[ "$seconds" = - ] || PAYLOAD="$PAYLOAD,\"seconds\":$seconds"
[ -z "$reason" ] || PAYLOAD="$PAYLOAD,\"reason\":\"$reason\""
PAYLOAD="$PAYLOAD}"

if [ "$DRY" = 1 ]; then
  say "dry-run, not published: subject geldar.$SHARD.maintenance"
  printf '%s\n' "$PAYLOAD"
  exit 0
fi

# The deploy user's password file is read inside the admin container; this script only names the path. The notice overlay
# (compose/colo-notice.yml) mounts it, and it is merged only when the file exists, so a node without the file keeps working
# (up and the admin subcommands never merge it). Without the file nothing is published and the warning names it.
NOTICE_SECRET=$GELDAR_SECRETS_DIR/nats-deploy.txt
NOTICE_OVERLAY=$(dirname "$COMPOSE_FILE")/colo-notice.yml
publish() {
  [ -f "$NOTICE_SECRET" ] || {
    echo "colo: warning: $NOTICE_SECRET is missing; copy the deploy NATS password file there (deploy/README.md)" >&2
    return 1
  }
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" -f "$NATS_OVERLAY" -f "$SECRETS_OVERLAY" -f "$NOTICE_OVERLAY" --profile admin run --rm \
    -e GELDAR_NATS_USER=deploy -e GELDAR_NATS_PASSWORD_FILE=/run/secrets/nats-deploy.txt \
    -e "GELDAR_NOTICE_SHARD=$SHARD" admin notice "$PAYLOAD" >/dev/null
}

if publish; then
  say "maintenance notice $id ($kind $scope) published on geldar.$SHARD.maintenance"
  exit 0
fi
if [ "${COLO_NOTICE_STRICT:-0}" = 1 ]; then
  die "maintenance notice $id was not published, and COLO_NOTICE_STRICT=1 (is NATS up and the deploy user in nats-auth.conf?)"
fi
echo "colo: warning: maintenance notice $id was not published (NATS unreachable or the publish failed); the deploy goes on" >&2
exit 0
