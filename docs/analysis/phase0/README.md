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
| D-P0-07 | Minecraft 26.1 (owner, 2026-11-08): Paper 26.1.2 build 74 (protocol 775, same as 26.1), Java 25, Velocity 3.5.1 build 615, Mineflayer 4.39.0, minecraft-data 3.117.0, mineflayer-pathfinder 2.4.5. Verified in wave 2: Mineflayer 4.39.0 joins Paper 26.1.2 through Velocity (protocol 775) and the live lane passes. P0-07b protocol verdict: version 26.1, protocolVersion 775, mineflayer 4.39.0, minecraft-data 3.117.0, pathfinder 2.4.5, vec3 0.1.10. Library gaps found: table-craft stateId ([0032](../../decisions/0032-table-crafting-and-recipe-book.md)) and chest transfer ([0037](../../decisions/0037-chest-transfers-by-explicit-clicks.md)); the pathfinder needs the corner-cutting wrapper ([0039](../../decisions/0039-pathing-forbids-corner-cutting.md)) | Accepted | P0-06, wave 2 | [0022](../../decisions/0022-minecraft-26-1.md) |
| D-P0-08 | Velocity from Phase 0: bots reach Paper only through the bot-ingress Velocity proxy with modern forwarding, Paper publishes no game port, secrets are Docker secret files, matching production (owner, 2026-11-08) | Accepted | P0-06, P0-07, P0-13 | [0021](../../decisions/0021-velocity-from-phase0.md) |
| D-P0-09 | Generator tools: `json-schema-to-typescript` for types, Ajv standalone for precompiled validators | Accepted (orchestrator) | P0-01 | work-packets.md § Contract |
| D-P0-10 | Receipts: every action writes one; economic actions write two phases (`prepared`, then `committed` or `aborted`), the rest write one final receipt; `(action_id, phase)` unique, which changes Appendix D | Accepted | P0-03, P0-05 | [0020](../../decisions/0020-receipts.md) |
| D-P0-11 | Migrations: numbered SQL files in `sql/`, applied by Postgres init on a fresh volume in Phase 0; a migration runner when the first schema change hits a live database | Accepted (orchestrator) | P0-05 | `sql/README.md` (P0-05) |
| D-P0-12 | Embedding model for `memories.embedding vector(768)`: `nomic-embed-text` through Ollama (768 dimensions) | Open | wave 5 | — |
| D-P0-14 | Recipe-book grant: the Geldar-Core plugin grants all recipes on join so table crafts work ([0032](../../decisions/0032-table-crafting-and-recipe-book.md)); an Adam design question for owner review | Proposed (owner review) | P0-11 | [0032](../../decisions/0032-table-crafting-and-recipe-book.md) |
| D-P0-15 | Chest transfers as explicit server-confirmed click sequences, not `container.deposit`/`withdraw` | Accepted (owner review of the click sequences) | wave 4 | [0037](../../decisions/0037-chest-transfers-by-explicit-clicks.md) |
| D-P0-16 | Tick rate does not slow a client-driven Body; this affects spec 5.14, and the owner must read it before waves 4 and 5 | Proposed (owner must read) | wave 4, wave 5 | [0038](../../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md) |
| D-P0-17 | Benchmark pass bar: 100% at 20 TPS; the 10 and 5 TPS rows are findings only | Accepted (owner ruling) | wave 4 | [0038](../../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md) |
| D-P0-18 | Benchmark runs: `--runs` defaults to 5; the recorded run uses 10 | Proposed (owner review) | wave 4 | `golem/src/bench/cli.ts` |
| D-P0-13 | Observatory edge (spec 13, 2a, "decide before Phase 0"): deferred to Phase 2, since Phase 0 exposes nothing | Proposed (orchestrator) | Phase 2 | — |

## Packets

Status: Ready / BlockedDependency / BlockedDecision / Writing / Review / Shipped / Done.

