#!/bin/sh
# The entrypoint of the geldar-admin image (decision 0133). One subcommand per run; each one runs an existing CLI
# with the colo database. Nothing here prints a value: the Postgres password is read from a file into PGPASSWORD for
# this process only. The CLIs' own arguments pass through unchanged (see tools/migrate/src/cli.ts and mcp-tokens).
set -eu
ROOT=/opt/geldar
PG_PASSWORD_FILE=${GELDAR_ADMIN_PG_PASSWORD_FILE:-/run/secrets/postgres.txt}

usage() {
  echo "usage: admin <migrate|owner-add|player-add|token-mint|token-revoke|players-status|roster> [args...]" >&2
  echo "  migrate [--dry-run] | migrate --set-role-password geldar_mcp --password-file <file>" >&2
  echo "  owner-add <id> [--cap N] | player-add <id> --owner <o> --life <l> --name <n> --harness <h>" >&2
  echo "  token-mint <player> --out <file> | token-revoke <tk_id> | skin-import <player-id> <json under /run/skins> | players-status (lists tokens, no values)" >&2
  echo "  notice <payload-json> (CD-1d: publishes one maintenance notice as the deploy NATS user; see deploy/colo-notice.sh)" >&2
  echo "  roster add <name> --owner <o> | roster list [--owner <o>] (decision 0108: the roster of Minecraft names)" >&2
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
  migrate | owner-add | player-add | token-mint | token-revoke | players-status | ensure-skins-bucket | whitelist-house-body | skin-import | roster) ;;
  *) usage ;;
esac

# roster takes add or list (decision 0108). Checked before the password file is read; the CLI checks the other arguments.
if [ "$cmd" = roster ]; then
  case ${1:-} in
    add | list) ;;
    *) echo "admin: roster takes add or list (roster add <name> --owner <o>, roster list [--owner <o>])" >&2; exit 2 ;;
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

case $cmd in
  migrate) exec node "$ROOT/tools/migrate/src/cli.ts" "$@" ;;
  owner-add) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" owner add "$@" ;;
  player-add) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" player add "$@" ;;
  token-mint) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" token mint "$@" ;;
  token-revoke) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" token revoke "$@" ;;
  skin-import) exec node "$ROOT/tools/players-cli/src/cli.ts" skin import "$@" ;;
  ensure-skins-bucket) exec node "$ROOT/golem/src/ensure-skins-bucket.ts" "$@" ;;
  whitelist-house-body) exec node "$ROOT/golem/src/whitelist-house-body.ts" "$@" ;;
  players-status) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" token list "$@" ;;
  roster) exec node "$ROOT/tools/mcp-tokens/src/cli.ts" roster "$@" ;;
esac
