# Decisions

One short record per decision as it is settled: an open decision from spec section 13, a gap the spec leaves, a place where we chose differently from the spec, an error in the spec, or a rule for how we work. The spec stays the design. A record says what we decided, why, and what it changes. A decision that is still open lives in the Decisions table of the campaign ledger that needs it (for Phase 0, [docs/analysis/phase0/README.md](../analysis/phase0/README.md)), not here.

The spec is frozen at v0.8 and never edited (0007). **Kind** says what a record does to it: `Changes` departs from the plan, `Fixes` corrects an error or contradiction in it, `Settles` fills a gap or closes an open decision, `Process` is about how we work. Filter the index for `Changes` and `Fixes` to see everything that differs from the original plan. Records written before the Kind field existed (0001–0006, 0020–0022) are classified in the index only; their files are not rewritten.

Name records `NNNN-short-slug.md`, numbered in order. Sessions working in parallel may each pick numbers well apart to avoid collisions; gaps in the sequence are fine. A record is never rewritten to say something else: a later record supersedes it, and the old one's status says `Superseded by NNNN`.

```markdown
# NNNN. Title

- Status: Accepted | Superseded by NNNN
- Kind: Changes | Fixes | Settles | Process
- Date: YYYY-MM-DD
- Spec: section or open-decision number this settles

## Decision
## Why
## Consequences
```

| # | Decision | Kind | Status |
|---|---|---|---|
| [0001](0001-contract-json-schema.md) | The contract is JSON Schema with code generation | Settles | Accepted |
| [0002](0002-phase0-host-and-models.md) | Phase 0 runs on the owner's Windows PC with Ollama, Qwen3 32B and 8B | Settles | Accepted |
| [0003](0003-task-runner.md) | `geldar.ps1` is the task runner, not `make` | Changes | Accepted |
| [0004](0004-phase0-repo-layout.md) | Phase 0 code lives in this one repo | Changes | Accepted |
| [0005](0005-pinning-and-security-updates.md) | Exact pins, two-week minimum age, Dependabot security updates only | Settles | Accepted |
| [0006](0006-typescript-toolchain.md) | pnpm, TypeScript 7, Biome and Vitest | Settles | Accepted |
| [0007](0007-spec-frozen-at-v0.8.md) | The spec is frozen at v0.8; changes are recorded here | Process | Accepted |
| [0008](0008-companion-servers-own-repo.md) | The player kit's companion servers live in their own repo and ship in the kit's container image | Changes | Accepted |
| [0009](0009-scriptorium-spec-errata.md) | Errata for the player kit (Scriptorium) sections | Fixes | Accepted |
| [0010](0010-player-kit-harnesses-v1.md) | The player kit supports Claude Code, then Codex CLI; no Google harness in v1 | Changes | Accepted |
| [0011](0011-player-repo-push-from-host.md) | Player memory is pushed from the human's machine; the container never sees the real repo | Changes | Accepted |
| [0012](0012-launcher-in-geldar-scriptorium.md) | The `geldar-play` launcher lives in `geldar-scriptorium` and is installed once per machine | Changes | Accepted |
| [0013](0013-public-player-repos.md) | Living player repos may be public; the agent is confined to its own repo, enforced and tested | Changes | Accepted |
| [0014](0014-template-source-in-geldar-scriptorium.md) | The template is player-facing only; it's developed in `geldar-scriptorium` and published from there | Changes | Accepted |
| [0015](0015-player-birth-and-setup-session.md) | Until the Allocator exists, a player is born through the launcher and a one-time setup session | Changes | Accepted |
| [0020](0020-receipts.md) | Every action gets a receipt; economic actions get two | Fixes | Accepted |
| [0021](0021-velocity-from-phase0.md) | Velocity bot ingress from Phase 0, matching production | Changes | Accepted |
| [0022](0022-minecraft-26-1.md) | Minecraft 26.1 and the pinned body stack | Settles | Accepted |
