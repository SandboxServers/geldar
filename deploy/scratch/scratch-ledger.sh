# The NeoForge ledger jar and the OpenTelemetry agent for the scratch NeoForge shard (compose/opt-in/scratch-neoforge-ledger.yml).
# Sourced by scratch.sh's set_env only when a ledger or agent variable is set, so the default render never reads this file.
# Nothing here starts anything. For up only, check_ledger_env refuses with exit 2 before compose runs. down and status never
# refuse on these variables: they render the overlay only when every value has the right shape (ledger_render_ok). The host
# sha256 of each jar is checked before any docker call; the entrypoint checks it again inside the container.
#   SCRATCH_NEOFORGE_LEDGER_JAR and SCRATCH_NEOFORGE_LEDGER_SHA256: both or neither. SCRATCH_NEOFORGE_LEDGER_SHA256=off alone is
#     the soft kill: no overlay and no mount.
#   SCRATCH_LEDGER_PROPS: the ledger config file, required with the jar pair.
#   SCRATCH_OTEL_AGENT_JAR, SCRATCH_OTEL_AGENT_SHA256, SCRATCH_OTEL_AGENT_PROPS: all three or none, and only with the jar pair.

# Exit 2 with the message, nothing started. The message names the variable only, never a value.
ledger_refuse() {
  echo "scratch: $1; nothing started" >&2
  exit 2
}

# An absolute path with no newline, quotes, backslashes or dollar signs (the overlay's YAML and the shell both read it).
ledger_shape_ok() {
  is_abs "$1" && ! has_newline "$1" || return 1
  case "$1" in
    *'"'* | *'\'* | *'$'*) return 1 ;;
  esac
}

# A host file the overlay mounts: the shape above, and a readable regular file (not a symlink).
ledger_file_ok() {
  ledger_shape_ok "$2" || ledger_refuse "$1 must be an absolute path with no newline, quotes, backslashes or dollar signs"
  if [ -L "$2" ] || [ ! -f "$2" ] || [ ! -r "$2" ]; then
    ledger_refuse "$1 must be a readable regular file, not a symlink"
  fi
}

# up only, before compose. Refuses a combination that cannot run, a malformed value, or a jar whose host sha256 differs from its pin.
check_ledger_env() {
  if [ "$PLATFORM" != neoforge ]; then
    ledger_refuse "the ledger jar and the OpenTelemetry agent need SCRATCH_PLATFORM=neoforge"
  fi
  if [ "$ls" = off ]; then
    [ -z "$lj$lp$aj$as$ap" ] || ledger_refuse "SCRATCH_NEOFORGE_LEDGER_SHA256=off takes no other ledger or agent variable"
    return 0
  fi
  if [ -z "$lj" ] && [ -z "$ls" ]; then
    [ -z "$lp$aj$as$ap" ] || ledger_refuse "SCRATCH_LEDGER_PROPS and the OpenTelemetry agent variables need SCRATCH_NEOFORGE_LEDGER_JAR and SCRATCH_NEOFORGE_LEDGER_SHA256"
    return 0
  fi
  if [ -z "$lj" ] || [ -z "$ls" ]; then
    ledger_refuse "set both SCRATCH_NEOFORGE_LEDGER_JAR and SCRATCH_NEOFORGE_LEDGER_SHA256, or neither (off alone is the soft kill)"
  fi
  is_sha256_hex "$ls" || ledger_refuse "SCRATCH_NEOFORGE_LEDGER_SHA256 must be exactly 64 lowercase hex digits (or off alone)"
  ledger_file_ok SCRATCH_NEOFORGE_LEDGER_JAR "$lj"
  ledger_file_ok SCRATCH_LEDGER_PROPS "$lp"
  if [ "$agent" = 1 ]; then
    [ -n "$aj" ] && [ -n "$as" ] && [ -n "$ap" ] || ledger_refuse "set all three of SCRATCH_OTEL_AGENT_JAR, SCRATCH_OTEL_AGENT_SHA256 and SCRATCH_OTEL_AGENT_PROPS, or none"
    is_sha256_hex "$as" || ledger_refuse "SCRATCH_OTEL_AGENT_SHA256 must be exactly 64 lowercase hex digits"
    ledger_file_ok SCRATCH_OTEL_AGENT_JAR "$aj"
    ledger_file_ok SCRATCH_OTEL_AGENT_PROPS "$ap"
  fi
  actual=$(sha256sum < "$lj" 2>/dev/null || true)
  [ "${actual%% *}" = "$ls" ] || ledger_refuse "the sha256 of SCRATCH_NEOFORGE_LEDGER_JAR does not match SCRATCH_NEOFORGE_LEDGER_SHA256"
  if [ "$agent" = 1 ]; then
    actual=$(sha256sum < "$aj" 2>/dev/null || true)
    [ "${actual%% *}" = "$as" ] || ledger_refuse "the sha256 of SCRATCH_OTEL_AGENT_JAR does not match SCRATCH_OTEL_AGENT_SHA256"
  fi
}

