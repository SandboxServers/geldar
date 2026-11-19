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

manifest_main() {
  cmd=${1:-}
  [ $# -gt 0 ] && shift
  case $cmd in
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
      echo "usage: manifest.sh validate|value|version <release.env> [KEY]" >&2
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
