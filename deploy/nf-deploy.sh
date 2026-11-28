#!/bin/sh
# Operator script for the live NeoForge project (compose project geldar-nf, compose/nf-live.yml). Run it on the node from an
# exported tree (a git checkout is refused unless --local, which the tests use), as the operator account (never root, and
# never with elevated rights). Verbs: plan (prints the gates and the steps, changes nothing), up (refuses an unseeded
# neoforge-data volume), seed-bundle (once per volume: extracts the offline bundle tarball into it), refresh-secrets (after a secret file's content changes; no volume removed), status, down [--volumes], logs <service>,
# probe (one golem body probe run, with the overlay compose/nf-live-probe.yml added for that run only; section 4c of the runbook).
# The project name and the base compose file are constants here. deploy/common.sh (the colo model) is NOT sourced, and the script
# refuses to run when GELDAR_PROJECT or GELDAR_COLO_COMPOSE is set, so no colo setting can reach this project.
# It never names golem-body or players-host (they are not services of compose/nf-live.yml). down removes containers and
# networks; --volumes also removes the project's volumes, after the operator types the project name. DEPLOY_DRY_RUN=1 prints
# the steps of up and down without running them; the gates still run. Inputs come from the environment, never the repo:
#   NF_MOD_JAR_HOST, NF_MOD_SHA256     the pinned geldar NeoForge mod jar and its sha256 (64 lowercase hex)
#   NF_BUNDLE_TARBALL, NF_BUNDLE_TARBALL_SHA256   seed-bundle only: the absolute path of the bundle tarball and its sha256
#                                      (plan and up need no bundle input: the seeded volume's marker check is the gate)
#   NF_TELEMETRY (default off)         on adds compose/nf-live-telemetry.yml and joins neoforge to the external network
#                                      geldar-telemetry (plan and up only; down and status never read these). With on, the inputs are
#                                      NF_LEDGER_JAR_HOST, NF_LEDGER_SHA256 (the ledger jar's sha256), NF_OTEL_AGENT_HOST (its sha256
#                                      must equal the pin in the overlay), NF_OTEL_AGENT_PROPS_HOST and NF_LEDGER_PROPS_HOST (absolute
#                                      regular files). Any other NF_TELEMETRY value refuses, and so does on while compose/neoforge/neoforge-entrypoint.sh has no
#                                      GELDAR_NF_TELEMETRY. NF_TELEMETRY=on has NO effect on the JVM until entrypoint packet B (PR #701)
#                                      is merged: do not set it before.
#   NF_TELEMETRY=off (explicit)        the rollback: adds compose/nf-live-telemetry-off.yml (plan and up only). It sets
#                                      GELDAR_NF_TELEMETRY=off, so the entrypoint removes our own stale ledger jar copy and starts
#                                      no agent. Unset adds no overlay, so a stale jar makes the start refuse, by design.
#   NF_HUMAN (default off)             on adds compose/nf-live-human.yml (the velocity-human lane; loopback unless NF_HUMAN_BIND
#                                      says otherwise). NF_HUMAN_BIND must be one IPv4 address (not 0.0.0.0). human-down removes velocity-human and velocity-human-init only. Unset or off never starts it.
#   The compose shapes: dc() renders six (the base, with telemetry on, with telemetry off or with neither, each with or without
#   compose/nf-live-human.yml); probe_dc() renders a seventh, the base plus compose/nf-live-probe.yml, for one run.
#   NF_SECRETS_DIR                     the secret files (default compose/secrets-nf)
#   NF_SERVICE_UID (default 1000), NF_SERVICE_GID (default NF_SERVICE_UID): the uid:gid the services run as and that owns
#                                      the seeded volume. The default 1000 is not the node: its ops account is uid 1001, so the
#                                      operator must export NF_SERVICE_UID=1001 (the default itself is unchanged).
# Runbook: docs/runbooks/nf-live-project.md (section 6).
set -eu

