#!/bin/sh
# Computes the delta for one release (CD-2a, decision 0084). Read-only: it compares the installed and the new release
# manifest, and each file of the exported tree with the node's src extract (cmp). It prints one line per fact;
# deploy/colo-cd.sh reads these lines and changes the node. This script changes nothing.
# Usage: colo-cd-plan.sh <installed manifest> <new manifest> <export dir> <src extract dir>
# Lines: image <service> changed|same | sql yes|no | refresh <path> | skip <path>
#        | player-host <id> stale|current | folder <name> <sha256> | manual <what> (cannot list the player hosts)
# folder lines (plugin, compose, caddy, nats) carry a hash of the export's folder; colo-cd.sh reports the folder as
# needs manual only when that hash differs from $STATE_DIR/applied.<name>.sha256 (see colo-cd.sh --record-applied).
# --folder-hashes <dir> prints only the folder lines for <dir> (colo-cd.sh uses it to record the node's copies).
# The export is git-less, so there is no git diff: the tracked set is every file in the export (the export holds the
# tracked files only). A file removed upstream is not seen here, because it is not in the export.
set -eu

# The category of one tracked path, in CATEGORY (no subshell). plugin, compose, caddy and nats are the folders the node
# does not refresh; secret (compose/secrets and skins) is never copied and never hashed.
category_of() {
  case $1 in
    compose/secrets/* | skins/*) CATEGORY=secret ;;
    plugin/*) CATEGORY=plugin ;;
    compose/*) CATEGORY=compose ;;
    deploy/caddy/*) CATEGORY=caddy ;;
    nats/* | */nats*.conf) CATEGORY=nats ;;
    sql/*.sql) CATEGORY=sql ;;
    *) CATEGORY=other ;;
  esac
}

# One line per folder with a tracked file in <dir>: "folder <name> <sha256>". The hash covers each file's path and sha256
# in sorted order, so the export and the node's copy of the same tree give the same hash.
folder_hashes() {
  listing=$(cd "$1" && find . -type f -not -path './.git/*' | sed 's|^\./||' | LC_ALL=C sort) || return 1
  for name in plugin compose caddy nats; do
    members=
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      category_of "$rel"
      if [ "$CATEGORY" = "$name" ]; then members="$members$rel
"; fi
    done <<EOF
$listing
EOF
    [ -n "$members" ] || continue
    hash=$(cd "$1" && printf '%s' "$members" | while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      printf '%s %s\n' "$rel" "$(sha256sum <"$rel" | cut -d' ' -f1)"
    done | sha256sum | cut -d' ' -f1) || return 1
    echo "folder $name $hash"
  done
}

if [ "${1:-}" = --folder-hashes ]; then
  [ $# -eq 2 ] && [ -d "$2" ] || { echo "usage: colo-cd-plan.sh --folder-hashes <dir>" >&2; exit 1; }
  folder_hashes "$2" || { echo "colo-cd-plan: cannot hash the folders in $2" >&2; exit 1; }
  exit 0
fi

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

# The image keys the manifest carries, and the compose service each one starts (admin never runs as a service here).
IMAGE_KEYS="GELDAR_BODY_IMAGE GELDAR_EVENTSINK_IMAGE GELDAR_MCP_IMAGE GELDAR_ADMIN_IMAGE GELDAR_GLASS_IMAGE GELDAR_REGISTER_IMAGE"

svc_of() {
  case $1 in
    GELDAR_BODY_IMAGE) echo golem-body ;;
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

# Running per-player host containers whose image differs from the new body image: a service-like delta entry per host.
# Read-only (player-list and inspect). A hibernating player has no container and is not listed.
DEPLOY_DIR=$(dirname "$0")
. "$DEPLOY_DIR/colo-cd-players.sh"
if hosts=$(host_states "$(value_of "$NEW" GELDAR_BODY_IMAGE)" 2>/dev/null); then
  [ -z "$hosts" ] || printf '%s\n' "$hosts" | sed 's/^/player-host /'
else
  echo "manual cannot list the player hosts; check them by hand"
fi

files=$(cd "$REPO" && find . -type f -not -path './.git/*' | sed 's|^\./||' | LC_ALL=C sort) ||
  { echo "colo-cd-plan: cannot list the export dir $REPO" >&2; exit 1; }

sql=no
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  # Unchanged files (same bytes as the src extract) are not listed.
  if [ -f "$SRC/$rel" ] && cmp -s "$REPO/$rel" "$SRC/$rel"; then continue; fi
  category_of "$rel"
  case $CATEGORY in
    secret | plugin | compose | caddy | nats) echo "skip $rel" ;;
    sql) sql=yes; echo "refresh $rel" ;;
    *) echo "refresh $rel" ;;
  esac
done <<EOF
$files
EOF

echo "sql $sql"
# Whether a folder is reported as needs manual is decided by colo-cd.sh, from the recorded hash of that folder.
folder_hashes "$REPO" || { echo "colo-cd-plan: cannot hash the folders in $REPO" >&2; exit 1; }
exit 0
