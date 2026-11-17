# 0386. The live NeoForge shard runs as a separate compose project, `geldar-nf`, on the colo node

- Status: Proposed (lead-accepted 2026-11-17; owner to confirm)
- Date: 2026-11-17
- Spec: section 7 (monitoring and deploy); builds on 0082 (colo node layout) and 0084 (colo deploy)

## Decision

1. The live NeoForge shard runs on the colo node as a new compose project named `geldar-nf`, not on a separate host.
2. Its file `compose/nf.yml` is self-contained, not an overlay on `compose/colo.yml`. It has its own network, NATS, Postgres, `eventsink`, Velocity and NeoForge server.
3. Every compose action on it names `-p geldar-nf -f compose/nf.yml`. It never uses the colo file, the `geldar-colo` network or the node's `colo.yml`.
4. Per-service caps (budget in `per-shard-storage-design.md` section 7.2): NeoForge server 3 CPUs and 8192m (heap 6G); Velocity 0.5 CPU and 1024m; Postgres 1 CPU and 2048m; NATS 0.5 CPU and 512m; `eventsink` 0.5 CPU and 512m. Total 5.5 CPUs and 12288m. These are proposals, to be measured at deploy time.
5. Loopback only. One host port is proposed, 127.0.0.1:25575 for Velocity, from a block 25575 to 25579 reserved for this project. No Postgres or NATS port is published.
6. The colo-cd and colo-deploy workflows do not apply to `geldar-nf`. It gets its own deploy script (`deploy/nf-cd.sh`, a proposal), which pins its own image digests.
7. The autonomous shard (colo) must never be restarted by an action on this project; the list of what must never restart is in the design note section 7.1.

## Why

The owner decided a new project on the colo node rather than a separate host. A separate project keeps the NeoForge stack's failures, restarts and networks out of the colo project, and keeps the colo file unchanged.

## Consequences

- The node's headroom is not measured in this record. The lead's figures (about 100 GiB available, 16 cores, at about 13:55Z on 2026-11-17) must be re-measured with the read-only commands in the design note section 7.4 before the first start.
- The CPU caps of colo, nf and scratch telemetry add to 22.6 cores against 16 cores. Caps are ceilings: CPU contention can slow the autonomous Paper. Lower `cpu_shares` on the nf services is a proposal to protect colo.
- Public exposure, the shared Caddy and the human route are out of scope. They are owner decisions for the final-instance step.
- `geldar.ps1 check` validates every `compose/*.yml` with `docker compose config`, so `compose/nf.yml` is checked there too.
