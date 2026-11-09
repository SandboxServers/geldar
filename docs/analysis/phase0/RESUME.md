# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-08):** scaffold PR #2 merged. `main` is protected (PR, required check `ci gate`). Owner decisions settled (Minecraft 26.1, Velocity from Phase 0). Branch `phase0/wave1` on origin; `.claude/state/active-campaign` = phase0. Ollama has `qwen3:32b` and `qwen3:8b` (pulled by the orchestrator at the owner's request).

**Current wave:** 1, the contract and a healthy stack (one PR `phase0/wave1` to `main`, not merged by the orchestrator).

**Merged into `phase0/wave1`:** P0-00 to P0-05 (all but P0-06).

**In flight (background agents):**

| Packet | Worktree | Stage |
|---|---|---|
| P0-06 | `.claude/worktrees/p0-06` | coder continuation 2 of 3 (first coder hit context; files uncommitted) |

`.claude/worktrees/wave1` is the orchestrator's checkout of `phase0/wave1` (ledger commits, merges). Do not touch `scriptorium-decisions`.

**Next actions:**

1. Review loop per packet: fresh `packet-reviewer`, `fix` goes to a fresh `packet-coder`, up to 3 passes. `decision` or `fix` after pass 3: ask the owner. Reviewers may lack a write tool; then pass their inline findings in the fix brief.
2. On `ship`, `git merge --no-ff` into `phase0/wave1`. P0-02/P0-03/P0-04 conflicts in `contract/src/index.ts` and `contract/src/generated/*`: keep every block, regenerate (`./geldar.ps1 pnpm --filter @geldar/contract generate`), commit (work-packets.md § Contract). P0-03 is merged already, so P0-02 and P0-04 will conflict.
3. All seven shipped: wave review over `origin/main..phase0/wave1`, then `./geldar.ps1 check`, open the PR, wait for `ci gate`, tell the owner. Don't merge.
4. Before removing packet worktrees (only after the PR is open), copy useful `.claude/reports/` files into `worknotes/`.

**Notes for the wave review:** P0-01 commit 8f17621 has a Haiku 5.5 co-author trailer (accepted). P0-03 left `credits`/`count`/`world_day` without upper bounds (SQL columns are INT) and `thinker_id` as a free string. P0-04 adds invented limits (job `max_tokens` cap, semver pattern) listed in its fix report.

**Open owner decisions:** `docs/spec.md` Appendix D needs the composite skill FK correction `(skill_id, edition)` on `books` and `skill_library` (owner chose it at P0-05 review; owner to record).

**P0-04 follow-ups for the wave review (non-blocking):** add `ModelName` length-bound tests and a `welcome.accepted_models` uniqueItems test; `MAX_FRAME_BYTES` value untested. P0-02 review-2 low findings: no tests for `attack.target` bad characters, the `skill_id` 64-char boundary, offset -257, `propose.rule` at 257 chars; `use_skill.args`, `Intent.arguments` and `Intent.checkpoint` are unbounded in size (backstop is `MAX_FRAME_BYTES`). `generator.ts` now exports a validator per `$defs` frame with `properties.type.const` (worknotes/p0-04.md).
