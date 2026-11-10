# Decisions

One short record per decision as it is settled: an open decision from spec section 13, a gap the spec leaves, or a place where we chose differently from the spec. The spec stays the design. A record says what we decided, why, and what it changes. A decision that is still open lives in the Decisions table of the campaign ledger that needs it (for Phase 0, [docs/analysis/phase0/README.md](../analysis/phase0/README.md)), not here.

Name records `NNNN-short-slug.md`, numbered in order. Sessions working in parallel may each pick numbers well apart to avoid collisions; gaps in the sequence are fine. A record is never rewritten to say something else: a later record supersedes it, and the old one's status says `Superseded by NNNN`.

```markdown
# NNNN. Title

- Status: Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Spec: section or open-decision number this settles

## Decision
## Why
## Consequences
```

| # | Decision | Status |
|---|---|---|
| [0001](0001-contract-json-schema.md) | The contract is JSON Schema with code generation | Accepted |
| [0002](0002-phase0-host-and-models.md) | Phase 0 runs on the owner's Windows PC with Ollama, Qwen3 32B and 8B | Accepted |
| [0003](0003-task-runner.md) | `geldar.ps1` is the task runner, not `make` | Accepted |
| [0004](0004-phase0-repo-layout.md) | Phase 0 code lives in this one repo | Accepted |
| [0005](0005-pinning-and-security-updates.md) | Exact pins, two-week minimum age, Dependabot security updates only | Accepted |
| [0006](0006-typescript-toolchain.md) | pnpm, TypeScript 7, Biome and Vitest | Accepted |
| [0020](0020-receipts.md) | Every action gets a receipt; economic actions get two | Accepted |
| [0021](0021-velocity-from-phase0.md) | Velocity bot ingress from Phase 0, matching production | Accepted |
| [0022](0022-minecraft-26-1.md) | Minecraft 26.1 and the pinned body stack | Accepted |
| [0023](0023-skill-foreign-keys.md) | Books and the skill library point at one edition of a skill | Accepted |
| [0024](0024-gamerules-26-1.md) | Gamerule names on Minecraft 26.1 are snake_case | Accepted |
| [0025](0025-snapshot-revision.md) | Snapshots and action records carry a revision | Accepted |
| [0026](0026-one-database-per-shard.md) | Phase 0 is one database per shard | Accepted |
| [0027](0027-final-receipt-constraints.md) | The database enforces one final receipt per action | Accepted |
| [0028](0028-model-names.md) | Phase 0 names models by their Ollama tag | Accepted |
| [0029](0029-rcon-reply-framing.md) | RCON replies end on a quiet period, not an empty packet | Accepted |
| [0030](0030-world-time-ticks.md) | `world_time.ticks` is the world age; an unnamed biome is omitted | Accepted |
| [0031](0031-place-at-feet.md) | `place ... at: "feet"` is the cell the bot's feet are in | Accepted |
| [0032](0032-table-crafting-and-recipe-book.md) | Crafting on 26.1 goes through the recipe book, and the shard unlocks recipes | Accepted |
| [0033](0033-mock-wake-and-interest-vocabulary.md) | The mock's wake and interest vocabulary is provisional; the character is woken only by wake_on and long-poll events | Accepted |
| [0034](0034-mock-result-shapes-and-untrusted-text.md) | Mock result shapes: untrusted-text wrapper, and the waking event is never trimmed | Accepted |
| [0035](0035-mcp-tool-schema-shapes.md) | MCP tool schemas: write_book oneOf, and results without a root type are not published as outputSchema | Accepted |
| [0036](0036-launcher-workspace-named-volume.md) | The launcher keeps the player workspace in a named Docker volume on every OS | Accepted |
| [0037](0037-chest-transfers-by-explicit-clicks.md) | Chest deposits and withdrawals are an explicit, server-confirmed click sequence | Accepted |
| [0038](0038-tick-rate-does-not-slow-a-client-driven-body.md) | `/tick rate` does not slow a Mineflayer-driven Body; the world clock has a 20-tick resolution | Accepted |
| [0039](0039-pathing-forbids-corner-cutting.md) | The Body's pathing forbids diagonal moves that cut a block corner | Accepted |
| [0040](0040-bot-ingress-registry-in-nats-kv.md) | The bot-ingress gate reads a NATS KV registry, fails closed, and Golem registers before it connects | Accepted |
| [0041](0041-event-export-stream-and-sink.md) | Events go to one JetStream stream with dedup headers, and the sink dead-letters what it cannot store | Accepted |
| [0042](0042-path-rule-case-folded-identity-prefix.md) | The session path rule never allows `memory/identity.md/` as a prefix, case-folded | Accepted |
| [0043](0043-phase0-body-state-in-nats-kv-and-record-rules.md) | Phase 0 keeps Body checkpoints and generations in NATS KV; record rules for intents, audit records and receipts | Accepted |
| [0044](0044-malicious-book-corpus-world-side.md) | The malicious-book corpus: world side in the mock, hostile text stays untrusted, the model half is local | Accepted |
| [0045](0045-live-malicious-book-check-is-local-only.md) | The live malicious-book check is local only; CI proves the deterministic half (D-SC-01) | Accepted |
| [0046](0046-scripted-stub-cli-stands-in-for-the-vendor-cli-in-ci.md) | A scripted stub CLI stands in for the vendor CLI in CI (D-SC-10) | Accepted |
| [0047](0047-thinking-time-comes-from-intents-and-waits-not-dilation.md) | Adam's thinking time comes from intents, waits and reflexes; time dilation is not a Phase 0 mechanism | Accepted (owner) |
| [0048](0048-recipe-discovery-is-part-of-the-game.md) | Recipe discovery is part of the game; the plugin stops granting the recipe book | Accepted (owner) |
| [0049](0049-thinker-job-gets-response-format-and-reasoning.md) | The Thinker job frame gains `response_format` and `reasoning` (Appendix H) | Accepted (owner) |
| [0050](0050-phase0-mind-processes-run-on-the-host.md) | In Phase 0 the Mind, the local Thinker and Adam's Body run as host processes | Accepted (owner) |
| [0051](0051-adam-identity-and-model-pins.md) | Adam's identity and the Phase 0 model pins | Accepted (owner; seed approved 2026-11-09) |
| [0052](0052-per-owner-sovereign-player-cap-raised-to-20.md) | The per-owner cap on sovereign players is raised to 20 for the owner; the real Geldar MCP is built alongside wave 6 | Accepted (owner) |
| [0053](0053-public-mcp-through-an-outbound-tunnel-deferred.md) | The sovereign MCP is loopback-only now; a public name through an outbound tunnel waits for the colo move | Accepted (owner ruling; Q1 and Q2 open) |
| [0054](0054-static-hashed-per-player-bearer-tokens.md) | Sovereign MCP clients use static, hashed, per-player Bearer tokens, not OAuth 2.1 | Accepted |
| [0055](0055-phase0-sovereign-tool-subset-and-mappings.md) | The Phase 0 sovereign MCP serves the frozen 14-tool vocabulary; six tools are not available and the action list is atomic | Accepted |
| [0056](0056-first-migration-runner-and-least-privilege-grants.md) | The first migration runner, the migration ledger rule, and the least-privilege grants for the MCP role | Accepted |
| [0057](0057-sovereign-budget-numbers-and-wake-spacing.md) | Sovereign budget numbers, rate limits, wake spacing and presence timings for Phase 0 | Accepted |
| [0058](0058-the-character-knowledge-boundary-and-thought-v2.md) | Characters honour the in-world knowledge of the character, not the model's training data; thought prompt v2 carries the knowledge, sleep and anti-loop rules | Accepted (owner) |
| [0059](0059-identity-mode-is-about-human-observation-not-agent-belief.md) | `identity_mode` governs whether humans may observe a shard; the agents are never told they are watched | Accepted (owner) |
| [0060](0060-persona-size-limits.md) | Persona files are not artificially size-limited (identity 8192 bytes, goals 4096); the prompt fit is open for Wave M | Accepted (owner) |
| [0061](0061-phase-0-exit-criteria-readings.md) | Readings of the Phase 0 exit criteria (survival, useful minute, latency, 24 hours, model floor) and the read-only Glass role | Accepted provisionally (orchestrator, owner may revise) |
| [0062](0062-no-settled-credits-in-phase-0.md) | No settled-credits value reaches the reflection in Phase 0; the completed reflection keeps its reserved cost, and E-8 is deferred | Accepted provisionally (orchestrator, owner may revise) |
| [0063](0063-phase-0-has-no-stuck-signal.md) | Phase 0 has no `stuck` signal (AD-11); the exit runs measure whether intents complete, and the watchdog is a Phase 1 item | Accepted provisionally (orchestrator, owner may revise) |
| [0064](0064-exit-run-lives.md) | The exit runs use fresh lives (`ag_adam_03` 32B, `ag_adam_04` 8B) and fresh volumes; the smoke run has its own life (`ag_smoke_01`); journals are append-only | Accepted provisionally (orchestrator, owner may revise) |
| [0065](0065-damage-wakes-the-mind.md) | Damage wakes the Mind when no intent is running; death still ends the life | Accepted provisionally (orchestrator, owner may revise) |
| [0066](0066-phase0-closed-as-proof-of-life.md) | Phase 0 is closed as proof of life; the spec's section 10 exit criteria are waived by the owner and the exit runs are deferred | Accepted (owner) |
| [0068](0068-prompt-v4-and-agent-visible-text.md) | Nothing an agent reads may say humans watch it or reveal the shard, harness or credits; prompt v4 is the default and released templates are immutable; persona lint with `--allow-meta` | Proposed (fix-c; owner amends the spec line ~1584) |
| [0067](0067-nats-accounts-and-least-privilege.md) | NATS accounts and least-privilege users, opt-in until the stack is cut over | Accepted provisionally (orchestrator, owner may revise) |
| [0069](0069-no-plan-wake-is-not-a-failure.md) | A no_plan wake with no intent is a neutral wake, not a failed intent; the player event type list gains `wake` | Accepted (fix-perception) |
| [0070](0070-phase1-is-the-colo-first-shard.md) | Phase 1 is the colo-first shard: final environment, invite-only, not announced | Accepted (owner) |
| [0071](0071-public-endpoints-and-ports.md) | The public Minecraft endpoint is a new TCP port with an SRV record; HTTPS ingress is the shared Caddy, reloaded and never restarted | Accepted (owner) |
| [0072](0072-glass-and-bluemap-are-public.md) | Glass and BlueMap are public, read-only, and hardened before exposure | Accepted (owner) |
| [0073](0073-spec-is-never-edited.md) | docs/spec.md is never edited by agents; decision records amend it, with the open amendments listed | Accepted (owner) |
| [0075](0075-glass-is-a-lakitu-camera.md) | The Glass gets Lakitu cameras: free-fly, collision-bound, invisible in the world, targeted by login | Proposed (anonymous versus login cameras pending owner) |
>