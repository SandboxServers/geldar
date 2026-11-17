# 0386. The live NeoForge shard runs as a separate compose project, `geldar-nf`, on the colo node

- Status: Proposed (lead-accepted 2026-11-17; owner to confirm)
- Date: 2026-11-17
- Spec: section 7 (monitoring and deploy); builds on 0082 (colo node layout) and 0084 (colo deploy)

## Decision

1. The live NeoForge shard runs on the colo node as a new compose project named `geldar-nf`, not on a separate host.
2. Its file `compose/nf-live.yml` is self-contained, not an overlay on `compose/colo.yml`. It has its own network, NATS, Postgres, `eventsink`, Velocity, NeoForge server and a one-shot `identity-seed`. The file is on branch `phase1/nf-live-compose` (commit e353646c).
3. Every compose action on it names `-p geldar-nf -f compose/nf-live.yml`. It never uses the colo file, the `geldar-colo` network or the node's `colo.yml`.
4. Per-service caps (budget in `per-shard-storage-design.md` section 7.2): NeoForge server 3 CPUs and 12288m (heap 9G, 512 pids); Velocity 0.5 CPU and 1024m; Postgres 1 CPU and 2048m; NATS 0.5 CPU and 512m; `eventsink` 0.5 CPU and 512m; identity-seed (one-shot) 0.25 CPU and 256m. Total 5.75 CPUs and 16640m (about 16.25 GiB). These are proposals, to be measured at deploy time. Proposed `cpu_shares` 256 for each of them (default 1024 for the colo services; section 7.2).
5. Loopback only. One host port is published: 127.0.0.1:46565 for Velocity. The block for this project is 46565 (Velocity, published), 46222 (NATS), 46432 (Postgres) and 46575 (NeoForge RCON), the last three reserved and not published. The earlier proposal 25575 to 25579 is withdrawn; 25575 is the RCON default.
6. The colo-cd and colo-deploy workflows do not apply to `geldar-nf`. No colo deploy script applies. It gets its own deploy script (`deploy/nf-cd.sh`, a later packet), which pins its own image digests and never sources `deploy/common.sh`.
7. The autonomous shard (colo) must never be restarted by an action on this project; the list of what must never restart is in the design note section 7.1.
8. Purge of the `events` rows is not automatic. The owner of the purge is the lead's operations, as an open assignment: an ops job with a runbook step, run by an ops agent under the lead's authorisation. The database has no purge today (record 0380, D7).

## Why

The owner decided a new project on the colo node rather than a separate host. A separate project keeps the NeoForge stack's failures, restarts and networks out of the colo project, and keeps the colo file unchanged.

## Consequences

- Node headroom, measured by the lead's read-only check at 17:50Z on 2026-11-17: 16 CPUs, load 0.72 to 0.98, 125 GiB total, 33 GiB used, 91 GiB available, 1.1 TiB free on the Docker disk, 69 containers, measured CPU use about 0.67 of one core in total, measured memory about 37.5 GiB. It is re-measured at deploy time with the read-only commands in the design note section 7.4 before the first start.
- The repo's `compose/colo.yml` is stale against the node. The node's autonomous Paper runs at 8 CPUs and 14336m (checked read-only by the lead at about 16:07Z 2026-11-17); the repo file says 3 CPUs and 8192m. Other drift exists too. The budget uses the node's Paper values. The repo file is updated in its own packet.
- The colo project's measured caps sum to 31.10 CPUs on 16 cores (about 194%) and 57 GiB of memory. Its CPU use is overcommitted on caps today, and the measured use (about 0.67 of one core across the node) matters more for planning. Adding geldar-nf (5.75 CPUs, 16.25 GiB of caps) gives 36.85 CPUs (about 230%) and 73.25 GiB; the memory caps fit against 91 GiB available. With scratch telemetry caps (6.5 CPUs, 15.5 GiB) the sums are 43.35 CPUs and 88.75 GiB, which is tight. The colo caps per container are in `per-shard-storage-design.md` section 7.2: 29 running (19 players-host, 10 others), 31.10 CPUs and 58368 MiB. An earlier count of 23 players-host containers was a miscount. `CpuQuota` and `CpuPeriod` are 0, so `NanoCpus` is the only CPU cap. The node's clock is US/Central, so the lead's 17:50Z and 11:50 node time are one instant; the notes use UTC. Caps are ceilings, and CPU contention can slow the autonomous Paper. Lower `cpu_shares` on the nf services (256 each, a proposal; colo unset, default 1024) is how colo wins contention; caps alone do not protect it.
- Public exposure, the shared Caddy and the human route are out of scope. They are owner decisions for the final-instance step.
- `geldar.ps1 check` validates every `compose/*.yml` with `docker compose config`, so `compose/nf-live.yml` is checked there too. Its test renders the file with no environment.
- `GELDAR_PROJECT` and `GELDAR_COLO_COMPOSE` are settled: the `ghdeploy` runner sets neither (lead's read-only check at 17:50Z), so `colo-cd` uses the defaults. The `geldar-nf` script names its project `geldar-nf` and its file `compose/nf-live.yml` itself, and never inherits `GELDAR_PROJECT` or sources `deploy/common.sh`. The colo project is mixed (its containers carry different compose config-file labels), which is one more reason never to run compose against it.
