#!/bin/sh
# C7-03c2: installs the body helper on the Colo node (decision 0260). Run on the node by geldar-93,
# from the repo checkout, as root for --apply.
#
# DRY RUN IS THE DEFAULT. Nothing changes unless --apply is given. The script is idempotent: a second
# --apply changes nothing. It prints names and paths only, never a secret value, and it never reads
# a secret file's contents. It never touches nats-auth.conf and never runs `shard nats-auth`.
#
# Open question for geldar-93 (recorded in docs/runbooks/body-helper-node-steps.md): how the built
# helper gets onto the node. This script does not fetch or copy code. It expects the build at
# $INSTALL_DIR/dist/main.js; until that file exists it writes no unit and enables nothing.
#
# Carry-forward (C7-03c5): this node has no Node today. The unit's ExecStart and the migrate call in
# step 4 use the node on PATH and the checkout's tools/migrate. C7-03c5 moves both to a pinned node
# under /opt/geldar. Until then --apply refuses to start without node (the preflight below).
#
# Environment (names only):
#   BODY_HELPER_PREFIX  root for every path below; empty on the node (tests set a temp root).
#   BODY_HELPER_REPO    the repo checkout that holds tools/migrate (default: this script's repo).
set -eu

usage() {
  cat <<'EOF'
usage: deploy/install-body-helper.sh [--dry-run | --apply]

  (no flag) or --dry-run  print the plan; change nothing.
  --apply                 make the planned changes.
  -h, --help              this text.

Any other argument is refused (exit 2).
EOF
}

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "install-body-helper: refused unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

die() {
  echo "install-body-helper: $*" >&2
  exit 1
}

PREFIX="${BODY_HELPER_PREFIX:-}"
case "$PREFIX" in
  *[!A-Za-z0-9_./-]*) die "BODY_HELPER_PREFIX holds a character outside A-Za-z0-9_./- and is refused" ;;
esac
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# The test settings (BODY_HELPER_PREFIX, BODY_HELPER_REPO) take effect only with a prefix. A prefix as root
# needs BODY_HELPER_TEST=1, which only the test harness exports. On the node neither is set.
REPO_DIR=$(dirname "$SCRIPT_DIR")
if [ -n "$PREFIX" ]; then
  REPO_DIR="${BODY_HELPER_REPO:-$REPO_DIR}"
  if [ "$(id -u)" = 0 ] && [ "${BODY_HELPER_TEST:-}" != 1 ]; then
    die "BODY_HELPER_PREFIX is a test setting and is refused for root"
  fi
fi
case "$REPO_DIR" in
  *[!A-Za-z0-9_./:-]*) die "BODY_HELPER_REPO holds a character outside the path set and is refused" ;;
esac
if [ "$APPLY" = 1 ] && [ -z "$PREFIX" ] && [ "$(id -u)" != 0 ]; then
  die "--apply on the node needs root (run with sudo)"
fi
# Preflight, before any write: the migrate verb (step 4) runs under node from the checkout.
if [ "$APPLY" = 1 ]; then
  command -v node >/dev/null 2>&1 || die "--apply needs node on PATH for the migrate verb; nothing was changed"
  [ -d "$REPO_DIR/tools/migrate/node_modules" ] || die "--apply needs $REPO_DIR/tools/migrate/node_modules (run pnpm install in the checkout); nothing was changed"
  # The password step (step 4) logs in with the PG* variables, and its login probe needs PGDATABASE.
  [ -n "${PGHOST:-}" ] || die "--apply needs PGHOST for the password step; nothing was changed"
  [ -n "${PGUSER:-}" ] || die "--apply needs PGUSER for the password step; nothing was changed"
  [ -n "${PGDATABASE:-}" ] || die "--apply needs PGDATABASE for the password step; nothing was changed"
fi

