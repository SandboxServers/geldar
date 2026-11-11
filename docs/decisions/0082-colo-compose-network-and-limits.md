# 0082. Colo compose layout: network, limits, loopback binds and ports

- Status: Proposed (the orchestrator may accept at the ops merge)
- Date: 2026-11-10
- Spec: section 8.6 (host hardening); section 10 Phase 1 (the colo stack). Decisions 0023, 0064, 0080.

## Problem

Phase 1 needs one production Linux compose file, `compose/colo.yml`, that runs the colo stack on the node next to services that already listen there. The Phase 0 files (`compose/phase0.yml`, `compose/rcon-host.yml`) are the watched local stack and stay unchanged. The colo file needs its own network, a cap on every service, loopback-only host binds, and a fixed host port for the Minecraft bot ingress that cannot be the production game server's port.

## Decision

- **Standalone file, not an overlay.** `compose/colo.yml` is a complete compose file with `name: geldar-colo`. It has its own network, `geldar-colo`, with an explicit name. No service uses the default network.
- **Limits on every service.** Each service sets `deploy.resources.limits` (`cpus`, `memory`) through one anchor. The values come from the single shard-config budget in `shards/colo.yaml` (`cpu_limit`, `memory_limit`): `geldar.ps1` reads that file and exports `GELDAR_COLO_CPU_LIMIT` and `GELDAR_COLO_MEMORY_LIMIT`. Each service's ceiling is that whole budget, not a split. The contract declares one budget, so a per-service split needs a contract change or a measurement in C1-10. The first guesses (4 cores, 8192m) are to be measured in C1-10 and are not results.
- **Loopback binds only.** Every published port is written `127.0.0.1:` and is a literal. The loopback-ports check (`tools/repo-checks/src/loopback-ports.ts`) fails any other bind and any service without limits.
- **Minecraft host port 25567, a literal.** The bot ingress is `127.0.0.1:25567:25565`. The Minecraft port in `shards/colo.yaml` (`minecraft_port: 25567`) is validated by `geldar.ps1` against this value. It is not used to set the port in compose, because the loopback check refuses interpolated ports and the check must read the real bind.
- **Ports 25565 and 25566 are never published by the colo file.** 25565 is the production game server's port on the node, and 25566 is reserved. The loopback check refuses either as a host port, including inside a range. `geldar.ps1` refuses either as `minecraft_port`.
- **Shared-node collisions are unverified here.** The Postgres (5432) and NATS (4222, 8222) loopback ports may already be in use by services on the shared node. This record does not decide that. C1-10 checks it on the node, read-only, before any start.
- **Health and restart.** Services keep the healthchecks of `compose/phase0.yml` and use `restart: unless-stopped`.
- **Phase 0 is unchanged.** The Phase 0 files change only in comments and dead keys (C1-02 commit 1). Their ports and behaviour stay as they were.

## Consequences

- `docker compose -f compose/colo.yml config --quiet` passes offline; the limits resolve from the defaults in the file, which equal the shard file's values.
- The colo stack cannot publish the game server's port, so a bot cannot reach the production game server through this stack.
- A per-service split of the CPU and memory budget waits for either a contract change (C1-00 owner) or C1-10 measurements.
- Later packets add their services through commented slots in `compose/colo.yml` (C1-03 golem-body, C1-06a nats-auth overlay, C1-07 telemetry, C1-09 bluemap), each uncommented by that packet's index line.
