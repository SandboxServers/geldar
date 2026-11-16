---
title: Monitoring and vitals
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [../architecture/telemetry-pipeline.md, ../concepts/observation-and-privacy.md, ../reference/glass-and-kino.md, ../runbooks/progress-metrics.md, ../runbooks/colo-deploy.md, node-facts.md, capacity-and-cost.md]
sources: [docs/spec.md, telemetry/README.md, telemetry/package.json, telemetry/src, telemetry/test, pnpm-workspace.yaml, compose/colo.yml, deploy/colo-status.sh, deploy/colo-cd.sh, deploy/README.md, golem/src/metrics.ts, threshold/mcp/src/metrics.ts, eventsink/src/metrics.ts, glass/src/kino/otlp.ts, tools/progress-metrics, tools/portscan/README.md, tools/repo-checks/src/colo-spark.test.ts, docs/runbooks/progress-metrics.md, docs/architecture/telemetry-pipeline.md, ../decisions/0088-metrics-exporters-and-replay-window.md, ../decisions/0130-phase1-owner-rulings-for-c1.md, ../decisions/0185-per-turn-record-for-kit-minds.md, ../decisions/0350-telemetry-scope-and-full-capture.md, ../decisions/0351-paper-telemetry-plugin-scope.md, ../decisions/0352-telemetry-dedicated-clickhouse-database.md]
---

# Monitoring and vitals

Operator material. Do not copy, quote or link this page from anything an agent in the world reads ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)). It states what monitoring is decided and what exists, and the policy around it. It leaves out how anything stays out of agents' reach: that is decision 0350 item 7, not repeated here (plan decision D9).

Repo facts were read at 03c1f5de on 2026-11-16. Nothing was read from the node, the VM, the database or the world (plan decision D8). Why the pipeline is shaped this way is in [telemetry pipeline](../architecture/telemetry-pipeline.md); this page is the inventory.

This page uses "vitals" to mean the shard's health signals: tick rate, bodies online, service health and the stack's own errors. That meaning is inferred: no spec section or decision defines the word (`git grep -i vitals` outside `docs/` finds only a helper in one live test, 2026-11-16). Campaign records under `docs/analysis/` use the same word for a coordinator campaign, which is a different thing.

## Decided

