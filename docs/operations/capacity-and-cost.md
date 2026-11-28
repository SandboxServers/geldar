---
title: Capacity and cost
type: reference
audience: owner
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [../concepts/economy-and-budgets.md, ../concepts/time-shards-and-phases.md, ../reference/shard-config.md, ../reference/compose-stacks.md, node-facts.md, monitoring-and-vitals.md]
sources: [docs/spec.md, shards/colo.yaml, shards/colo-mind.yaml, shards/phase0.yaml, compose/colo.yml, compose/phase0.yml, deploy/README.md, body-helper/src/helperConfig.ts, tools/adam-report/criteria.yaml, docs/analysis/phase0/bench-results.md, docs/analysis/phase0/bench-runs, docs/analysis/phase0/README.md, docs/concepts/economy-and-budgets.md, docs/runbooks/node-only-config.md, docs/reference/admin-service.md, ../decisions/0002-phase0-host-and-models.md, ../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md, ../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md, ../decisions/0057-sovereign-budget-numbers-and-wake-spacing.md, ../decisions/0082-colo-compose-network-and-limits.md, ../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md, ../decisions/0149-act-budget-suspended-and-metered.md, ../decisions/0350-telemetry-scope-and-full-capture.md, ../decisions/0351-paper-telemetry-plugin-scope.md, ../decisions/0352-telemetry-dedicated-clickhouse-database.md]
---

# Capacity and cost

Every figure the repo holds about what Geldar costs and what it can carry: the spec's cost model, the configured budgets, the measured benchmarks and the node's recorded headroom. Each figure carries its source and its date. Why thinking costs credits, and how the three ledgers stay apart, is in [economy and budgets](../concepts/economy-and-budgets.md).

How the figures were checked on 2026-11-16 at 03c1f5de:

- **Repo figures** (config, compose, benchmark files) were re-read or re-derived from the files.
- **Benchmark figures** were re-derived from the recorded run files, not re-run. The benchmark changes the shard's tick rate and world, and this pass is read-only.
- Links marked **(a-n)** go to `agents-never` documents.
- **Node figures** come from decisions that recorded a read-only survey. They were not re-measured (plan decision D8) and are marked **unverified**.

## Cost model (spec section 9)

