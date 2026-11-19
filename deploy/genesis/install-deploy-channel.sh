#!/bin/sh
# Installs the forced-command deploy channel on a node (G3-02, GE-04). Bootstrap (G3-01) runs this; nothing here runs on a
# node by hand from the repo. It places the wrapper (as the channel, mode 0755), the sudoers fragment (0440, checked with
# visudo when present) and the colo-env.sh template in the operator home (only when that file does not exist yet).
# Idempotent: a file already identical is left alone, and a second run changes nothing. The authorized_keys line is not
# installed here: authorized-keys.template is filled by bootstrap with the per-environment public key.
# Usage: GELDAR_OPERATOR_USER=<account> sh install-deploy-channel.sh
# Env: GELDAR_DEPLOY_DEST, a root prefix for tests (empty on a node, which then needs root); GELDAR_OPERATOR_HOME
#   (default /home/<account>).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DEST=${GELDAR_DEPLOY_DEST:-}
OP=${GELDAR_OPERATOR_USER:-}
OP_HOME=${GELDAR_OPERATOR_HOME:-/home/$OP}
WORK=$(mktemp -d) || exit 1
trap 'rm -rf "$WORK"' EXIT

die() {
  echo "install-deploy-channel: $*" >&2
  exit 1
}

case $OP in
  '' | [!a-z_]* | *[!a-z0-9_-]*) die "GELDAR_OPERATOR_USER must be a lowercase account name" ;;
esac
if [ -z "$DEST" ] && [ "$(id -u)" -ne 0 ]; then die "run as root (GELDAR_DEPLOY_DEST is for tests only)"; fi

# place SRC DST MODE: copies SRC to DST unless DST already holds the same bytes. The copy goes through a temp file and a rename.
place() {
  src=$1
  dst=$DEST$2
  mode=$3
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    echo "unchanged $2"
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst.new"
  chmod "$mode" "$dst.new"
  mv -f "$dst.new" "$dst"
  echo "installed $2"
}

place "$HERE/geldar-deploy-channel.sh" /usr/local/libexec/geldar-deploy/channel 0755

sed "s/@OPERATOR@/$OP/g" "$HERE/geldar-deploy.sudoers.template" >"$WORK/sudoers"
if command -v visudo >/dev/null 2>&1; then
  visudo -cf "$WORK/sudoers" >/dev/null || die "the sudoers fragment does not check; nothing was installed under sudoers"
fi
place "$WORK/sudoers" /etc/sudoers.d/geldar-deploy 0440

# The env file is the node's own: it is copied from the template only when absent, and never overwritten.
if [ -e "$DEST$OP_HOME/colo-env.sh" ]; then
  echo "kept $OP_HOME/colo-env.sh (exists)"
else
  place "$HERE/colo-env.sh.template" "$OP_HOME/colo-env.sh" 0600
  if [ -z "$DEST" ]; then chown "$OP" "$OP_HOME/colo-env.sh"; fi
fi
