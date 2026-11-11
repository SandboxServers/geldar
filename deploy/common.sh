# Shared settings and checks for the Colo deploy scripts (decision 0084). Sourced by deploy/colo-*.sh and
# deploy/gen-secrets.sh; it is not run by itself. Every target comes from the environment. No host, address,
# account or secret value is set here or printed by any script. POSIX sh (dash on Debian 12, and bash in tests).

DEPLOY_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT=geldar-colo
ROOT=${GELDAR_COLO_ROOT:-$(cd "$DEPLOY_DIR/.." && pwd)}
COMPOSE_FILE=${GELDAR_COLO_COMPOSE:-$ROOT/compose/colo.yml}
SECRETS_OVERLAY=$DEPLOY_DIR/compose.secrets.yml
EXTRA_OVERLAY=${GELDAR_COLO_EXTRA_OVERLAY:-}
GELDAR_SECRETS_DIR=${GELDAR_SECRETS_DIR:-/etc/geldar-colo/secrets}
export GELDAR_SECRETS_DIR
RELEASE_FILE=${GELDAR_RELEASE_FILE:-/etc/geldar-colo/release.env}
STATE_DIR=${GELDAR_STATE_DIR:-/var/lib/geldar-colo}
MIN_FREE_KB=${GELDAR_MIN_FREE_KB:-10485760}
BLUEMAP_LOCK=${GELDAR_BLUEMAP_LOCK:-$ROOT/plugins/bluemap/bluemap.lock.json}
DRY_RUN=${DEPLOY_DRY_RUN:-0}
SECRET_FILES="postgres.txt rcon.txt velocity-forwarding.txt nats-body.txt"

WORK=$(mktemp -d) || exit 1
trap 'rm -rf "$WORK"' EXIT

die() {
  echo "colo: error: $*" >&2
  exit 1
}

say() {
  echo "colo: $*"
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

# Runs a state-changing step, or names it in dry-run mode.
act() {
  if [ "$DRY_RUN" = 1 ]; then
    say "dry-run, not run: $*"
  else
    "$@"
  fi
}

# Every compose call names the project, so it can only reach geldar-colo containers, volumes and networks.
dc() {
  if [ -n "$EXTRA_OVERLAY" ]; then
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" -f "$SECRETS_OVERLAY" -f "$EXTRA_OVERLAY" "$@"
  else
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" -f "$SECRETS_OVERLAY" "$@"
  fi
}

plan_header() {
  say "project: $PROJECT"
  say "compose: $COMPOSE_FILE (+ $SECRETS_OVERLAY${EXTRA_OVERLAY:+ + $EXTRA_OVERLAY})"
  say "secrets dir: $GELDAR_SECRETS_DIR; release manifest: $RELEASE_FILE; state: $STATE_DIR"
  if [ "$DRY_RUN" = 1 ]; then say "DEPLOY_DRY_RUN=1: read-only steps only"; fi
}

check_prereqs() {
  need docker
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is not available"
  docker info >/dev/null 2>&1 || die "cannot reach the docker daemon (is this account in the docker group?)"
  [ -f "$COMPOSE_FILE" ] || die "compose file not found: $COMPOSE_FILE"
  [ -f "$SECRETS_OVERLAY" ] || die "secrets overlay not found: $SECRETS_OVERLAY"
  free=$(df -Pk "$ROOT" | awk 'NR == 2 {print $4}')
  if [ -z "$free" ] || [ "$free" -lt "$MIN_FREE_KB" ]; then
    die "free disk ${free:-unknown} KiB is below the threshold of $MIN_FREE_KB KiB"
  fi
}

# Checks that each secret file exists, is not empty, and is owner-only. It never reads the contents.
check_secrets() {
  [ -d "$GELDAR_SECRETS_DIR" ] || die "secrets directory missing: $GELDAR_SECRETS_DIR (deploy/README.md)"
  for f in $SECRET_FILES; do
    p=$GELDAR_SECRETS_DIR/$f
    [ -f "$p" ] && [ -s "$p" ] || die "secret file missing or empty: $f"
    m=$(stat -c %a "$p") || die "cannot stat secret file: $f"
    case $m in
      600 | 400 | 0600 | 0400) ;;
      *) die "secret file $f has mode $m; it must be 0600 or 0400" ;;
    esac
  done
}