| Packet | Wave | Title | Implementer | Status | Depends on | PR |
|---|---|---|---|---|---|---|
| P0-00 | 1 | Threat model (`docs/threat-model.md`) | Sonnet (general-purpose) | Done | — | #4 |
| P0-01 | 1 | `contract/` package, generator, drift check, snapshot schema | packet-coder | Done | — | #4 |
| P0-02 | 1 | Thought schema: intents and actions (Appendix C) | packet-coder | Done | P0-01 | #4 |
| P0-03 | 1 | Action record, receipt and event envelope schemas | packet-coder | Done | P0-01 | #4 |
| P0-04 | 1 | Thinker protocol frame schemas (Appendix H) | packet-coder | Done | P0-01 | #4 |
| P0-05 | 1 | `sql/` migrations from Appendix D, checked in CI | packet-coder | Done | — | #4 |
| P0-06 | 1 | `compose/phase0.yml` (Paper behind Velocity, Postgres, NATS) and `shards/phase0.yaml`, healthy stack | packet-coder | Done | P0-05 | #4 |
| P0-07a | 2 | `golem/` package, RCON test control, arena, live-test lane | packet-coder | Shipped (review 3, merged to wave2) | — | |
| P0-07b | 2 | Connection with reconnect and backoff, snapshot builder, live fixture, smoke test and protocol verdict | packet-coder | Shipped (review 2, merged to wave2) | P0-07a | |
| P0-07c | 2 | Action outcome shape, registry, run wrapper with timeouts, `moveNear` | packet-coder | Shipped (review 2, merged to wave2) | P0-07b | |
| P0-08a | 2 | Body actions: `goto`, `mine` | packet-coder | Shipped (batch review 5 rounds, merged to wave2) | P0-07c | |
| P0-08b | 2 | Body action: `craft` | packet-coder | Shipped (batch review 5 rounds, merged to wave2) | P0-07c | |
| P0-09a | 2 | Body actions: `place`, `eat`, `sleep` | packet-coder | Shipped (batch review 5 rounds, merged to wave2) | P0-07c | |
| P0-09b | 2 | Body actions: `open`, `deposit`, `withdraw` | packet-coder | Shipped (batch review 5 rounds, merged to wave2) | P0-07c | |
| P0-10a | 2 | Benchmark harness, TPS control, results writer, `./geldar.ps1 bench` | packet-coder | Shipped (review 3, merged to wave2) | P0-08a | |
| P0-10b | 2 | Scenarios `wood-to-stone-tools`, `food`, `shelter` | packet-coder | Shipped (batch review 2 rounds, merged to wave2) | P0-08a, P0-08b, P0-09a, P0-10a | |
| P0-10c | 2 | Scenarios `bed`, `chest`, `blocked-path` | packet-coder | Shipped (batch review 2 rounds, merged to wave2) | P0-08a, P0-08b, P0-09a, P0-09b, P0-10a | |
| W1-process | 2 | Apply the wave 1 retro actions to agents, skills and repo checks | packet-coder | Shipped (review 3, merged to wave2) | — | |
| W2-process | 2 | Apply the wave 2 retro actions to agents, skills, docs and repo checks | packet-coder | Ready | wave 2 code | |
| W2-process | 2 | Apply the wave 2 retro actions to agents, skills, `CLAUDE.md` and `AGENTS.md` | packet-coder | Writing | — | |
| P0-11 | 3 | Geldar-Core plugin: Gradle/Paper skeleton, event export to NATS | written at wave 2 close | Writing | P0-06 | |
| P0-12 | 3 | `eventsink/`: NATS to Postgres, idempotent on `source_event_id` | written at wave 2 close | Writing | P0-03, P0-05 | |
| P0-13 | 3 | Bot-ingress identity plugin for Velocity: admit only usernames registered for a living life ID | written at wave 2 close | Writing | P0-06 | |

Wave PRs: wave 1 is #4; the wave 2 PR number is filled in when it is opened. Retros: [retro/wave-1.md](retro/wave-1.md); `retro/wave-2.md` is written at the wave 2 close (wave close step 4).