UNIT_NAME=geldar-body-helper.service
INSTALL_DIR="$PREFIX/opt/geldar/body-helper"
BUILD_MAIN="$INSTALL_DIR/dist/main.js"
UNIT="$PREFIX/etc/systemd/system/$UNIT_NAME"
SECRET_DIR="$PREFIX/etc/geldar/secrets"
PG_SECRET="$SECRET_DIR/helper-postgres.txt"
# The single source for the helper's NATS password. The unit's env file points the helper at this file,
# and the NATS conf step in the runbook reads the same file.
NATS_SECRET="$SECRET_DIR/nats-helper.txt"
ENV_FILE="$PREFIX/etc/geldar/body-helper.env"
MIGRATE_CLI="$REPO_DIR/tools/migrate/src/cli.ts"

TMP_UNIT=""
CHANGES=0
BLOCKED=0
ENV_MISSING=0
note() { printf '%s\n' "$*"; }
change() {
  CHANGES=$((CHANGES + 1))
  if [ "$APPLY" = 1 ]; then note "made: $*"; else note "would: $*"; fi
}

if [ "$APPLY" = 1 ]; then note "mode: apply"; else note "mode: dry run (nothing changes; --apply makes the changes)"; fi
note "migrate checkout: $REPO_DIR"

# 1. The helper build. Without it the unit would crash-loop, so the unit is neither written nor enabled.
if [ -f "$BUILD_MAIN" ]; then
  note "helper build present: $INSTALL_DIR/dist/main.js"
else
  BLOCKED=1
  note "blocked: helper build missing at $INSTALL_DIR/dist/main.js (open question for geldar-93: how the build reaches the node); no unit is written or enabled"
fi

# 1b. The env file (names only; geldar-93 writes it from the release env). Without it the unit is
#     never enabled or restarted.
if [ -f "$ENV_FILE" ]; then
  note "env file present: $(basename "$ENV_FILE") (names only are checked by the runbook)"
else
  ENV_MISSING=1
  note "blocked: env file missing: $(basename "$ENV_FILE") (geldar-93 writes it before --apply; see the runbook); the unit is not enabled"
fi

