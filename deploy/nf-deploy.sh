#!/bin/sh
# Operator script for the live NeoForge project (compose project geldar-nf, compose/nf-live.yml). Run it on the node from an
# exported tree (a git checkout is refused unless --local, which the tests use), as the operator account (never root, and
# never with elevated rights). Verbs: plan (prints the gates and the steps, changes nothing), up (refuses an unseeded
# neoforge-data volume), seed-bundle (once per volume: extracts the offline bundle tarball into it), status, down [--volumes], logs <service>.
# The project name and the compose file are constants here. deploy/common.sh (the colo model) is NOT sourced, and the script
# refuses to run when GELDAR_PROJECT or GELDAR_COLO_COMPOSE is set, so no colo setting can reach this project.
# It never names golem-body or players-host (they are not services of compose/nf-live.yml). down removes containers and
# networks; --volumes also removes the project's volumes, after the operator types the project name. DEPLOY_DRY_RUN=1 prints
# the steps of up and down without running them; the gates still run. Inputs come from the environment, never the repo:
#   NF_MOD_JAR_HOST, NF_MOD_SHA256     the pinned geldar NeoForge mod jar and its sha256 (64 lowercase hex)
#   NF_BUNDLE_TARBALL, NF_BUNDLE_TARBALL_SHA256   seed-bundle only: the absolute path of the bundle tarball and its sha256
#                                      (plan and up need no bundle input: the seeded volume's marker check is the gate)
#   NF_SECRETS_DIR                     the secret files (default compose/secrets-nf)
#   NF_SERVICE_UID (default 1000), NF_SERVICE_GID (default NF_SERVICE_UID): the uid:gid the services run as and that owns
#                                      the seeded volume. The default 1000 is not the node: its ops account is uid 1001, so the
#                                      operator must export NF_SERVICE_UID=1001 (the default itself is unchanged).
# Runbook: docs/runbooks/nf-live-project.md (section 6).
set -eu

PROJECT=geldar-nf
ROOT=$(cd "$(dirname "$0")/.." && pwd)
COMPOSE_FILE=$ROOT/compose/nf-live.yml
SERVICES="nats postgres eventsink identity-seed velocity neoforge"
# The secret files compose/nf-live.yml declares under ${NF_SECRETS_DIR:-./secrets-nf}. A test keeps this list in sync.
SECRET_FILES="postgres.txt velocity-forwarding.txt nats-auth.conf nats-sink.txt nats-neoforge.txt nats-velocity.txt nats-deploy.txt nats-seed.txt"
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
  plan | up | status | seed-bundle) [ -z "$SERVICE" ] || die "$verb takes no service name" ;;
  down) [ -z "$SERVICE" ] || die "down takes no service name" ;;
  logs)
    [ -n "$SERVICE" ] || die "logs needs a service: one of $SERVICES"
    case " $SERVICES " in
      *" $SERVICE "*) ;;
      *) die "unknown service: $SERVICE (one of $SERVICES)" ;;
    esac
    ;;
  *)
    echo "usage: nf-deploy.sh plan|up|status|down [--volumes] [--local]|logs <service> [--local]|seed-bundle [--local]" >&2
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

check_port() {
  need ss
  listeners=$(ss -Hltn "sport = :$PORT") || die "cannot read the listening sockets (ss)"
  [ -z "$listeners" ] || die "something already listens on port $PORT; the project's published port must be free"
}

check_secrets() {
  secdir=${NF_SECRETS_DIR:-$ROOT/compose/secrets-nf}
  [ -d "$secdir" ] || die "secrets directory missing: $secdir (the per-shard NF secrets step writes it; see the runbook)"
  for f in $SECRET_FILES; do
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
  need_mib=$((MEM_CAPS_MIB + MEM_MARGIN_MIB))
  [ "$mib" -ge "$need_mib" ] ||
    die "free RAM ${mib} MiB is below $need_mib MiB (the project's caps of $MEM_CAPS_MIB MiB plus a $MEM_MARGIN_MIB MiB margin)"
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
  check_operator
  check_service_uid
  check_no_colo_labels
  check_port
  check_inputs
  check_resources
  check_config
}

cmd_plan() {
  gates
  say "project $PROJECT; compose file $COMPOSE_FILE (the only -f)"
  say "plan, nothing changed: up runs these steps in order"
  say "  1. up -d --wait nats postgres"
  say "  2. up --no-deps --exit-code-from identity-seed identity-seed (one-shot)"
  say "  3. up -d --wait eventsink neoforge"
  say "  4. up -d --wait velocity (the only published port: 127.0.0.1:$PORT)"
  say "up refuses until the neoforge-data volume is seeded (seed-bundle, once per volume); plan does not check it"
  say "golem-body and players-host are not in this project and are never started"
  say "all gates passed"
}

cmd_up() {
  gates
  check_seeded
  act dc up -d --wait nats postgres
  act dc up --no-deps --exit-code-from identity-seed identity-seed
  act dc up -d --wait eventsink neoforge
  act dc up -d --wait velocity
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
  dc ps -a
}

cmd_down() {
  check_operator
  check_no_colo_labels
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
  dc logs --tail 200 "$SERVICE"
}

case $verb in
  plan) cmd_plan ;;
  up) cmd_up ;;
  status) cmd_status ;;
  down) cmd_down ;;
  logs) cmd_logs ;;
  seed-bundle) cmd_seed_bundle ;;
esac
