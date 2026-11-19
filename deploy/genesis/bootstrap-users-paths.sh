#!/usr/bin/env bash
# bootstrap-users-paths.sh: the service and operator users (uids from the environment file), the docker group gid, and
# the directory layout. A uid or gid that differs from the environment is refused, never renumbered: the Paper and
# service files are owned by the numbers. Secret values are never read or written here. The secrets directory gets its
# mode and owner; the files inside it are left exactly as they are. Sourced by bootstrap.sh.

# ensure_group NAME GID
ensure_group() {
  local have
  have=$(getent group "$1" | cut -d: -f3 || true)
  if [ -z "$have" ]; then
    mut groupadd --gid "$2" "$1"
  elif [ "$have" != "$2" ]; then
    die "group $1 has gid $have but the environment says $2; refusing to renumber it"
  fi
}

# ensure_user NAME UID GID KIND: KIND is service (system account, no login) or operator (login account).
ensure_user() {
  local have
  have=$(getent passwd "$1" | cut -d: -f3 || true)
  if [ -z "$have" ]; then
    if [ "$4" = service ]; then
      mut useradd --system --uid "$2" --gid "$3" --no-create-home --shell /usr/sbin/nologin "$1"
    else
      mut useradd --uid "$2" --gid "$3" --create-home --shell /bin/bash "$1"
    fi
  elif [ "$have" != "$2" ]; then
    die "user $1 has uid $have but the environment says $2; refusing to renumber it"
  fi
}

users_step() {
  ensure_group "$GELDAR_SERVICE_USER" "$GELDAR_SERVICE_UID"
  ensure_user "$GELDAR_SERVICE_USER" "$GELDAR_SERVICE_UID" "$GELDAR_SERVICE_UID" service
  ensure_group "$GELDAR_OPERATOR_USER" "$GELDAR_OPERATOR_UID"
  ensure_user "$GELDAR_OPERATOR_USER" "$GELDAR_OPERATOR_UID" "$GELDAR_OPERATOR_UID" operator
  ensure_group docker "$GELDAR_DOCKER_GID"
}

# paths_step: state, secrets (0700, service-owned: Docker on native Linux ignores the compose uid for file
# secrets, so the file owner must be the service uid), tokens, logs, and the source bundle target.
paths_step() {
  local svc=$GELDAR_SERVICE_UID
  ensure_dir "$GELDAR_STATE_DIR" 750 "$svc" "$svc"
  ensure_dir "$GELDAR_STATE_DIR/logs" 750 "$svc" "$svc"
  ensure_dir "$GELDAR_SECRETS_DIR" 700 "$svc" "$svc"
  ensure_dir "$GELDAR_TOKENS_DIR" 700 "$svc" "$svc"
  ensure_dir "$GELDAR_SRC_DIR" 755 0 0
}
