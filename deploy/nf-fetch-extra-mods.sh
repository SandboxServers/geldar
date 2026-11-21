#!/bin/sh
# Fetches the NeoForge extra mod jars named in the sources file (compose/neoforge/extra-mods.sources, GE-02c) into a directory, and
# verifies each one against both digests: its sha256 from the pins file (compose/neoforge/extra-mods.pins, keyed by the jar file
# name) and its sha512 from the sources line. Usage: nf-fetch-extra-mods.sh <sources-file> <pins-file> <dest-dir>. POSIX sh.
# A jar already in <dest-dir> that matches both digests prints "unchanged: <jar>" and is not downloaded. Otherwise the jar is
# downloaded to a temp file in <dest-dir>, verified, set to mode 0644 and moved into place with mv -T, then "fetched: <jar>" is printed.
# The first failing line stops the run and the exit status is 1. A refused or failed jar leaves the old file alone and no temp file
# behind. A refusal names the jar only, never its bytes.
set -eu

die() {
  echo "nf-fetch-extra-mods: $*" >&2
  exit 1
}

# digest256 FILE, digest512 FILE: the hex digest of FILE, hashed on stdin like the other jar checks.
digest256() { sha256sum <"$1" | awk '{ print $1 }'; }
digest512() { sha512sum <"$1" | awk '{ print $1 }'; }

if [ "$#" -ne 3 ]; then
  die "usage: nf-fetch-extra-mods.sh <sources-file> <pins-file> <dest-dir>"
fi
sources=$1
pins=$2
dest=$3
[ -f "$sources" ] && [ -r "$sources" ] || die "the sources file is missing or unreadable"
[ -f "$pins" ] && [ -r "$pins" ] || die "the pins file is missing or unreadable"
[ ! -L "$dest" ] || die "the dest dir is a symlink; refusing"
[ -d "$dest" ] || die "the dest dir is missing or not a directory"

# The temp file of the jar being fetched. The exit trap removes it on every refusal and failure.
tmp=""
trap '[ -z "$tmp" ] || rm -f "$tmp"' EXIT

while read -r jar url sha512 extra || [ -n "$jar" ]; do
  case $jar in
    '' | '#'*) continue ;;
  esac
  case $jar in
    .* | *[!A-Za-z0-9._-]*) die "a jar name in the sources file is unsafe (letters, digits, dot, underscore, dash; no leading dot); refusing" ;;
  esac
  [ -z "$extra" ] || die "the sources line for $jar has more than three fields; refusing"
  case $url in
    https://*) ;;
    *) die "the sources line for $jar is not an https URL; refusing" ;;
  esac
  case $url in
    */"$jar") ;;
    *) die "the sources line for $jar does not end its URL in /$jar; refusing" ;;
  esac
  case $sha512 in
    UNSET | '') die "the sha512 for $jar is UNSET in the sources file; refusing" ;;
  esac
  printf '%s\n' "$sha512" | grep -Eq '^[0-9a-f]{128}$' || die "the sha512 for $jar is not 128 lowercase hex; refusing"
  pin=$(awk -v j="$jar" '$0 !~ /^#/ && NF > 0 && $3 == j { n++; if (n == 1) p = $2 } END { if (n == 1) print p }' "$pins")
  printf '%s\n' "$pin" | grep -Eq '^[0-9a-f]{64}$' || die "$jar has no single sha256 pin in the pins file; refusing"

  target=$dest/$jar
  if [ -f "$target" ] && [ ! -L "$target" ] && [ "$(digest256 "$target")" = "$pin" ] && [ "$(digest512 "$target")" = "$sha512" ]; then
    echo "unchanged: $jar"
    continue
  fi

  tmp=$(mktemp "$dest/.nf-fetch.XXXXXX")
  if ! curl -fsS --proto '=https' --proto-redir '=https' --max-redirs 5 --max-time 120 -o "$tmp" "$url"; then
    die "the download of $jar failed; the old file is kept"
  fi
  if [ "$(digest256 "$tmp")" != "$pin" ] || [ "$(digest512 "$tmp")" != "$sha512" ]; then
    rm -f "$tmp"
    tmp=""
    die "$jar does not match its pins (sha256 in the pins file, sha512 in the sources file); refused, the old file is kept"
  fi
  chmod 0644 "$tmp"
  mv -T "$tmp" "$target"
  tmp=""
  echo "fetched: $jar"
done <"$sources"
