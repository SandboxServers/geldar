# The NeoForge ledger jar and the telemetry agent for the scratch NeoForge shard (compose/opt-in/scratch-neoforge-ledger.yml).
# Sourced by scratch.sh's set_env only when a ledger or telemetry variable is set, so the default render never reads this file.
# Nothing here starts anything. For up only, check_ledger_env refuses with exit 2 before compose runs. down and status never
# refuse on these variables: they render the overlay only when every value has the right shape (ledger_render_ok). The host
# sha256 of each jar is checked before any docker call; the entrypoint checks it again inside the container.
# Every shell global here has a ledger_ prefix: scratch.sh sources other files (telemetry-rows.sh) into the same shell.
#   SCRATCH_NEOFORGE_TELEMETRY=off alone is the soft kill: GELDAR_NF_TELEMETRY=off and compose/opt-in/scratch-neoforge-ledger-off.yml
#     (one environment key, no mount). It refuses with any of the five variables below.
#   Otherwise all five or none; all five set GELDAR_NF_TELEMETRY=on for the container, which mounts the ledger jar and the agent:
#     SCRATCH_NEOFORGE_LEDGER_JAR and SCRATCH_NEOFORGE_LEDGER_SHA256 (the ledger jar and its pin, 64 lowercase hex digits),
#     SCRATCH_LEDGER_PROPS (the ledger config; the entrypoint copies it into the container's config/ at every start),
#     SCRATCH_NEOFORGE_OTEL_AGENT_JAR and SCRATCH_NEOFORGE_OTEL_AGENT_PROPS (the agent jar and its properties).
#   The agent's pin is a repo constant, ledger_agent_pin below. It is the same value as GELDAR_NF_OTEL_AGENT_PIN in the overlay;
#   a repo test checks that it matches the design doc. It is not an operator variable.
#   The properties files are neither pinned nor checked. SCRATCH_OTEL_AGENT_JAR is the Paper telemetry variable (docs/runbooks/scratch-telemetry.md): this file never reads it.

# The agent pin: the sha256 of opentelemetry-javaagent 2.33.1 (26507624 bytes), from docs/analysis/telemetry/nf-live-telemetry.md section 0a.
ledger_agent_pin=e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149

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
    ledger_refuse "the ledger jar and the telemetry agent need SCRATCH_PLATFORM=neoforge"
  fi
  if [ "$ledger_telem" = off ]; then
    [ -z "$ledger_jar$ledger_sha$ledger_props$ledger_agent_jar$ledger_agent_props" ] || ledger_refuse "SCRATCH_NEOFORGE_TELEMETRY=off is contradictory with the ledger or agent variables; unset them, or unset SCRATCH_NEOFORGE_TELEMETRY"
    return 0
  fi
  if [ -n "$ledger_telem" ]; then
    ledger_refuse "SCRATCH_NEOFORGE_TELEMETRY must be off or unset"
  fi
  if [ -z "$ledger_jar$ledger_sha$ledger_props$ledger_agent_jar$ledger_agent_props" ]; then
    return 0
  fi
  [ -n "$ledger_jar" ] && [ -n "$ledger_sha" ] && [ -n "$ledger_props" ] && [ -n "$ledger_agent_jar" ] && [ -n "$ledger_agent_props" ] || ledger_refuse "set all five of SCRATCH_NEOFORGE_LEDGER_JAR, SCRATCH_NEOFORGE_LEDGER_SHA256, SCRATCH_LEDGER_PROPS, SCRATCH_NEOFORGE_OTEL_AGENT_JAR and SCRATCH_NEOFORGE_OTEL_AGENT_PROPS, or none (SCRATCH_NEOFORGE_TELEMETRY=off alone is the soft kill)"
  is_sha256_hex "$ledger_sha" || ledger_refuse "SCRATCH_NEOFORGE_LEDGER_SHA256 must be exactly 64 lowercase hex digits"
  ledger_no_space SCRATCH_NEOFORGE_OTEL_AGENT_JAR "$ledger_agent_jar"
  ledger_no_space SCRATCH_NEOFORGE_OTEL_AGENT_PROPS "$ledger_agent_props"
  ledger_file_ok SCRATCH_NEOFORGE_LEDGER_JAR "$ledger_jar"
  ledger_file_ok SCRATCH_LEDGER_PROPS "$ledger_props"
  ledger_file_ok SCRATCH_NEOFORGE_OTEL_AGENT_JAR "$ledger_agent_jar"
  ledger_file_ok SCRATCH_NEOFORGE_OTEL_AGENT_PROPS "$ledger_agent_props"
  ledger_actual=$(sha256sum < "$ledger_jar" 2>/dev/null || true)
  [ "${ledger_actual%% *}" = "$ledger_sha" ] || ledger_refuse "the sha256 of SCRATCH_NEOFORGE_LEDGER_JAR does not match SCRATCH_NEOFORGE_LEDGER_SHA256"
  ledger_actual=$(sha256sum < "$ledger_agent_jar" 2>/dev/null || true)
  [ "${ledger_actual%% *}" = "$ledger_agent_pin" ] || ledger_refuse "the sha256 of SCRATCH_NEOFORGE_OTEL_AGENT_JAR does not match the agent pin in deploy/scratch/scratch-ledger.sh"
}

