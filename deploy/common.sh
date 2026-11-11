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
# The uid the containers run as (compose/colo.yml user:, Paper UID). The secrets directory and every secret file must be
# owned by it, so the deploy checks owners against it. Exported so compose sees the same value.
GELDAR_SERVICE_UID=${GELDAR_SERVICE_UID:-1000}
export GELDAR_SERVICE_UID

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

check_service_uid() {
  case $GELDAR_SERVICE_UID in
    '' | *[!0-9]*) die "GELDAR_SERVICE_UID must be a number (the containers' uid, default 1000)" ;;
  esac
  [ "$GELDAR_SERVICE_UID" -ne 0 ] || die "GELDAR_SERVICE_UID is 0; the containers must not run as root"
  runner=$(id -u) || die "cannot read the uid of this account"
  [ "$runner" -ne 0 ] || die "refusing to run the deploy as root (uid 0); run it as the operator account, not root"
}

check_prereqs() {
  check_service_uid
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

# Writes the merged compose config (read-only) to $WORK/config.yml once. Every check below reads that file.
merged_config() {
  if [ -s "$WORK/config.yml" ]; then return 0; fi
  dc config --quiet || die "compose config does not validate"
  dc config >"$WORK/config.yml" || die "compose config failed"
}

# The secret files the merged config declares (decision 0084): one NAME<TAB>PATH line per top-level secrets: entry,
# read from $WORK/config.yml. compose prints plain YAML, so awk is enough (no jq or python on the node).
# An entry with no file: has an empty PATH and is refused by check_secret.
secret_sources() {
  awk '
    function flush() {
      if (cur != "") printf "%s\t%s\n", cur, path
      cur = ""; path = ""
    }
    /^secrets:[[:space:]]*$/ { flush(); insec = 1; next }
    /^[^ ]/ { if (insec) flush(); insec = 0; next }
    insec && /^  [^ ]/ {
      flush(); cur = $0; sub(/^  /, "", cur); sub(/:[[:space:]]*$/, "", cur); gsub(/"/, "", cur); next
    }
    insec && /^    file:/ { path = $0; sub(/^    file:[[:space:]]*/, "", path); gsub(/"/, "", path) }
    END { flush() }
  ' "$WORK/config.yml"
}

# True when a resolved path is inside the secrets directory or compose/secrets (the two places compose reads them from).
inside_secrets_dir() {
  case $1 in "$SECRETS_REAL"/*) return 0 ;; esac
  [ -n "$COMPOSE_SECRETS_REAL" ] || return 1
  case $1 in "$COMPOSE_SECRETS_REAL"/*) return 0 ;; esac
  return 1
}

# Checks one secret file, named by its compose NAME and PATH. It never reads the contents. The file must exist, resolve
# (through any symlink) to a regular file inside an allowed directory, be non-empty, be mode 0600 or 0400, and be owned
# by GELDAR_SERVICE_UID (the uid the containers read it as).
check_secret() {
  name=$1
  p=$2
  base=${p##*/}
  [ -n "$p" ] || die "secret $name has no file source in the merged config; refusing"
  if [ ! -e "$p" ]; then
    hint=
    case $base in
      nats-*) hint=" (NATS files are written on a trusted machine by ./geldar.ps1 shard nats-auth colo, not on the node)" ;;
    esac
    die "secret file missing: $base (compose secret: $name, path: $p)$hint"
  fi
  real=$(readlink -f "$p") || die "cannot resolve secret file $base (compose secret: $name)"
  inside_secrets_dir "$real" || die "secret file $base (compose secret: $name) resolves outside the secrets directory; refusing"
  [ -f "$real" ] || die "secret file $base (compose secret: $name) is not a regular file"
  [ -s "$real" ] || die "secret file empty: $base (compose secret: $name)"
  m=$(stat -c %a "$real") || die "cannot stat secret file $base"
  case $m in
    600 | 400 | 0600 | 0400) ;;
    *) die "secret file $base has mode $m; it must be 0600 or 0400 (compose secret: $name)" ;;
  esac
  o=$(stat -c %u "$real") || die "cannot stat the owner of secret file $base"
  [ "$o" = "$GELDAR_SERVICE_UID" ] ||
    die "secret file $base is owned by uid $o; expected uid $GELDAR_SERVICE_UID (GELDAR_SERVICE_UID, compose secret: $name)"
}

