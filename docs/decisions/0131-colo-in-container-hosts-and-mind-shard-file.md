# 0131. Colo containers reach their compose peers by name, and the Mind's shard file is separate from the budget file

- Status: Accepted (orchestrator, 2026-11-10)
- Date: 2026-11-10
- Spec: section 6.1 (the Mind on the colo's Record/Mind host), section 10 Phase 1 (the colo stack). Decisions 0050 (loopback for Phase 0), 0078 (Mind placement), 0082 (colo compose layout), 0083 (the Body and Mind images). Phase 1 plan: `docs/analysis/phase1/plan.md`. Worknote: `docs/analysis/phase1/worknotes/FX-RUNTIME.md`.

## Problem

The C1 boundary review found that the colo containers cannot start. The loaders of golem and animus were written for Phase 0, where every address is loopback (decision 0050). Inside the colo compose network, the peers are compose service names (`nats`, `postgres`, `velocity`, `paper`), and the loaders refuse them. Also, the Body and the Mind read `shards/<shard>.yaml`, and the mounted file `shards/colo.yaml` is the flat budget file that `geldar.ps1` reads, so it has none of the Mind's blocks. Nothing ran the entry points before, so the defect was not caught by the image and compose tests, which read files as text.

## Decision

1. **An explicit in-network opt-in.** The loopback rule stays the default. A closed allowlist of colo service names, `nats`, `postgres`, `paper` and `velocity`, is accepted only when the environment variable `GELDAR_IN_NETWORK_HOSTS` is exactly `1`. Compose sets it for `golem-body` and `animus` and for no other service. Any other host is refused, with or without the opt-in. Phase 0 runs without the variable, so its behaviour does not change. The check lives in `golem/src/config.ts` (`hostAllowed`, used by the NATS and Minecraft host checks and by `golem/src/body/restart.ts`) and in `animus/src/config.ts` (`loopbackHost`). The two copies are minimal duplicates, one per package, as the packages do not share a helper module.

2. **Two shard files.** `shards/colo.yaml` stays the flat budget file that `geldar.ps1` reads and refuses to extend with unknown keys. The Mind's blocks live in `shards/colo-mind.yaml`, a full shard file derived from `shards/phase0.yaml`: the same blocks without `sovereign`, because no sovereign players run on the colo yet. Compose mounts `colo-mind.yaml` at `/opt/geldar/shards/colo.yaml` for `golem-body` and `animus`, because both loaders read `<repo root>/shards/<GELDAR_SHARD>.yaml`. The container path keeps the name the loaders expect; the host file has its own name.

3. **The Thinker is an explicit placeholder.** Decision 0078 puts the Thinkers on the owner's home GPUs and the `api-minds` Thinker, reached through a Thinker gateway. The gateway does not exist yet. `colo-mind.yaml` therefore sets `mind.thinker` to `127.0.0.1:7410` named `unreachable-placeholder`: a loopback socket inside the Mind's own container, which nothing outside can reach, so no thought is dispatched. The gateway packet replaces the three values. The models and pins are the phase0 tags and digests, because the colo Thinkers serve the same models.

## Consequences

- The in-network allowlist is a closed list. Adding a name is a change to this decision, not a config value.
- The colo Body talks to Velocity, never to Paper (decision 0082's ingress). `GELDAR_MC_HOST` is `velocity` and `GELDAR_MC_PORT` is `25565`, the in-network port. `GELDAR_RCON_PORT` is set only for completeness: the RCON host is loopback by design and the Body does not use RCON.
- The Mind's Ollama address is still loopback. In the container nothing listens there, so the Mind cannot run a thought until the gateway packet. Loading the config does not need Ollama, so the loaders pass.
- The colo life id is `ag_adam_03`, the phase0 id, reused unchanged. Whether the colo life gets a fresh id (decision 0064) is an open question for the owner. It is not decided here.
- Whether the containers start is not verified by this decision. The first real start is packet C1-10.

## Unblocks

- Packet FX-RUNTIME (the C1 boundary review fix), which implements this decision.
- The gateway packet, which replaces the Thinker placeholder.
