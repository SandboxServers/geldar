#!/usr/bin/env bash
# The supervisor container on the Colo node (C7-03b2, decision 0260). It creates geldar-colo-supervisor with `docker create`
# and starts it with `docker start`, as the `supervisor` service in compose/colo.yml describes it. It is never `docker compose up`:
# on the node a compose up fails with "network geldar-colo has active endpoints" (the network's recorded config has drifted).
# The flags, labels, limits, read-only root, secret mounts and uid match that service. It grants no Docker access: Body
# containers are controlled by the host body helper (C7-03c1), never by this container.
#
# It never creates, removes or recreates a network, never runs docker compose, down, rm or --force-recreate, and never
# replaces a container. Run by ops only, after the runbook steps in docs/runbooks/supervisor-node-steps.md.
#
# Environment (the node's secrets dir and the image digest; none is read from the repo):
#   GELDAR_SUPERVISOR_IMAGE  the digest reference of the supervisor image, name@sha256:<64 lowercase hex> (required; a tag is refused).
#                            The digest is in the colo-images run log of the merge commit (the supervisor job's push step); it
#                            is not in release.env or the manifest summary yet.
#   GELDAR_SECRETS_DIR       the absolute node secrets dir holding postgres-supervisor.txt and nats-supervisor.txt (required;
#                            no comma in the path)
#   GELDAR_SERVICE_UID       the non-root uid the container runs as, and the owner of the secret files (default 1000)
#   GELDAR_NETWORK           the colo network (default geldar-colo)
#   DOCKER                   the docker client (default docker; tests point it at a fake)
#   STAT                     the stat command (default stat; tests point it at a fake)
set -euo pipefail

NAME="geldar-colo-supervisor"
NETWORK="${GELDAR_NETWORK:-geldar-colo}"
UID_VALUE="${GELDAR_SERVICE_UID:-1000}"
IMAGE="${GELDAR_SUPERVISOR_IMAGE:?GELDAR_SUPERVISOR_IMAGE must be set to the image digest reference}"
SECRETS_DIR="${GELDAR_SECRETS_DIR:?GELDAR_SECRETS_DIR must be set}"
DOCKER="${DOCKER:-docker}"
STAT="${STAT:-stat}"

case "$UID_VALUE" in
  0 | '' | *[!0-9]*)
    echo "refusing: GELDAR_SERVICE_UID must be a non-root number" >&2
    exit 1
    ;;
esac

if [[ ! "$IMAGE" =~ ^[^-].*@sha256:[0-9a-f]{64}$ ]]; then
  echo "refusing: GELDAR_SUPERVISOR_IMAGE must be a digest reference (name@sha256:<64 lowercase hex>), not a tag" >&2
  exit 1
fi

case "$SECRETS_DIR" in
  /* | [A-Za-z]:/*) ;; # a POSIX absolute path, or a drive path (the Windows test host)
  *)
    echo "refusing: GELDAR_SECRETS_DIR must be an absolute path" >&2
    exit 1
    ;;
esac

case "$SECRETS_DIR" in
  *,*)
    echo "refusing: GELDAR_SECRETS_DIR must not contain a comma (it would split the --mount flags)" >&2
    exit 1
    ;;
esac

if ! "$DOCKER" network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "refusing: network $NETWORK is missing; this script never creates a network" >&2
  exit 1
fi

for file in postgres-supervisor.txt nats-supervisor.txt; do
  path="$SECRETS_DIR/$file"
  if [ ! -f "$path" ]; then
    echo "refusing: $path is missing (geldar-93 writes the NATS file; gen-secrets.sh the Postgres file)" >&2
    exit 1
  fi
  owner="$("$STAT" -c %u "$path")"
  if [ "$owner" != "$UID_VALUE" ]; then
    echo "refusing: $path is owned by uid $owner, but the container runs as uid $UID_VALUE (chown it to GELDAR_SERVICE_UID)" >&2
    exit 1
  fi
done

# An existing container: a running one on the expected image is left alone; anything else stops the script for the operator.
if "$DOCKER" container inspect "$NAME" >/dev/null 2>&1; then
  running="$("$DOCKER" container inspect --format '{{.State.Running}}' "$NAME")"
  current="$("$DOCKER" container inspect --format '{{.Config.Image}}' "$NAME")"
  if [ "$running" = "true" ] && [ "$current" = "$IMAGE" ]; then
    echo "$NAME already runs $IMAGE; nothing to do"
    exit 0
  fi
  echo "refusing: a container named $NAME exists (running=$running, image=$current); this script replaces nothing." >&2
  echo "The operator removes it by hand (docker stop, then docker rm) after reading the rollback in the runbook." >&2
  exit 1
fi

"$DOCKER" create \
  --name "$NAME" \
  --network "$NETWORK" \
  --restart unless-stopped \
  --user "$UID_VALUE:$UID_VALUE" \
  --read-only \
  --tmpfs /tmp \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --memory 128m --memory-swap 128m --cpus 0.25 \
  --pids-limit 64 \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  --label com.centurylinklabs.watchtower.enable=false \
  --label com.geldar.stack=colo \
  --env SUPERVISOR_SHARD=colo \
  --env SUPERVISOR_NATS_URL=nats://nats:4222 \
  --env SUPERVISOR_DB_PASSWORD_FILE=/run/secrets/postgres-supervisor.txt \
  --env POSTGRES_HOST=postgres \
  --env POSTGRES_PORT=5432 \
  --env POSTGRES_DB=geldar \
  --env GELDAR_NATS_USER=supervisor \
  --env GELDAR_NATS_PASSWORD_FILE=/run/secrets/nats-supervisor.txt \
  --mount "type=bind,source=$SECRETS_DIR/postgres-supervisor.txt,target=/run/secrets/postgres-supervisor.txt,readonly" \
  --mount "type=bind,source=$SECRETS_DIR/nats-supervisor.txt,target=/run/secrets/nats-supervisor.txt,readonly" \
  "$IMAGE" >/dev/null

"$DOCKER" start "$NAME" >/dev/null
echo "started $NAME on $NETWORK from $IMAGE"
