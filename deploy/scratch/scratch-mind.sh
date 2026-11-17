# The Mind test verbs of deploy/scratch/scratch.sh: mind-up and mind-token. scratch.sh sources this file only when one of
# those verbs is requested, after its own functions and variables exist (set_env, compose_run, is_abs, has_newline,
# nats_dir_ok, random_secret, ROOT, PROJECT, SECRETS, suffix, verb). It is not a script on its own.
# The docs are docs/runbooks/scratch-stack.md, "Mind test on the scratch stack". The one test player is the phase0
# roster's test player (shards/phase0.yaml); mind-token refuses every other name. Every refusal exits 2 before compose runs.
MIND_PLAYER=ag-test-01
MIND_NATS_FILES="nats-mcp.txt nats-body.txt"

# The scratch project only: the mind never runs against a colo or other project name.
check_mind_project() {
  case "$PROJECT" in
    scratch-?*) ;;
    *)
      echo "scratch: $verb refuses $PROJECT: it is not a scratch-<suffix> project; nothing started" >&2
      exit 2
      ;;
  esac
}

# The NATS auth dir for the mind: the same absolute, quote-free rules as the probe, and the two mind files non-empty.
check_mind_nats() {
  if [ -z "${SCRATCH_NATS_AUTH_DIR:-}" ]; then
    echo "scratch: $verb needs SCRATCH_NATS_AUTH_DIR, the auth dir of up that also holds $MIND_NATS_FILES; nothing started" >&2
    exit 2
  fi
  if ! is_abs "$SCRATCH_NATS_AUTH_DIR" || has_newline "$SCRATCH_NATS_AUTH_DIR"; then
    echo "scratch: SCRATCH_NATS_AUTH_DIR must be an absolute path with no newline; nothing started" >&2
    exit 2
  fi
  case "$SCRATCH_NATS_AUTH_DIR" in
    *'"'* | *'\'* | *'$'*)
      echo "scratch: SCRATCH_NATS_AUTH_DIR must not contain quotes, backslashes or dollar signs; nothing started" >&2
      exit 2
      ;;
  esac
  if ! nats_dir_ok "$MIND_NATS_FILES"; then
    echo "scratch: $verb needs $MIND_NATS_FILES, non-empty, in SCRATCH_NATS_AUTH_DIR; nothing started" >&2
    exit 2
  fi
}

# Up must have started this project: its secrets dir with the three up secrets, and running, healthy postgres,
# nats, velocity and paper containers. mind-up and mind-token both need it.
check_mind_up() {
  check_mind_project
  if [ ! -d "$SECRETS" ] || [ -L "$SECRETS" ]; then
    echo "scratch: $PROJECT has no secrets dir; run: sh deploy/scratch/scratch.sh up $suffix first. Nothing started." >&2
    exit 2
  fi
  for f in postgres.txt rcon.txt velocity-forwarding.txt; do
    if [ ! -s "$SECRETS/$f" ]; then
      echo "scratch: $SECRETS/$f is missing; run up first. Nothing started." >&2
      exit 2
    fi
  done
  for svc in postgres nats velocity paper; do
    healthy=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$svc" --filter health=healthy) || {
      echo "scratch: docker ps failed (is docker running?); nothing started" >&2
      exit 1
    }
    if [ -z "$healthy" ]; then
      echo "scratch: $PROJECT has no healthy $svc container; wait for up to finish; nothing started" >&2
      exit 2
    fi
  done
}

do_mind_up() {
  set_env
  GELDAR_MIND_PLAYER=$MIND_PLAYER
  export GELDAR_MIND_PLAYER
  check_mind_nats
  check_mind_up
  umask 077
  # The mcp login password and the token pepper: random, written once, never printed. Re-running keeps them.
  [ -s "$SECRETS/postgres-mcp.txt" ] || printf '%s' "$(random_secret)" >"$SECRETS/postgres-mcp.txt"
  [ -s "$SECRETS/mcp-token-pepper.txt" ] || printf '%s' "$(random_secret)" >"$SECRETS/mcp-token-pepper.txt"
  if ! compose_run --profile mind run --rm --no-deps mind-migrate; then
    echo "scratch: the geldar_mcp password step failed; geldar-mcp was not started" >&2
    exit 1
  fi
  compose_run --profile mind up -d --wait geldar-mcp players-host
  exit $?
}

do_mind_token() {
  player=${1:-}
  bad_player="scratch: mind-token needs the test player name $MIND_PLAYER (letters, digits and hyphens, starting with a letter, 31 at most); nothing started"
  case "$player" in
    [a-z]*) ;;
    *) echo "$bad_player" >&2; exit 2 ;;
  esac
  case "$player" in
    *[!a-z0-9-]*) echo "$bad_player" >&2; exit 2 ;;
  esac
  if [ "${#player}" -gt 31 ] || [ "$player" != "$MIND_PLAYER" ]; then
    echo "scratch: mind-token mints only for the one test player $MIND_PLAYER; nothing started" >&2
    exit 2
  fi
  set_env
  GELDAR_MIND_PLAYER=$MIND_PLAYER
  export GELDAR_MIND_PLAYER
  check_mind_up
  if [ ! -s "$SECRETS/postgres-mcp.txt" ] || [ ! -s "$SECRETS/mcp-token-pepper.txt" ]; then
    echo "scratch: mind-up has not run for $PROJECT; nothing started" >&2
    exit 2
  fi
  if [ -e "$SECRETS/mind-token.txt" ] || [ -L "$SECRETS/mind-token.txt" ]; then
    echo "scratch: $SECRETS/mind-token.txt already exists; remove it by hand to mint again. Nothing started." >&2
    exit 2
  fi
  # The mint prints the token id and the path in the container. Only the id is kept, and the token is never read here.
  out=$(compose_run --profile mind run --rm --no-deps mind-mint 2>&1) || {
    echo "scratch: the token mint failed; no token id is printed" >&2
    exit 1
  }
  id=$(printf '%s\n' "$out" | sed -n 's/^minted \([^ ]*\) for .*/\1/p')
  if [ -z "$id" ]; then
    echo "scratch: the mint printed no token id line; check the mint output in the operator's terminal" >&2
    exit 1
  fi
  echo "minted token $id for $MIND_PLAYER to $SECRETS/mind-token.txt"
  exit 0
}
