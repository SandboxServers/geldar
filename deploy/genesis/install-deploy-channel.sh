#!/bin/sh
# Installs the forced-command deploy channel on a node (G3-02, GE-04). Bootstrap (G3-01) runs this; nothing here runs on a
# node by hand from the repo. It creates the libexec, allow-list and log directories (root:root 0755) and places:
#   the wrapper            /usr/local/libexec/geldar-deploy/channel    root:root 0755
#   the sudoers fragment   /etc/sudoers.d/geldar-deploy                root:root 0440, checked with visudo
#   the operator env file  <operator home>/colo-env.sh                 operator 0600, created only when absent
#   the channel log and lock, owned by the operator, 0600
# It FAILS when visudo is absent unless --skip-visudo is given, and when visudo rejects the fragment. It refuses a symlinked
# *.yaml in the allow-list and a symlinked env file.
# Idempotent: an identical file with the right mode and owner is left alone (unchanged). Identical bytes with a drifted mode
# or owner are repaired (repaired); the env file's contents are never changed. A file that did not exist is installed.
# Root-owned destinations are staged next to the destination and moved into place with mv -T (a same-filesystem rename).
# The operator's env file is built in the root-owned work dir and moved in. No chown or chmod is run by path inside an
# operator-writable directory.
# The authorized_keys line is not installed here: authorized-keys.template is filled by bootstrap with the per-environment key.
# Usage: GELDAR_OPERATOR_USER=<account> sh install-deploy-channel.sh [--skip-visudo]
# Env: GELDAR_DEPLOY_DEST, a root prefix for tests (empty on a node, which then needs root); GELDAR_OPERATOR_HOME
#   (default /home/<account>).
set -eu
IFS=' '
unset BASH_ENV ENV
SKIP_VISUDO=
for arg in "$@"; do
  case $arg in
    --skip-visudo) SKIP_VISUDO=1 ;;
    *) echo "install-deploy-channel: unknown argument" >&2; exit 1 ;;
  esac
done
HERE=$(cd "$(dirname "$0")" && pwd)
DEST=${GELDAR_DEPLOY_DEST:-}
OP=${GELDAR_OPERATOR_USER:-}
OP_HOME=${GELDAR_OPERATOR_HOME:-/home/$OP}
ENVS=/var/lib/geldar-deploy/envs
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

# mkdir_owned DIR: root:root 0755 (created or repaired). Under a test prefix there is no owner flag: the tests run unprivileged.
mkdir_owned() {
  if [ -z "$DEST" ]; then
    install -d -m 0755 -o root -g root "$DEST$1"
  else
    install -d -m 0755 "$DEST$1"
  fi
}

# attrs_ok PATH MODE OWNER: 0 when the mode is MODE and, on a node, the owner is OWNER (user:group).
# stat prints the mode without its leading zero (644, not 0644), so MODE is compared with that zero removed.
attrs_ok() {
  [ "$(stat -c %a "$1")" = "${2#0}" ] || return 1
  [ -n "$DEST" ] || [ "$(stat -c %U:%G "$1")" = "$3" ]
}

# fix_existing PATH MODE OWNER LABEL: a file that is kept (never rewritten): only its mode and owner are repaired. The repair
# copies it into the work dir (cp -P copies a symlink as a link, never its target), sets owner and mode there, and renames
# the copy over the file. No chown or chmod runs by path in the operator's directory.
fix_existing() {
  if [ -L "$1" ]; then die "$4 is a symlink; refused"; fi
  if [ ! -f "$1" ]; then die "$4 is not a regular file; refused"; fi
  if attrs_ok "$1" "$2" "$3"; then
    echo "kept $4"
    return 0
  fi
  cp -P "$1" "$WORK/keep" || die "cannot read $4"
  if [ -L "$WORK/keep" ]; then die "$4 changed while it was read; refused"; fi
  chown "$3" "$WORK/keep"
  chmod "$2" "$WORK/keep"
  mv -T -f "$WORK/keep" "$1"
  echo "repaired $4"
}

