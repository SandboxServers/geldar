#!/bin/sh
# Creates the Colo secret files that are missing, with random values from /dev/urandom (decision 0084).
# It never overwrites a file, never prints a value (it prints file names only), and writes mode 0600 in a 0700
# directory, owned by GELDAR_SERVICE_UID. Run as root on the node: sudo sh deploy/gen-secrets.sh (root hands the files
# to GELDAR_SERVICE_UID). Any other account must already be that uid, or the script refuses before it creates anything.
# nats-body.txt is the Body's NATS password. It matches the NATS server only with the auth overlay, whose server config
# is written by `geldar.ps1 shard nats-auth` (PowerShell only, for now; see the P1-C1-04 worknote). Until a shell
# equivalent exists, the open-NATS default does not read it.
# The files this script can create. The list of secrets the deploy requires is not kept here: it comes from the
# merged compose config (common.sh, check_secrets). The NATS files and nats-auth.conf are never created here.
GENERATED="postgres.txt rcon.txt velocity-forwarding.txt nats-body.txt postgres-mcp.txt postgres-glass.txt postgres-register.txt register-pepper.txt mcp-token-pepper.txt"
set -eu
. "$(dirname "$0")/common.sh"

need od
# The uid check comes before anything is created. Root (sudo) creates the files and then hands them to
# GELDAR_SERVICE_UID. Any other account must already be that uid, so the files it creates are the containers' own.
case $GELDAR_SERVICE_UID in
  '' | *[!0-9]*) die "GELDAR_SERVICE_UID must be a number (the containers' uid, default 1000)" ;;
esac
[ "$GELDAR_SERVICE_UID" -ne 0 ] || die "GELDAR_SERVICE_UID is 0; the containers must not run as root"
runner=$(id -u) || die "cannot read the uid of this account"
if [ "$runner" -ne 0 ] && [ "$runner" -ne "$GELDAR_SERVICE_UID" ]; then
  die "run as root (sudo sh deploy/gen-secrets.sh) or as the GELDAR_SERVICE_UID account (uid $GELDAR_SERVICE_UID); this account is uid $runner"
fi
umask 077
mkdir -p "$GELDAR_SECRETS_DIR" || die "cannot create $GELDAR_SECRETS_DIR"
chmod 700 "$GELDAR_SECRETS_DIR" || die "cannot set mode 0700 on $GELDAR_SECRETS_DIR"
CREATED=
for f in $GENERATED; do
  p=$GELDAR_SECRETS_DIR/$f
  if [ -e "$p" ]; then
    say "kept (exists): $f"
    continue
  fi
  value=$(od -An -N 32 -tx1 /dev/urandom | tr -d ' \n')
  # set -C: the redirection fails if the file appeared meanwhile, so nothing is ever overwritten.
  (
    set -C
    printf '%s\n' "$value" >"$p"
  ) || die "cannot create $f"
  say "created: $f"
  CREATED="$CREATED $f"
done
if [ "$runner" -eq 0 ]; then
  chown "$GELDAR_SERVICE_UID" "$GELDAR_SECRETS_DIR" || die "cannot give $GELDAR_SECRETS_DIR to uid $GELDAR_SERVICE_UID"
  for f in $CREATED; do
    chown "$GELDAR_SERVICE_UID" "$GELDAR_SECRETS_DIR/$f" || die "cannot give $f to uid $GELDAR_SERVICE_UID"
  done
  say "owner: $GELDAR_SECRETS_DIR and the created files are uid $GELDAR_SERVICE_UID"
fi