PROJECT=geldar-nf
ROOT=$(cd "$(dirname "$0")/.." && pwd)
COMPOSE_FILE=$ROOT/compose/nf-live.yml
PROBE_FILE=$ROOT/compose/nf-live-probe.yml
SERVICES="nats postgres eventsink identity-seed velocity neoforge"
# The secret files compose/nf-live.yml declares under ${NF_SECRETS_DIR:-./secrets-nf}. A test keeps this list in sync.
SECRET_FILES="postgres.txt velocity-forwarding.txt nats-auth.conf nats-sink.txt nats-neoforge.txt nats-velocity.txt nats-deploy.txt nats-seed.txt rcon.txt nats-body.txt"
# The one published host port (127.0.0.1:46565, velocity). Nothing else may listen on it.
PORT=46565
# Memory: the sum of the memory caps in compose/nf-live.yml, in MiB (neoforge 12288, postgres 2048, velocity 1024, nats 512,
# eventsink 512, identity-seed 256). Measured on the node 2026-11-17: 91 GiB available of 125 GiB. The margin is 8 GiB.
MEM_CAPS_MIB=16640
MEM_MARGIN_MIB=8192
# Disk: the free-space floor for the project's volumes and images, in KiB (50 GiB). Measured 2026-11-17: 1.1T free on /mnt/nvme.
MIN_FREE_DISK_KB=52428800
# The NeoForge data volume. compose/nf-live.yml declares neoforge-data with no name:, so compose names it <project>_neoforge-data.
VOLUME=${PROJECT}_neoforge-data
# Telemetry (NF_TELEMETRY=on only): the overlay plan and up add, and the external network it joins. The stack owns the network:
# this script never creates, removes or prunes it. TELEMETRY is 1 only after check_telemetry sees on.
TELEMETRY_FILE=$ROOT/compose/nf-live-telemetry.yml
TELEMETRY_NETWORK=geldar-telemetry
TELEMETRY=0
# Rollback (NF_TELEMETRY=off set explicitly; plan and up only, like the overlay above): the off overlay sets GELDAR_NF_TELEMETRY=off,
# so the entrypoint removes our own stale ledger jar copy. Unset adds nothing; the default render is unchanged.
OFF_FILE=$ROOT/compose/nf-live-telemetry-off.yml
TELEMETRY_OFF=0
# The human lane (velocity-human, NF_HUMAN=on only) lives in deploy/nf-human-lib.sh: its paths, its flag and its functions.
. "$(dirname "$0")/nf-human-lib.sh"
# The optional extra mods (NF_EXTRA_MODS, deploy/nf-extra-mods-lib.sh): one overlay per enabled name, checked in gates().
. "$(dirname "$0")/nf-extra-mods-lib.sh"
# The rangers lane (geldar-mcp and the five players-host Bodies, NF_RANGERS=on only) lives in deploy/nf-rangers-lib.sh.
. "$(dirname "$0")/nf-rangers-lib.sh"

die() {
  echo "nf-deploy: error: $*" >&2
  exit 1
}

say() {
  echo "nf-deploy: $*"
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

# Every compose call goes through here: the constant project and the one compose file, nothing else.
dc() {
  # Each set -- prepends one overlay. The extra mod overlays go in first (in reverse, so they keep the allowlist order), so the -f
  # order is compose, telemetry or off, human, then the extra mods. Unset NF_EXTRA_MODS: EXTRA_ENABLED is empty and nothing is added.
  rev=""
  for name in $EXTRA_ENABLED; do rev="$name $rev"; done
  for name in $rev; do set -- -f "$ROOT/compose/nf-live-mod-$name.yml" "$@"; done
  # Each set -- prepends one overlay: the human file first, so the -f order is compose, telemetry or off, then human.
  if [ "$HUMAN" = 1 ]; then set -- -f "$HUMAN_FILE" "$@"; fi
  if [ "$TELEMETRY" = 1 ]; then
    set -- -f "$TELEMETRY_FILE" "$@"
  elif [ "$TELEMETRY_OFF" = 1 ]; then
    set -- -f "$OFF_FILE" "$@"
  fi
  if [ "$RANGERS" = 1 ]; then set -- -f "$RANGERS_FILE" "$@"; fi
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"
}

# Runs a state-changing step, or names it in dry-run mode.
act() {
  if [ "${DEPLOY_DRY_RUN:-0}" = 1 ]; then
    say "dry-run, not run: $*"
  else
    "$@"
  fi
}

# Refuses the colo settings: this script never reads them, so a set value means the operator mixed the two projects.
if [ -n "${GELDAR_PROJECT+x}" ]; then
  die "GELDAR_PROJECT is set; this script always uses project geldar-nf and never reads it. Unset it and rerun."
fi
if [ -n "${GELDAR_COLO_COMPOSE+x}" ]; then
  die "GELDAR_COLO_COMPOSE is set; this script always uses compose/nf-live.yml and never reads it. Unset it and rerun."
fi

verb=${1:-}
if [ "$#" -gt 0 ]; then shift; fi
LOCAL=0
VOLUMES=0
SERVICE=
for arg in "$@"; do
  case $arg in
    --local) LOCAL=1 ;;
    --volumes) VOLUMES=1 ;;
    -*) die "unknown option: $arg" ;;
    *)
      [ -z "$SERVICE" ] || die "one service name at most"
      SERVICE=$arg
      ;;
  esac
done
case $verb in
  plan | up | status | seed-bundle | probe) [ -z "$SERVICE" ] || die "$verb takes no service name" ;;
  down) [ -z "$SERVICE" ] || die "down takes no service name" ;;
  human-down) [ -z "$SERVICE" ] || die "human-down takes no service name" ;;
  rangers-down) [ -z "$SERVICE" ] || die "rangers-down takes no service name" ;;
  refresh-secrets) [ -z "$SERVICE" ] || die "refresh-secrets takes no service name" ;;
  logs)
    [ -n "$SERVICE" ] || die "logs needs a service: one of $SERVICES"
    case " $SERVICES velocity-human " in
      *" $SERVICE "*) ;;
      *) die "unknown service: $SERVICE (one of $SERVICES)" ;;
    esac
    ;;
  *)
    echo "usage: nf-deploy.sh plan|up|refresh-secrets|status|down [--volumes] [--local]|human-down [--local]|rangers-down [--local]|logs <service> [--local]|seed-bundle [--local]|probe [--local]" >&2
    exit 2
    ;;