**Wave 2 additions** (merged outside the packet rows above): the P0-10a follow-up (read-only run queries `blockIs` and `isSleeping`, an injected scenario list; eeb44fd); the record helper (`golem/test/live/record.ts`; 7f8c46e); the corner-cutting `moveNear` fix ([0039](../../decisions/0039-pathing-forbids-corner-cutting.md)); the hidden `bed-clear` control scenario; the arena `stone_bricks` floor (46962cc); the table-craft and chest rework ([0032](../../decisions/0032-table-crafting-and-recipe-book.md), [0037](../../decisions/0037-chest-transfers-by-explicit-clicks.md)).

Later waves, sliced when wave 2 closes (spec section 10 "Build" line):

- **Wave 3, world to record** (the Phase 0 wave; not "Scriptorium Wave 3", which is already merged to main: the mock Geldar MCP world, PRs #5 to #15): Geldar-Core plugin (Gradle, Paper API) with event export to NATS `geldar.<shard>.<type>`; `eventsink/` NATS → Postgres (idempotent on `source_event_id`); the Velocity bot-ingress identity plugin (Appendix F, P0-13), which reads registrations from a NATS JetStream key-value bucket that Golem writes before connecting, standing in for the production supervisor. Packet IDs for this wave: P0-11 to P0-13. Obligations carried in: P0-11 must make the Geldar-Core plugin grant all recipes on join ([0032](../../decisions/0032-table-crafting-and-recipe-book.md)); `compose/phase0.yml` sets `ENFORCE_WHITELIST` on and Golem whitelists its bots over RCON, so P0-13 must keep that working or replace it.
- **Wave 4, the Body lives:** reflexes (spec 5.2 table), the intent executor with preconditions, wake conditions, limits and checkpoints, action records and receipts, Body restart resuming from checkpoint.
- **Wave 5, the Mind:** `lantern-local/` (Appendix H over a local WebSocket to Ollama), `animus/` thinking loop (5.3.4), attention controller (5.3.2), memory and sleep reflection (5.4), first versioned prompts in `prompts/` (Appendix B).
- **Wave 6, watch and run Adam:** `glass/` Thought Stream v0, then the Adam runs on Qwen3 32B and 8B against the exit criteria above, and the campaign review.

## Cross-packet notes (wave 1 and wave 2 review)

- **Spec gaps settled in records:** [0023](../../decisions/0023-skill-foreign-keys.md) composite skill FKs, [0024](../../decisions/0024-gamerules-26-1.md) snake_case gamerules, [0025](../../decisions/0025-snapshot-revision.md) revision fields, [0026](../../decisions/0026-one-database-per-shard.md) one database per shard, [0027](../../decisions/0027-final-receipt-constraints.md) final-receipt constraints, [0028](../../decisions/0028-model-names.md) Ollama tags as model names.
- **Wave 2 records:** [0029](../../decisions/0029-rcon-reply-framing.md) RCON reply framing, [0030](../../decisions/0030-world-time-ticks.md) world time in ticks, [0031](../../decisions/0031-place-at-feet.md) place at feet, [0032](../../decisions/0032-table-crafting-and-recipe-book.md) table crafting and the recipe book, [0037](../../decisions/0037-chest-transfers-by-explicit-clicks.md) chest transfers by explicit clicks, [0038](../../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md) tick rate does not slow a client-driven Body, [0039](../../decisions/0039-pathing-forbids-corner-cutting.md) pathing forbids corner-cutting.
- **Scriptorium Wave 3 records (mock Geldar MCP world, merged to main):** [0033](../../decisions/0033-mock-wake-and-interest-vocabulary.md), [0034](../../decisions/0034-mock-result-shapes-and-untrusted-text.md), [0035](../../decisions/0035-mcp-tool-schema-shapes.md), [0036](../../decisions/0036-launcher-workspace-named-volume.md).
