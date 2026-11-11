#!/bin/sh
# The entrypoint of the geldar-admin image (decision 0133). One subcommand per run; each one runs an existing CLI
# with the colo database. Nothing here prints a value: the Postgres password is read from a file into PGPASSWORD for
# this process only. The CLIs' own arguments pass through unchanged (see tools/migrate/src/cli.ts and mcp-tokens).
set -eu
ROOT=/opt/geldar
PG_PASSWORD_FILE=${GELDAR_ADMIN_PG_PASSWORD_FILE:-/run/secrets/postgres.txt}

usage() {
  echo "usage: admin <migrate|owner-add|player-add|token-mint|token-revoke|players-status> [args...]" >&2
  echo "  migrate [--dry-run] | migrate --set-role-password geldar_mcp --password-file <file>" >&2
  echo "  owner-add <id> [--cap N] | player-add <id> --owner <o> --life <l> --name <n> --harness <h>" >&2
  echo "  token-mint <player> --out <file> | token-revoke <tk_id> | players-status (lists tokens, no values)" >&2
  exit 2
}

[ $# -ge 1 ] || usage
cmd=$1
shift

case $cmd in
  migrate | owner-add | player-add | token-mint | token-revoke | players-status | ensure-skins-bucket) ;;
  *) usage ;;
esac

[ -f "$PG_PASSWORD_FILE" ] && [ -s "$PG_PASSWORD_FILE" ] || {
  echo "admin: the database password file is missing or empty" >&2
  exit 1
}
PGPASSWORD=$(cat "$PG_PASSWORD_FILE")
PGHOST=${PGHOST:-postgres}
PGUSER=${PGUSER:-geldar}
PGDATABASE=${PGDATABASE:-geldar}
export PGPASSWORD PGHOST PGUSER PGDATABASE

case $cmd in
  migrate) exec node "$ROOT/tools/migrate/src/cli.ts" "$@" ;;
  owner-add) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" owner add "$@" ;;
  player-add) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" player add "$@" ;;
  token-mint) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" token mint "$@" ;;
  token-revoke) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" token revoke "$@" ;;
  ensure-skins-bucket) exec node "$ROOT/golem/src/ensure-skins-bucket.ts" "$@" ;;
  players-status) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" token list "$@" ;;
esac
