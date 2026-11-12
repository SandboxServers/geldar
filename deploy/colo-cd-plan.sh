#!/bin/sh
# Computes the delta for one release (CD-2a, decision 0084). Read-only: it compares the installed and the new release
# manifest, and each file of the exported tree with the node's src extract (cmp). It prints one line per fact;
# deploy/colo-cd.sh reads these lines and changes the node. This script changes nothing.
# Usage: colo-cd-plan.sh <installed manifest> <new manifest> <export dir> <src extract dir>
# Lines: image <service> changed|same | sql yes|no | plugin changed | refresh <path> | skip <path>
#        | manual <what> (the change is not applied; the Paper path is a later packet)
# The export is git-less, so there is no git diff: the tracked set is every file in the export (the export holds the
# tracked files only). A file removed upstream is not seen here, because it is not in the export.
set -eu

if [ $# -ne 4 ]; then
  echo "usage: colo-cd-plan.sh <installed manifest> <new manifest> <export dir> <src extract dir>" >&2
  exit 1
fi
OLD=$1
NEW=$2
REPO=$3
SRC=$4
[ -d "$REPO" ] || { echo "colo-cd-plan: export dir not found: $REPO" >&2; exit 1; }
# A missing src extract would make every file look changed; refuse instead.
[ -d "$SRC" ] || { echo "colo-cd-plan: src extract dir not found: $SRC" >&2; exit 1; }

# The image keys the manifest carries, and the compose service each one starts (mind and admin never run as services here).
IMAGE_KEYS="GELDAR_BODY_IMAGE GELDAR_MIND_IMAGE GELDAR_EVENTSINK_IMAGE GELDAR_MCP_IMAGE GELDAR_ADMIN_IMAGE GELDAR_GLASS_IMAGE GELDAR_REGISTER_IMAGE"

svc_of() {
  case $1 in
    GELDAR_BODY_IMAGE) echo golem-body ;;
    GELDAR_MIND_IMAGE) echo animus ;;
    GELDAR_EVENTSINK_IMAGE) echo eventsink ;;
    GELDAR_MCP_IMAGE) echo geldar-mcp ;;
    GELDAR_ADMIN_IMAGE) echo admin ;;
    GELDAR_GLASS_IMAGE) echo glass ;;
    GELDAR_REGISTER_IMAGE) echo register ;;
  esac
}

value_of() {
  sed -n "s/^$2=//p" "$1" | tail -n 1
}

for key in $IMAGE_KEYS; do
  new=$(value_of "$NEW" "$key")
  if [ -z "$new" ]; then
    echo "colo-cd-plan: $key is missing from the new manifest" >&2
    exit 1
  fi
  old=$(value_of "$OLD" "$key")
  if [ "$old" = "$new" ]; then state=same; else state=changed; fi
  echo "image $(svc_of "$key") $state"
done

files=$(cd "$REPO" && find . -type f -not -path './.git/*' | sed 's|^\./||' | LC_ALL=C sort) ||
  { echo "colo-cd-plan: cannot list the export dir $REPO" >&2; exit 1; }

sql=no
plugin=no
compose=no
caddy=no
nats=no
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  # Unchanged files (same bytes as the src extract) are not listed.
  if [ -f "$SRC/$rel" ] && cmp -s "$REPO/$rel" "$SRC/$rel"; then continue; fi
  case $rel in
    compose/secrets/* | skins/*) echo "skip $rel" ;;
    plugin/*) plugin=yes; echo "skip $rel" ;;
    compose/*) compose=yes; echo "skip $rel" ;;
    deploy/caddy/*) caddy=yes; echo "skip $rel" ;;
    nats/* | */nats*.conf) nats=yes; echo "skip $rel" ;;
    sql/*.sql) sql=yes; echo "refresh $rel" ;;
    *) echo "refresh $rel" ;;
  esac
done <<EOF
$files
EOF

echo "sql $sql"
if [ "$plugin" = yes ]; then echo "plugin changed"; echo "manual plugin jar or plugin config changed (plugin/): not applied"; fi
if [ "$compose" = yes ]; then echo "manual compose config changed (may define Paper, Velocity, Caddy or NATS): not applied"; fi
if [ "$caddy" = yes ]; then echo "manual Caddy config changed (deploy/caddy): not applied"; fi
if [ "$nats" = yes ]; then echo "manual NATS config changed: not applied"; fi
exit 0
