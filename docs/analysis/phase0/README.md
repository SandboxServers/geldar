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
| D-P0-12 | Embedding model for `memories.embedding vector(768)`: `nomic-embed-text` through Ollama (768 dimensions) | Accepted (owner, 2026-11-09) | wave 5 | — |
| D-P0-14 | Recipe-book grant replaced by recipe discovery (owner, 2026-11-09): the plugin no longer grants recipes; P0-19 makes unlocking work | Accepted (owner), supersedes 0032 item 2 | P0-11, P0-19 | [0048](../../decisions/0048-recipe-discovery-is-part-of-the-game.md) |
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
| W2-process | 2 | Apply the wave 2 retro actions to agents, skills, `CLAUDE.md` and `AGENTS.md` | packet-coder | Shipped (review 2, merged to wave2) | wave 2 code | |
| W3-process | 3 | Apply the wave 3 retro actions to agents, skills and repo checks | packet-coder | Shipped (merged to wave3; no separate review: owner ruling, reviews at wave end) | wave 3 code | |
| P0-14 | 4 | Body runtime skeleton (reflex runner, program and record interfaces): the unblocker | packet-coder | Shipped (wave review 3 rounds, merged to wave4) | wave 3 | |
| P0-15a | 4 | Reflexes: eat, fall-stop, hazard escape | packet-coder | Shipped (wave review 3 rounds, merged to wave4) | P0-14 | |
| P0-15b | 4 | Reflexes: retreat, fight or flee, `attack` action | packet-coder | Shipped (wave review 3 rounds, merged to wave4) | P0-14 | |
| P0-15c | 4 | Reflexes: panic burrow, blocked-path | packet-coder | Shipped (wave review 3 rounds, merged to wave4) | P0-14 | |
| P0-16a | 4 | Intent executor: validity, preconditions, limits, wake conditions | packet-coder | Shipped (wave review 3 rounds, merged to wave4) | P0-14 | |
| P0-16b | 4 | Built-in programs (travel, gather, craft, rest, flee) with checkpoints | packet-coder | Shipped (wave review 3 rounds, merged to wave4) | P0-14 | |
| P0-17 | 4 | Intent, action and receipt records to NATS and Postgres | packet-coder | Shipped (wave review 3 rounds, merged to wave4) | P0-14 | |
| P0-18 | 4 | Body restart resumes from its checkpoint | packet-coder | Shipped (wave review 3 rounds, merged to wave4) | P0-16a, P0-16b, P0-17 | |
| W4-process | 4 | Apply the wave 4 retro actions | packet-coder | Writing (after the benchmark re-record) | wave 4 test, review and retro | |
| P0-19 | 5 | Recipe discovery: find why vanilla recipe unlocking did not fire, make unlocking work (or a plugin unlock), remove the grant, scenarios without `recipe give` (decision 0048) | packet-coder | Shipped (merged to wave5) | wave 4 | |
| P0-20 | 5 | Mind contract and Body sense interfaces (unblocker 1) | packet-coder | Shipped (merged to wave5) | wave 4 | |
| P0-21 | 5 | `animus/` skeleton: ports, config, ids, fakes (unblocker 2) | packet-coder | Shipped (merged to wave5) | P0-20 | |
| P0-22 | 5 | `lantern-local/`: local Thinker (Appendix H to Ollama) | packet-coder | Shipped (merged to wave5) | P0-20 | |
| P0-23 | 5 | Body perception: authorized surroundings and unlocked recipes | packet-coder | Shipped (merged to wave5) | P0-20 | |
| P0-24 | 5 | Body ears, voice, `wait`, recent events | packet-coder | Shipped (merged to wave5) | P0-20 | |
| P0-25 | 5 | Thinker hub and model client (animus side of Appendix H) | packet-coder | Shipped (merged to wave5) | P0-21 | |
| P0-26 | 5 | Body-Mind channel over NATS (both ends) | packet-coder | Shipped (merged to wave5) | P0-21 | |
| P0-27 | 5 | Attention controller | packet-coder | Shipped (merged to wave5) | P0-21 | |
| P0-28 | 5 | Memory store and embedder (Postgres, pgvector) | packet-coder | Shipped (merged to wave5) | P0-21 | |
| P0-29 | 5 | Prompts v1, renderer, output validators | packet-coder | Shipped (merged to wave5) | P0-21 | |
| P0-30 | 5 | Thinking loop (5.3.4) | packet-coder | Shipped (merged to wave5) | P0-21 | |
| P0-31 | 5 | Sleep reflection (5.4) | packet-coder | Shipped (merged to wave5) | P0-21 | |
| P0-32a | 5 | Integration A: merge fan-out B, apply interface requests, Mind composition, body-api cross-check | packet-coder | Ready | P0-19, P0-22 to P0-31 | |
| P0-32b | 5 | Integration B: Mind main, Adam Body process and supervision, in-process e2e | packet-coder | BlockedDependency | P0-32a | |
| P0-33 | 5 | `./geldar.ps1 adam` and the Mind live cases | packet-coder | BlockedDependency | P0-32 | |
| W5-process | 5 | Apply the wave 5 retro actions | packet-coder | Shipped | wave 5 test, review and retro | |
| P0-11 | 3 | Geldar-Core plugin: Gradle/Paper skeleton, event export to NATS | packet-coder | Shipped (batch review 1, wave review 3 rounds, merged to wave3) | P0-06 | |
| P0-12 | 3 | `eventsink/`: NATS to Postgres, idempotent on `source_event_id` | packet-coder | Shipped (batch review 1, wave review 3 rounds, merged to wave3) | P0-03, P0-05 | |
| P0-13a | 3 | Velocity bot-ingress identity plugin (KV registry, fail closed) | packet-coder | Shipped (wave review 3 rounds, merged to wave3) | P0-11 | |
| P0-13b | 3 | Golem registers its bot username before connecting | packet-coder | Shipped (wave review 3 rounds, merged to wave3) | P0-13a | |
| WM-01 | M | Contract, config and the `threshold/mcp` skeleton | packet-coder | Shipped (merged to wave-m-main) | wave 5 | |
| WM-02 | M | Postgres: migration 0002, the first migration runner, the stores | packet-coder | Shipped (merged to wave-m-main) | WM-01 | |
| WM-03 | M | HTTP front door: auth, scoping, limits, revocation, logs | packet-coder | Shipped (merged to wave-m-main) | WM-01 | |
| WM-04 | M | Player event log, wake policy and `wait` | packet-coder | Shipped (merged to wave-m-main) | WM-01 | |
| WM-05 | M | `act`, `say` and the sovereign budget | packet-coder | Shipped (merged to wave-m-main) | WM-01 | |
| WM-06 | M | `look`, `status`, `sleep`, `journal`, `read_book`, resources | packet-coder | Shipped (merged to wave-m-main) | WM-01 | |
| WM-07 | M | Body: read a carried written book | packet-coder | Shipped (merged to wave-m-main) | WM-01 | |
| WM-08 | M | Player host: one Body process per ranger | packet-coder | Shipped (merged to wave-m-main) | WM-01 | |
| WM-09 | M | The `mcp-tokens` CLI | packet-coder | Shipped (merged to wave-m-main) | WM-02 | |
| WM-10 | M | Container, compose overlay, threat model (tunnel config only) | packet-coder | Shipped (merged to wave-m-main) | WM-01 | |
| WM-11 | M | Integration: the NATS gateway, presence, main, end to end | packet-coder | Shipped (merged to wave-m-main) | WM-02 to WM-10 | |
| WM-12 | M | Run commands, docs and live cases (written, not run) | packet-coder | Shipped (merged to wave-m-main) | WM-11 | |
| WM-13 | M | Player skins (MineSkin V2 upload, stored skin on login) | packet-coder | Shipped (merged to wave-m-main) | WM-01, velocity-identity plugin | |
| WM-process | M | Apply the wave M retro actions | packet-coder | Shipped | wave M test, review and retro | |
| W6-01 | 6 | Mind review fixes: E-13, E-2, E-8, E-11, E-14 | packet-coder | Ready | — | |
| W6-02 | 6 | Validator bounds read from shard config (BC-11); redact a private address from a worknote (E-16) | packet-coder | Ready | — | |
| W6-03 | 6 | Record the no-stuck-signal decision (AD-11); the watchdog is Phase 1 | packet-coder | Shipped | section 4 item 7 (provisional) | decision 0063 |
| W6-04 | 6 | Velocity marker ordering (diagnose first) | packet-coder | Ready | — | |
| W6-05 | 6 | Thought template v3 line (BC-10) | packet-coder | Ready | section 4 item 8 (provisional) | |
| W6-06 | 6 | Warm every pinned model before advertising it (cold load) | packet-coder | Ready | — | |
| W6-07 | 6 | Split three files over 500 lines (`pg-store.ts`, mock `server.ts`, `front.test.ts`) | packet-coder | Ready | — | |
| W6-08 | 6 | Investigate `intent_link_gave_up` (read-only, needs the 32B logs from ops) | packet-coder | Ready | ops logs | |
| W6-09 | 6 | `glass/` Thought Stream server: loopback, read-only API and SSE; owns migration `sql/0005_glass_reader.sql` (read-only role) | packet-coder | Ready | — | |
| W6-10 | 6 | `glass/` page: escaped rendering, filters, per-agent view | packet-coder | BlockedDependency | W6-09 | |
| W6-11 | 6 | Glass security: adversarial fixtures, read-only route test, XSS review | packet-coder | BlockedDependency | W6-10, W6-13 | |
| W6-12 | 6 | Adam run report generator (JSON and Markdown, read-only DB) | packet-coder | Ready | — | |
| W6-13 | 6 | Run protocol script `adam-run` and `glass up` | packet-coder | BlockedDependency | W6-09, W6-12 | |
| W6-14 | 6 | Run protocol documents, 32B and 8B | packet-coder | Ready | section 4 items 1 to 6 (provisional) | |
| W6-20 | 6 | Campaign review: Body and Golem (read-only) | reviewer | BlockedDependency | all coder packets, OPS-2 | |
| W6-21 | 6 | Campaign review: Mind, memory and prompts (read-only) | reviewer | BlockedDependency | all coder packets, OPS-2 | |
| W6-22 | 6 | Campaign review: contract, sql, infra, Glass security, secrets (read-only) | reviewer | BlockedDependency | all coder packets | |
| W6-23 | 6 | Campaign retro (all waves and both runs) | packet-coder | BlockedDependency | W6-20 to W6-22, OPS-3 | |
| W6-24 | 6 | Apply the campaign retro actions | packet-coder | BlockedDependency | W6-23 | |