| Record | Status | What it settles for monitoring |
|---|---|---|
| [Spec 7](../spec.md#7-observability) | The design | Prometheus metrics, logs shipped to Loki, correlation ids, and a short alert list. |
| [0088](../decisions/0088-metrics-exporters-and-replay-window.md) | Proposed | Counters, gauges and histograms only; no metric label names a player, a life or a token; push only when an endpoint is set; a failed push never stops a component. |
| [0130](../decisions/0130-phase1-owner-rulings-for-c1.md) ruling 3 | Accepted (owner, 2026-11-10) | Telemetry goes to SigNoz. The endpoint URL is configuration, never in the repo. |
| [0350](../decisions/0350-telemetry-scope-and-full-capture.md) | Accepted (2026-11-15) | Traces, logs and metrics; the attribute rules; content capture during development; retention and budget; operators-only readers; read-only under principle 1; SigNoz replaces spec 7's Prometheus and Loki; work cards T-01 to T-20. |
| [0351](../decisions/0351-paper-telemetry-plugin-scope.md) | Proposed | Paper's share: a separate read-only plugin and one SDK, tested on a scratch shard before any live restart. |
| [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md) | Accepted (owner ruling relayed 2026-11-16), option B | Geldar telemetry goes to a Geldar-owned store and SigNoz stack, not the shared one. |

## Alerts

| Alert | Source | Built? |
|---|---|---|
| TPS under 12 for 5 minutes | Spec 7 | No |
| Bodies online under 80% of target for 10 minutes | Spec 7 | No |
| Any vLLM instance down | Spec 7 | No |
| Daily token spend above the configured ceiling | Spec 7 | No |
| Historian failed to post | Spec 7 | No |

- 0350 item 10 makes spec 7's list the minimum alert set and names three of the five (TPS, bodies online, daily token spend). Card T-17 plans more, as code under a `deploy/signoz/` folder that does not exist at 03c1f5de (`ls deploy`, 2026-11-16).
- The alert channel is not chosen. Alerts go to operators only (0350 item 8 and "Open items").
- 0351 card PT-17 proposes Paper alerts; it is Proposed, and its figures are in the record.

## What exists in the repo

Checked with `ls`, `git grep` and `git log` on 2026-11-16 at 03c1f5de.

| Piece | What it is | State | Evidence |
|---|---|---|---|
| Container health checks | `postgres`, `nats`, `paper`, `velocity`, `geldar-mcp` and `register` declare a healthcheck in `compose/colo.yml`; the other eight services do not. | In the repo; node state unverified | `compose/colo.yml` lines 54, 85, 151, 194, 382, 433 |
| Deploy health gate | `deploy/colo-cd.sh` checks health after each restart and rolls back on a failed check. | In the repo | [deployment topology](../architecture/deployment-topology-colo.md#rollback-and-stop); [deploy scripts](../reference/deploy-scripts.md) |
| Project status | `deploy/colo-status.sh` reports the Geldar project's containers, found by project label only. Read-only. | In the repo | `deploy/colo-status.sh` header |
| Metric pushers | Hand-written OTLP/HTTP JSON pushers in the Body, the MCP, eventsink and Kino. Each is off unless its endpoint variable is set. | In the repo; whether any endpoint is set on the node is unverified | `golem/src/metrics.ts`, `threshold/mcp/src/metrics.ts`, `eventsink/src/metrics.ts`, `glass/src/kino/otlp.ts`; [telemetry pipeline](../architecture/telemetry-pipeline.md#what-the-repo-holds-at-1b114276) |
| Shared telemetry package | `@geldar/telemetry` (card T-03): one OpenTelemetry setup for the Node services, for traces, logs and metrics. Off unless a collector URL is given. The attribute rules of 0350 item 1 are enforced inside the SDK. Its pins match card T-03 (API 1.10.0, SDK 3.0.0, OTLP exporters 0.300.0). | Merged to `main` 2026-11-16 06:08 UTC (PR #551, merge commit 6cf3c957). Not imported by any other package at 03c1f5de. | `telemetry/README.md`; `telemetry/package.json`; `pnpm-workspace.yaml` line 11; `git grep "@geldar/telemetry"` outside `telemetry/` and the lock file finds no code file |
| Paper diagnostics | The profiler bundled with Paper, run by an operator from the console or RCON. Its background profiler is off. | In the repo | `deploy/README.md`, "Performance diagnostics"; `tools/repo-checks/src/colo-spark.test.ts` |
| Progress metrics | `tools/progress-metrics`: an offline, operator-run report from existing logs and samples. Reads files only. | In the repo | [progress-metrics runbook](../runbooks/progress-metrics.md) |
| Port scan | `tools/portscan`: an external TCP scan that passes only on the expected set of open ports. | In the repo | `tools/portscan/README.md` (decisions 0071, 0072) |
| Observation surfaces | The Glass, Kino and the public map: what humans use to watch (spec section 3). | Described in their own pages | [Glass and Kino](../reference/glass-and-kino.md); [observation and privacy](../concepts/observation-and-privacy.md) |

Not in the repo at 03c1f5de (`ls compose deploy plugin`, 2026-11-16): the collector gateway overlay and its config (card T-02), the Geldar SigNoz stack (0352), dashboards and alerts as code (T-17), and the Paper telemetry plugin (0351).

### Metric names in the pushers

Read from the files at 03c1f5de. Kino's counters are left to its own page.

| Pusher | Metric names |
|---|---|
| Body (`golem/src/metrics.ts` lines 253 to 257) | `geldar_body_connected`, `geldar_tps`, `geldar_tick_lag_ms`, `geldar_wakeups_total`, `geldar_action_outcomes_total` |
| MCP (`threshold/mcp/src/metrics.ts` lines 261 to 262) | `geldar_mcp_tool_calls_total`, `geldar_mcp_tool_call_seconds` |
| eventsink (`eventsink/src/metrics.ts` lines 179 to 184) | `geldar_eventsink_consumed_total`, `geldar_eventsink_written_total`, `geldar_eventsink_failed_total`, `geldar_eventsink_dlq_written_total`, `geldar_eventsink_consumer_pending`, `geldar_eventsink_skipped_total` |

Card T-20 keeps these names when the pushers are retired (0350, "Consequences").

### Endpoint wiring

- `compose/colo.yml` passes `GELDAR_TELEMETRY_URL` to `golem-body` (line 267) and `animus` (line 307) only, and Kino's endpoint variable to `glass` (line 485), empty by default.
- Card T-07 plans to carry the endpoint to both Body launch paths (0350, "Consequences").

## Policy

Each item is the decision's rule in one line; the decision holds the detail.

- **Metrics carry no identity.** No metric label names a player, a life, a token or an owner (0088 item 1; 0350 item 1).
- **Traces and logs** may carry the correlation ids and agent names. Owner identities, emails, tokens, cookies, provider subjects and account ids are never attributes in any signal (0350 item 1).
- **Content.** During development all content is captured for diagnosis, with no opt-out. Postgres stays the system of record (0350 item 2).
- **Outside players.** Their content is captured too and erased on request; erasure is a known gap that must close before any outside player's agent runs (0350 item 3).
- **Retention and budget.** One year, under a hard limit, with a storage budget and an early alarm (0350 item 5; 0352, "Budget and alarms" and "Retention"). The figures are in [capacity and cost](capacity-and-cost.md#telemetry-storage).
- **Readers.** Operators and operator sessions only; no public route serves any telemetry view (0350 item 6 and its 2026-11-16 clarification).
- **Agents never see or infer telemetry** (0350 item 7). Not detailed here.
- **Principle 1.** Telemetry, dashboards and alerts only read. None may act in the world (0350 item 8).
- **Failure.** An export failure never stops a component (0088 item 2; `telemetry/README.md`, "Operator notes").

## Lifecycle

| Stage | Where it stands |
|---|---|
| Owner | The owner approves every node step, the extra containers, the budget, the retention and any route; the orchestrator decides which cards change and when (0352, "Who decides"). |
| Build and test | `./geldar.ps1 pnpm --filter @geldar/telemetry test` runs the package's 18 test files with fake exporters and no network (`telemetry/README.md`, "Tests"; `ls telemetry/test`, 2026-11-16). Each card names its own tests (0350, "Consequences"). |
| Deploy | Nothing telemetry-specific is deployed by the repo. Each node change needs the owner's approval at the time (0350 items 4 and 9; 0352). |
| Operate | Health: `deploy/colo-status.sh` and the container health checks. Paper: the bundled profiler, by an operator. Progress: the [progress-metrics runbook](../runbooks/progress-metrics.md). |
| Rollback | Unset the gateway endpoint so the SDK goes off; stop the Geldar SigNoz stack; keep its data until the owner decides (0352, "Rollback"). |
| Failure modes | See [failure modes](failure-modes.md), "Telemetry". |
| Retirement | T-20 retires the four hand-written pushers once the SDK path reaches parity (0350, "Consequences"). |

## Conflicts recorded

None is resolved here.

1. **Which stack.** Spec 7: Prometheus and Loki. Decisions 0130, 0350 item 10 and 0352: SigNoz. Code: hand-written OTLP pushers and, since 2026-11-16, an OpenTelemetry package that no service uses yet.
2. **Who gets alerts.** Spec 7 sends alerts to a named person. 0350 item 8: operators only, channel not chosen.
3. **What is recorded.** 0088 item 1 (Proposed): thought text, persona text, prompts and tokens are never recorded. 0350 item 2 (Accepted): all content is captured during development, for telemetry only. Decision [0185](../decisions/0185-per-turn-record-for-kit-minds.md) (Proposed) gates prompts and reasoning in Postgres on an open ruling that 0350 does not settle.
4. **The package against 0350.** `telemetry/README.md` ("Operator notes") records one narrowing of 0350. Read both before changing either.

## Not verified

- Anything on the node: whether any endpoint is set, whether any collector or SigNoz stack runs, which health checks pass (plan decision D8). 0350 records that on 2026-11-15 nothing was switched on (0350, "Context"); not re-checked.
- 0351 is Proposed and its overhead test is not reported in the repo.
- [Telemetry pipeline](../architecture/telemetry-pipeline.md) was checked at 1b114276 and says no `@geldar/telemetry` package exists; that was true then and changed with PR #551.
