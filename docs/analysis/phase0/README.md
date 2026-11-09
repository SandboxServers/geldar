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
| D-P0-07 | Minecraft 26.1 (owner, 2026-11-08): Paper 26.1.2 build 74 (protocol 775, same as 26.1), Java 25, Velocity 3.5.1 build 615, Mineflayer 4.39.0, minecraft-data 3.117.0, mineflayer-pathfinder 2.4.5 (untested on 26.1: P0-07 and the benchmark watch it) | Accepted | P0-06, wave 2 | [0022](../../decisions/0022-minecraft-26-1.md) |
| D-P0-08 | Velocity from Phase 0: bots reach Paper only through the bot-ingress Velocity proxy with modern forwarding, Paper publishes no game port, secrets are Docker secret files, matching production (owner, 2026-11-08) | Accepted | P0-06, P0-07, P0-13 | [0021](../../decisions/0021-velocity-from-phase0.md) |
| D-P0-09 | Generator tools: `json-schema-to-typescript` for types, Ajv standalone for precompiled validators | Accepted (orchestrator) | P0-01 | work-packets.md § Contract |
| D-P0-10 | Receipts: every action writes one; economic actions write two phases (`prepared`, then `committed` or `aborted`), the rest write one final receipt; `(action_id, phase)` unique, which changes Appendix D | Accepted | P0-03, P0-05 | [0020](../../decisions/0020-receipts.md) |
| D-P0-11 | Migrations: numbered SQL files in `sql/`, applied by Postgres init on a fresh volume in Phase 0; a migration runner when the first schema change hits a live database | Accepted (orchestrator) | P0-05 | `sql/README.md` (P0-05) |
| D-P0-12 | Embedding model for `memories.embedding vector(768)`: `nomic-embed-text` through Ollama (768 dimensions) | Open | wave 5 | — |
| D-P0-13 | Observatory edge (spec 13, 2a, "decide before Phase 0"): deferred to Phase 2, since Phase 0 exposes nothing | Proposed (orchestrator) | Phase 2 | — |

## Packets

Status: Ready / BlockedDependency / BlockedDecision / Writing / Review / Done.

| Packet | Wave | Title | Implementer | Status | Depends on | PR |
|---|---|---|---|---|---|---|
| P0-00 | 1 | Threat model (`docs/threat-model.md`) | Sonnet (general-purpose) | Done | — | |
| P0-01 | 1 | `contract/` package, generator, drift check, snapshot schema | packet-coder | Writing (continuation 2) | — | |
| P0-02 | 1 | Thought schema: intents and actions (Appendix C) | packet-coder | BlockedDependency | P0-01 | |
| P0-03 | 1 | Action record, receipt and event envelope schemas | packet-coder | BlockedDependency | P0-01 | |
| P0-04 | 1 | Thinker protocol frame schemas (Appendix H) | packet-coder | BlockedDependency | P0-01 | |
| P0-05 | 1 | `sql/` migrations from Appendix D, checked in CI | packet-coder | Done | — | |
| P0-06 | 1 | `compose/phase0.yml` (Paper behind Velocity, Postgres, NATS) and `shards/phase0.yaml`, healthy stack | packet-coder | BlockedDependency | P0-05 | |
| P0-07 | 2 | `golem/` skeleton: connect, reconnect, RCON test control | written at wave 1 close | BlockedDependency | P0-06 | |
| P0-08 | 2 | Body actions A: goto, gather, craft, with action results | written at wave 1 close | BlockedDependency | P0-07 | |
| P0-09 | 2 | Body actions B: place, eat, sleep, chest open/deposit/withdraw | written at wave 1 close | BlockedDependency | P0-07 | |
| P0-10 | 2 | Body benchmark harness, six scenarios, 20/10/5 TPS, `bench-results.md` | written at wave 1 close | BlockedDependency | P0-08, P0-09 | |
| P0-11 | 3 | Geldar-Core plugin: Gradle/Paper skeleton, event export to NATS | written at wave 2 close | BlockedDependency | P0-06 | |
| P0-12 | 3 | `eventsink/`: NATS to Postgres, idempotent on `source_event_id` | written at wave 2 close | BlockedDependency | P0-03, P0-05 | |
| P0-13 | 3 | Bot-ingress identity plugin for Velocity: admit only usernames registered for a living life ID | written at wave 2 close | BlockedDependency | P0-06 | |

Later waves, sliced when wave 2 closes (spec section 10 "Build" line):

- **Wave 3, world to record:** Geldar-Core plugin (Gradle, Paper API) with event export to NATS `geldar.<shard>.<type>`; `eventsink/` NATS → Postgres (idempotent on `source_event_id`); the Velocity bot-ingress identity plugin (Appendix F, P0-13), which reads registrations from a NATS JetStream key-value bucket that Golem writes before connecting, standing in for the production supervisor. Packet IDs for this wave: P0-11 to P0-13.
- **Wave 4, the Body lives:** reflexes (spec 5.2 table), the intent executor with preconditions, wake conditions, limits and checkpoints, action records and receipts, Body restart resuming from checkpoint.
- **Wave 5, the Mind:** `lantern-local/` (Appendix H over a local WebSocket to Ollama), `animus/` thinking loop (5.3.4), attention controller (5.3.2), memory and sleep reflection (5.4), first versioned prompts in `prompts/` (Appendix B).
- **Wave 6, watch and run Adam:** `glass/` Thought Stream v0, then the Adam runs on Qwen3 32B and 8B against the exit criteria above, and the campaign review.
