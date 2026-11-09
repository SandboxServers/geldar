# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-09):** wave 1 merged (PR #4). Wave 2 packets written (P0-07a..c, P0-08a/b, P0-09a/b, P0-10a..c). Integration branch `phase0/wave2`.

**Next actions:**

1. Wait for `ci gate` on the wave 1 PR (`gh pr checks <PR> --watch`). Likely first-run risks: the `compose` job needs `corepack` on the runner for `geldar.ps1`; the `sql` job relies on `psql`/`pg_isready` on the runner.
2. Owner reviews and merges the PR (decisions 0023 to 0028 are in it).
3. Then: remove packet worktrees `p0-00` to `p0-06`, `wave1`, `wave1-fix` (not `scriptorium-decisions`); copy useful `.claude/reports/` files to `worknotes/` first.
4. Write wave 2 packets (P0-07 to P0-10: Golem skeleton, body actions A and B, body benchmark) from main after the merge; the ledger rows say "written at wave 1 close". Open the bench host questions with the owner before P0-10.

**Known low findings carried forward (not blocking):** P0-01 commit 8f17621 has a Haiku 5.5 trailer. P0-03: `credits`/`count`/`world_day` have no upper bound (SQL INT), `thinker_id` is a free string. P0-04: invented limits (job `max_tokens` 32768, semver pattern), missing tests for `ModelName` length, `welcome.accepted_models` uniqueItems, `MAX_FRAME_BYTES`. P0-02: no tests for `attack.target` bad characters, `skill_id` 64-char boundary, offset -257, `propose.rule` 257 chars; `use_skill.args`, `Intent.arguments`, `Intent.checkpoint`, `propose.value` unbounded (backstop `MAX_FRAME_BYTES`). P0-06: paper-entrypoint `sed` rewrites every `secret:` line (one exists today). Port check rejects `extends`/`include`/interpolation (fail closed).

**Settled in records:** 0023 to 0028 (skill FKs, gamerules, revision fields, one DB per shard, final-receipt constraints, Ollama tags). `docs/spec.md` is not edited.

**Open owner items:** infra repo questions (spec section 13 items 2, 2a to 2d) are Phase 2; `docs/ideas.md` note for them not written (owner hasn't said yes).
