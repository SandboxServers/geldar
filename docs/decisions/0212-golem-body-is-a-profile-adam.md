# 0212. golem-body (the idle Colo Adam) is a compose profile, and Paper sets players_sleeping_percentage 50

- Status: Accepted
- Date: 2026-11-14
- Related: decision 0134 (the Mind is a profile until a Thinker path exists), decision 0131 (the in-network Body), decision 0082 (colo compose layout), decision 0084 (the CD).

## Context

The Colo runs one Body, `golem-body`, as Adam's Golem. Nothing depends on it, and it has no Mind (0134): the Mind is a profile
and does not start. So the Body is an idle Adam, one more container on the node (1 CPU, 2 GB) that is started by every plain
`colo-up.sh` and only adds noise. Its reflex counts pollute the shared numbers that the Colo reads, and the Body was the one
service whose start was not needed for the sovereign players to be served.

The Body image is also the image the player hosts (`players-host`, profile `sovereign`) run: `GELDAR_BODY_IMAGE` is shared.
So a new Body digest must still drive the player-host refresh even when the Adam itself is not running.

## Decision

1. **The Adam is under the compose profile `adam`** in `compose/colo.yml`. `deploy/colo-up.sh` and `shard up colo` do not start
   it. It keeps its image, budget and wiring.
2. **The CD never starts it.** `deploy/colo-cd.sh` maps `golem-body` to the profile `adam` for pulls and checks. When a new
   `GELDAR_BODY_IMAGE` digest arrives, the CD pulls the image, pauses the `bodies` scope and recreates the player hosts, as
   before. It restarts `golem-body` only when the container is already running. A stopped or absent Adam is not started, and
   its rollback does not start it either. The player-host recreate and its rollback still run.
3. **How to start it:**
   `docker compose --profile adam up -d --wait golem-body`, or `docker start geldar-colo-golem-body-1` when the container exists.
   The Adam also needs NATS healthy and the house Body whitelisted on Paper (`colo-admin.sh whitelist-house-body`).
4. **Paper sets `players_sleeping_percentage 50`.** The line sits in `RCON_CMDS_STARTUP` next to `gamerule keep_inventory false`.
   The name is the snake_case command name the 26.1 server takes; it is not yet read back from a running server, so the first
   live start must confirm it with `gamerule players_sleeping_percentage` (a read-only query).

## Consequences

- A plain Colo deploy starts no Adam. `colo-status.sh` does not expect `golem-body` to be healthy by default.
- A body digest change on a node where the Adam is stopped restarts no Body, and the player hosts are still refreshed.
- The Adam's budget stays in the compose file, so the shard's total cap still counts it.
- The Adam is not removed. Stopping it stops only its own reflexes; no volume is touched.
