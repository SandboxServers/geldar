# The human listener for the scratch NeoForge shard (compose/opt-in/scratch-human.yml, service velocity-human). Sourced by
# deploy/scratch/scratch.sh only for up with SCRATCH_HUMAN_LANE set (the way scratch-mind.sh is sourced). Nothing here starts
# anything: check_human_lane refuses with exit 2 before compose runs. down and status never source this file.
# The lane needs the NeoForge shard (SCRATCH_PLATFORM=neoforge: humans are players there) and the NATS auth dir (the
# identity plugin's registry read, through the scratch velocity NATS user; no new role).

# Refuses unless SCRATCH_HUMAN_LANE is exactly 1, the platform is neoforge and SCRATCH_NATS_AUTH_DIR is set. Exit 2.
check_human_lane() {
  if [ "$SCRATCH_HUMAN_LANE" != 1 ]; then
    echo "scratch: SCRATCH_HUMAN_LANE must be 1 to add the human listener (or unset); nothing started" >&2
    exit 2
  fi
  if [ "$PLATFORM" != neoforge ]; then
    echo "scratch: the human listener needs SCRATCH_PLATFORM=neoforge (humans are players on the NeoForge shard); nothing started" >&2
    exit 2
  fi
  if [ -z "${SCRATCH_NATS_AUTH_DIR:-}" ]; then
    echo "scratch: the human listener needs SCRATCH_NATS_AUTH_DIR (the identity plugin reads the registry through the velocity NATS user); nothing started" >&2
    exit 2
  fi
}
