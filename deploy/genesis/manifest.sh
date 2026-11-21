#!/bin/sh
# Genesis release manifest v2 (G1-04, decision 0188): the validator and reader for the optional digest keys in release.env.
# The v2 keys are extra KEY=VALUE lines beside the *_IMAGE lines that colo-cd reads; deploy/common.sh load_release ignores
# them, so a v1 manifest (image lines only) still validates and loads. Keys:
#   GELDAR_MANIFEST_VERSION            2 when set (absent means version 1)
#   GELDAR_PLUGIN_CORE_SHA256          sha256 of geldar-core.jar (G1-01 plugin-jars.sha256)
#   GELDAR_PLUGIN_VELOCITY_IDENTITY_SHA256  sha256 of geldar-velocity-identity.jar (G1-01)
#   GELDAR_CONFIG_BUNDLE_SHA256        sha256 of config-bundle.tar.gz (G1-03 build-config-bundle.sh)
#   GELDAR_ENV_DEFINITION_SHA256       sha256 of the environment definition
# Each digest is 64 lowercase hex characters. Errors name the key or the line number, never a value.
# Usage: manifest.sh validate <release.env> | value <release.env> <KEY> | version <release.env>
#        manifest.sh from-lock <plugin-jars.lock>   (GE-01w1a: the two plugin lines of a v2 manifest, see below)
# Functions only when sourced. The file is read as data and is never sourced. POSIX sh.

MANIFEST_DIGEST_KEYS="GELDAR_PLUGIN_CORE_SHA256 GELDAR_PLUGIN_VELOCITY_IDENTITY_SHA256 GELDAR_CONFIG_BUNDLE_SHA256 GELDAR_ENV_DEFINITION_SHA256"

# Prints how many lines of the manifest $1 start with KEY= ($2).
manifest_count() {
  sed -n "s/^$2=//p" "$1" | grep -c ''
}

# Prints the value of KEY ($2) in the manifest $1. Fails when the key is absent or listed more than once.
manifest_value() {
  [ -f "$1" ] || return 1
  [ "$(manifest_count "$1" "$2")" = 1 ] || return 1
  sed -n "s/^$2=//p" "$1"
}

# Prints the manifest version: GELDAR_MANIFEST_VERSION, or 1 when the manifest does not set it.
manifest_version() {
  if [ "$(manifest_count "$1" GELDAR_MANIFEST_VERSION)" = 0 ]; then
    echo 1
    return 0
  fi
  manifest_value "$1" GELDAR_MANIFEST_VERSION
}

# Validates the manifest $1 and returns 0 when it is valid. Every problem is printed to stderr as one line that names
# a key or a line number. Lines that are blank, comments or KEY=VALUE with an upper-case name are the only ones allowed.
manifest_validate() {
  f=$1
  if [ ! -f "$f" ]; then
    echo "genesis manifest: file not found" >&2
    return 1
  fi
  errors=0
  bad=$(grep -Env '^(#.*|$|[A-Z][A-Z0-9_]*=.*)$' "$f" | cut -d: -f1 | tr '\n' ' ')
  if [ -n "$bad" ]; then
    echo "genesis manifest: lines $bad are not KEY=VALUE with an upper-case name" >&2
    errors=1
  fi
  # The size and line rules below mirror the node entrypoint's (the entrypoint is outside this repo): a plain file of at
  # most 65536 bytes whose every line matches ^([A-Z][A-Z0-9_]*=[A-Za-z0-9_./:@+,=-]*|#.*|)$. Keep them in step with it.
  # A CR byte is refused on every line, CRLF comment lines included, so a CRLF file fails here and not on the node.
  # Each CR is mapped to byte 0x01 before grep: the Git for Windows grep drops CRs, and a CR in a grep pattern does not
  # match. Messages name the line number only, never the line.
  size=$(wc -c <"$f" | tr -d ' ')
  if [ "$size" -gt 65536 ]; then
    echo "genesis manifest: the file is larger than 65536 bytes" >&2
    errors=1
  fi
  bad=$(tr '\r' '\001' <"$f" | LC_ALL=C grep -aEvn '^([A-Z][A-Z0-9_]*=[A-Za-z0-9_./:@+,=-]*|#.*|)$' | cut -d: -f1 | tr '\n' ' ')
  if [ -n "$bad" ]; then
    echo "genesis manifest: lines $bad do not match the node entrypoint's line rule" >&2
    errors=1
  fi
  cr_byte=$(printf '\001')
  bad=$(tr '\r' '\001' <"$f" | LC_ALL=C grep -aEn "$cr_byte" | cut -d: -f1 | tr '\n' ' ')
  if [ -n "$bad" ]; then
    echo "genesis manifest: the file contains a CR or 0x01 byte on line(s) $bad" >&2
    errors=1
  fi
  nv=$(manifest_count "$f" GELDAR_MANIFEST_VERSION)
  if [ "$nv" -gt 1 ]; then
    echo "genesis manifest: GELDAR_MANIFEST_VERSION is listed $nv times" >&2
    errors=1
  elif [ "$nv" = 1 ]; then
    if [ "$(manifest_value "$f" GELDAR_MANIFEST_VERSION)" != 2 ]; then
      echo "genesis manifest: GELDAR_MANIFEST_VERSION must be 2 when it is set" >&2
      errors=1
    fi
  fi
  for key in $MANIFEST_DIGEST_KEYS; do
    n=$(manifest_count "$f" "$key")
    if [ "$n" -gt 1 ]; then
      echo "genesis manifest: $key is listed $n times" >&2
      errors=1
    elif [ "$n" = 1 ]; then
      v=$(manifest_value "$f" "$key")
      if ! printf '%s' "$v" | grep -Eq '^[0-9a-f]{64}$'; then
        echo "genesis manifest: $key is not a sha256 digest (64 lowercase hex characters)" >&2
        errors=1
      fi
    fi
  done
  [ "$errors" = 0 ]
}