From [spec section 9](../spec.md#9-cost-model), as written:

- The Colo costs what it already costs. There is no GPU in the Colo.
- Ongoing costs are home power, Patron goodwill and cloud API spend. The money goes to the frontier tier and the Historian; everything else is local or nearly free.
- Local inference costs nothing at the margin beyond power; its limit is capacity, measured as successful intents per GPU-second.
- Sovereign players cost the project nothing for thinking: their human's subscription pays. The project pays for the Body and the MCP traffic.
- The number that matters most: model calls a learned procedure saves, per skill edition.

### The spec's exposure figure

The spec gives one worked figure and calls it an illustration, not a provider quote and not a prediction: six frontier agents at about 150 standard thoughts each per real day.

| Item | Spec figure | Arithmetic re-checked 2026-11-16 |
|---|---|---|
| Calls per day | 900 | 6 x 150 = 900 |
| Uncached input | about $4.05 | 900 x 1,500 tokens x $3 per million = $4.05 |
| Cached input | about $0.54 | 900 x 2,000 x $0.30 per million = $0.54 |
| Output | about $4.05 | 900 x 300 x $15 per million = $4.05 |
| Per day, every call on the cached prefix | about $8.60 | $8.64 |
| Per month | about $260 | $8.64 x 30 = $259 |
| Per day, no cache hits | about $13.50 | 900 x 3,500 x $3 per million + $4.05 = $13.50 |

The spec adds reflection, retries, cache writes, hidden reasoning tokens and the Historian on top. The prices are the spec's assumptions, not checked against any provider. The spec costs against "the baseline tick rate of 10"; Geldar runs at 20 TPS ([conflict 1](#conflicts-recorded)).

### Controls the spec names, and what exists

| Control (spec 9) | In the repo at 03c1f5de | Evidence |
|---|---|---|
| Per-agent credits | Yes, for sovereign players (ledger) and for the project's own Mind (admission counter) | [economy and budgets](../concepts/economy-and-budgets.md#what-exists-in-code) |
| Per-Patron LiteLLM ceiling | Not found | `git grep -il litellm` outside `docs/` and the lock file: no match, 2026-11-16 |
| Per-shard real-resource ceiling, reserve before dispatch | Not found | [economy and budgets](../concepts/economy-and-budgets.md#what-exists-in-code) (no `real_ceiling` in code, 1b114276) |
| Frontier tier capped at 8% of population | Not found | The shard files set one `tier` per life and no population cap (`shards/colo-mind.yaml` line 114, `shards/phase0.yaml` line 38; read 2026-11-16) |
| Daily token spend alert | Not built | [monitoring and vitals](monitoring-and-vitals.md#alerts) **(a-n)** |

## Thinking budgets

Re-read from the shard files on 2026-11-16 at 03c1f5de.

| Setting | Value | Where | Decision |
|---|---|---|---|
| Credits accrued per real hour (sovereign) | 30 | `shards/phase0.yaml` line 128; `shards/colo-mind.yaml` line 74 | [0057](../decisions/0057-sovereign-budget-numbers-and-wake-spacing.md) |
| Credit cap (sovereign) | 240 | `shards/phase0.yaml` line 129; `shards/colo-mind.yaml` line 75 | 0057 |
| Thought jobs per real hour (project Mind) | 120 | `shards/phase0.yaml` line 67; `shards/colo-mind.yaml` line 141 | wave 5 Q4 (file comment) |
| Act budget enforcement | off by default (`0`) | `compose/colo.yml` line 357 | [0149](../decisions/0149-act-budget-suspended-and-metered.md), accepted and temporary |

While 0149 holds, every `act` is metered instead of charged: each writes what it would have cost and how it ended (0149, "What is metered"). That stream is the repo's only per-call cost measurement. No summary of it is committed. On the Colo the project's own Mind is off until a Thinker exists (decision [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md)), so its admission counter costs nothing there.

The spec's tiered numbers differ from these; the [economy page](../concepts/economy-and-budgets.md#conflicts-recorded) records that conflict.

## Colo stack budget

Re-derived on 2026-11-16 from the per-service defaults in `compose/colo.yml` (`GELDAR_COLO_<SERVICE>_CPUS` and `_MEM`, lines 35 to 652).

| Service | Profile | CPUs | Memory |
|---|---|---|---|
| `paper` | default | 8 | 15360m (heap 10G) |
| `postgres` | default | 1 | 2048m |
| `velocity` | default | 0.5 | 1024m |
| `nats` | default | 0.5 | 512m |
| `eventsink` | default | 0.5 | 512m |
| `geldar-mcp` | default | 0.5 | 512m |
| `glass` | default | 0.5 | 256m |
| `bluemap-web` | default | 0.25 | 64m |
| `bluemap-alias` | default | 0.1 | 64m |
| `golem-body` | `adam` | 1 | 2048m |
| `players-host` | `sovereign` | 1 | 2048m |
| `register` | `register` | 0.25 | 128m |
| `admin` | `admin` | 0.5 | 512m |
| **Total, 13 services** | | **14.6** | **25088m** |
| Default profile only, 9 services | | 11.85 | 20352m |

The total equals `cpu_limit: 14.6` and `memory_limit: 25088m` in `shards/colo.yaml` (lines 13 and 14). That file's header says the limits are "first guesses, to be measured in C1-10 on the node; they are not results". No C1-10 measurement is committed.

Two limits this total does not cover:

- **One player host per player.** The total counts one `players-host`. The admin wrapper starts one container per sovereign player ([admin service](../reference/admin-service.md#per-player-hosts)), and 19 player Bodies ran on 2026-11-15 (decision [0350](../decisions/0350-telemetry-scope-and-full-capture.md), "Context"; unverified). The per-owner cap is 20 (decision [0052](../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md)).
- **Managed Bodies.** The body helper takes its Body CPU, memory and process limits from its node env file (`GELDAR_BODY_NANO_CPUS`, `GELDAR_BODY_MEMORY_BYTES`, `GELDAR_BODY_PIDS_LIMIT` in `body-helper/src/helperConfig.ts`). Their values are not in the repo.

## Node headroom

From decision [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md), "Fit check", a read-only measurement at 2026-11-15 23:49 UTC. **Unverified** here. [Node facts](node-facts.md#measured-capacity) has the same table with its context.

| Measure | Value |
|---|---|
| CPUs | 16, about 95% idle |
| Memory | 128 GB total, 29 GB used, 98 GB available |
| Data disk | 1.8 TB, 1.2 TB free |
| Root filesystem | 20 GB free |
| Paper in use | 12.7 of 14 GiB |

0352 notes the data disk's free space "was a sample, not a budget". The deploy script refuses to run with less than 10 GiB free on the filesystem that holds the checkout (`GELDAR_MIN_FREE_KB`, `deploy/README.md`, "Prerequisites"; re-read 2026-11-16).

## Telemetry storage

| Figure | Value | Source, date | Kind |
|---|---|---|---|
| Retention | One year, hard limit | 0350 item 5 (owner ruling 2026-11-15); 0352 "Retention" | Policy |
| Storage budget | 100 GB | 0350 item 5 | Policy |
| Early alarm | 70 GB (70% of the budget) | 0350 item 5; 0352 "Budget and alarms" | Policy |
| Node-wide disk alarm | data disk above 60% used | 0350 item 5 | Policy |
| Over budget | Stop and tell the owner; do not raise the budget | 0350 item 5 | Policy |
| Estimated growth, Geldar services | 0.1 to 0.15 GB a day, about 37 to 55 GB a year | 0350 item 5 (survey estimate, 2026-11-15) | Estimate, unverified |
| Estimated growth, Paper | 17 to 66 MB a day stored, about 6 to 24 GB a year | 0351 "Consequences" (survey estimate, 2026-11-15) | Estimate, unverified; the top of the range passes the 70 GB alarm, so 0351 requires a measurement first |
| Geldar telemetry stack at its caps | 5.5 CPUs and 11.5 GiB long-running; 6.25 CPUs and 12.25 GiB with the UI and migrator | 0352 "Containers and caps" and "Costs" | Proposed ceilings, not usage; nothing built |

0352's fit check put the stack at caps at about 9% of the node's total memory and about 5% of its CPU at typical load. It names the Paper tick during store merges as the risk to watch.

## Body capacity

The body benchmark (spec section 10, Phase 0) on the owner's desktop, not the Colo (bench notes; decision [0002](../decisions/0002-phase0-host-and-models.md)). The latest recorded 20 TPS run is commit 251ff8d on 2026-11-09. The table below was re-derived on 2026-11-16 from `docs/analysis/phase0/bench-runs/20261109T195841Z-251ff8d.json` (`summary`) and matches the rows in [bench-results.md](../analysis/phase0/bench-results.md).

| Scenario | Runs passed | Actions completed | p50 ms | p95 ms | Achieved TPS |
|---|---|---|---|---|---|
| wood-to-stone-tools | 10/10 | 80/80 | 499 | 23162 | 19.4 |
| food | 10/10 | 20/20 | 1646 | 2668 | 19.6 |
| shelter | 10/10 | 100/100 | 563 | 1063 | 19.1 |
| bed | 10/10 | 30/30 | 312 | 1103 | 26.6 |
| chest | 10/10 | 30/30 | 9 | 437 | 16.9 |
| blocked-path | 10/10 | 5/10 | 6200 | 6445 | 19.7 |

- p50 and p95 are over completed actions only (bench-results, "How to read the rows").
- In blocked-path every run passed while half the `goto` actions completed; the file records both.
- Achieved TPS above the 20 TPS target (bed, 26.6) and well below it (chest, 16.9) are as recorded in the run file; neither is explained in the source.
- The 10 and 5 TPS rows (commit 8934be9, same day) are findings only: the client is not slowed, only the server (decision [0038](../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md)).
- No benchmark has run on the Colo or with more than one Body. 0351 plans a 19-Body scratch run for Paper's overhead test; none is reported.

## Model capacity

- **Model floor.** Not recorded. `model_floor_verdict` is `null` in `tools/adam-report/criteria.yaml` (line 25, read 2026-11-16); the owner fills it after the 8B and 32B Adam runs.
- **Inference calls per useful autonomous minute** and **thought latency** (target under 15 s) are Phase 0 measures ([phase 0 README](../analysis/phase0/README.md)). No Adam run report is committed (`git ls-files` finds none, 2026-11-16).
- **Sovereign players.** Their cost is turns against their own plan's limits (spec 9). The repo records no per-player usage figure.

## Conflicts recorded

None is resolved here.

1. **Tick rate in the cost model.** Spec 9 costs against "the baseline tick rate of 10"; spec 10 says all phases run at 20 TPS. Spec 9 also says its budgets are in real time, so the tick rate changes how long an in-game day lasts, not the per-day figures above. See [time, shards and phases](../concepts/time-shards-and-phases.md#conflicts-recorded).
2. **Paper's memory.** `compose/colo.yml`: 15360m (15 GiB) and heap 10G (D1). Decisions 0351 and 0352 (node surveys, 2026-11-15): 14 GiB limit, heap 10 GiB; 0351 item 13 proposes 15 GiB. Decision [0082](../decisions/0082-colo-compose-network-and-limits.md) (Proposed): every limit comes from `shards/colo.yaml`. See [node facts](node-facts.md#conflicts-recorded).
3. **The shard total and the running population.** `shards/colo.yaml` calls its limits "the TOTAL budget of the shard" and counts one player host. 19 player Bodies ran on 2026-11-15 (0350, unverified). Whether the total is meant to cover per-player hosts is not stated.

## Not measured

- Real API spend, tokens per thought, cache hit rate and GPU-seconds per intent: no committed measurement, and no `tokens_total` metric in code (`git grep tokens_total` outside `docs/`: none, 2026-11-16).
- The Colo stack's real use against its budget (C1-10).
- Peak load of the Geldar telemetry stack under store merges (0352, "Unverified").
