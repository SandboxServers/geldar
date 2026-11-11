# Shared settings and checks for the Colo deploy scripts (decision 0084). Sourced by deploy/colo-*.sh and
# deploy/gen-secrets.sh; it is not run by itself. Every target comes from the environment. No host, address,
# account or secret value is set here or printed by any script. POSIX sh (dash on Debian 12, and bash in tests).

DEPLOY_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT=geldar-colo
ROOT=${GELDAR_COLO_ROOT:-$(cd "$DEPLOY_DIR/.." && pwd)}
COMPOSE_FILE=${GELDAR_COLO_COMPOSE:-$ROOT/compose/colo.yml}
SECRETS_OVERLAY=$DEPLOY_DIR/compose.secrets.yml
# NATS auth (decision 0080, default-on): the overlay beside the colo file. It gives nats the auth config and the
# per-role password files, and it is merged on every compose call so the deploy never runs open NATS.
# It is merged BEFORE the secrets overlay: it names its secrets as ./secrets/..., and the later file wins, so the
# secrets overlay must come last to point every NATS secret at GELDAR_SECRETS_DIR.
NATS_OVERLAY=$(dirname "$COMPOSE_FILE")/nats-auth.yml
EXTRA_OVERLAY=${GELDAR_COLO_EXTRA_OVERLAY:-}
GELDAR_SECRETS_DIR=${GELDAR_SECRETS_DIR:-/etc/geldar-colo/secrets}
export GELDAR_SECRETS_DIR
RELEASE_FILE=${GELDAR_RELEASE_FILE:-/etc/geldar-colo/release.env}
STATE_DIR=${GELDAR_STATE_DIR:-/var/lib/geldar-colo}
export GELDAR_STATE_DIR=$STATE_DIR # compose mounts $GELDAR_STATE_DIR/bluemap/bluemap.jar into Paper (C2-07o)
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
  public_overlay
  # colo-up.sh sets HOLD_PUBLIC=1 until the stack is healthy: the port is published by the last `up` only.
  if [ "${HOLD_PUBLIC:-0}" = 1 ]; then PUBLIC_OVERLAY=; fi
  if [ -n "$PUBLIC_OVERLAY" ] && [ -n "$EXTRA_OVERLAY" ]; then
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" -f "$NATS_OVERLAY" -f "$SECRETS_OVERLAY" -f "$PUBLIC_OVERLAY" -f "$EXTRA_OVERLAY" "$@"
  elif [ -n "$PUBLIC_OVERLAY" ]; then
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" -f "$NATS_OVERLAY" -f "$SECRETS_OVERLAY" -f "$PUBLIC_OVERLAY" "$@"
  elif [ -n "$EXTRA_OVERLAY" ]; then
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" -f "$NATS_OVERLAY" -f "$SECRETS_OVERLAY" -f "$EXTRA_OVERLAY" "$@"
  else
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" -f "$NATS_OVERLAY" -f "$SECRETS_OVERLAY" "$@"
  fi
}

# The public Minecraft port overlay (compose/colo-public.yml) is merged only when the node env sets both
# GELDAR_MC_BIND and GELDAR_MC_PORT. Exactly one set is refused, and so is a wildcard bind: the bind must be the node's
# own interface address. Sets PUBLIC_OVERLAY (empty when the overlay is off). No address is kept in the repo.
public_overlay() {
  PUBLIC_OVERLAY=
  bind=${GELDAR_MC_BIND:-}
  port=${GELDAR_MC_PORT:-}
  if [ -z "$bind" ] && [ -z "$port" ]; then return 0; fi
  [ -n "$bind" ] || die "GELDAR_MC_PORT is set but GELDAR_MC_BIND is not; set both or neither (deploy/README.md)"
  [ -n "$port" ] || die "GELDAR_MC_BIND is set but GELDAR_MC_PORT is not; set both or neither (deploy/README.md)"
  case $bind in
    0.0.0.0 | '::' | '[::]' | '0:0:0:0:0:0:0:0') die "GELDAR_MC_BIND is a wildcard address; it must be the node's own interface address" ;;
  esac
  # One IPv4 literal only: four decimal octets 0-255, no leading zeros, no hostname, no IPv6, no list.
  printf '%s' "$bind" | grep -Eq '^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$' ||
    die "GELDAR_MC_BIND must be one IPv4 literal (a.b.c.d); no hostname, IPv6 or list"
  oldifs=$IFS
  IFS=.
  # shellcheck disable=SC2086
  set -- $bind
  IFS=$oldifs
  for octet in "$@"; do
    [ "$octet" -le 255 ] || die "GELDAR_MC_BIND must be one IPv4 literal (a.b.c.d): octet $octet is above 255"
  done
  case $port in
    '' | *[!0-9]*) die "GELDAR_MC_PORT must be a number" ;;
  esac
  [ "${#port}" -le 5 ] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || die "GELDAR_MC_PORT must be between 1 and 65535"
  case $port in
    25565 | 25566) die "GELDAR_MC_PORT must not be 25565 or 25566 (decision 0082); pick another public port" ;;
  esac
  PUBLIC_OVERLAY=$(dirname "$COMPOSE_FILE")/colo-public.yml
  [ -f "$PUBLIC_OVERLAY" ] || die "public overlay not found: $PUBLIC_OVERLAY"
}

