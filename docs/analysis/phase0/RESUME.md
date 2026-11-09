# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), [overnight-decisions.md](overnight-decisions.md), [retro/wave-4.md](retro/wave-4.md) and [retro/wave-3.md](retro/wave-3.md) before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-09):** waves 1 to 3 are merged (PRs #4, #16, #17; Scriptorium corpus PRs #18 to #21). Wave 4 (the Body lives: seven reflexes, the executor, programs, records, restart) is complete on `phase0/wave4`; the wave test is done (live lane 73 of 73, sink integration tests pass), the review had three rounds, the retro is written. Open on the wave 4 branch: re-record the 20 TPS benchmark on the final commit (the earlier record predates the last craft fix), `W4-process`, then the wave PR.

**Owner rulings in force:** reviews and live tests once per wave at its end (up to 5 rounds with fix rounds); `W<N>-process` after the retro; plan packets to fan out early; merge a green PR that meets its exit criteria and keep going; a full campaign retro at the end; the benchmark gate is 20 TPS at 100% (10 and 5 TPS rows informational). Decisions answered 2026-11-09: recipes are discovered (0048, supersedes 0032 item 2), no time dilation (0047), embeddings `nomic-embed-text` via Ollama, spec amended (5.14, 5.6, release rule, path rule, no tick-rate law).

**Next:** (1) wave 4 close: benchmark re-record, `W4-process`, PR, merge. (2) P0-19 recipe discovery (first packet of wave 5): find why vanilla unlocking did not fire on the 26.1.2 shard, make unlocking work, remove the Geldar-Core grant, scenarios without `recipe give`. (3) Plan wave 5 (the Mind: `lantern-local`, `animus` loop, attention controller, memory and sleep reflection, first prompts) with the fan-out rule (small unblockers first). Thinking time comes from intents, waits and reflexes (0047): the loop keeps the Body busy while a thought is pending. (4) Wave 6: Thought Stream, Adam runs, campaign review and the full campaign retro.

**Owner items still open:** confirm the wording of decisions 0044 to 0046 (relayed from the Scriptorium orchestrator: release criterion, D-SC-01, D-SC-10); overnight decisions 1 to 38 (the owner answered 0032, 0038, D-P0-12); the spec edits are in `worknotes/spec-edits-2026-11-09.md` for review.

**Side track:** Scriptorium Wave 6 corpus (SC-61a to d) is done; the new mock image digest `sha256:1bf80fac...edfb5` was sent to the Scriptorium orchestrator; D-SC-10 is filed (0046); next free decision number 0049.

**Worktrees:** many packet worktrees remain under `.claude/worktrees/` (copy useful `.claude/reports/` to `worknotes/` first; never `git worktree prune`; do not touch `scriptorium-decisions`). The live stack runs from `wave4` (secrets copied into `wave4/compose/secrets`); `p0-07b` can go once the stack is brought up from a clean main checkout. Create worktrees from the repo root, not a subdirectory.

**Machine:** about 20 GB free after closing Firefox and ChatGPT; WSL page cache was dropped (`wsl -u root -e sh -c "sync; echo 3 > /proc/sys/vm/drop_caches"`); at most about six agents at once.

**Process rules that mattered:** coders edit only inside their worktree, use the Edit tool (no backtick escapes in PowerShell strings), commit per item, and keep a progress file; reviewers return findings inline and the orchestrator records them in `worknotes/wave<N>-review-<r>.md`; only the orchestrator runs live tests (in the background, about 11 minutes); live cases print state in failure messages; always `</dev/null` on scripted git.