esac
if [ "$VOLUMES" = 1 ] && [ "$verb" != down ]; then die "--volumes is for down only"; fi

# A checkout has a .git entry at its root. The node runs an exported tree, so a checkout is refused unless --local.
if [ -e "$ROOT/.git" ] && [ "$LOCAL" != 1 ]; then
  die "$ROOT is a git checkout; run this from an exported tree on the node (--local is for the tests)"
fi

check_operator() {
  need docker
  [ "$(id -u)" -ne 0 ] || die "refusing to run as root; run it as the operator account"
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is not available"
  docker info >/dev/null 2>&1 || die "cannot reach the docker daemon (is this account in the docker group?)"
  [ -f "$COMPOSE_FILE" ] || die "compose file not found: $COMPOSE_FILE"
}

check_service_uid() {
  SERVICE_UID=${NF_SERVICE_UID:-1000}
  SERVICE_GID=${NF_SERVICE_GID:-$SERVICE_UID}
  case $SERVICE_UID in
    '' | *[!0-9]*) die "NF_SERVICE_UID must be a number (default 1000)" ;;
  esac
  case $SERVICE_GID in
    '' | *[!0-9]*) die "NF_SERVICE_GID must be a number (default NF_SERVICE_UID)" ;;
  esac
  [ "$SERVICE_UID" -ne 0 ] || die "NF_SERVICE_UID is 0; the containers must not run as root"
  [ "$SERVICE_GID" -ne 0 ] || die "NF_SERVICE_GID is 0; the containers must not run as root"
  export NF_SERVICE_UID=$SERVICE_UID NF_SERVICE_GID=$SERVICE_GID
  # The owner the seeded volume and the services use: one uid:gid string for every docker --user.
  SERVICE_OWNER=$SERVICE_UID:$SERVICE_GID
}

# Refuses when a geldar-nf container carries a geldar-colo label (its compose project, or the colo stack label).
check_no_colo_labels() {
  labels=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Labels}}') ||
    die "cannot list the $PROJECT containers"
  if printf '%s\n' "$labels" | grep -Eq 'com\.docker\.compose\.project=geldar-colo|com\.geldar\.stack=colo'; then
    die "a $PROJECT container carries a geldar-colo label; refusing (this script never touches the autonomous shard)"
  fi
}

# The one listener the project may have on its port: its own velocity container, whose Ports field has exactly one published
# mapping, 127.0.0.1:$PORT->25565/tcp (compose/nf-live.yml), under the exact compose project and service labels. The Ports
# field is split on ", ": a token without "->" is an unpublished (exposed) port, e.g. 25577/tcp from the image's EXPOSE, and
# is ignored in any position. Any other published token (a second mapping, 0.0.0.0, [::], another port), a different project
# or service, a second velocity row, output that does not parse or a docker failure refuse. The project lists one row per
# container (velocity, neoforge, eventsink, postgres, nats), so only the rows whose service is velocity are counted: the
# awk counts every row for the parse check, then keeps exactly one velocity row. On refusal it prints one reason on
# stdout and returns 1. Called only once a listener is found.
# Generalised for the human lane: $1 is the service (velocity, or velocity-human), $2 the bind address and $3 the host port; the
# one published mapping must be exactly $2:$3->25565/tcp. Only rows of service $1 count; the other services' rows are ignored.
# $4 is the container port (default 25565; the rangers' geldar-mcp publishes 8788).
own_service_on_port() {
  cport=${4:-25565}
  rows=$(docker ps --filter "label=com.docker.compose.project=$PROJECT" \
    --format '{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.Ports}}') ||
    { echo "docker ps failed"; return 1; }
  printf '%s\n' "$rows" | awk -F'|' -v p="$PROJECT" -v svc="$1" -v want="$2:$3->$cport/tcp" '
    NF == 0 { next }
    NF != 3 { bad = 1; next }
    { all++ }
    $2 != svc { next }
    { n++; proj = $1; ports = $3 }
    END {
      if (bad) { print "docker output does not parse"; exit 1 }
      if (all == 0) { print "no docker row"; exit 1 }
      if (n == 0) { print "wrong service"; exit 1 }
      if (n != 1) { print "more than one docker ps row"; exit 1 }
      if (proj != p) { print "wrong compose project"; exit 1 }
      pub = 0; ok = 0
      k = split(ports, t, ", ")
      for (i = 1; i <= k; i++) if (index(t[i], "->") > 0) { pub++; tok = t[i]; if (t[i] == want) ok = 1 }
      if (pub == 0) { print "unpublished only (no published mapping)"; exit 1 }
      if (pub > 1) { print "more than one published mapping"; exit 1 }
      if (!ok) { print "published mapping is not exactly " want ": " tok; exit 1 }
    }'
}

check_port() {
  check_listener "$PORT" 127.0.0.1 velocity
}

