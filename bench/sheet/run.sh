#!/bin/sh
# Sheet driver step 0 (scratch shard, Colo node). Helpers only: this script starts no life and writes to no
# shard. Every action first runs the scratch guard, which refuses unless SHEET_SHARD and SHEET_PROJECT both
# start with scratch- and are not a live name. Endpoints come from the environment; defaults are loopback.
#
#   SHEET_SHARD=scratch-sheet0 SHEET_LIFE=<scratch life name> sh bench/sheet/run.sh guard
#   SHEET_SHARD=scratch-sheet0 SHEET_PROJECT=scratch-sheet0 sh bench/sheet/run.sh up|down
#   SHEET_SHARD=scratch-sheet0 SHEET_LIFE=<life> SHEET_PG_URL=<url without password> sh bench/sheet/run.sh evidence
#   SHEET_SHARD=scratch-sheet0 sh bench/sheet/run.sh leak <capture file> [sheet numbers, e.g. 3,3]
#
# evidence needs PGPASSWORD (or a .pgpass the operator keeps outside the repo). It runs psql read-only
# (default_transaction_read_only=on) and prints the rows the pipeline wrote for SHEET_LIFE.
# up and down use the compose files below plus the overlay bench/sheet/phase0-sheet.yml. Worldops may run
# its own scratch stack instead; this script does not require it.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SHEET_SHARD=${SHEET_SHARD:-}
SHEET_PROJECT=${SHEET_PROJECT:-$SHEET_SHARD}
SHEET_LIFE=${SHEET_LIFE:-}
SHEET_PG_URL=${SHEET_PG_URL:-postgresql://geldar@127.0.0.1:15433/geldar}
SHEET_NODE=${SHEET_NODE:-node}
CLI="$ROOT/golem/src/bench/sheet/cli.ts"

guard() {
  "$SHEET_NODE" --experimental-strip-types "$CLI" guard "$SHEET_SHARD" "$SHEET_PROJECT"
}

action="${1:-}"
case "$action" in
  guard)
    guard
    ;;
  up)
    guard
    cd "$ROOT"
    GELDAR_WORLD_VOLUME="${SHEET_PROJECT}_paper-data" docker compose -p "$SHEET_PROJECT" \
      -f compose/phase0.yml -f compose/rcon-host.yml -f bench/sheet/phase0-sheet.yml up -d
    ;;
  down)
    guard
    cd "$ROOT"
    GELDAR_WORLD_VOLUME="${SHEET_PROJECT}_paper-data" docker compose -p "$SHEET_PROJECT" \
      -f compose/phase0.yml -f compose/rcon-host.yml -f bench/sheet/phase0-sheet.yml down -v
    ;;
  evidence)
    guard
    case "$SHEET_LIFE" in
      ''|*[!a-z0-9_]*) echo "refusing: SHEET_LIFE must be lowercase letters, digits or underscores" >&2; exit 1 ;;
    esac
    # Read-only session. The three queries filter on the scratch life only; nothing is written.
    q() {
      PGOPTIONS='-c default_transaction_read_only=on' psql "$SHEET_PG_URL" -v ON_ERROR_STOP=1 \
        -v "life=$SHEET_LIFE" --csv -f - <<SQL
$1
SQL
    }
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    q "SELECT world_tick, fx, score, proficiency, dc, mode, total, success FROM rolls WHERE life_id = :'life' ORDER BY world_tick;" > "$tmp/rolls.csv"
    q "SELECT domain, evidence_key, world_tick, awarded_at FROM xp_evidence WHERE life_id = :'life' ORDER BY awarded_at;" > "$tmp/xp.csv"
    q "SELECT * FROM proficiency WHERE life_id = :'life';" > "$tmp/proficiency.csv"
    "$SHEET_NODE" --experimental-strip-types "$CLI" report \
      "rolls=$tmp/rolls.csv" "xp_evidence=$tmp/xp.csv" "proficiency=$tmp/proficiency.csv"
    ;;
  leak)
    guard
    [ "$#" -ge 2 ] || { echo "usage: run.sh leak <capture file> [sheet numbers]" >&2; exit 2; }
    "$SHEET_NODE" --experimental-strip-types "$CLI" leak "$2" "${3:-3}"
    ;;
  *)
    echo "usage: sh bench/sheet/run.sh guard|up|down|evidence|leak <capture file> [numbers]" >&2
    exit 2
    ;;
esac