# 2. The systemd unit. Root-owned, mode 0644, written only when its content changes.
render_unit() {
  cat <<EOF
[Unit]
Description=Geldar body helper: starts and stops Body containers for the supervisor (decision 0260)
After=network-online.target docker.service
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
# Root by design: this process is the only one that talks to the Docker socket (decision 0260).
# The supervisor and every Body run in containers without it.
User=root
EnvironmentFile=/etc/geldar/body-helper.env
# Carry-forward (C7-03c5): ExecStart moves to a pinned node under /opt/geldar; node5 has no Node today.
ExecStart=/usr/bin/node /opt/geldar/body-helper/dist/main.js
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadOnlyPaths=-/etc/geldar/secrets/helper-postgres.txt -/etc/geldar/secrets/nats-helper.txt
ReadWritePaths=-/var/run/docker.sock
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

UNIT_CHANGED=0
if [ "$BLOCKED" = 0 ]; then
  TMP_UNIT="$(mktemp)"
  trap 'rm -f "$TMP_UNIT"' EXIT
  render_unit >"$TMP_UNIT"
  if [ ! -f "$UNIT" ] || ! cmp -s "$TMP_UNIT" "$UNIT"; then
    UNIT_CHANGED=1
    change "write unit file $UNIT_NAME (root-owned, 0644)"
    if [ "$APPLY" = 1 ]; then
      mkdir -p "$(dirname "$UNIT")"
      cp "$TMP_UNIT" "$UNIT.tmp"
      chmod 644 "$UNIT.tmp"
      mv "$UNIT.tmp" "$UNIT"
    fi
  else
    note "unit file $UNIT_NAME already current"
  fi
fi

# 3. Secret directory and secret files. A path that exists, or is a symlink, is never overwritten or read.
if [ ! -d "$SECRET_DIR" ]; then
  change "create secret directory $SECRET_DIR (0700)"
fi
# The node path is install -d with root:root. A test prefix has no root, and Git Bash on Windows
# cannot chmod a directory that install -d creates, so a prefix takes mkdir and chmod instead.
if [ "$APPLY" = 1 ]; then
  if [ -n "$PREFIX" ]; then
    mkdir -p "$SECRET_DIR" && chmod 700 "$SECRET_DIR"
  else
    install -d -m 0700 -o root -g root "$SECRET_DIR"
  fi
fi
for secret in "$PG_SECRET" "$NATS_SECRET"; do
  name=$(basename "$secret")
  if [ -e "$secret" ] || [ -L "$secret" ]; then
    note "secret file $name present (not touched)"
    mode=$(stat -c '%a' "$secret" 2>/dev/null || echo unknown)
    if [ "$mode" != 600 ]; then
      note "warn: secret file $name is mode $mode, expected 600 (not changed; fix it with chmod 600)"
    fi
  else
    change "create secret file $name (0600, 64 hex characters from 32 random bytes; the value is not printed)"
    if [ "$APPLY" = 1 ]; then
      (
        umask 077
        head -c 32 /dev/urandom | od -An -v -tx1 | tr -d ' \n' >"$secret.tmp"
      )
      chmod 600 "$secret.tmp"
      if [ ! -s "$secret.tmp" ]; then
        rm -f "$secret.tmp"
        die "the random value for $name came out empty; nothing was moved into place"
      fi
      if [ "$(wc -c <"$secret.tmp" | tr -d ' ')" != 64 ]; then
        rm -f "$secret.tmp"
        die "the random value for $name is not 64 characters; nothing was moved into place"
      fi
      mv "$secret.tmp" "$secret"
    fi
  fi
done

# 4. The geldar_helper password, from the PG secret. The migrate verb logs in with the file's password
#    first and runs ALTER ROLE only when that login fails, so a second run changes no pg_authid row.
#    The line is planned whenever the secret exists or would be created.
if [ -e "$PG_SECRET" ] || [ "$APPLY" = 0 ]; then
  change "set geldar_helper password from $(basename "$PG_SECRET") if its login fails (migrate verb, login first)"
  if [ "$APPLY" = 1 ]; then
    node "$MIGRATE_CLI" --set-role-password geldar_helper --password-file "$PG_SECRET"
  fi
fi

# 5. Reload, enable and restart. Enable and restart happen only when the build and the env file both
#    exist. A changed unit that cannot be restarted yet is named in the plan.
READY=0
if [ "$BLOCKED" = 0 ] && [ "$ENV_MISSING" = 0 ]; then READY=1; fi
if [ "$UNIT_CHANGED" = 1 ]; then
  change "systemctl daemon-reload"
  if [ "$APPLY" = 1 ]; then systemctl daemon-reload; fi
fi
ENABLED=0
if systemctl is-enabled --quiet "$UNIT_NAME" 2>/dev/null; then ENABLED=1; fi
if [ "$ENABLED" = 0 ]; then
  if [ "$READY" = 1 ]; then
    change "systemctl enable --now $UNIT_NAME"
    if [ "$APPLY" = 1 ]; then systemctl enable --now "$UNIT_NAME"; fi
  else
    note "enable blocked: $UNIT_NAME needs the helper build and the env file (see above)"
  fi
elif [ "$UNIT_CHANGED" = 1 ]; then
  if [ "$READY" = 1 ]; then
    change "systemctl restart $UNIT_NAME (unit changed)"
    if [ "$APPLY" = 1 ]; then systemctl restart "$UNIT_NAME"; fi
  else
    note "restart needed: $UNIT_NAME (unit changed; not restarted: the helper build or the env file is missing)"
  fi
else
  note "unit $UNIT_NAME already enabled"
fi

# 6. Summary.
GATES=""
if [ "$BLOCKED" = 1 ]; then GATES="; blocked on the build"; fi
if [ "$ENV_MISSING" = 1 ]; then GATES="$GATES; enable blocked on the env file"; fi
if [ "$APPLY" = 1 ]; then
  note "apply summary: $CHANGES change(s) made$GATES"
else
  note "dry run summary: $CHANGES change(s) planned$GATES. Run with --apply to make them."
fi