# Host port $1 on address $2 must be free, or held only by $PROJECT's own service $3 with its one mapping $2:$1->25565/tcp.
# Every listener socket must be on $2:$1 (a second socket on another address refuses). Otherwise the message names the check.
check_listener() {
  need ss
  listeners=$(ss -Hltn "sport = :$1") || die "cannot read the listening sockets (ss)"
  [ -n "$listeners" ] || return 0
  if printf '%s\n' "$listeners" | awk -v want="$2:$1" 'NF && $4 != want { bad = 1 } END { exit bad + 0 }'; then
    reason=$(own_service_on_port "$3" "$2" "$1" "${4:-25565}") && return 0
  else
    reason="ss socket not $2:$1"
  fi
  die "something already listens on port $1; the project's published port must be free (only $PROJECT's own $3 on $2:$1 is accepted); own $3 check failed: $reason"
}

check_secrets() {
  secdir=${NF_SECRETS_DIR:-$ROOT/compose/secrets-nf}
  [ -d "$secdir" ] || die "secrets directory missing: $secdir (the per-shard NF secrets step writes it; see the runbook)"
  for f in $SECRET_FILES $(rangers_secret_files); do
    p=$secdir/$f
    [ -f "$p" ] || die "secret file missing: $f"
    [ -s "$p" ] || die "secret file empty: $f"
    mode=$(stat -c %a "$p") || die "cannot read the mode of $f"
    case $mode in
      600 | 400) ;;
      *) die "secret file $f has mode $mode; it must be 0600 or 0400" ;;
    esac
    owner=$(stat -c %u "$p") || die "cannot read the owner of $f"
    [ "$owner" = "$SERVICE_UID" ] || die "secret file $f is owned by uid $owner; expected $SERVICE_UID (NF_SERVICE_UID)"
  done
}

# The mod jar: the sha256 of the file on the host must equal NF_MOD_SHA256 (the same check scratch.sh makes).
check_mod_jar() {
  [ -n "${NF_MOD_JAR_HOST:-}" ] || die "NF_MOD_JAR_HOST is not set (the pinned geldar NeoForge mod jar)"
  want=${NF_MOD_SHA256:-}
  printf '%s' "$want" | grep -Eq '^[0-9a-f]{64}$' || die "NF_MOD_SHA256 must be 64 lowercase hex digits"
  [ -f "$NF_MOD_JAR_HOST" ] || die "mod jar not found at NF_MOD_JAR_HOST"
  need sha256sum
  # The file goes in on stdin: GNU sha256sum prefixes a backslash to a name that contains one (Windows paths in the tests).
  got=$(sha256sum <"$NF_MOD_JAR_HOST" | awk '{print $1}')
  [ "$got" = "$want" ] || die "the sha256 of the mod jar does not match NF_MOD_SHA256; nothing started"
}

