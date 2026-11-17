# The NeoForge ledger jar and the OpenTelemetry agent for the scratch NeoForge shard (compose/opt-in/scratch-neoforge-ledger.yml).
# Sourced by scratch.sh's set_env only when a ledger or agent variable is set, so the default render never reads this file.
# Nothing here starts anything. For up only, check_ledger_env refuses with exit 2 before compose runs. down and status never
# refuse on these variables: they render the overlay only when every value has the right shape (ledger_render_ok). The host
# sha256 of each jar is checked before any docker call; the entrypoint checks it again inside the container.
# Every shell global here has a ledger_ prefix: scratch.sh sources other files (telemetry-rows.sh) into the same shell.
#   SCRATCH_NEOFORGE_LEDGER_JAR and SCRATCH_NEOFORGE_LEDGER_SHA256: both or neither. SCRATCH_NEOFORGE_LEDGER_SHA256=off alone is
#     the soft kill: compose/opt-in/scratch-neoforge-ledger-off.yml (two environment keys, no mount), and it refuses with a jar or agent variable.
#   SCRATCH_LEDGER_PROPS: the ledger config file, required with the jar pair.
#   SCRATCH_NEOFORGE_OTEL_AGENT_JAR, SCRATCH_NEOFORGE_OTEL_AGENT_SHA256, SCRATCH_NEOFORGE_OTEL_AGENT_PROPS: all three or none, and
#     only with the jar pair. SCRATCH_OTEL_AGENT_JAR is the Paper telemetry variable (docs/runbooks/scratch-telemetry.md): this file never reads it.
#   The properties files (SCRATCH_LEDGER_PROPS and SCRATCH_NEOFORGE_OTEL_AGENT_PROPS) are neither pinned nor checked; they set the export endpoint.

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

# The agent paths: the entrypoint splits JVM_OPTS on whitespace, so a path with a space would become two arguments.
ledger_no_space() {
  case "$2" in
    *[[:space:]]*) ledger_refuse "$1 must not contain whitespace" ;;
  esac
}

# up only, before compose. Refuses a combination that cannot run, a malformed value, or a jar whose host sha256 differs from its pin.
check_ledger_env() {
  if [ "$PLATFORM" != neoforge ]; then
    ledger_refuse "the ledger jar and the OpenTelemetry agent need SCRATCH_PLATFORM=neoforge"
  fi
  if [ "$ledger_sha" = off ]; then
    [ -z "$ledger_jar$ledger_props$ledger_agent_jar$ledger_agent_sha$ledger_agent_props" ] || ledger_refuse "SCRATCH_NEOFORGE_LEDGER_SHA256=off is contradictory with the ledger jar or agent variables; unset them, or set the jar pair"
    return 0
  fi
  if [ -z "$ledger_jar" ] && [ -z "$ledger_sha" ]; then
    [ -z "$ledger_props$ledger_agent_jar$ledger_agent_sha$ledger_agent_props" ] || ledger_refuse "SCRATCH_LEDGER_PROPS and the OpenTelemetry agent variables need SCRATCH_NEOFORGE_LEDGER_JAR and SCRATCH_NEOFORGE_LEDGER_SHA256"
    return 0
  fi
  if [ -z "$ledger_jar" ] || [ -z "$ledger_sha" ]; then
    ledger_refuse "set both SCRATCH_NEOFORGE_LEDGER_JAR and SCRATCH_NEOFORGE_LEDGER_SHA256, or neither (off alone is the soft kill)"
  fi
  is_sha256_hex "$ledger_sha" || ledger_refuse "SCRATCH_NEOFORGE_LEDGER_SHA256 must be exactly 64 lowercase hex digits (or off alone)"
  ledger_file_ok SCRATCH_NEOFORGE_LEDGER_JAR "$ledger_jar"
  ledger_file_ok SCRATCH_LEDGER_PROPS "$ledger_props"
  if [ "$ledger_agent" = 1 ]; then
    [ -n "$ledger_agent_jar" ] && [ -n "$ledger_agent_sha" ] && [ -n "$ledger_agent_props" ] || ledger_refuse "set all three of SCRATCH_NEOFORGE_OTEL_AGENT_JAR, SCRATCH_NEOFORGE_OTEL_AGENT_SHA256 and SCRATCH_NEOFORGE_OTEL_AGENT_PROPS, or none"
    is_sha256_hex "$ledger_agent_sha" || ledger_refuse "SCRATCH_NEOFORGE_OTEL_AGENT_SHA256 must be exactly 64 lowercase hex digits"
    ledger_no_space SCRATCH_NEOFORGE_OTEL_AGENT_JAR "$ledger_agent_jar"
    ledger_no_space SCRATCH_NEOFORGE_OTEL_AGENT_PROPS "$ledger_agent_props"
    ledger_file_ok SCRATCH_NEOFORGE_OTEL_AGENT_JAR "$ledger_agent_jar"
    ledger_file_ok SCRATCH_NEOFORGE_OTEL_AGENT_PROPS "$ledger_agent_props"
  fi
  ledger_actual=$(sha256sum < "$ledger_jar" 2>/dev/null || true)
  [ "${ledger_actual%% *}" = "$ledger_sha" ] || ledger_refuse "the sha256 of SCRATCH_NEOFORGE_LEDGER_JAR does not match SCRATCH_NEOFORGE_LEDGER_SHA256"
  if [ "$ledger_agent" = 1 ]; then
    ledger_actual=$(sha256sum < "$ledger_agent_jar" 2>/dev/null || true)
    [ "${ledger_actual%% *}" = "$ledger_agent_sha" ] || ledger_refuse "the sha256 of SCRATCH_NEOFORGE_OTEL_AGENT_JAR does not match SCRATCH_NEOFORGE_OTEL_AGENT_SHA256"
  fi
}

