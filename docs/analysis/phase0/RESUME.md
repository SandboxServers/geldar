# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), [overnight-decisions.md](overnight-decisions.md) and the retros in [retro/](retro/) before acting. Rewrite at every wave boundary; 40 lines at most.

**State (wave 5 closing, 2026-11-09):** waves 1 to 4 are merged. Wave 5 (the Mind: `animus/`, `lantern-local/`, Adam's live lifecycle) is on `phase0/wave5`. The 8B live cases are green on the merged head, a clean 8-minute run of the 32B model passed, and the benchmark gate (20 TPS at 100%) PASSED on 898b9b9.

**Next:** (1) the wave 5 PR, merged when CI is green. (2) Wave M: sovereign players (`player add --seed-file`). Its persona limits are decision 0060 (identity 8192 bytes, goals 4096), and the fit against `num_ctx` 8192 is OPEN for that packet. (3) Wave 6: Thought Stream, Adam runs, campaign review and the full campaign retro.

**Owner rulings in force:** reviews and live tests once per wave at its end (up to 5 rounds with fix rounds); `W<N>-process` after the retro; plan packets to fan out early; merge a green PR that meets its exit criteria and keep going; a full campaign retro at the end; the benchmark gate is 20 TPS at 100% (10 and 5 TPS rows informational). No time dilation (0047); recipes are discovered (0048); identity mode is about human observation, never agent belief (0059); persona files are not artificially limited (0060).

**Owner items still open:** the fit of maximal personas against `num_ctx` (0060, Wave M); the wording of decisions 0044 to 0046 (relayed from the Scriptorium orchestrator); the spec edits in `worknotes/spec-edits-2026-11-09.md`, including the observer-disclosure variable apart from `identity_mode` (0059).

**Side track:** the Scriptorium corpus (SC-61a to d) is done; the mock image digest was sent to the Scriptorium orchestrator. Next free decision number: 0061.

**Worktrees:** packet worktrees remain under `.claude/worktrees/`, one per packet (copy useful `.claude/reports/` to `worknotes/` first; never `git worktree prune`; do not touch `scriptorium-decisions`). Create worktrees from the repo root, not a subdirectory.

**Process rules that mattered:** coders edit only inside their worktree and commit per item; reviewers return findings inline and the orchestrator records them in `worknotes/wave<N>-review-<r>.md`; only the orchestrator runs live tests (in the background, about 11 minutes); live cases print state in failure messages; always `</dev/null` on scripted git.

**Machine:** about 20 GB free after closing Firefox and ChatGPT; at most about six agents at once.
