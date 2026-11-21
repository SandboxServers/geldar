#!/bin/sh
# Checks the NeoForge build outputs (the geldar-neoforge mod jar and the ledger mod jar) against the digests in
# neoforge-artifacts.sha256 (GE-02e). Modelled on deploy/genesis/verify-plugin-jars.sh.
#   deploy/genesis/verify-neoforge-artifacts.sh <dir>
# <dir> holds geldar-neoforge.jar, geldar-neoforge-ledger-0.1.0.jar and neoforge-artifacts.sha256. The sha256 file has one line
# per jar in the sha256sum format, `<64 lowercase hex>  <file name>`; lines starting with `#` are comments. Both jars must be
# listed and present, and no other jar may sit in <dir>. Each jar must be a zip whose META-INF/neoforge.mods.toml has the
# expected first modId (geldar_neoforge for geldar-neoforge.jar, ledger for the ledger jar). The ledger jar must nest exactly four
# jars under META-INF/jarjar/: ledger-core and the OpenTelemetry api, common and context jars, as deploy/build-neoforge-ledger.sh
# requires. Exit 0 when every check passes; 1 on a digest mismatch, a missing or extra jar, or a failed content check; 2 on a
# usage or format error. Needs unzip on PATH.
set -eu

GELDAR_JAR="geldar-neoforge.jar"
LEDGER_JAR="geldar-neoforge-ledger-0.1.0.jar"
REQUIRED_JARS="$GELDAR_JAR $LEDGER_JAR"

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  echo "usage: verify-neoforge-artifacts.sh <dir>" >&2
  exit 2
fi
dir=$1
sums="$dir/neoforge-artifacts.sha256"
if [ ! -f "$sums" ]; then
  echo "missing $sums" >&2
  exit 2
fi
if ! command -v unzip >/dev/null 2>&1; then
  echo "verify-neoforge-artifacts.sh: unzip is required on PATH" >&2
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

# The jar's content checks: a zip, META-INF/neoforge.mods.toml with the expected first modId, and for the ledger jar exactly four
# nested jars named as deploy/build-neoforge-ledger.sh names them. Prints the reason on stderr and returns 1 on a failure.
check_jar() {
  jar_name=$1
  jar_path=$2
  want_id=$3
  listing=$(unzip -Z1 "$jar_path" 2>/dev/null) || {
    echo "not a zip: $jar_name" >&2
    return 1
  }
  listing=$(printf '%s\n' "$listing" | tr -d '\r')
  printf '%s\n' "$listing" | grep -qx 'META-INF/neoforge.mods.toml' || {
    echo "no META-INF/neoforge.mods.toml in $jar_name" >&2
    return 1
  }
  toml=$(unzip -p "$jar_path" META-INF/neoforge.mods.toml 2>/dev/null | tr -d '\r') || true
  # The first modId line is the mod's own; the later ones are its dependencies.
  got=$(printf '%s\n' "$toml" | sed -n 's/^[[:space:]]*modId[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  if [ "$got" != "$want_id" ]; then
    echo "wrong modId in $jar_name: expected $want_id, got ${got:-none}" >&2
    return 1
  fi
  if [ "$jar_name" = "$LEDGER_JAR" ]; then
    nested=$(printf '%s\n' "$listing" | grep '^META-INF/jarjar/.*\.jar$' || true)
    nested_count=$(printf '%s\n' "$nested" | grep -c . || true)
    if [ "$nested_count" -ne 4 ]; then
      echo "$jar_name nests $nested_count jars under META-INF/jarjar/, expected 4" >&2
      return 1
    fi
    for want in ledger-core opentelemetry-api opentelemetry-common opentelemetry-context; do
      # ledger-core is nested with the composite build's group prefix; the others as <artifact>-<version>.jar.
      printf '%s\n' "$nested" | grep -Eq "^META-INF/jarjar/([A-Za-z0-9_-]+\.)?$want-[0-9][^/]*\.jar\$" || {
        echo "$jar_name does not nest $want under META-INF/jarjar/" >&2
        return 1
      }
    done
  fi
  return 0
}

status=0
seen=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  case "$line" in
    *"  "*) ;;
    *) echo "malformed line in $sums" >&2; exit 2 ;;
  esac
  expected=${line%%  *}
  name=${line#*  }
  [ "${#expected}" -eq 64 ] || { echo "malformed line in $sums" >&2; exit 2; }
  case "$expected" in
    *[!0-9a-f]*) echo "malformed line in $sums" >&2; exit 2 ;;
  esac
  case "$name" in
    ''|*[!A-Za-z0-9._-]*) echo "unsafe jar name in $sums: $name" >&2; exit 2 ;;
  esac
  case " $REQUIRED_JARS " in
    *" $name "*) ;;
    *) echo "unexpected jar name in $sums: $name" >&2; exit 2 ;;
  esac
  case " $seen " in
    *" $name "*) echo "duplicate jar name in $sums: $name" >&2; exit 2 ;;
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
    continue
  fi
  case "$name" in
    "$GELDAR_JAR") want_id=geldar_neoforge ;;
    *) want_id=ledger ;;
  esac
  if check_jar "$name" "$dir/$name" "$want_id"; then
    echo "ok: $name"
  else
    status=1
  fi
done <"$sums"

for jar in $REQUIRED_JARS; do
  case " $seen " in
    *" $jar "*) ;;
    *) echo "not listed in $sums: $jar" >&2; exit 2 ;;
  esac
done

# Every entry in <dir> must be the sums file or an expected jar. The globs take dotfiles and every case; a symlink or a directory
# that is not one of the expected names is refused too.
for f in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  base=${f##*/}
  case " $REQUIRED_JARS " in
    *" $base "*) continue ;;
  esac
  if [ "$base" != neoforge-artifacts.sha256 ]; then
    echo "unexpected file in $dir: $base" >&2
    status=1
  fi
done
exit "$status"
