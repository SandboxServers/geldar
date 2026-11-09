# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-08):** scaffold PR #2 merged. `main` is protected (PR, required check `ci gate`). Owner decisions settled (Minecraft 26.1, Velocity from Phase 0). Branch `phase0/wave1` on origin; `.claude/state/active-campaign` = phase0. Ollama has `qwen3:32b` and `qwen3:8b`.

**Current wave:** 1 (one PR `phase0/wave1` to `main`, not merged by the orchestrator).

**Merged into `phase0/wave1`:** P0-00 to P0-06, all with `ship`. No agents in flight.

**Next actions:**

1. Wave review pass 1 returned `fix` (docs and one small SQL constraint). A packet-coder in `.claude/worktrees/wave1-fix` (branch `phase0/wave1-fix`) applies it; then merge into `phase0/wave1`. Re-review only if the diff touches more than docs, SQL constraint and check-schema.
2. `./geldar.ps1 check` on `phase0/wave1`; open the PR to `main` (`.github/pull_request_template.md`); wait for `ci gate` (`gh pr checks <PR> --watch`). Don't merge; tell the owner.
3. After the PR is open: copy useful `.claude/reports/` files from packet worktrees into `worknotes/`, then remove the packet worktrees (`p0-00` to `p0-06`; not `scriptorium-decisions`).

**Notes for the wave review:** P0-01 commit 8f17621 has a Haiku 5.5 trailer (accepted). P0-03: `credits`/`count`/`world_day` have no upper bound (SQL columns INT), `thinker_id` is a free string. P0-04: invented limits (job `max_tokens` 32768, semver pattern); `generator.ts` now exports a per-frame validator for `$defs` with `properties.type.const` (worknotes/p0-04.md); missing tests for `ModelName` length, `welcome.accepted_models` uniqueItems, `MAX_FRAME_BYTES`. P0-02: no tests for `attack.target` bad characters, `skill_id` 64-char boundary, offset -257, `propose.rule` 257 chars; `use_skill.args`, `Intent.arguments`, `Intent.checkpoint` unbounded (backstop `MAX_FRAME_BYTES`). P0-06: see worknotes/p0-06.md; the paper-entrypoint `sed` rewrites every `secret:` line (only one exists today); the CI `compose` job relies on corepack on the runner.

**Decisions written for the spec gaps (owner asked the orchestrator to write them, 2026-11-08):** [0023](../../decisions/0023-skill-foreign-keys.md) to [0028](../../decisions/0028-model-names.md). `docs/spec.md` itself is not edited; the records are the corrections. Name them in the wave PR description.