# Telemetry is off unless NF_TELEMETRY is set to on (an empty value refuses). On, the host inputs are checked here, before
# any docker call: absolute regular files without whitespace, quotes, backslash or dollar; the ledger jar's sha256 against
# NF_LEDGER_SHA256; the OTel agent jar's sha256 against the pin in the overlay (read from the file, one copy).
check_host_file() {
  name=$1
  p=$2
  [ -n "$p" ] || die "$name is not set (NF_TELEMETRY=on needs it)"
  case $p in
    /*) ;;
    # A drive-letter form is accepted only so the Windows test fixtures pass (as the bundle tarball check does); the node is Linux.
    [A-Za-z]:/*) ;;
    *) die "$name must be an absolute path" ;;
  esac
  case $p in
    *[[:space:]]* | *\"* | *\'* | *\\* | *\$*) die "$name has whitespace, a quote, a backslash or a dollar; refusing" ;;
  esac
  [ ! -L "$p" ] || die "$name is a symlink; give the regular file"
  [ -f "$p" ] || die "$name is not a regular file"
  case $p in
    # The parent must be its real path: a symlinked directory would hide the file that is hashed (Linux node form).
    /*) [ "$(cd "$(dirname "$p")" && pwd -P)/$(basename "$p")" = "$p" ] || die "$name is under a symlinked directory; give the real path" ;;
  esac
}

check_telemetry_inputs() {
  check_host_file NF_LEDGER_JAR_HOST "${NF_LEDGER_JAR_HOST:-}"
  check_host_file NF_OTEL_AGENT_HOST "${NF_OTEL_AGENT_HOST:-}"
  check_host_file NF_OTEL_AGENT_PROPS_HOST "${NF_OTEL_AGENT_PROPS_HOST:-}"
  check_host_file NF_LEDGER_PROPS_HOST "${NF_LEDGER_PROPS_HOST:-}"
  want=${NF_LEDGER_SHA256:-}
  printf '%s' "$want" | grep -Eq '^[0-9a-f]{64}$' || die "NF_LEDGER_SHA256 must be 64 lowercase hex digits"
  need sha256sum
  got=$(sha256sum <"$NF_LEDGER_JAR_HOST" | awk '{print $1}')
  [ "$got" = "$want" ] || die "the sha256 of the ledger jar does not match NF_LEDGER_SHA256; nothing started"
  pin=$(awk -F'"' '/^ *GELDAR_NF_OTEL_AGENT_SHA256:/ { print $2; exit }' "$TELEMETRY_FILE")
  printf '%s\n' "$pin" | grep -Eq '^[0-9a-f]{64}$' || die "the agent pin in $TELEMETRY_FILE is not 64 lowercase hex digits"
  got=$(sha256sum <"$NF_OTEL_AGENT_HOST" | awk '{print $1}')
  [ "$got" = "$pin" ] || die "the sha256 of the OTel agent jar is not the pinned agent (GELDAR_NF_OTEL_AGENT_SHA256 in the overlay); nothing started"
  say "telemetry: the ledger jar and the OTel agent jar match their pins (no docker call made yet)"
}

check_telemetry() {
  case ${NF_TELEMETRY-off} in
    off) TELEMETRY=0; [ -z "${NF_TELEMETRY+x}" ] || TELEMETRY_OFF=1 ;;
    on)
      # The entrypoint of packet B (PR #701) reads GELDAR_NF_TELEMETRY. Without it the overlay mounts and joins, and no agent loads.
      grep -Fq GELDAR_NF_TELEMETRY "$ROOT/compose/neoforge/neoforge-entrypoint.sh" 2>/dev/null ||
        die "compose/neoforge/neoforge-entrypoint.sh has no GELDAR_NF_TELEMETRY (PR #701 is not merged): on would start nothing; refusing"
      TELEMETRY=1
      check_telemetry_inputs
      ;;
    *) die "NF_TELEMETRY must be on or off (default off); refusing" ;;
  esac
}

# On, the external network must already exist (the telemetry stack creates it). Checked before anything starts.
check_telemetry_network() {
  [ "$TELEMETRY" = 1 ] || return 0
  docker network inspect "$TELEMETRY_NETWORK" >/dev/null 2>&1 ||
    die "docker network $TELEMETRY_NETWORK does not exist on this node; start the geldar-telemetry stack first (nothing started)"
}

# The image of the neoforge service in compose/nf-live.yml: the one pinned reference, read from the file (no second copy here).
compose_image() {
  img=$(awk '/^  [a-z][a-z-]*:$/ { svc = ($1 == "neoforge:") } svc && /^    image: / { print $2; exit }' "$COMPOSE_FILE")
  printf '%s\n' "$img" | grep -Eq '^itzg/minecraft-server:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$' ||
    die "the neoforge image in $COMPOSE_FILE is not a pinned itzg/minecraft-server reference"
  printf '%s\n' "$img"
}

# The volume is seeded when its bundle marker verifies. Read-only, no network, as the service uid:gid (the owner seed-bundle
# chowned /data to): the marker check runs as the same owner the services run as.
seed_marker_ok() {
  docker run --rm --network none --user "$SERVICE_OWNER" -v "$VOLUME:/data:ro" --entrypoint /bin/sh "$IMAGE" \
    -c 'cd /data && sha256sum -c --strict --status .geldar-bundle.sha256' >/dev/null 2>&1
}

# up refuses an unseeded volume: a missing volume, or one whose marker does not verify, is not seeded.
check_seeded() {
  IMAGE=$(compose_image) || exit 1
  if ! docker volume inspect "$VOLUME" >/dev/null 2>&1 || ! seed_marker_ok; then
    die "volume $VOLUME is not seeded with the NeoForge bundle; run nf-deploy.sh seed-bundle once (runbook section 7), then up"
  fi
  say "neoforge-data: seeded (the bundle marker verifies)"
}

# The tarball must be an absolute regular file with the expected sha256 (the stdin form). Its archive must hold no absolute
# path, no ../ segment, no link or device (only regular files and directories) and the marker. Nothing is extracted before these pass.
check_seed_inputs() {
  TARBALL=${NF_BUNDLE_TARBALL:-}
  # A drive-letter path is accepted only so the Windows test fixtures pass; the node is Linux and a drive letter is no path there.
  case $TARBALL in
    /* | [A-Za-z]:[\\/]*) ;;
    *) die "NF_BUNDLE_TARBALL must be an absolute path to the bundle tarball" ;;
  esac
  case $TARBALL in
    *,*) die "NF_BUNDLE_TARBALL must not contain a comma (docker --mount syntax)" ;;
  esac
  [ ! -L "$TARBALL" ] || die "NF_BUNDLE_TARBALL is a symlink; give the regular file"
  [ -f "$TARBALL" ] || die "NF_BUNDLE_TARBALL is not a regular file"
  want=${NF_BUNDLE_TARBALL_SHA256:-}
  printf '%s' "$want" | grep -Eq '^[0-9a-f]{64}$' || die "NF_BUNDLE_TARBALL_SHA256 must be 64 lowercase hex digits"
  need sha256sum
  got=$(sha256sum <"$TARBALL" | awk '{print $1}')
  [ "$got" = "$want" ] || die "the sha256 of the tarball does not match NF_BUNDLE_TARBALL_SHA256; nothing extracted"
  need tar
  names=$(tar -tzf "$TARBALL") || die "cannot list the tarball"
  verbose=$(tar -tzvf "$TARBALL") || die "cannot list the tarball with entry types"
  bad=$(printf '%s\n' "$names" | awk '/^\// || /^[A-Za-z]:/ || /^-/ || /(^|\/)\.\.(\/|$)/ { print; exit }')
  [ -z "$bad" ] || die "the tarball holds an absolute, dash-led or ../ entry ($bad); nothing extracted"
  odd=$(printf '%s\n' "$verbose" | awk 'NF && substr($0, 1, 1) != "-" && substr($0, 1, 1) != "d" { print; exit }')
  [ -z "$odd" ] || die "the tarball holds a symlink, hardlink or device entry ($odd); nothing extracted"
  printf '%s\n' "$names" | grep -Fxq -e .geldar-bundle.sha256 -e ./.geldar-bundle.sha256 ||
    die "the tarball has no .geldar-bundle.sha256 marker; it is not a bundle"
}

# The volume must hold nothing: a seeded volume is never overwritten. A missing volume is empty (the extract creates it).
check_volume_empty() {
  if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    # Listed as root: a half-seeded /data can be owned by another uid at mode 750, which the service uid cannot read.
    listing=$(docker run --rm --network none --user 0 -v "$VOLUME:/data:ro" --entrypoint /bin/sh "$IMAGE" \
      -c 'ls -A /data') || die "cannot list /data in $VOLUME, even as root (its /data is not readable); nothing extracted"
    [ -z "$listing" ] || die "volume $VOLUME is not empty; it is never overwritten (seed-bundle runs once per volume)"
  fi
  say "volume $VOLUME: absent or empty"
}

check_inputs() {
  check_secrets
  check_mod_jar
  say "inputs: secret files and the mod jar present and checked (the bundle is verified by the volume's marker, not here)"
}

# Free RAM must cover the project's memory caps plus the margin. Free disk must clear the floor. Both are read-only.
check_resources() {
  need free
  need df
  kb=$(free -k | awk '/^Mem:/ {print $NF}')
  case $kb in
    '' | *[!0-9]*) die "cannot read free RAM from free(1)" ;;
  esac
  mib=$((kb / 1024))
  caps=$MEM_CAPS_MIB
  if [ "$RANGERS" = 1 ]; then caps=$((caps + RANGERS_MEM_CAPS_MIB)); fi
  need_mib=$((caps + MEM_MARGIN_MIB))
  [ "$mib" -ge "$need_mib" ] ||
    die "free RAM ${mib} MiB is below $need_mib MiB (the project's caps of $caps MiB plus a $MEM_MARGIN_MIB MiB margin)"
  disk=$(df -Pk "$ROOT" | awk 'NR == 2 {print $4}')
  case $disk in
    '' | *[!0-9]*) die "cannot read free disk space for $ROOT" ;;
  esac
  [ "$disk" -ge "$MIN_FREE_DISK_KB" ] || die "free disk ${disk} KiB is below the floor of $MIN_FREE_DISK_KB KiB"
}

check_config() {
  dc config --quiet || die "compose config does not validate (compose/nf-live.yml)"
}

# Every gate that up and plan run, in order. Refusing here stops before any state changes.
gates() {
  check_telemetry
  check_extra_mods
  check_human_inputs
  check_rangers_inputs
  check_operator
  check_telemetry_network
  check_service_uid
  check_no_colo_labels
  check_port
  check_human_port
  check_human_orphan
  check_rangers_port
  check_rangers_orphan
  check_inputs
  check_resources
  check_config
  check_extra_mods_drop
}

cmd_plan() {
  gates
  say "project $PROJECT; compose file $COMPOSE_FILE"
  if [ "$TELEMETRY" = 1 ]; then
    say "telemetry on: overlay $TELEMETRY_FILE is added; neoforge joins the external network $TELEMETRY_NETWORK (never created or removed here)"
  fi
  if [ "$TELEMETRY_OFF" = 1 ]; then
    say "telemetry off (explicit NF_TELEMETRY=off): overlay $OFF_FILE is added; the entrypoint removes our own stale ledger jar copy and adds no agent"
  fi
  extra_plan_lines
  say "plan, nothing changed: up runs these steps in order"
  say "  1. up -d --wait nats postgres"
  say "  2. up --no-deps --exit-code-from identity-seed identity-seed (one-shot)"
  say "  3. up -d --wait eventsink neoforge"
  say "  4. up -d --wait velocity (the only published port: 127.0.0.1:$PORT)"
  if [ "$HUMAN" = 1 ]; then
    say "  5. up -d --wait velocity-human (NF_HUMAN=on: publishes $HUMAN_BIND:$HUMAN_PORT only; velocity-human-init chowns its volume first)"
    say "NF_HUMAN=on: the first on-run recreates nats, eventsink and neoforge (their network set changes). An off-run is refused while velocity-human exists (human-down first)."
  fi
  say "up refuses until the neoforge-data volume is seeded (seed-bundle, once per volume); plan does not check it"
  say "golem-body is not in this project and is never started"
  if [ "$RANGERS" = 1 ]; then
    say "rangers (NF_RANGERS=on, after the steps above): up -d --wait --no-deps geldar-mcp and the five ranger Bodies (ranger-yellow ranger-green ranger-blue ranger-red ranger-pink); geldar-mcp publishes 127.0.0.1:$RANGERS_PORT, the Bodies publish nothing"
  fi
  say "all gates passed"
}

cmd_up() {
  gates
  check_seeded
  act dc up -d --wait nats postgres
  act dc up --no-deps --exit-code-from identity-seed identity-seed
  act dc up -d --wait eventsink neoforge
  act dc up -d --wait velocity
  if [ "$HUMAN" = 1 ] && ! act dc up -d --wait velocity-human; then human_fail "velocity-human did not become healthy"; fi
  if [ "$RANGERS" = 1 ]; then rangers_up; fi
  say "up: project $PROJECT started (no volume removed)"
}

# Extracts the offline bundle tarball into the empty neoforge-data volume, then checks its marker. Once per volume.
# The extract runs as root inside a throwaway container of the pinned image: no network, the tarball read-only, --rm.
cmd_seed_bundle() {
  check_operator
  check_service_uid
  check_no_colo_labels
  IMAGE=$(compose_image) || exit 1
  check_seed_inputs
  check_volume_empty
  say "seed-bundle: extracting the tarball into $VOLUME (one throwaway container, no network, the tarball read-only)"
  # After the tar, the whole tree is chowned to the service uid:gid (the numbers were checked above). The owner gets rw on every
  # directory and file, and group and others lose write (the archive's own modes could carry o+w), so only the server writes.
  # /data itself is the tree's root, so it is chowned too. The container keeps only CHOWN, FOWNER and DAC_OVERRIDE (what tar and
  # chown need) and gains no privileges.
  act docker run --rm --network none --user 0 --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
    --security-opt no-new-privileges \
    --mount "type=bind,source=$TARBALL,target=/in/bundle.tar.gz,readonly" -v "$VOLUME:/data" \
    --entrypoint /bin/sh "$IMAGE" -c "tar -xzf /in/bundle.tar.gz -C /data && chown -R $SERVICE_OWNER /data && chmod -R u+rwX,go-w /data"
  if [ "${DEPLOY_DRY_RUN:-0}" = 1 ]; then
    say "seed-bundle: dry run; the extract and the marker check were not run"
    return 0
  fi
  seed_marker_ok || die "the marker check of $VOLUME failed after the extract; do not start the stack; leave the volume for the operator to inspect"
  say "seed-bundle: $VOLUME seeded; the bundle marker verifies. up is now allowed."
}

cmd_status() {
  check_operator
  check_human_switch
  dc ps -a
}

cmd_down() {
  check_operator
  check_human_switch
  check_no_colo_labels
  check_rangers_switch
  check_rangers_orphan
  if [ "$VOLUMES" = 1 ]; then
    printf 'Type the project name (%s) to remove its volumes too: ' "$PROJECT" >&2
    typed=
    read -r typed || true
    [ "$typed" = "$PROJECT" ] || die "the typed name did not match $PROJECT; nothing removed"
    act dc down --volumes
    say "down: project $PROJECT removed, volumes included"
  else
    act dc down
    say "down: project $PROJECT stopped and removed (volumes kept)"
  fi
}

cmd_logs() {
  check_operator
  check_human_switch
  if [ "$SERVICE" = velocity-human ]; then HUMAN=1; fi
  dc logs --tail 200 "$SERVICE"
}

# The probe: one run of the body probe (compose/nf-live-probe.yml, profile probe) on a project that `up` started. It refuses
# unless the five long-running services run (nats, velocity and neoforge healthy too), identity-seed exited 0, and unless the secret files pass check_secrets (it
# reads nats-body.txt and rcon.txt). The run is --no-deps, so nothing is started or restarted. Its exit code is the probe's.
# Cleanup runs even when the run fails: run --rm removes the container, and rm -f removes any left behind. The probe's own
# cleanup (the registry entry and the RCON whitelist entry) runs inside the probe process (golem/src/p0/probe-cleanup.ts).
probe_dc() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" -f "$PROBE_FILE" --profile probe "$@"
}

check_probe_up() {
  states=$(dc ps -a --format '{{.Service}} {{.State}} {{.Health}} {{.ExitCode}}') || die "docker compose ps failed (is docker running?); nothing started"
  # nats, velocity and neoforge must be healthy, not only running: a neoforge in its start period is `starting` (mc-health
  # allows 15 minutes) and would fail the join after the probe's timeout. postgres and eventsink need only be running.
  for svc in nats velocity neoforge; do
    printf '%s\n' "$states" | grep -q "^$svc running healthy " ||
      die "$svc is not running and healthy in $PROJECT (wait for it, or run: nf-deploy.sh up first). Nothing started."
  done
  for svc in postgres eventsink; do
    printf '%s\n' "$states" | grep -q "^$svc running " || die "$svc is not running in $PROJECT; run: nf-deploy.sh up first. Nothing started."
  done
  printf '%s\n' "$states" | grep -Eq '^identity-seed exited +0$' ||
    die "identity-seed has not exited 0 in $PROJECT; run: nf-deploy.sh up first. Nothing started."
}

# Ctrl-C (INT) and TERM: the terminal signals the whole foreground group, so the run ends first. Then the leftover probe is
# stopped and removed with its stop_grace_period (60 s in compose/nf-live-probe.yml, enough for the probe's own cleanup),
# and the script exits 130 (INT) or 143 (TERM), the usual 128 + signal number.
probe_signal() {
  probe_dc rm -f -s probe >/dev/null 2>&1 || true
  exit "$1"
}

cmd_probe() {
  check_operator
  check_service_uid
  check_no_colo_labels
  check_human_switch
  check_human_orphan
  check_rangers_orphan
  check_secrets
  check_probe_up
  check_extra_mods_drop
  [ -f "$PROBE_FILE" ] || die "probe overlay not found: $PROBE_FILE"
  rc=0
  trap 'probe_signal 130' INT
  trap 'probe_signal 143' TERM
  # build first: `run --no-deps` reuses an existing tag, so a stale image would keep an old isolation guard.
  act probe_dc build probe
  act probe_dc run --rm --no-deps probe || rc=$?
  trap - INT TERM
  act probe_dc rm -f probe >/dev/null 2>&1 || true
  exit "$rc"
}

# refresh-secrets: the verb to run after ANY change to a secret file's content (an upgrade included). A bind-mounted file is
# followed by inode, and compose compares config, not file content, so a new file under the same name changes nothing for a
# running container: each service that reads a secret is force-recreated here, nats first. postgres is never recreated.
# Same gates as up, and the project must be up (refused otherwise: use up). NF_REFRESH_HEALTH_TRIES (default 120, one
# check per second) bounds the wait for nats to be healthy.
check_refresh_up() {
  states=$(dc ps --format '{{.Service}} {{.State}} {{.Health}}') ||
    die "docker compose ps failed (is docker running?); nothing refreshed"
  for svc in nats postgres velocity eventsink neoforge; do
    printf '%s\n' "$states" | grep -q "^$svc running" ||
      die "$svc is not running in $PROJECT: the project is not up, so there is nothing to refresh (run: nf-deploy.sh up). Nothing changed."
  done
}

wait_nats_healthy() {
  tries=0
  limit=$REFRESH_HEALTH_LIMIT
  while :; do
    states=$(dc ps --format '{{.Service}} {{.State}} {{.Health}}') ||
      die "docker compose ps failed while waiting for nats; nothing else was recreated"
    if printf '%s\n' "$states" | grep -q '^nats running healthy'; then
      say "nats: running and healthy"
      return 0
    fi
    tries=$((tries + 1))
    [ "$tries" -lt "$limit" ] ||
      die "nats is not healthy after $limit checks; stopped: velocity, eventsink, identity-seed and neoforge were not recreated"
    sleep 1
  done
}

cmd_refresh_secrets() {
  REFRESH_HEALTH_LIMIT=${NF_REFRESH_HEALTH_TRIES:-120}
  case $REFRESH_HEALTH_LIMIT in
    '' | *[!0-9]* | 0) die "NF_REFRESH_HEALTH_TRIES must be a positive number (default 120); refusing" ;;
  esac
  gates
  check_refresh_up
  say "refresh-secrets: force-recreate nats, then velocity and eventsink (and velocity-human with NF_HUMAN=on), identity-seed, neoforge (postgres is never touched)"
  act dc up -d --force-recreate --no-deps nats ||
    die "nats did not recreate; nothing else was touched"
  if [ "${DEPLOY_DRY_RUN:-0}" = 1 ]; then
    say "dry-run, not run: wait until nats is healthy"
  else
    wait_nats_healthy
  fi
  # NF_HUMAN=on: velocity-human joins this step. Its bind mounts follow inodes, so a rotated forwarding secret or NATS password
  # reaches it only by a recreate. Unset adds no word, so the recorded args are unchanged.
  human=
  if [ "$HUMAN" = 1 ]; then human=velocity-human; fi
  if ! act dc up -d --wait --force-recreate --no-deps velocity eventsink $human; then
    [ "$HUMAN" != 1 ] || human_fail "velocity, eventsink or velocity-human did not recreate or become healthy; identity-seed and neoforge were not run"
    die "velocity, eventsink or velocity-human did not recreate or become healthy; identity-seed and neoforge were not run"
  fi
  act dc up --force-recreate --no-deps --exit-code-from identity-seed identity-seed ||
    die "identity-seed did not exit 0 (the one-shot seed); neoforge was not recreated; fix it and run refresh-secrets again"
  act dc up -d --wait --force-recreate --no-deps neoforge ||
    die "neoforge did not recreate or become healthy"
  if [ "$RANGERS" = 1 ]; then rangers_refresh; fi
  say "refresh-secrets: project $PROJECT refreshed (no volume removed, postgres not touched)"
}

case $verb in
  plan) cmd_plan ;;
  up) cmd_up ;;
  refresh-secrets) cmd_refresh_secrets ;;
  status) cmd_status ;;
  down) cmd_down ;;
  logs) cmd_logs ;;
  probe) cmd_probe ;;
  seed-bundle) cmd_seed_bundle ;;
  human-down) cmd_human_down ;;
  rangers-down) cmd_rangers_down ;;
esac