# Checks every secret file that the MERGED config declares, so a secret added to compose/colo.yml or an overlay is
# checked with no change here. The nats-auth overlay mounts nats-auth.conf as a bind file, not a secret, so it is
# read from the merged config too. Nothing is generated on the node for the NATS files (decision 0084).
check_secrets() {
  [ -d "$GELDAR_SECRETS_DIR" ] || die "secrets directory missing: $GELDAR_SECRETS_DIR (deploy/README.md)"
  # Both sides of the containment test come from readlink -f, so they are spelled the same way (on Git for Windows
  # sh, pwd -P prints /tmp/... while readlink prints C:/... for the same directory).
  SECRETS_REAL=$(readlink -f "$GELDAR_SECRETS_DIR") || die "cannot open $GELDAR_SECRETS_DIR"
  o=$(stat -c %u "$SECRETS_REAL") || die "cannot stat the owner of $GELDAR_SECRETS_DIR"
  [ "$o" = "$GELDAR_SERVICE_UID" ] ||
    die "secrets directory $GELDAR_SECRETS_DIR is owned by uid $o; expected uid $GELDAR_SERVICE_UID (GELDAR_SERVICE_UID)"
  COMPOSE_SECRETS_REAL=
  if [ -d "$(dirname "$COMPOSE_FILE")/secrets" ]; then
    COMPOSE_SECRETS_REAL=$(readlink -f "$(dirname "$COMPOSE_FILE")/secrets") || die "cannot resolve compose/secrets"
  fi
  merged_config
  secret_sources >"$WORK/secrets.tsv"
  [ -s "$WORK/secrets.tsv" ] || die "the merged config declares no secret files; refusing (deploy/README.md)"
  tab=$(printf '\t')
  while IFS=$tab read -r name p; do
    check_secret "$name" "$p"
  done <"$WORK/secrets.tsv"
  conf=$(awk '/^ +source: / {src = $2} /^ +target: \/etc\/nats\/nats-auth\.conf$/ {print src}' "$WORK/config.yml")
  if [ -n "$conf" ]; then check_secret "nats-auth.conf (bind mount)" "$conf"; fi
  say "secret files: each file the merged config declares is present, non-empty and owner-only"
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
  merged_config
  if grep -Eq 'published: *"?(25565|25566)"?$' "$WORK/config.yml"; then
    die "the merged config publishes 25565 or 25566 (decision 0082); refusing"
  fi
  if grep -E '^ +image: ' "$WORK/config.yml" | grep -Evq '@sha256:[0-9a-f]{64}$'; then
    die "an image in the merged config is not digest-pinned; refusing"
  fi
  # A service with a build: key and no image: would be built from source on the node by `up`. Refused.
  unpinned=$(awk '/^  [A-Za-z0-9_-]+:$/ {svc = $1} /^    build:/ {b[svc] = 1} /^    image:/ {i[svc] = 1}
    END {for (s in b) if (!(s in i)) print s}' "$WORK/config.yml")
  [ -z "$unpinned" ] || die "service built on the node without a pinned image: $unpinned; refusing"
  say "compose config: valid; no public game port; every image digest-pinned"
}

# Fetches the BlueMap jar named by the lock file and checks its sha256 before anything uses it. A mismatch stops
# the deploy. The lock file is plugins/bluemap/bluemap.lock.json (C1-09), JSON with "url" and "sha256".
fetch_bluemap() {
  if [ ! -f "$BLUEMAP_LOCK" ]; then
    say "bluemap: no lock file at $BLUEMAP_LOCK; skipped"
    return 0
  fi
  need curl
  need sha256sum
  url=$(sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BLUEMAP_LOCK")
  want=$(sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BLUEMAP_LOCK")
  [ -n "$url" ] || die "bluemap lock has no url"
  printf '%s' "$want" | grep -Eq '^[0-9a-f]{64}$' || die "bluemap lock: sha256 is not 64 lowercase hex characters"
  case $url in
    https://*) ;;
    file://*)
      # file:// exists only so the tests can use a local fixture jar; production never sets this variable.
      [ "${GELDAR_DEPLOY_ALLOW_FILE_URL:-0}" = 1 ] || die "bluemap lock: the url must be https (file:// is test-only)"
      ;;
    *) die "bluemap lock: the url must be https" ;;
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
