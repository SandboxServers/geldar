#!/bin/sh
# Places the plugin jars that CI published (G1-01, locked by GE-01a) into a host's plugin directory, and keeps the jar it
# replaces as a rollback copy. It restarts nothing.
#   deploy/genesis/place-plugin-jars.sh <artifact-dir> <lock-file> <target-dir> [--allow-pending]
#   deploy/genesis/place-plugin-jars.sh --rollback <target-dir>
# Place mode runs verify-plugin-lock.sh first and changes nothing when it fails. A locked jar whose target copy already has
# the locked sha256 is left alone (`unchanged: <name>`) and, when the run places a jar, its old `<name>.prev`, if any, is
# removed, so a later rollback undoes only the last placement. Every other jar is staged as `.<name>.XXXXXX` in the target dir before any jar is renamed;
# each staged copy is re-hashed against the lock. Then the old jar moves to `<name>.prev` (replacing an older .prev) and the
# staged file moves onto `<name>` (`placed: <name>`). Rollback mode moves each `<name>.prev` (only names ending in `.jar.prev`)
# back over `<name>`, keeping the jar it replaces as `<name>.rolled-back` (`restored: <name>`). Exit 0 on success; 1 when
# verify fails, a slot is refused, a staged copy does not match, or there is no .prev to roll back to; 2 on a usage error, a
# missing or symlinked target dir, or an unsafe name.
set -eu

here=$(dirname "$0")
tmps=""

usage() {
  echo "usage: place-plugin-jars.sh <artifact-dir> <lock-file> <target-dir> [--allow-pending]" >&2
  echo "       place-plugin-jars.sh --rollback <target-dir>" >&2
  exit 2
}

# A jar name matches ^[A-Za-z0-9._-]+$ and does not start with a dot (so no `.`, `..` or hidden names).
safe_name() {
  case "$1" in
    ''|.*) return 1 ;;
    *[!A-Za-z0-9._-]*) return 1 ;;
  esac
  return 0
}

# Exits 2 unless the target dir exists and is not a symbolic link.
check_target() {
  if [ -L "$1" ]; then
    echo "target dir is a symbolic link, refusing: $1" >&2
    exit 2
  fi
  if [ ! -d "$1" ]; then
    echo "target dir does not exist: $1" >&2
    exit 2
  fi
}

# Exits 1 when a jar slot or its .prev is a symbolic link or not a regular file: the script never acts through a link.
check_slot() {
  if [ -L "$1" ]; then
    echo "refusing a symbolic link in the target dir: ${1##*/}" >&2
    exit 1
  fi
  if [ -e "$1" ] && [ ! -f "$1" ]; then
    echo "refusing a non-file in the target dir: ${1##*/}" >&2
    exit 1
  fi
}

# True for a `<name>.jar.prev` path: the only .prev files that rollback manages.
is_jar_prev() {
  case "${1##*/}" in
    *.jar.prev) return 0 ;;
  esac
  return 1
}

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

# Removes the staged files that were not renamed onto a jar (on any exit).
cleanup() {
  printf '%s' "$tmps" | while IFS= read -r p; do
    if [ -n "$p" ]; then
      rm -f -- "$p"
    fi
  done
  return 0
}

rollback() {
  t=$1
  check_target "$t"
  found=0
  # Every check runs before the first move, so a refused name or slot changes nothing.
  for prev in "$t"/*.prev; do
    if [ ! -e "$prev" ] && [ ! -L "$prev" ]; then
      continue
    fi
    if ! is_jar_prev "$prev"; then
      continue
    fi
    found=1
    base=${prev##*/}
    name=${base%.prev}
    if ! safe_name "$name"; then
      echo "unsafe name refused: $base" >&2
      exit 2
    fi
    check_slot "$prev"
    check_slot "$t/$name"
    check_slot "$t/$name.rolled-back"
  done
  if [ "$found" -eq 0 ]; then
    echo "no .prev copy in the target dir, nothing to roll back" >&2
    exit 1
  fi
  for prev in "$t"/*.prev; do
    if [ ! -e "$prev" ] && [ ! -L "$prev" ]; then
      continue
    fi
    if ! is_jar_prev "$prev"; then
      continue
    fi
    name=${prev##*/}
    name=${name%.prev}
    jar="$t/$name"
    if [ -e "$jar" ]; then
      mv -f "$jar" "$jar.rolled-back"
    fi
    mv -f "$prev" "$jar"
    echo "restored: $name"
  done
}

place() {
  artifact=$1
  lock=$2
  t=$3
  allow=$4
  check_target "$t"
  rc=0
  # $allow is empty or --allow-pending; it is unquoted on purpose so that an empty value passes no argument.
  sh "$here/verify-plugin-lock.sh" "$artifact" "$lock" $allow || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "refusing: verify-plugin-lock.sh exited $rc; the target dir is unchanged" >&2
    exit "$rc"
  fi

  trap cleanup EXIT
  # Pass 1: check every slot and collect the jars that differ. Nothing is written in this pass.
  changed=""
  unchanged=""
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    name=${line#*  }
    want=${line%%  *}
    check_slot "$t/$name"
    check_slot "$t/$name.prev"
    if [ -f "$t/$name" ] && [ "$(sha256_of "$t/$name")" = "$want" ]; then
      echo "unchanged: $name"
      unchanged="$unchanged $name"
      continue
    fi
    changed="$changed $name"
  done <"$lock"

  # Pass 2: stage every changed jar in the target dir (same filesystem), before any rename.
  staged=""
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    want=${line%%  *}
    name=${line#*  }
    case " $changed " in
      *" $name "*) ;;
      *) continue ;;
    esac
    tmp=$(mktemp "$t/.$name.XXXXXX")
    tmps="$tmps$tmp
"
    staged="$staged$name $tmp
"
    cp "$artifact/$name" "$tmp"
    # Re-hash the copy: the artifact may have changed since verify ran. The message names the jar only.
    if [ "$(sha256_of "$tmp")" != "$want" ]; then
      echo "refusing: the staged copy of $name does not match its locked digest; the target dir is unchanged" >&2
      exit 1
    fi
    chmod 0644 "$tmp"
  done <"$lock"

  # Pass 3: the renames. A failure after the first rename is not undone; pass 1 and pass 2 catch the usual causes.
  while IFS= read -r entry; do
    if [ -z "$entry" ]; then
      continue
    fi
    name=${entry%% *}
    tmp=${entry#* }
    if [ -e "$t/$name" ]; then
      mv -f "$t/$name" "$t/$name.prev"
    fi
    mv -T "$tmp" "$t/$name"
    echo "placed: $name"
  done <<EOF
$staged
EOF
  # An unchanged jar drops its older .prev, so --rollback cannot restore an earlier version of it. A run that placed no
  # jar keeps every .prev, so the last placement stays undoable.
  if [ -n "$changed" ]; then
    for name in $unchanged; do
      rm -f -- "$t/$name.prev"
    done
  fi
}

if [ "${1-}" = --rollback ]; then
  if [ "$#" -ne 2 ]; then
    usage
  fi
  rollback "$2"
  exit 0
fi
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  usage
fi
allow=""
if [ "$#" -eq 4 ]; then
  if [ "$4" != --allow-pending ]; then
    usage
  fi
  allow=--allow-pending
fi
place "$1" "$2" "$3" "$allow"
