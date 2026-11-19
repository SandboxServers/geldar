#!/bin/sh
# Creates the Colo secret files that are missing, with random values from /dev/urandom (decision 0084).
# The names come from a list file, one file name per line (# starts a comment): deploy/genesis/secret-names.list by
# default, or GELDAR_SECRETS_LIST for another environment. It never overwrites a file and never changes a value. It prints
# file names only, as created, kept (exists), wrong-owner or wrong-mode; it never prints a value.
# Run as root on the node: sudo sh deploy/gen-secrets.sh (root creates the files at mode 0600 in a 0700 directory owned by
# GELDAR_SERVICE_UID, and fixes the owner or mode of an existing file). Any other account must already be that uid, or the
# script refuses before it creates anything. A wrong owner or mode that this account cannot fix makes the script exit
# non-zero, after the report. Compose ignores uid and mode on file: secrets, so the owner and mode are set here.
# nats-body.txt is the Body's NATS password. It matches the NATS server only with the auth overlay, whose server config
# is written by `geldar.ps1 shard nats-auth` (PowerShell only, for now; see the P1-C1-04 worknote). Until a shell
# equivalent exists, the open-NATS default does not read it.
# register-session-key.txt is the register service's session key (>= 32 characters), shared with Glass by the Kino session
# overlay. register-ms-secret.txt (the Microsoft/Entra client secret) is owner-provided: it is never generated here.
# The NATS server config and the NATS per-role passwords (other than the two in the list) are never created here.
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
# The names to create: one per line from the list file. A name is a bare file name, checked before anything is created.
SECRETS_LIST=${GELDAR_SECRETS_LIST:-$DEPLOY_DIR/genesis/secret-names.list}
[ -f "$SECRETS_LIST" ] || die "secret name list not found: $SECRETS_LIST"
GENERATED=
while IFS= read -r line || [ -n "$line" ]; do
  case $line in
    '' | '#'*) continue ;;
  esac
  printf '%s' "$line" | grep -Eq '^[a-z0-9][a-z0-9-]*\.txt$' || die "bad secret name in $SECRETS_LIST (a bare file name such as postgres.txt)"
  case " $GENERATED " in
    *" $line "*) die "secret name listed twice in $SECRETS_LIST: $line" ;;
  esac
  GENERATED="$GENERATED $line"
done <"$SECRETS_LIST"
[ -n "$GENERATED" ] || die "secret name list is empty: $SECRETS_LIST"
umask 077
mkdir -p "$GELDAR_SECRETS_DIR" || die "cannot create $GELDAR_SECRETS_DIR"
chmod 700 "$GELDAR_SECRETS_DIR" || die "cannot set mode 0700 on $GELDAR_SECRETS_DIR"
WRONG=
if [ "$runner" -ne 0 ]; then
  o=$(stat -c %u "$GELDAR_SECRETS_DIR") || die "cannot stat the owner of $GELDAR_SECRETS_DIR"
  if [ "$o" != "$GELDAR_SERVICE_UID" ]; then
    say "wrong-owner: the secrets directory (not root, so not changed)"
    WRONG="$WRONG directory"
  fi
fi

# An existing file is kept: its value is never read or written. Its owner and mode are checked; root sets them
# (owner GELDAR_SERVICE_UID, mode 0600), any other account reports them and the script fails at the end.
keep_file() {
  o=$(stat -c %u "$2") || die "cannot stat the owner of $1"
  if [ "$o" != "$GELDAR_SERVICE_UID" ]; then
    if [ "$runner" -eq 0 ]; then
      chown "$GELDAR_SERVICE_UID" "$2" || die "cannot give $1 to uid $GELDAR_SERVICE_UID"
      say "kept (exists), owner fixed: $1"
    else
      say "wrong-owner: $1 (kept; this account cannot change its owner)"
      WRONG="$WRONG $1"
    fi
  else
    say "kept (exists): $1"
  fi
  m=$(stat -c %a "$2") || die "cannot stat the mode of $1"
  case $m in
    600 | 400 | 0600 | 0400) ;;
    *)
      if [ "$runner" -eq 0 ]; then
        chmod 600 "$2" || die "cannot set mode 0600 on $1"
        say "kept (exists), mode fixed to 0600: $1"
      else
        say "wrong-mode: $1 has mode $m (kept; this account cannot change it)"
        WRONG="$WRONG $1"
      fi
      ;;
  esac
}

CREATED=
for f in $GENERATED; do
  p=$GELDAR_SECRETS_DIR/$f
  # create-if-missing guard: an existing file is never recreated (the second run changes nothing).
  if [ -e "$p" ]; then
    keep_file "$f" "$p"
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
if [ -n "$WRONG" ]; then
  die "wrong owner or mode that this account cannot fix (run as root to fix:$WRONG); no value was printed or changed"
fi
