#!/bin/sh
# Sheet driver step 0 (scratch shard, Colo node). Helpers only: this script starts no life and writes to no
# shard. Every action first runs the scratch guard, which refuses unless SHEET_SHARD and SHEET_PROJECT both
# start with scratch- and are not a live name. Endpoints come from the environment; defaults are loopback.
#
#   SHEET_SHARD=scratch-sheet0 SHEET_LIFE=<scratch life name> sh bench/sheet/run.sh guard
#   SHEET_SHARD=scratch-sheet0 SHEET_PROJECT=scratch-sheet0 sh bench/sheet/run.sh up|down
#   SHEET_SHARD=scratch-sheet0 SHEET_LIFE=<life> SHEET_PG_URL=<url without password> sh bench/sheet/run.sh evidence
#   SHEET_SHARD=scratch-sheet0 SHEET_LIFE=<life> sh bench/sheet/run.sh mine-once [block] [count]
#   SHEET_SHARD=scratch-sheet0 SHEET_LIFE=<life> sh bench/sheet/run.sh rcon-roll
#   SHEET_SHARD=scratch-sheet0 sh bench/sheet/run.sh leak <capture file> <sheet numbers, e.g. 3,3>
#
# Exit codes: 0 ok, 1 refused by the guard (or a leak hit, or an evidence refusal), 2 usage error or a crash.
#
# mine-once sends one scripted plan (one mine action, no model) over NATS and prints the ids and the Body's reply.
# It needs SHEET_NATS_URL (default nats://127.0.0.1:14223). rcon-roll prints an UNVERIFIED operator checklist for
# the one roll; it runs no RCON command itself.
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
      PGOPTIONS='-c default_transaction_read_only=on' psql -w "$SHEET_PG_URL" -v ON_ERROR_STOP=1 \
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
    [ "$#" -eq 3 ] || { echo "usage: run.sh leak <capture file> <sheet numbers>" >&2; exit 2; }
    "$SHEET_NODE" --experimental-strip-types "$CLI" leak "$2" "$3"
    ;;
  mine-once)
    guard
    case "$SHEET_LIFE" in
      ''|*[!a-z0-9_]*) echo "refusing: SHEET_LIFE must be a life id such as ag_<name>_<nn>" >&2; exit 1 ;;
    esac
    SHEET_SHARD="$SHEET_SHARD" SHEET_PROJECT="$SHEET_PROJECT" \
      "$SHEET_NODE" --experimental-strip-types "$ROOT/golem/src/bench/sheet/life-cli.ts" \
      mine-once "$SHEET_LIFE" "${2:-stone}" "${3:-1}"
    ;;
  rcon-roll)
    guard
    # OPTIONAL OPERATOR STEP. Nothing here runs RCON. The command shapes are candidates, not verified against the
    # scratch server's version. The operator runs each one with their own RCON client, reads the reply, and keeps
    # the password out of the repo.
    cat <<EOF
UNVERIFIED operator checklist for the one roll (life: ${SHEET_LIFE:-<SHEET_LIFE>}, in-game name: <player name>)
Scratch shard only. Never run these against a live shard (spec Principle 1).
  1. Summon one armed hostile next to the life (not a creeper). Candidate: summon minecraft:zombie <x> <y> <z>
  2. Give the life a weapon. Candidate: give <player name> minecraft:iron_sword 1
  3. Hurt the life to 7-10 of 20 health, so the band is reached. Candidate: damage <player name> 12
     (vanilla /damage; check it exists on this server version first; the trigger is unverified)
  4. Wait for the reflex to fire, then read the roll: sh bench/sheet/run.sh evidence
     Expect a rolls row with fx threat and dc 11. If there is none, the trigger did not fire: report it.
EOF
    ;;
  *)
    echo "usage: sh bench/sheet/run.sh guard|up|down|evidence|mine-once [block] [count]|rcon-roll|leak <capture file> <numbers>" >&2
    exit 2
    ;;
esac
