#!/bin/sh
# Builds the Colo config bundle (G1-03): one deterministic gzip tar of the files a target needs to run the Colo
# compose stack without a git checkout. The allowlist is deploy/genesis/config-bundle.list (# lines are comments).
#
# Usage: sh deploy/genesis/build-config-bundle.sh <out-dir>
# Writes into <out-dir>: config-bundle.tar.gz, config-bundle.manifest (sha256 and path per file) and
# config-bundle.sha256 (the archive digest). Prints the archive sha256. A listed file that is missing fails the build.
# Determinism: names sorted, mtime 0, owner and group 0 (numeric), and gzip without a name or timestamp (gzip -n).
# Needs GNU tar (Git for Windows' tar on a desktop, tar on Linux) and sha256sum (or shasum).
# The script runs few external commands on purpose: each one costs seconds under Git for Windows' sh.
set -eu

die() {
  echo "build-config-bundle: $*" >&2
  exit 1
}

[ $# -eq 1 ] && [ -n "$1" ] || die "usage: build-config-bundle.sh <out-dir>"
# The output directory in the shell's own absolute form. A drive path (C:/...) in a redirection is not written where it
# says on Git for Windows' sh, so the directory is entered and the shell's pwd is used.
mkdir -p "$1" || die "cannot create $1"
OUT=$(cd "$1" && pwd) || die "cannot enter $1"
case $0 in
  */*) HERE=${0%/*} ;;
  *) HERE=. ;;
esac
cd "$HERE/../.." || die "cannot enter the repo root from $HERE"
ROOT=$PWD
LIST=$ROOT/deploy/genesis/config-bundle.list
[ -f "$LIST" ] || die "cannot read $LIST"

# The digests of the named files, in sha256sum's format (hash, two spaces, path). -t: text mode, so that the coreutils on
# Windows do not print the binary-mode marker ("hash *path").
sha256_files() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -t -- "$@"; else shasum -a 256 -- "$@"; fi
}

# The allowlist, read into the positional parameters (comments and blank lines out). Every path is checked here.
set --
while IFS= read -r p || [ -n "$p" ]; do
  case $p in
    '' | '#'*) continue ;;
    /* | *..* | *[[:space:]]* | *'*'* | *'?'* | *'['*) die "not a plain relative path: $p" ;;
  esac
  [ -f "$ROOT/$p" ] || die "listed file is missing from the tree: $p"
  set -- "$@" "$p"
done <"$LIST"
[ $# -gt 0 ] || die "$LIST lists no files"

TAR=$OUT/.config-bundle.$$.tar
trap 'rm -f "$TAR"' EXIT

# Run from the repo root so the names in the manifest and the archive are the repo paths.
cd "$ROOT"
sha256_files "$@" >"$OUT/config-bundle.manifest" || die "cannot hash the listed files"
# --force-local: a drive-letter path (C:/...) is a file here, not a host:file remote (GNU tar).
tar --force-local --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner --mode='u=rw,go=r' \
  -cf "$TAR" "$@" || die "tar failed"
gzip -n -9 -c "$TAR" >"$OUT/config-bundle.tar.gz" || die "gzip failed"

cd "$OUT" || die "cannot enter $OUT"
sha256_files config-bundle.tar.gz >config-bundle.sha256 || die "cannot digest the archive"
read -r DIGEST _ <config-bundle.sha256
echo "$DIGEST"