Wave PRs: wave 1 is #4; wave 2 is #16 (merged). Retros: [retro/wave-1.md](retro/wave-1.md); `retro/wave-2.md`, [retro/wave-3.md](retro/wave-3.md) and [retro/wave-4.md](retro/wave-4.md) are written.

**Wave 2 additions** (merged outside the packet rows above): the P0-10a follow-up (read-only run queries `blockIs` and `isSleeping`, an injected scenario list; eeb44fd); the record helper (`golem/test/live/record.ts`; 7f8c46e); the corner-cutting `moveNear` fix ([0039](../../decisions/0039-pathing-forbids-corner-cutting.md)); the hidden `bed-clear` control scenario; the arena `stone_bricks` floor (46962cc); the table-craft and chest rework ([0032](../../decisions/0032-table-crafting-and-recipe-book.md), [0037](../../decisions/0037-chest-transfers-by-explicit-clicks.md)).

Later waves, sliced when wave 2 closes (spec section 10 "Build" line):

- **Wave 3, world to record** (the Phase 0 wave; not "Scriptorium Wave 3", which is already merged to main: the mock Geldar MCP world, PRs #5 to #15): Geldar-Core plugin (Gradle, Paper API) with event export to NATS `geldar.<shard>.<type>`; `eventsink/` NATS → Postgres (idempotent on `source_event_id`); the Velocity bot-ingress identity plugin (Appendix F, P0-13), which reads registrations from a NATS JetStream key-value bucket that Golem writes before connecting, standing in for the production supervisor. Packet IDs for this wave: P0-11 to P0-13. Obligations carried in: P0-11 must make the Geldar-Core plugin grant all recipes on join ([0032](../../decisions/0032-table-crafting-and-recipe-book.md)); `compose/phase0.yml` sets `ENFORCE_WHITELIST` on and Golem whitelists its bots over RCON, so P0-13 must keep that working or replace it.
- **Wave 4, the Body lives:** reflexes (spec 5.2 table), the intent executor with preconditions, wake conditions, limits and checkpoints, action records and receipts, Body restart resuming from checkpoint.
- **Wave 5, the Mind** (the plan and cards are in [wave5-packets.md](wave5-packets.md)): `lantern-local/` (Appendix H over a local WebSocket to Ollama), `animus/` thinking loop (5.3.4), attention controller (5.3.2), memory and sleep reflection (5.4), first versioned prompts in `prompts/` (Appendix B).
- **Wave 6, watch and run Adam:** the plan is [wave6-packets.md](wave6-packets.md). `glass/` Thought Stream v0, the wave 5 and M review fixes, the run harness and protocols, the Adam runs on Qwen3 32B and 8B against the exit criteria above (gated by the benchmark), then the campaign review and retro.

## Cross-packet notes (wave 1 and wave 2 review)

- **Spec gaps settled in records:** [0023](../../decisions/0023-skill-foreign-keys.md) composite skill FKs, [0024](../../decisions/0024-gamerules-26-1.md) snake_case gamerules, [0025](../../decisions/0025-snapshot-revision.md) revision fields, [0026](../../decisions/0026-one-database-per-shard.md) one database per shard, [0027](../../decisions/0027-final-receipt-constraints.md) final-receipt constraints, [0028](../../decisions/0028-model-names.md) Ollama tags as model names.
- **Wave 2 records:** [0029](../../decisions/0029-rcon-reply-framing.md) RCON reply framing, [0030](../../decisions/0030-world-time-ticks.md) world time in ticks, [0031](../../decisions/0031-place-at-feet.md) place at feet, [0032](../../decisions/0032-table-crafting-and-recipe-book.md) table crafting and the recipe book, [0037](../../decisions/0037-chest-transfers-by-explicit-clicks.md) chest transfers by explicit clicks, [0038](../../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md) tick rate does not slow a client-driven Body, [0039](../../decisions/0039-pathing-forbids-corner-cutting.md) pathing forbids corner-cutting.
- **Scriptorium Wave 3 records (mock Geldar MCP world, merged to main):** [0033](../../decisions/0033-mock-wake-and-interest-vocabulary.md), [0034](../../decisions/0034-mock-result-shapes-and-untrusted-text.md), [0035](../../decisions/0035-mcp-tool-schema-shapes.md), [0036](../../decisions/0036-launcher-workspace-named-volume.md).