# Prints the v2 plugin lines for the lock $1 (plugin/plugin-jars.lock, the plugin-jars.sha256 format with a header
# `# source commit: <40 lowercase hex or PENDING>`): GELDAR_PLUGIN_CORE_SHA256, GELDAR_PLUGIN_VELOCITY_IDENTITY_SHA256,
# then GELDAR_MANIFEST_VERSION=2. A PENDING lock prints nothing and returns 0, so the caller writes a version 1 manifest.
# Returns 2 with a fixed message (no lock content echoed) when the lock is malformed. The rules are verify-plugin-lock.sh's,
# copied here rather than sourced: one header line, exactly the two plugin jars once each, `<64 lowercase hex>  <name>`
# lines, and no CR bytes.
manifest_from_lock() {
  lock=$1
  if [ ! -f "$lock" ] || ! tr -d '\r' <"$lock" | cmp -s - "$lock"; then
    echo "plugin lock: file not found or contains CR bytes" >&2
    return 2
  fi
  commits=$(grep -c '^# source commit: ' "$lock" || true)
  if [ "$commits" != 1 ]; then
    echo "plugin lock: needs exactly one '# source commit:' line" >&2
    return 2
  fi
  commit=$(sed -n 's/^# source commit: //p' "$lock")
  pending=0
  if [ "$commit" = PENDING ]; then
    pending=1
  elif [ "${#commit}" -ne 40 ] || [ -n "$(printf '%s' "$commit" | tr -d '0-9a-f')" ]; then
    echo "plugin lock: source commit must be 40 lowercase hex or PENDING" >&2
    return 2
  fi
  core_hex=""
  velocity_hex=""
  core_n=0
  velocity_n=0
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      ''|'#'*) continue ;;
      *"  "*) ;;
      *)
        echo "plugin lock: a jar line is not '<64 lowercase hex>  <name>'" >&2
        return 2
        ;;
    esac
    hex=${line%%  *}
    name=${line#*  }
    case $hex in
      *[!0-9a-f]*) hex= ;;
    esac
    if [ "${#hex}" -ne 64 ]; then
      echo "plugin lock: a jar line is not '<64 lowercase hex>  <name>'" >&2
      return 2
    fi
    case $name in
      ''|*[!A-Za-z0-9._-]*)
        echo "plugin lock: a jar line is not '<64 lowercase hex>  <name>'" >&2
        return 2
        ;;
      geldar-core.jar)
        [ "$core_n" -eq 0 ] || { echo "plugin lock: geldar-core.jar is listed twice" >&2; return 2; }
        core_n=1
        core_hex=$hex
        ;;
      geldar-velocity-identity.jar)
        [ "$velocity_n" -eq 0 ] || { echo "plugin lock: geldar-velocity-identity.jar is listed twice" >&2; return 2; }
        velocity_n=1
        velocity_hex=$hex
        ;;
      *)
        echo "plugin lock: unknown jar name (only geldar-core.jar and geldar-velocity-identity.jar)" >&2
        return 2
        ;;
    esac
  done <"$lock"
  if [ "$core_n" != 1 ] || [ "$velocity_n" != 1 ]; then
    echo "plugin lock: needs one line each for geldar-core.jar and geldar-velocity-identity.jar" >&2
    return 2
  fi
  [ "$pending" = 0 ] || return 0
  printf 'GELDAR_PLUGIN_CORE_SHA256=%s\n' "$core_hex"
  printf 'GELDAR_PLUGIN_VELOCITY_IDENTITY_SHA256=%s\n' "$velocity_hex"
  echo 'GELDAR_MANIFEST_VERSION=2'
  return 0
}

manifest_main() {
  cmd=${1:-}
  [ $# -gt 0 ] && shift
  case $cmd in
    from-lock)
      [ $# -eq 1 ] || { echo "usage: manifest.sh from-lock <plugin-jars.lock>" >&2; return 2; }
      manifest_from_lock "$1"
      ;;
    validate)
      [ $# -eq 1 ] || { echo "usage: manifest.sh validate <release.env>" >&2; return 2; }
      manifest_validate "$1"
      ;;
    value)
      [ $# -eq 2 ] || { echo "usage: manifest.sh value <release.env> <KEY>" >&2; return 2; }
      manifest_value "$1" "$2"
      ;;
    version)
      [ $# -eq 1 ] || { echo "usage: manifest.sh version <release.env>" >&2; return 2; }
      manifest_version "$1"
      ;;
    *)
      echo "usage: manifest.sh validate|value|version|from-lock <release.env|plugin-jars.lock> [KEY]" >&2
      return 2
      ;;
  esac
}

case ${0##*/} in
  manifest.sh)
    manifest_main "$@"
    exit $?
    ;;
esac
