# Phase 0 — Adam: campaign ledger

**Goal (spec section 10, Phase 0):** one living agent on one machine. Paper, Postgres, NATS, the Mind, one Body and a model, started with one command. The body benchmark runs first, before any model is attached.

**Exit (system acceptance), copied from the spec:**

- An agent survives 5 consecutive in-game days (about 100 real minutes at 20 TPS), and the stack runs **24 real hours** across restarts, with a bed, food and stone tools.
- At least three durable intents ran to completion through chatter and interruptions without a model call.
- Every action has a receipt.
- A Body restart mid-intent resumed from its checkpoint.
- Recorded: the **model floor** (smallest model that passed) and **inference calls per useful autonomous minute**. Thought latency under 15 s.
- If no model passes, stop and fix the Body/Mind split.

Packets: [work-packets.md](work-packets.md). Resume card: [RESUME.md](RESUME.md). Benchmark numbers: [bench-results.md](bench-results.md). Process: the [campaign-packet skill](../../../.claude/skills/campaign-packet/SKILL.md).

## Decisions

| ID | Decision | Status | Needed by | Record |
|---|---|---|---|---|
| D-P0-01 | Task runner: `geldar.ps1` | Accepted | — | [0003](../../decisions/0003-task-runner.md) |
| D-P0-02 | Contract format: JSON Schema + codegen | Accepted | P0-01 | [0001](../../decisions/0001-contract-json-schema.md) |
| D-P0-03 | Host and models: this PC, Ollama, Qwen3 32B and 8B | Accepted | wave 5 | [0002](../../decisions/0002-phase0-host-and-models.md) |
| D-P0-04 | Repo layout: one repo for Phase 0 | Accepted | — | [0004](../../decisions/0004-phase0-repo-layout.md) |
| D-P0-05 | Exact pins, two-week minimum, security-only Dependabot | Accepted | — | [0005](../../decisions/0005-pinning-and-security-updates.md) |
| D-P0-06 | Toolchain: pnpm, TypeScript 7, Biome, Vitest | Accepted | — | [0006](../../decisions/0006-typescript-toolchain.md) |
| D-P0-07 | **Minecraft version and the pinned body stack.** Mineflayer 4.39.0 is tested up to 26.1, but `mineflayer-pathfinder` (2.4.5) hasn't released since 2023. Candidates: 26.1 (newest Mineflayer tests) or 1.21.11 (longer plugin track record). Proposal: P0-07 smoke-tests 26.1 with the pinned plugins; fall back to 1.21.11 if digging, pathing or eating misbehave. | **Owner** | P0-06, wave 2 | — |
| D-P0-08 | **Does Phase 0 run Velocity?** Spec section 10 says Velocity "doesn't exist yet" in Phase 0, but the same paragraph builds "the bot ingress", which Appendix F defines as a Velocity plugin. Proposal: Phase 0 connects the Body straight to Paper (offline mode, bound to localhost) and the bot-ingress identity check moves to Phase 1. | **Owner** | P0-06 | — |
| D-P0-09 | Generator tools: `json-schema-to-typescript` for types, Ajv standalone for precompiled validators | Accepted (orchestrator) | P0-01 | work-packets.md § Contract |
| D-P0-10 | Receipts: every action writes one; economic actions write two phases (`prepared`, then `committed` or `aborted`), the rest write one final receipt; `(action_id, phase)` unique, which changes Appendix D | Accepted | P0-03, P0-05 | [0020](../../decisions/0020-receipts.md) |
| D-P0-11 | Migrations: numbered SQL files in `sql/`, applied by Postgres init on a fresh volume in Phase 0; a migration runner when the first schema change hits a live database | Accepted (orchestrator) | P0-05 | `sql/README.md` (P0-05) |
| D-P0-12 | Embedding model for `memories.embedding vector(768)`: `nomic-embed-text` through Ollama (768 dimensions) | Open | wave 5 | — |
| D-P0-13 | Observatory edge (spec 13, 2a, "decide before Phase 0"): deferred to Phase 2, since Phase 0 exposes nothing | Proposed (orchestrator) | Phase 2 | — |

## Packets

Status: Ready / BlockedDependency / BlockedDecision / Writing / Review / Done.

| Packet | Wave | Title | Implementer | Status | Depends on | PR |
|---|---|---|---|---|---|---|
| P0-00 | 1 | Threat model (`docs/threat-model.md`) | Sonnet (general-purpose) | Ready | — | |
| P0-01 | 1 | `contract/` package, generator, drift check, snapshot schema | packet-coder | Ready | — | |
| P0-02 | 1 | Thought schema: intents and actions (Appendix C) | packet-coder | BlockedDependency | P0-01 | |
| P0-03 | 1 | Action record, receipt and event envelope schemas | packet-coder | BlockedDependency | P0-01 | |
| P0-04 | 1 | Thinker protocol frame schemas (Appendix H) | packet-coder | BlockedDependency | P0-01 | |
| P0-05 | 1 | `sql/` migrations from Appendix D, checked in CI | packet-coder | Ready | — | |
| P0-06 | 1 | `compose/phase0.yml` and `shards/phase0.yaml`, healthy stack | packet-coder | BlockedDecision | P0-05, D-P0-07, D-P0-08 | |
| P0-07 | 2 | `golem/` skeleton: connect, reconnect, RCON test control | written at wave 1 close | BlockedDependency | P0-06 | |
| P0-08 | 2 | Body actions A: goto, gather, craft, with action results | written at wave 1 close | BlockedDependency | P0-07 | |
| P0-09 | 2 | Body actions B: place, eat, sleep, chest open/deposit/withdraw | written at wave 1 close | BlockedDependency | P0-07 | |
| P0-10 | 2 | Body benchmark harness, six scenarios, 20/10/5 TPS, `bench-results.md` | written at wave 1 close | BlockedDependency | P0-08, P0-09 | |

Later waves, sliced when wave 2 closes (spec section 10 "Build" line):

- **Wave 3, world to record:** Geldar-Core plugin (Gradle, Paper API) with event export to NATS `geldar.<shard>.<type>`; `eventsink/` NATS → Postgres (idempotent on `source_event_id`); bot ingress per D-P0-08.
- **Wave 4, the Body lives:** reflexes (spec 5.2 table), the intent executor with preconditions, wake conditions, limits and checkpoints, action records and receipts, Body restart resuming from checkpoint.
- **Wave 5, the Mind:** `lantern-local/` (Appendix H over a local WebSocket to Ollama), `animus/` thinking loop (5.3.4), attention controller (5.3.2), memory and sleep reflection (5.4), first versioned prompts in `prompts/` (Appendix B).
- **Wave 6, watch and run Adam:** `glass/` Thought Stream v0, then the Adam runs on Qwen3 32B and 8B against the exit criteria above, and the campaign review.
