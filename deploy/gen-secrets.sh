#!/bin/sh
# Creates the Colo secret files that are missing, with random values from /dev/urandom (decision 0084).
# It never overwrites a file, never prints a value (it prints file names only), and writes mode 0600 in a 0700
# directory. Run as root on the node: sudo sh deploy/gen-secrets.sh
# nats-body.txt is the Body's NATS password. It matches the NATS server only with the auth overlay, whose server config
# is written by `geldar.ps1 shard nats-auth` (PowerShell only, for now; see the P1-C1-04 worknote). Until a shell
# equivalent exists, the open-NATS default does not read it.
set -eu
. "$(dirname "$0")/common.sh"

need od
umask 077
mkdir -p "$GELDAR_SECRETS_DIR" || die "cannot create $GELDAR_SECRETS_DIR"
chmod 700 "$GELDAR_SECRETS_DIR" || die "cannot set mode 0700 on $GELDAR_SECRETS_DIR"
for f in $SECRET_FILES; do
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
done
