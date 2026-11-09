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
