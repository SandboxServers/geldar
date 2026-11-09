# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), [overnight-decisions.md](overnight-decisions.md), [retro/wave-3.md](retro/wave-3.md) and [retro/wave-2.md](retro/wave-2.md) before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-09):** waves 1 and 2 are merged (PR #4, #16; the 20 TPS gate passed). Wave 3 (the world to the record: Geldar-Core plugin with NATS event export and recipe grant, `eventsink/`, the Velocity identity gate, Golem registration) is complete on `phase0/wave3` and its PR is open to `main`. The wave test and review ran once at the end (owner ruling): three review rounds, four fix rounds, four live-lane passes (60 of 60), the retro and `W3-process` are done. Decisions 0040 and 0041 record the gate and the event path.

**Owner rulings now in force:** reviews and live tests once per wave, at its end (up to 5 review rounds with fix rounds between); the `W<N>-process` packet runs after the wave test, review and retro; plan packets to fan out early (small unblocking packets first); merge a green PR that meets its exit criteria and keep going; a full campaign retro at the end.

**Next:** merge the wave 3 PR when `ci gate` is green. Then plan wave 4 (the Body lives: reflexes, intent executor with preconditions, wake conditions and limits, action records and receipts, Body restart from a checkpoint) with the fan-out rule: name the small unblocking packets and the fan-out point first. Then waves 5 (the Mind) and 6 (Thought Stream, Adam runs, campaign review and full retro).

**Owner items:** decisions 0032 (recipe grant: is recipe discovery part of Adam's game?), 0038 (tick rate does not slow a client-driven Body: how does Adam get thinking time?), 0039; overnight decisions 1 to 25; wave 3 open items in the retro (command cancel, `death` events, NATS outage, consumer-only deletion, case-differing duplicate login: not proven live).

**Worktrees:** about 35 packet worktrees remain under `.claude/worktrees/` (copy useful `.claude/reports/` to `worknotes/` first; never `git worktree prune`; do not touch `scriptorium-decisions`). Keep `p0-07b` (live secrets) until the shard is rebuilt: the live stack now runs from `wave3` (secrets copied into `wave3/compose/secrets`). Create new worktrees from the repo root, not from a subdirectory.

**Machine:** memory is tight (commit charge about 82 GB on 64 GB). Run at most two or three agents at once; check for orphans after agent runs.

**Process rules that mattered:** coders edit only paths inside their own worktree and commit after each item; reviewers return findings inline and the orchestrator records them in `worknotes/wave<N>-review-<r>.md`; only the orchestrator uses the live lane; never weaken an assertion; regenerate `pnpm-lock.yaml`; always `</dev/null` on scripted git; no PowerShell backtick escapes in file content.