# True when every value the overlay needs is present and well formed. Nothing is read from disk and nothing exits, so
# down and status render the overlay exactly when up would, and never refuse.
ledger_render_ok() {
  [ "$PLATFORM" = neoforge ] && [ -n "$lj" ] && [ -n "$lp" ] && is_sha256_hex "$ls" || return 1
  ledger_shape_ok "$lj" && ledger_shape_ok "$lp" || return 1
  if [ "$agent" = 1 ]; then
    [ -n "$aj" ] && [ -n "$ap" ] && is_sha256_hex "$as" || return 1
    ledger_shape_ok "$aj" && ledger_shape_ok "$ap" || return 1
  fi
}

# Sets the variables compose_run and the overlay read. With the agent off, the two agent mounts point at the ledger files:
# the entrypoint reads them only when GELDAR_NF_OTEL_AGENT=1, so the placeholder is never used by the agent.
ledger_set_env() {
  lj=${SCRATCH_NEOFORGE_LEDGER_JAR:-}
  ls=${SCRATCH_NEOFORGE_LEDGER_SHA256:-}
  lp=${SCRATCH_LEDGER_PROPS:-}
  aj=${SCRATCH_OTEL_AGENT_JAR:-}
  as=${SCRATCH_OTEL_AGENT_SHA256:-}
  ap=${SCRATCH_OTEL_AGENT_PROPS:-}
  agent=0
  [ -z "$aj$as$ap" ] || agent=1
  if [ "$verb" = up ]; then
    check_ledger_env
  fi
  GELDAR_NF_LEDGER_JAR_HOST=
  GELDAR_NF_LEDGER_PROPS_HOST=
  GELDAR_NF_LEDGER_SHA256=
  GELDAR_NF_OTEL_AGENT=0
  GELDAR_NF_OTEL_AGENT_SHA256=
  GELDAR_NF_OTEL_AGENT_JAR_HOST=
  GELDAR_NF_OTEL_AGENT_PROPS_HOST=
  if ledger_render_ok; then
    GELDAR_NF_LEDGER_JAR_HOST=$lj
    GELDAR_NF_LEDGER_PROPS_HOST=$lp
    GELDAR_NF_LEDGER_SHA256=$ls
    GELDAR_NF_OTEL_AGENT_JAR_HOST=$lj
    GELDAR_NF_OTEL_AGENT_PROPS_HOST=$lp
    if [ "$agent" = 1 ]; then
      GELDAR_NF_OTEL_AGENT=1
      GELDAR_NF_OTEL_AGENT_SHA256=$as
      GELDAR_NF_OTEL_AGENT_JAR_HOST=$aj
      GELDAR_NF_OTEL_AGENT_PROPS_HOST=$ap
    fi
  fi
  export GELDAR_NF_LEDGER_JAR_HOST GELDAR_NF_LEDGER_PROPS_HOST GELDAR_NF_LEDGER_SHA256 GELDAR_NF_OTEL_AGENT GELDAR_NF_OTEL_AGENT_SHA256
  export GELDAR_NF_OTEL_AGENT_JAR_HOST GELDAR_NF_OTEL_AGENT_PROPS_HOST
}
