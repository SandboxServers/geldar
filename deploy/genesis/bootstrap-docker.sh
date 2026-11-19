#!/usr/bin/env bash
# bootstrap-docker.sh: the Docker daemon. The default-address-pools entry is merged into daemon.json (other keys are
# kept), so Docker networks are carved from a known pool and cannot run out of the default ranges. The daemon is
# restarted only when the merged file changes. Sourced by bootstrap.sh.

# docker_step: merge daemon.json, enable the daemon, and in apply check that compose v2 answers.
docker_step() {
  local daemon=$BOOT_ROOT/etc/docker/daemon.json input merged
  if ! command -v jq >/dev/null 2>&1; then
    if [ "$MODE" = apply ]; then
      die "jq is missing after the packages step"
    fi
    say "dry-run: jq is not installed yet; apply merges the address pools after it is"
    return 0
  fi
  if [ -f "$daemon" ]; then
    input=$(cat "$daemon")
  else
    input='{}'
  fi
  merged=$(printf '%s\n' "$input" | jq -S --arg base "$GELDAR_DOCKER_POOL_BASE" \
    --argjson size "$GELDAR_DOCKER_POOL_SIZE" \
    '. + {"default-address-pools": [{"base": $base, "size": $size}]}') ||
    die "$daemon is not valid JSON; fix it by hand, the bootstrap will not overwrite it"
  CHANGED=0
  write_if_changed "$daemon" 644 0 0 <<<"$merged"
  if [ "$CHANGED" = 1 ]; then
    mut systemctl restart docker
  fi
  if ! systemctl is-enabled -q docker 2>/dev/null; then
    mut systemctl enable --now docker
  fi
  if [ "$MODE" = apply ]; then
    docker compose version >/dev/null || die "docker compose v2 does not answer"
  fi
}
