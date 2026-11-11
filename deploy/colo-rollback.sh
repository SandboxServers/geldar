#!/bin/sh
# Re-applies the previous release recorded by colo-up.sh (decision 0084). It pulls nothing: --pull never.
# The release it leaves in place becomes the previous one, so a second rollback goes forward again.
# Touches only the geldar-colo project. Never runs `down -v`.
set -eu
. "$(dirname "$0")/common.sh"

plan_header
need docker
PREVIOUS=$STATE_DIR/previous.env
[ -f "$PREVIOUS" ] || die "no previous release recorded in $STATE_DIR; nothing to roll back to"
check_prereqs
check_secrets
load_release "$PREVIOUS"
check_merged_config
if [ "$DRY_RUN" != 1 ]; then
  (
    umask 077
    cp "$PREVIOUS" "$STATE_DIR/rollback.new" &&
      cp "$STATE_DIR/current.env" "$STATE_DIR/previous.env.new" &&
      mv "$STATE_DIR/previous.env.new" "$PREVIOUS" &&
      mv "$STATE_DIR/rollback.new" "$STATE_DIR/current.env" &&
      cp "$STATE_DIR/current.env" "$RELEASE_FILE"
  ) || die "cannot write the rollback record in $STATE_DIR; nothing rolled back"
else
  say "dry-run, not run: swap previous.env and current.env, and update $RELEASE_FILE"
fi
act dc up -d --wait --pull never
say "rolled back: project $PROJECT runs the previous release (no volume was removed)"
