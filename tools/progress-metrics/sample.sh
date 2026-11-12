#!/usr/bin/env bash
# Operator-only sampler. Appends one tab-separated line per agent and sample:
#   <iso time>\t<agent>\t<raw rcon reply>
# Only reads: `data get entity <agent> Pos|Inventory`. It never changes the world.
#
# usage: sample.sh <pos|inventory> <interval-seconds> <out-file> <agent> [<agent>...]
# RCON_CMD may be set to override the command, default "rcon-cli" (for example
# RCON_CMD="docker exec <paper container> rcon-cli").
set -u

what="${1:-}"; interval="${2:-}"; out="${3:-}"
if [ $# -lt 4 ]; then
  echo "usage: $0 <pos|inventory> <interval-seconds> <out-file> <agent> [<agent>...]" >&2
  exit 2
fi
shift 3
case "$what" in
  pos) path="Pos" ;;
  inventory) path="Inventory" ;;
  *) echo "first argument must be pos or inventory" >&2; exit 2 ;;
esac
case "$interval" in
  ''|*[!0-9]*) echo "interval must be whole seconds" >&2; exit 2 ;;
esac
rcon="${RCON_CMD:-rcon-cli}"

while true; do
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for agent in "$@"; do
    reply="$($rcon "data get entity $agent $path" 2>/dev/null | tr -d '\r\n\t')"
    [ -n "$reply" ] && printf '%s\t%s\t%s\n' "$now" "$agent" "$reply" >> "$out"
  done
  sleep "$interval"
done
