#!/bin/sh
# The entrypoint of the geldar-admin image (decision 0133). One subcommand per run; each one runs an existing CLI
# with the colo database. Nothing here prints a value: the Postgres password is read from a file into PGPASSWORD for
# this process only. The CLIs' own arguments pass through unchanged (see tools/migrate/src/cli.ts and mcp-tokens).
set -eu
ROOT=/opt/geldar
PG_PASSWORD_FILE=${GELDAR_ADMIN_PG_PASSWORD_FILE:-/run/secrets/postgres.txt}

usage() {
  echo "usage: admin <migrate|owner-add|owner-set-cap|owner-admin|player-add|token-mint|token-revoke|players-status|roster> [args...]" >&2
  echo "  migrate [--dry-run] | migrate --set-role-password geldar_mcp --password-file <file>" >&2
  echo "  owner-add <id> [--cap N] | owner-set-cap <id> <N> (N 0 to 50; the shard's owner_cap_owner 20 is not applied) | player-add <id> --owner <o> --life <l> --name <n> --harness <h>" >&2
  echo "  token-mint <player> --out <file> | token-revoke <tk_id> | skin-import <player-id> <json under /run/skins> | players-status (lists tokens, no values)" >&2
  echo "  player-flags <player-id> [--public-camera on|off] [--thoughts-delayed-public on|off]" >&2
  echo "  player-set-owner <player-id> <owner-id> (moves the player, its roster name and its life in one transaction; refuses a retired player or a full owner)" >&2
  echo "  notice <payload-json> (CD-1d: publishes one maintenance notice as the deploy NATS user; see deploy/colo-notice.sh)" >&2
  echo "  roster add <name> --owner <o> | roster list [--owner <o>] (decision 0108: the roster of Minecraft names)" >&2
  echo "  adopt-sheets plan --lives <list> | adopt-sheets apply --operator-confirm --plan <12 hex> --lives <list> (S12-04b: the sheet adoption plan and its apply; <list> is a comma list of life ids)" >&2
  exit 2
}

[ $# -ge 1 ] || usage
cmd=$1
shift

# notice (CD-1d) runs as the deploy NATS user and reads no Postgres password, so it is dispatched before that check.
if [ "$cmd" = notice ]; then
  exec node "$ROOT/golem/src/publish-maintenance-notice.ts" "$@"
fi

case $cmd in
  migrate | owner-add | owner-set-cap | owner-admin | player-add | token-mint | token-revoke | players-status | ensure-skins-bucket | whitelist-house-body | skin-import | player-flags | player-set-owner | roster | adopt-sheets) ;;
  *) usage ;;
esac

# Checks the --lives value (the same rules as adopt_lives_check in deploy/colo-admin.sh): a comma list of 1 to 120 unique
# life ids, each matching ^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$. Names only the offending id.
adopt_lives_check() {
  rest=$1
  seen=
  n=0
  [ -n "$rest" ] || { echo "admin: --lives takes a comma list of life ids" >&2; exit 2; }
  while :; do
    id=${rest%%,*}
    n=$((n + 1))
    [ "$n" -le 120 ] || { echo "admin: --lives takes at most 120 life ids" >&2; exit 2; }
    case $id in '' | *[!a-z0-9_]*) echo "admin: life id must match ^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}\$: $id" >&2; exit 2 ;; esac
    printf '%s' "$id" | grep -Eq '^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$' ||
      { echo "admin: life id must match ^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}\$: $id" >&2; exit 2; }
    case ",$seen," in *",$id,"*) echo "admin: duplicate life id: $id" >&2; exit 2 ;; esac
    seen=${seen:+$seen,}$id
    case $rest in *,*) rest=${rest#*,} ;; *) break ;; esac
  done
}

# adopt-sheets takes plan --lives <list>, or apply --operator-confirm --plan <12 hex> --lives <list>, in that order. Checked
# before the password file is read; the shard check (each id in the shard file) runs in the map step below.
if [ "$cmd" = adopt-sheets ]; then
  case ${1:-}:$# in
    plan:3)
      [ "$2" = --lives ] || { echo "admin: adopt-sheets plan takes --lives <list>" >&2; exit 2; }
      adopt_lives_check "$3"
      ;;
    apply:6)
      { [ "$2" = --operator-confirm ] && [ "$3" = --plan ] && printf '%s' "$4" | grep -Eq '^[0-9a-f]{12}$' && [ "$5" = --lives ]; } ||
        { echo "admin: adopt-sheets apply takes --operator-confirm --plan <12 lower-case hex> --lives <list>" >&2; exit 2; }
      adopt_lives_check "$6"
      ;;
    *) echo "admin: adopt-sheets takes plan --lives <list>, or apply --operator-confirm --plan <12 hex> --lives <list>" >&2; exit 2 ;;
  esac
fi