# Reads the release manifest as KEY=VALUE data (it is never sourced) and exports each *_IMAGE variable.
# Every image must be a digest reference; a tag, a bare name or latest is refused.
load_release() {
  [ -f "$1" ] || die "release manifest not found: $1"
  count=0
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      '' | '#'*) continue ;;
      *=*) ;;
      *) die "bad line in release manifest $1 (expected KEY=VALUE)" ;;
    esac
    key=${line%%=*}
    val=${line#*=}
    printf '%s' "$key" | grep -Eq '^[A-Z][A-Z0-9_]*_IMAGE$' || die "not an image variable: $key"
    case $val in
      *:latest | *:latest@*) die "$key uses the latest tag; pin a digest" ;;
    esac
    printf '%s' "$val" | grep -Eq '^[A-Za-z0-9./:_-]+@sha256:[0-9a-f]{64}$' ||
      die "$key is not a digest reference (name@sha256:<64 hex>)"
    export "$key=$val"
    count=$((count + 1))
  done <"$1"
  [ "$count" -gt 0 ] || die "release manifest lists no images"
}

# Validates the merged compose config (read-only). It refuses a published 25565 or 25566 (decision 0082) and any
# image that is not digest-pinned. It checks `published:` only, because 25565 is also the container target of Velocity.
check_merged_config() {
  dc config --quiet || die "compose config does not validate"
  dc config >"$WORK/config.yml" || die "compose config failed"
  if grep -Eq 'published: *"?(25565|25566)"?$' "$WORK/config.yml"; then
    die "the merged config publishes 25565 or 25566 (decision 0082); refusing"
  fi
  if grep -E '^ +image: ' "$WORK/config.yml" | grep -Evq '@sha256:[0-9a-f]{64}$'; then
    die "an image in the merged config is not digest-pinned; refusing"
  fi
  say "compose config: valid; no public game port; every image digest-pinned"
}

# Fetches the BlueMap jar named by the lock file and checks its sha256 before anything uses it. A mismatch stops
# the deploy. The lock file is written by C1-09 (plugins/bluemap/bluemap.lock.json) as JSON with "url" and "sha256".
fetch_bluemap() {
  if [ ! -f "$BLUEMAP_LOCK" ]; then
    say "bluemap: no lock file at $BLUEMAP_LOCK; skipped (C1-09 adds it)"
    return 0
  fi
  need curl
  need sha256sum
  url=$(sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BLUEMAP_LOCK")
  want=$(sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BLUEMAP_LOCK")
  [ -n "$url" ] || die "bluemap lock has no url"
  printf '%s' "$want" | grep -Eq '^[0-9a-f]{64}$' || die "bluemap lock: sha256 is not 64 lowercase hex characters"
  case $url in
    https://* | file://*) ;;
    *) die "bluemap lock: the url must be https (file:// is for tests only)" ;;
  esac
  curl -fsSL -o "$WORK/bluemap.jar" "$url" || die "bluemap: download failed"
  got=$(sha256sum "$WORK/bluemap.jar" | awk '{print $1}')
  if [ "$got" != "$want" ]; then
    die "bluemap: sha256 mismatch (lock says $want, download is $got); nothing installed"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    say "bluemap: jar verified against the lock (dry run keeps nothing)"
  else
    mkdir -p "$STATE_DIR/bluemap" && mv "$WORK/bluemap.jar" "$STATE_DIR/bluemap/bluemap.jar" ||
      die "bluemap: cannot store the verified jar in $STATE_DIR/bluemap"
    say "bluemap: jar verified and stored in $STATE_DIR/bluemap"
  fi
}

# Saves the release being replaced (previous.env) and the one being applied (current.env) before any pull.
# If the record cannot be written, the deploy stops: nothing is applied without a record of what it replaced.
record_release() {
  if [ "$DRY_RUN" = 1 ]; then
    say "dry-run, not run: record the release in $STATE_DIR (previous.env, current.env)"
    return 0
  fi
  (
    umask 077
    mkdir -p "$STATE_DIR" || exit 1
    if [ -f "$STATE_DIR/current.env" ] && ! cmp -s "$STATE_DIR/current.env" "$RELEASE_FILE"; then
      cp "$STATE_DIR/current.env" "$STATE_DIR/previous.env" || exit 1
    fi
    cp "$RELEASE_FILE" "$STATE_DIR/current.env.new" && mv "$STATE_DIR/current.env.new" "$STATE_DIR/current.env"
  ) || die "cannot write the release record in $STATE_DIR; nothing deployed"
}
