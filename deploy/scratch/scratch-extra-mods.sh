# The optional extra mods on the scratch NeoForge stack: Chunky and BlueMap, mounted read-only by
# compose/opt-in/scratch-neoforge-extra-mods.yml. Sourced by deploy/scratch/scratch.sh only when SCRATCH_EXTRA_MODS is set,
# and only up calls extra_mods_check (before any docker call). Nothing here starts anything. compose_run adds the overlay only
# with SCRATCH_EXTRA_MODS=1 and SCRATCH_PLATFORM=neoforge; down and status never refuse on these variables.
# Every shell global here has an extra_ prefix: scratch.sh is sourced into the same shell as the other scratch files.
# Runbook: docs/runbooks/scratch-stack.md, "Extra mods (BlueMap, Chunky) on scratch".

EXTRA_PINS=$ROOT/compose/neoforge/extra-mods.pins
EXTRA_BLUEMAP_CONFIG=$ROOT/compose/neoforge/extra-mods-bluemap-config.sh

# Exit 2 with the message, nothing started. The message names the variable only, never a value.
extra_refuse() {
  echo "scratch: $1; nothing started" >&2
  exit 2
}

# extra_check_jar PIN-NAME VARIABLE: the jar named by VARIABLE must be an absolute, readable, non-empty regular file (not a
# symlink) with no newline, quotes, backslashes or dollar signs, and its sha256 must equal the pin for PIN-NAME in the pins file.
# The hash is computed on the host; neither the path's bytes nor the jar's bytes are printed.
extra_check_jar() {
  eval "extra_jar=\${$2:-}"
  [ -n "$extra_jar" ] || extra_refuse "$2 is not set (SCRATCH_EXTRA_MODS=1 mounts both jars)"
  is_abs "$extra_jar" && ! has_newline "$extra_jar" || extra_refuse "$2 must be an absolute path with no newline"
  case "$extra_jar" in
    *'"'* | *'\'* | *'$'*) extra_refuse "$2 must not contain quotes, backslashes or dollar signs" ;;
  esac
  if [ -L "$extra_jar" ] || [ ! -f "$extra_jar" ] || [ ! -r "$extra_jar" ] || [ ! -s "$extra_jar" ]; then
    extra_refuse "$2 must be a readable, non-empty regular file, not a symlink"
  fi
  extra_want=$(awk -v n="$1" '$0 !~ /^#/ && $1 == n { print $2; exit }' "$EXTRA_PINS" 2>/dev/null)
  extra_got=$(sha256sum "$extra_jar" 2>/dev/null || true)
  extra_got=${extra_got%% *}
  [ -n "$extra_want" ] && [ "$extra_got" = "$extra_want" ] ||
    extra_refuse "the sha256 of $2 does not match its pin in compose/neoforge/extra-mods.pins"
}

# extra_mods_check: up only, before any docker call. The value must be 1; the platform must be neoforge; the BlueMap config
# seeding (compose/neoforge/extra-mods-bluemap-config.sh) must be in this tree, because BlueMap must never run on defaults (the
# privacy guarantee); and both host jars must match their pins.
extra_mods_check() {
  [ "$SCRATCH_EXTRA_MODS" = 1 ] || extra_refuse "SCRATCH_EXTRA_MODS must be 1 or unset"
  [ "$PLATFORM" = neoforge ] || extra_refuse "SCRATCH_EXTRA_MODS=1 needs SCRATCH_PLATFORM=neoforge"
  [ -f "$EXTRA_BLUEMAP_CONFIG" ] ||
    extra_refuse "compose/neoforge/extra-mods-bluemap-config.sh is not in this tree; BlueMap must not run without its config seeding (see docs/runbooks/scratch-stack.md, Extra mods); use a tree that has it"
  extra_check_jar chunky SCRATCH_EXTRA_CHUNKY_JAR_HOST
  extra_check_jar bluemap SCRATCH_EXTRA_BLUEMAP_JAR_HOST
}