plan_header() {
  say "project: $PROJECT"
  public_overlay
  say "compose: $COMPOSE_FILE (+ $SECRETS_OVERLAY + $NATS_OVERLAY${PUBLIC_OVERLAY:+ + $PUBLIC_OVERLAY}${EXTRA_OVERLAY:+ + $EXTRA_OVERLAY})"
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
  [ -f "$NATS_OVERLAY" ] || die "NATS auth overlay not found: $NATS_OVERLAY"
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
# checked with no change here. nats-auth.conf is one of them: compose/nats-auth.yml mounts it as a secret, and
# deploy/compose.secrets.yml names it under GELDAR_SECRETS_DIR. Nothing is generated on the node for the NATS files (decision 0084).
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
  # A bind mount of an absolute host path is checked here too. A service secret prints its source as a bare name, which
  # the loop above already checked through its top-level file, so only an absolute source is taken. The source is kept
  # for one list item only (reset at each "- "), so an unrelated bind mount's source never carries over to a later
  # item's target (C2-07g: the colo-mind.yaml bind mount was read as the nats-auth.conf secret).
  conf=$(awk '/^ +- / {src = ""} /^ +(- )?source: (\/|[A-Za-z]:\/)/ {src = $NF} /^ +target: \/etc\/nats\/nats-auth\.conf$/ {print src}' "$WORK/config.yml")
  if [ -n "$conf" ]; then check_secret "nats-auth.conf (bind mount)" "$conf"; fi
  say "secret files: each file the merged config declares is present, non-empty and owner-only"
}

# The two plugin jars are bind-mounted as files (compose/colo.yml). When a jar path is missing at container start, Docker
# creates it as a root-owned DIRECTORY, and the container then fails. That happened after an operator moved `src` while
# a container restarted (C2-07j). Refuse here when a needed jar path is a directory; a missing path is the build's concern.
# GELDAR_PLUGIN_DIR overrides the plugin directory (the tests use it).
check_jar_sources() {
  pdir=${GELDAR_PLUGIN_DIR:-$(dirname "$COMPOSE_FILE")/../plugin}
  for rel in core/build/libs/geldar-core.jar velocity-identity/build/libs/geldar-velocity-identity.jar; do
    if [ -d "$pdir/$rel" ]; then
      die "bind-mount source $pdir/$rel is a directory where a file is expected (Docker made it while the jar was missing); stop the project's containers, run: rmdir '$pdir/$rel', rebuild the plugins, then run colo-up again (deploy/README.md, replacing src)"
    fi
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

# Trusted proxies (ruling R32): Glass and the MCP trust the colo bridge gateway, which is the peer address a host-network
# Caddy shows. The two lists live in the node env file (STATE_DIR/node.env, mode 0600, KEY=VALUE as data, never sourced).
# load_node_env fills an unset variable from the file and exports both; save_node_env writes the values in force.
NODE_PROXY_VARS="GELDAR_GLASS_TRUSTED_PROXIES GELDAR_MCP_TRUSTED_PROXIES"
NODE_ENV_VARS="$NODE_PROXY_VARS GELDAR_COLO_SUBNET REGISTER_TRUSTED_PEERS"
load_node_env() {
  for v in $NODE_ENV_VARS; do
    eval "cur=\${$v:-}"
    if [ -z "$cur" ] && [ -f "$STATE_DIR/node.env" ]; then
      cur=$(sed -n "s/^$v=//p" "$STATE_DIR/node.env" | tail -n 1)
      [ -z "$cur" ] || printf '%s' "$cur" | grep -Eq '^[0-9A-Fa-f:.,/]*$' || die "$v in $STATE_DIR/node.env has characters that are not an address list"
    fi
    if [ -n "$cur" ]; then
      eval "$v=\$cur"
      export "${v?}"
    fi
  done
}

save_node_env() {
  if [ "$DRY_RUN" = 1 ]; then
    say "dry-run, not run: persist the trusted proxy lists in $STATE_DIR/node.env"
    return 0
  fi
  (
    umask 077
    mkdir -p "$STATE_DIR" || exit 1
    : >"$STATE_DIR/node.env.new"
    for v in $NODE_ENV_VARS; do
      eval "cur=\${$v:-}"
      [ -z "$cur" ] || echo "$v=$cur" >>"$STATE_DIR/node.env.new"
    done
    mv "$STATE_DIR/node.env.new" "$STATE_DIR/node.env"
  ) || die "cannot write the node env file in $STATE_DIR; nothing deployed"
}

# Prints the node env values in force (the bridge subnet is what keeps the gateway address stable).
say_node_env() {
  say "trusted proxies: glass=${GELDAR_GLASS_TRUSTED_PROXIES:-unset} mcp=${GELDAR_MCP_TRUSTED_PROXIES:-unset}"
  say "colo subnet: ${GELDAR_COLO_SUBNET:-unset (compose default, the gateway trust will not match)}"
}

# True when every proxy list is set to something other than the loopback default.
proxies_set() {
  for v in $NODE_PROXY_VARS; do
    eval "cur=\${$v:-}"
    [ -n "$cur" ] && [ "$cur" != 127.0.0.1 ] || return 1
  done
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
