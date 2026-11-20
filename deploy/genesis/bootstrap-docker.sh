#!/usr/bin/env bash
# bootstrap-docker.sh: the Docker daemon. The default-address-pools entry is merged into daemon.json, so Docker networks
# are carved from a known pool and cannot run out of the default ranges. Other keys are kept. An existing
# default-address-pools value is REPLACED by the one pool from the environment. An empty or blank file counts as {};
# a file that is not a JSON object stops the run. The daemon restarts after a successful write, and again on a rerun
# whose last restart did not complete (a marker records the pool content only after the restart succeeded).
# Sourced by bootstrap.sh.

# record_pools FILE HASH: writes the marker once the restart for this content has succeeded.
record_pools() {
  printf '%s\n' "$2" >"$1"
}

# docker_step: merge daemon.json, enable the daemon, and in apply check that compose v2 answers.
docker_step() {
  local daemon=$BOOT_ROOT/etc/docker/daemon.json marker=$BOOT_ROOT/etc/docker/geldar-pools.sha256 input merged want
  if ! command -v jq >/dev/null 2>&1; then
    if [ "$MODE" = apply ]; then
      die "jq is missing after the packages step"
    fi
    say "dry-run: jq is not installed yet; apply merges the address pools after it is"
    return 0
  fi
  input='{}'
  if [ -f "$daemon" ] && [ -n "$(tr -d '[:space:]' <"$daemon")" ]; then
    input=$(cat "$daemon")
  fi
  printf '%s\n' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 ||
    die "$daemon must hold a JSON object or be empty; fix it by hand, the bootstrap will not overwrite it"
  merged=$(printf '%s\n' "$input" | jq -S --arg base "$GELDAR_DOCKER_POOL_BASE" \
    --argjson size "$GELDAR_DOCKER_POOL_SIZE" \
    '. + {"default-address-pools": [{"base": $base, "size": $size}]}') ||
    die "$daemon could not be merged; fix it by hand, the bootstrap will not overwrite it"
  [ -n "$merged" ] && printf '%s\n' "$merged" | jq -e 'has("default-address-pools")' >/dev/null 2>&1 ||
    die "the merged $daemon has no default-address-pools"
  CHANGED=0
  write_if_changed "$daemon" 644 0 0 <<<"$merged"
  want=$(printf '%s' "$merged" | sha256sum | cut -d' ' -f1)
  if [ "$CHANGED" = 1 ] || ! grep -qx "$want" "$marker" 2>/dev/null; then
    mut systemctl restart docker
    mut record_pools "$marker" "$want"
  fi
  if ! systemctl is-enabled -q docker 2>/dev/null; then
    mut systemctl enable --now docker
  fi
  if [ "$MODE" = apply ]; then
    docker compose version >/dev/null || die "docker compose v2 does not answer"
  fi
}
