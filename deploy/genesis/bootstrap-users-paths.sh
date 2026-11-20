#!/usr/bin/env bash
# bootstrap-users-paths.sh: the service and operator users (uids from the environment file), and the directory layout.
# A uid or gid that differs from the environment is refused, never renumbered: the Paper and service files are owned by
# the numbers. preflight_ids runs in both modes before any change and refuses a number that another name already holds.
# Secret values are never read or written here. The secrets directory gets its mode and owner; the files inside it are
# left exactly as they are. Sourced by bootstrap.sh.

# id_owner DB NUMBER: the name that holds a uid (passwd) or a gid (group); empty when the number is free.
id_owner() {
  getent "$1" "$2" 2>/dev/null | cut -d: -f1 || true
}

# preflight_ids: a target uid or gid that another name already holds stops the run before any change.
preflight_ids() {
  local spec db name num owner
  for spec in \
    "passwd $GELDAR_SERVICE_USER $GELDAR_SERVICE_UID" \
    "group $GELDAR_SERVICE_USER $GELDAR_SERVICE_UID" \
    "passwd $GELDAR_OPERATOR_USER $GELDAR_OPERATOR_UID" \
    "group $GELDAR_OPERATOR_USER $GELDAR_OPERATOR_UID" \
    "group docker $GELDAR_DOCKER_GID"; do
    read -r db name num <<<"$spec"
    owner=$(id_owner "$db" "$num")
    if [ -n "$owner" ] && [ "$owner" != "$name" ]; then
      die "$db id $num belongs to $owner, not $name; refusing to renumber or reuse it"
    fi
  done
}

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

# users_step: the docker group is created earlier, before the packages (see bootstrap.sh).
users_step() {
  ensure_group "$GELDAR_SERVICE_USER" "$GELDAR_SERVICE_UID"
  ensure_user "$GELDAR_SERVICE_USER" "$GELDAR_SERVICE_UID" "$GELDAR_SERVICE_UID" service
  ensure_group "$GELDAR_OPERATOR_USER" "$GELDAR_OPERATOR_UID"
  ensure_user "$GELDAR_OPERATOR_USER" "$GELDAR_OPERATOR_UID" "$GELDAR_OPERATOR_UID" operator
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