# True when every value the on overlay needs is present and well formed. Nothing is read from disk and nothing exits, so
# down and status render the overlay exactly when up would, and never refuse.
ledger_render_ok() {
  [ "$PLATFORM" = neoforge ] && [ -z "$ledger_telem" ] && [ -n "$ledger_jar" ] && [ -n "$ledger_props" ] && [ -n "$ledger_agent_jar" ] && [ -n "$ledger_agent_props" ] || return 1
  is_sha256_hex "$ledger_sha" || return 1
  ledger_shape_ok "$ledger_jar" && ledger_shape_ok "$ledger_props" && ledger_shape_ok "$ledger_agent_jar" && ledger_shape_ok "$ledger_agent_props" || return 1
  case "$ledger_agent_jar$ledger_agent_props" in
    *[[:space:]]*) return 1 ;;
  esac
}

# Sets the variables compose_run and the overlay read. GELDAR_NF_TELEMETRY is set to on or off, or left empty (the default path).
ledger_set_env() {
  ledger_jar=${SCRATCH_NEOFORGE_LEDGER_JAR:-}
  ledger_sha=${SCRATCH_NEOFORGE_LEDGER_SHA256:-}
  ledger_props=${SCRATCH_LEDGER_PROPS:-}
  ledger_agent_jar=${SCRATCH_NEOFORGE_OTEL_AGENT_JAR:-}
  ledger_agent_props=${SCRATCH_NEOFORGE_OTEL_AGENT_PROPS:-}
  ledger_telem=${SCRATCH_NEOFORGE_TELEMETRY:-}
  if [ "$verb" = up ]; then
    check_ledger_env
  fi
  GELDAR_NF_TELEMETRY=
  GELDAR_NF_LEDGER_JAR_HOST=
  GELDAR_NF_LEDGER_PROPS_HOST=
  GELDAR_NF_LEDGER_SHA256=
  GELDAR_NF_OTEL_AGENT_JAR_HOST=
  GELDAR_NF_OTEL_AGENT_PROPS_HOST=
  GELDAR_NF_LEDGER_OFF=0
  if [ "$ledger_telem" = off ]; then
    GELDAR_NF_LEDGER_OFF=1
    GELDAR_NF_TELEMETRY=off
  elif ledger_render_ok; then
    GELDAR_NF_TELEMETRY=on
    GELDAR_NF_LEDGER_JAR_HOST=$ledger_jar
    GELDAR_NF_LEDGER_PROPS_HOST=$ledger_props
    GELDAR_NF_LEDGER_SHA256=$ledger_sha
    GELDAR_NF_OTEL_AGENT_JAR_HOST=$ledger_agent_jar
    GELDAR_NF_OTEL_AGENT_PROPS_HOST=$ledger_agent_props
  fi
  # The overlay compose_run adds (scratch.sh): the env-only soft kill, or the on overlay. Empty adds nothing.
  GELDAR_NF_LEDGER_FILE=
  if [ "$GELDAR_NF_LEDGER_OFF" = 1 ]; then
    GELDAR_NF_LEDGER_FILE=$ROOT/compose/opt-in/scratch-neoforge-ledger-off.yml
  elif [ -n "$GELDAR_NF_LEDGER_JAR_HOST" ]; then
    GELDAR_NF_LEDGER_FILE=$ROOT/compose/opt-in/scratch-neoforge-ledger.yml
  fi
  export GELDAR_NF_TELEMETRY GELDAR_NF_LEDGER_JAR_HOST GELDAR_NF_LEDGER_PROPS_HOST GELDAR_NF_LEDGER_SHA256
  export GELDAR_NF_OTEL_AGENT_JAR_HOST GELDAR_NF_OTEL_AGENT_PROPS_HOST GELDAR_NF_LEDGER_OFF
}