# True when every value the overlay needs is present and well formed. Nothing is read from disk and nothing exits, so
# down and status render the overlay exactly when up would, and never refuse.
ledger_render_ok() {
  [ "$PLATFORM" = neoforge ] && [ -n "$ledger_jar" ] && [ -n "$ledger_props" ] && is_sha256_hex "$ledger_sha" || return 1
  ledger_shape_ok "$ledger_jar" && ledger_shape_ok "$ledger_props" || return 1
  if [ "$ledger_agent" = 1 ]; then
    [ -n "$ledger_agent_jar" ] && [ -n "$ledger_agent_props" ] && is_sha256_hex "$ledger_agent_sha" || return 1
    ledger_shape_ok "$ledger_agent_jar" && ledger_shape_ok "$ledger_agent_props" || return 1
    case "$ledger_agent_jar$ledger_agent_props" in
      *[[:space:]]*) return 1 ;;
    esac
  fi
}

# Sets the variables compose_run and the overlay read. With the agent off, the two agent mounts point at the ledger files:
# the entrypoint reads them only when GELDAR_NF_OTEL_AGENT=1, so the placeholder is never used by the agent.
ledger_set_env() {
  ledger_jar=${SCRATCH_NEOFORGE_LEDGER_JAR:-}
  ledger_sha=${SCRATCH_NEOFORGE_LEDGER_SHA256:-}
  ledger_props=${SCRATCH_LEDGER_PROPS:-}
  ledger_agent_jar=${SCRATCH_NEOFORGE_OTEL_AGENT_JAR:-}
  ledger_agent_sha=${SCRATCH_NEOFORGE_OTEL_AGENT_SHA256:-}
  ledger_agent_props=${SCRATCH_NEOFORGE_OTEL_AGENT_PROPS:-}
  ledger_agent=0
  [ -z "$ledger_agent_jar$ledger_agent_sha$ledger_agent_props" ] || ledger_agent=1
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
  GELDAR_NF_LEDGER_OFF=0
  if [ "$ledger_sha" = off ] && [ -z "$ledger_jar$ledger_props$ledger_agent_jar$ledger_agent_sha$ledger_agent_props" ]; then
    GELDAR_NF_LEDGER_OFF=1
  fi
  if ledger_render_ok; then
    GELDAR_NF_LEDGER_JAR_HOST=$ledger_jar
    GELDAR_NF_LEDGER_PROPS_HOST=$ledger_props
    GELDAR_NF_LEDGER_SHA256=$ledger_sha
    GELDAR_NF_OTEL_AGENT_JAR_HOST=$ledger_jar
    GELDAR_NF_OTEL_AGENT_PROPS_HOST=$ledger_props
    if [ "$ledger_agent" = 1 ]; then
      GELDAR_NF_OTEL_AGENT=1
      GELDAR_NF_OTEL_AGENT_SHA256=$ledger_agent_sha
      GELDAR_NF_OTEL_AGENT_JAR_HOST=$ledger_agent_jar
      GELDAR_NF_OTEL_AGENT_PROPS_HOST=$ledger_agent_props
    fi
  fi
  # The overlay compose_run adds (scratch.sh): the env-only soft kill, or the ledger jar overlay. Empty adds nothing.
  GELDAR_NF_LEDGER_FILE=
  if [ "$GELDAR_NF_LEDGER_OFF" = 1 ]; then
    GELDAR_NF_LEDGER_FILE=$ROOT/compose/opt-in/scratch-neoforge-ledger-off.yml
  elif [ -n "$GELDAR_NF_LEDGER_JAR_HOST" ]; then
    GELDAR_NF_LEDGER_FILE=$ROOT/compose/opt-in/scratch-neoforge-ledger.yml
  fi
  export GELDAR_NF_LEDGER_JAR_HOST GELDAR_NF_LEDGER_PROPS_HOST GELDAR_NF_LEDGER_SHA256 GELDAR_NF_OTEL_AGENT GELDAR_NF_OTEL_AGENT_SHA256
  export GELDAR_NF_OTEL_AGENT_JAR_HOST GELDAR_NF_OTEL_AGENT_PROPS_HOST GELDAR_NF_LEDGER_OFF
}
