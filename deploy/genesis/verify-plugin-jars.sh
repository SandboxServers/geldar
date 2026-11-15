#!/bin/sh
# Checks the plugin jars that CI published (G1-01) against the digests in plugin-jars.sha256.
#   deploy/genesis/verify-plugin-jars.sh <dir>
# <dir> holds geldar-core.jar, geldar-velocity-identity.jar and plugin-jars.sha256. The sha256 file has one line per jar in
# the sha256sum format, `<64 lowercase hex>  <file name>`; lines starting with `#` are comments. Both jars must be listed
# and present. Exit 0 when every digest matches; 1 on a digest mismatch or a missing jar; 2 on a usage or format error.
set -eu

REQUIRED_JARS="geldar-core.jar geldar-velocity-identity.jar"

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo "usage: verify-plugin-jars.sh <dir>" >&2
  exit 2
fi
dir=$1
sums="$dir/plugin-jars.sha256"
if [ ! -f "$sums" ]; then
  echo "missing $sums" >&2
  exit 2
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    out=$(sha256sum "$1")
  else
    out=$(shasum -a 256 "$1")
  fi
  # coreutils prefixes the line with a backslash when the file name holds a backslash (Windows paths under Git's sh).
  hash=${out%% *}
  printf '%s\n' "${hash#\\}"
}

# A line is `<64 lowercase hex>  <file name>`: exactly two spaces, then a plain name. Shell patterns only, no forks.
valid_line() {
  hex=${1%%  *}
  name=${1#*  }
  case "$1" in
    *"  "*) ;;
    *) return 1 ;;
  esac
  [ "${#hex}" -eq 64 ] || return 1
  case "$hex" in
    *[!0-9a-f]*) return 1 ;;
  esac
  case "$name" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  return 0
}

status=0
seen=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  if ! valid_line "$line"; then
    echo "malformed line in $sums" >&2
    exit 2
  fi
  expected=${line%%  *}
  name=${line#*  }
  case " $REQUIRED_JARS " in
    *" $name "*) ;;
    *) echo "unexpected jar name in $sums: $name" >&2; exit 2 ;;
  esac
  seen="$seen $name"
  if [ ! -f "$dir/$name" ]; then
    echo "missing jar: $name" >&2
    status=1
    continue
  fi
  actual=$(sha256_of "$dir/$name")
  if [ "$actual" != "$expected" ]; then
    echo "digest mismatch: $name (expected $expected, got $actual)" >&2
    status=1
  else
    echo "ok: $name"
  fi
done <"$sums"

for jar in $REQUIRED_JARS; do
  case " $seen " in
    *" $jar "*) ;;
    *) echo "not listed in $sums: $jar" >&2; exit 2 ;;
  esac
done
exit "$status"
