#!/bin/sh
# Checks the lock of our plugin jars (plugin/plugin-jars.lock, GE-01a) against the artifact that CI published (G1-01).
#   deploy/genesis/verify-plugin-lock.sh <artifact-dir> <lock-file> [--allow-pending]
# <artifact-dir> is the plugin-jars artifact (see verify-plugin-jars.sh). The lock has one `<64 lowercase hex>  <file name>`
# line per jar, the plugin-jars.sha256 format, and one header line: `# source commit: <40 lowercase hex>` or
# `# source commit: PENDING`. The commit is informational: it names the commit whose build produced the digests, and it is
# not compared with the commit of the artifact (plugin-jars.sha256 names that one). A PENDING lock is refused unless
# --allow-pending is given; that flag admits only the PENDING header, the digests are checked either way. Jar names must match ^[A-Za-z0-9._-]+$. The lock, plugin-jars.sha256 and the
# jars in the directory must name the same jars, and every jar must hash to its locked digest. Exit 0 when they agree; 1 on
# a mismatch, a missing or extra jar, or a refused PENDING lock; 2 on a usage or format error.
set -eu

usage() {
  echo "usage: verify-plugin-lock.sh <artifact-dir> <lock-file> [--allow-pending]" >&2
  exit 2
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  usage
fi
dir=$1
lock=$2
allow_pending=0
if [ "$#" -eq 3 ]; then
  if [ "$3" != "--allow-pending" ]; then
    usage
  fi
  allow_pending=1
fi
if [ ! -d "$dir" ] || [ ! -f "$lock" ]; then
  usage
fi
sums="$dir/plugin-jars.sha256"
if [ ! -f "$sums" ]; then
  echo "missing plugin-jars.sha256 in the artifact dir" >&2
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
  case "$1" in
    *"  "*) ;;
    *) return 1 ;;
  esac
  hex=${1%%  *}
  name=${1#*  }
  [ "${#hex}" -eq 64 ] || return 1
  case "$hex" in
    *[!0-9a-f]*) return 1 ;;
  esac
  case "$name" in
    '') return 1 ;;
    *[!A-Za-z0-9._-]*) return 1 ;;
  esac
  return 0
}

# Sets $pairs (the sorted `<sha256>  <name>` lines of $1) and $names (the jar names, space-separated). Exits 2 on a malformed
# or duplicate line; $2 names the file in the message.
read_pairs() {
  pairs=""
  names=""
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    if ! valid_line "$line"; then
      echo "malformed line in $2" >&2
      exit 2
    fi
    name=${line#*  }
    case " $names " in
      *" $name "*)
        echo "duplicate jar name in $2" >&2
        exit 2
        ;;
    esac
    names="$names $name"
    pairs="$pairs$line
"
  done <"$1"
  pairs=$(printf '%s' "$pairs" | sort)
}

commit_lines=$(grep -c '^# source commit: ' "$lock" || true)
if [ "$commit_lines" != 1 ]; then
  echo "lock file needs exactly one '# source commit:' line" >&2
  exit 2
fi
commit_line=$(grep '^# source commit: ' "$lock")
commit=${commit_line#'# source commit: '}
case "$commit" in
  PENDING)
    if [ "$allow_pending" -ne 1 ]; then
      echo "lock is PENDING: no source commit yet; pass --allow-pending to check it" >&2
      exit 1
    fi
    echo "note: lock is PENDING"
    ;;
  *)
    if [ "${#commit}" -ne 40 ]; then
      echo "lock source commit must be 40 lowercase hex or PENDING" >&2
      exit 2
    fi
    case "$commit" in
      *[!0-9a-f]*)
        echo "lock source commit must be 40 lowercase hex or PENDING" >&2
        exit 2
        ;;
    esac
    ;;
esac

read_pairs "$lock" "lock file"
lock_pairs=$pairs
lock_names=$names
if [ -z "$lock_names" ]; then
  echo "lock file lists no jars" >&2
  exit 2
fi
read_pairs "$sums" "plugin-jars.sha256"
sums_names=$names

status=0
if [ "$lock_pairs" != "$pairs" ]; then
  echo "plugin-jars.sha256 does not list the same jars and digests as the lock" >&2
  status=1
fi
# The lock's source commit is informational: it is not compared with the built-from line of plugin-jars.sha256. A lock cannot
# name the commit that contains it, so the build being verified may come from another commit with the same digests.
for name in $sums_names; do
  case " $lock_names " in
    *" $name "*) ;;
    *) echo "extra jar, not in the lock: $name" >&2; status=1 ;;
  esac
done
for name in $lock_names; do
  case " $sums_names " in
    *" $name "*) ;;
    *) echo "jar missing from plugin-jars.sha256: $name" >&2; status=1 ;;
  esac
done

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  want=${line%%  *}
  name=${line#*  }
  if [ ! -f "$dir/$name" ]; then
    echo "missing jar: $name" >&2
    status=1
    continue
  fi
  actual=$(sha256_of "$dir/$name")
  if [ "$actual" != "$want" ]; then
    echo "digest mismatch: $name (locked $want, got $actual)" >&2
    status=1
  else
    echo "ok: $name"
  fi
done <"$lock"

# Every entry in the directory, dot-files and any case included, must be plugin-jars.sha256 or a locked jar name. Each name is
# compared with an exact test, so a file name that holds two names does not match either of them.
for entry in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
  if [ ! -e "$entry" ] && [ ! -L "$entry" ]; then
    continue
  fi
  base=${entry##*/}
  if [ "$base" = plugin-jars.sha256 ]; then
    continue
  fi
  found=0
  for locked in $lock_names; do
    if [ "$base" = "$locked" ]; then
      found=1
    fi
  done
  if [ "$found" -ne 1 ]; then
    echo "unexpected entry in the artifact dir, not plugin-jars.sha256 or a locked jar" >&2
    status=1
  fi
done

exit "$status"