# fix_in_place PATH MODE OWNER LABEL: repairs the mode and owner of a file kept in place, so its inode is kept (a running deploy
# holds flock on it). Only for files in the root-owned log directory, which the operator cannot rename within, so chown and
# chmod by path are safe there.
fix_in_place() {
  if [ -L "$1" ]; then die "$4 is a symlink; refused"; fi
  if [ ! -f "$1" ]; then die "$4 is not a regular file; refused"; fi
  if attrs_ok "$1" "$2" "$3"; then
    echo "kept $4"
    return 0
  fi
  chown "$3" "$1"
  chmod "$2" "$1"
  echo "repaired $4"
}

# place SRC LABEL MODE OWNER STAGE: installs SRC at DEST+LABEL. The file is built by install (owner and mode set there) and
# moved over the destination with mv -T. STAGE=root stages it next to the destination, so the move is a same-filesystem
# rename; STAGE=work stages it in the root-owned work dir (the operator's env file only). A file that did not exist is
# installed; identical bytes with drifted attributes are repaired.
place() {
  src=$1
  dst=$DEST$2
  mode=$3
  owner=$4
  stage=$5
  same=no
  if [ -f "$dst" ] && [ ! -L "$dst" ] && cmp -s "$src" "$dst"; then same=yes; fi
  if [ "$same" = yes ] && attrs_ok "$dst" "$mode" "$owner"; then
    echo "unchanged $2"
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if [ "$stage" = work ]; then
    tmp=$(mktemp "$WORK/place.XXXXXX") || die "cannot create a staging file for $2"
  else
    tmp=$(mktemp "$dst.XXXXXX") || die "cannot create a staging file for $2"
  fi
  if [ -z "$DEST" ]; then
    install -m "$mode" -o "${owner%%:*}" -g "${owner#*:}" "$src" "$tmp" || { rm -f "$tmp"; die "cannot install $2"; }
  else
    install -m "$mode" "$src" "$tmp" || { rm -f "$tmp"; die "cannot install $2"; }
  fi
  mv -T -f "$tmp" "$dst"
  if [ "$same" = yes ]; then echo "repaired $2"; else echo "installed $2"; fi
}

mkdir_owned /usr/local/libexec/geldar-deploy
mkdir_owned /var/lib/geldar-deploy
mkdir_owned "$ENVS"
if [ -n "$(find "$DEST$ENVS" -maxdepth 1 -name '*.yaml' -type l)" ]; then
  die "a symlinked *.yaml is in the allow-list; refused"
fi

place "$HERE/geldar-deploy-channel.sh" /usr/local/libexec/geldar-deploy/channel 0755 root:root root

sed "s/@OPERATOR@/$OP/g" "$HERE/geldar-deploy.sudoers.template" >"$WORK/sudoers"
if command -v visudo >/dev/null 2>&1; then
  visudo -cf "$WORK/sudoers" >/dev/null || die "the sudoers fragment does not check; nothing was installed under sudoers"
elif [ -z "$SKIP_VISUDO" ]; then
  die "visudo is absent, so the sudoers fragment cannot be checked; install sudo or pass --skip-visudo"
fi
place "$WORK/sudoers" /etc/sudoers.d/geldar-deploy 0440 root:root root

# The operator's env file is the node's own: copied from the template only when absent, never overwritten.
if [ -e "$DEST$OP_HOME/colo-env.sh" ] || [ -L "$DEST$OP_HOME/colo-env.sh" ]; then
  fix_existing "$DEST$OP_HOME/colo-env.sh" 0600 "$OP:$OP" "$OP_HOME/colo-env.sh"
else
  place "$HERE/colo-env.sh.template" "$OP_HOME/colo-env.sh" 0600 "$OP:$OP" work
fi

# The channel log and lock live in the root-owned log directory; the operator owns those two files. A missing file is
# installed empty; an existing one is kept in place, with only its mode and owner repaired (never replaced: its inode is kept).
: >"$WORK/empty"
for f in channel.log channel.lock; do
  if [ -e "$DEST/var/lib/geldar-deploy/$f" ] || [ -L "$DEST/var/lib/geldar-deploy/$f" ]; then
    fix_in_place "$DEST/var/lib/geldar-deploy/$f" 0600 "$OP:$OP" "/var/lib/geldar-deploy/$f"
  else
    place "$WORK/empty" "/var/lib/geldar-deploy/$f" 0600 "$OP:$OP" root
  fi
done