# roster takes add or list (decision 0108). Checked before the password file is read; the CLI checks the other arguments.
if [ "$cmd" = roster ]; then
  case ${1:-} in
    add | list) ;;
    *) echo "admin: roster takes add or list (roster add <name> --owner <o>, roster list [--owner <o>])" >&2; exit 2 ;;
  esac
fi

# owner-admin takes set <owner>, unset <owner> or list (the admin flag, C7-12). Checked before the password file is read.
if [ "$cmd" = owner-admin ]; then
  case ${1:-}:$# in
    set:2 | unset:2 | list:1) ;;
    *) echo "admin: owner-admin takes set <owner>, unset <owner> or list" >&2; exit 2 ;;
  esac
fi

[ -f "$PG_PASSWORD_FILE" ] && [ -s "$PG_PASSWORD_FILE" ] || {
  echo "admin: the database password file is missing or empty" >&2
  exit 1
}
PGPASSWORD=$(cat "$PG_PASSWORD_FILE")
PGHOST=${PGHOST:-postgres}
PGUSER=${PGUSER:-geldar}
PGDATABASE=${PGDATABASE:-geldar}
export PGPASSWORD PGHOST PGUSER PGDATABASE

# adopt-sheets (S12-04b). The sheets map is built here from the shard file, with the CLI's readShardLives, and holds only the
# listed lives (--lives), each "standard". An id the shard file does not list stops the map step before the CLI runs. The
# CLI prints one `life: verdict` line per life and nothing else. The plan hash is the first 12 hex of sha256 over those
# lines, sorted (LC_ALL=C), each with its newline. Apply runs the plan again and refuses when the hash differs from the one
# the operator read. No sheet value is printed; the sheets file sits in a private work directory that the EXIT trap removes.
ADOPT_MAP_JS='import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [root, shard, listArg] = process.argv.slice(1);
const { readShardLives } = await import(pathToFileURL(`${root}/tools/mcp-tokens/src/convert-sheets.ts`).href);
const lives = readShardLives(readFileSync(shard, "utf8"));
const wanted = listArg.split(",");
const missing = wanted.find((life) => !lives.includes(life));
if (missing !== undefined) {
  process.stderr.write(`admin: life not in the shard file: ${missing}\n`);
  process.exit(2);
}
process.stdout.write(JSON.stringify(Object.fromEntries(wanted.map((life) => [life, "standard"]))));'

adopt_sheets() {
  mode=$1
  if [ "$mode" = plan ]; then lives=${3:-}; want=; else lives=${6:-}; want=${4:-}; fi
  work=$(mktemp -d) || { echo "admin: cannot make a work directory" >&2; exit 1; }
  trap 'rm -rf "$work"' EXIT
  sheets=$work/sheets.json
  plan=$work/plan.txt
  umask 077
  node --input-type=module -e "$ADOPT_MAP_JS" "$ROOT" "$GELDAR_SHARD_FILE" "$lives" >"$sheets" ||
    { echo "admin: cannot build the sheets map from the shard file" >&2; exit 1; }
  node "$ROOT/tools/mcp-tokens/src/cli.ts" player adopt-sheets --shard "$GELDAR_SHARD_FILE" --sheets "$sheets" >"$plan" ||
    { echo "admin: adopt-sheets plan failed" >&2; exit 1; }
  hash=$(LC_ALL=C sort "$plan" | sha256sum | cut -c1-12)
  if [ "$mode" = plan ]; then
    cat "$plan"
    echo "plan: $hash"
    exit 0
  fi
  if [ "$hash" != "$want" ]; then
    echo "adopt-sheets-apply: plan changed (expected $want, now $hash)" >&2
    exit 1
  fi
  cat "$plan"
  echo "plan: $hash"
  node "$ROOT/tools/mcp-tokens/src/cli.ts" player adopt-sheets --shard "$GELDAR_SHARD_FILE" --sheets "$sheets" --apply --operator-confirm
  exit $?
}

if [ "$cmd" = adopt-sheets ]; then
  adopt_sheets "$@"
fi

case $cmd in
  migrate) exec node "$ROOT/tools/migrate/src/cli.ts" "$@" ;;
  owner-add) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" owner add "$@" ;;
  owner-set-cap) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" owner set-cap "$@" ;;
  player-add) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" player add "$@" ;;
  player-flags) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" player flags "$@" ;;
  owner-admin) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" owner admin "$@" ;;
  player-set-owner) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" player set-owner "$@" ;;
  token-mint) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" token mint "$@" ;;
  token-revoke) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" token revoke "$@" ;;
  skin-import) exec node "$ROOT/tools/players-cli/src/cli.ts" skin import "$@" ;;
  ensure-skins-bucket) exec node "$ROOT/golem/src/ensure-skins-bucket.ts" "$@" ;;
  whitelist-house-body) exec node "$ROOT/golem/src/whitelist-house-body.ts" "$@" ;;
  players-status) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" token list "$@" ;;
  roster) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" roster "$@" ;;
esac
