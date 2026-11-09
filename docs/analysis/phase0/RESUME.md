# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-09):** wave 1 merged (PR #4, `a6fbf99`); retro at [retro/wave-1.md](retro/wave-1.md). Wave 2 is in progress on integration branch `phase0/wave2` (pushed; packets in work-packets.md, ledger rows in README.md). The owner authorised the orchestrator to merge a green PR that meets the exit criteria and to keep going to the end of the campaign, and to write decision records. Each wave now closes with docs sweep, retro and a `W<N>-process` packet ([work-packets.md](work-packets.md) § Wave close).

**In flight (background agents, worktrees under `.claude/worktrees/`):**

| Packet | Worktree / branch | Stage |
|---|---|---|
| P0-07a golem base | `p0-07a` / `phase0/p0-07a-golem-base` | review 1 = fix; fix-1 coder running (decision 0029 written); then review pass 2 |
| W1-process | `w1-process` / `phase0/w1-process` | review 3 = ship; merged into `phase0/wave2` (clean up the worktree at wave close) |

`wave2` is the orchestrator's checkout of `phase0/wave2`. The live stack may be running from `p0-07a` (`./geldar.ps1 shard down phase0` when done). Do not touch `scriptorium-decisions`.

**Next actions:**

1. Review loops per work-packets.md (rule 11: parallel batches 08a/08b/09a/09b and 10a/10b/10c get ONE batch review, up to 5 rounds); `fix` after the last round or `decision`: ask the owner (AskUserQuestion). Merge shipped branches into `phase0/wave2` with `--no-ff` and push; update ledger rows.
2. Wave 2 order: 07a, then 07b, then 07c; then 08a, 08b, 09a, 09b in parallel; then 10a (needs 08a), 10b and 10c. Write the interface-conflict resolution per the registry-file blocks (`golem/src/actions/index.ts`, `golem/src/bench/scenarios/index.ts`).
3. P0-07b decides whether Mineflayer 4.39.0 speaks Minecraft 26.1 (protocol 775); if not, stop and ask the owner. P0-07b also flags the `world_time.ticks` meaning (world age vs time of day): write a decision record.
4. Wave 2 close: wave review over `origin/main..phase0/wave2`, docs sweep, `retro/wave-2.md`, `W2-process` packet, `./geldar.ps1 check`, open the PR, wait for `ci gate`, merge if green and the exit criteria are met, remove worktrees, then write wave 3 packets (P0-11 to P0-13).
5. Waves 3 to 6 per README.md; wave 6 has the 24 h run and 5-day survival; report to the owner at each wave boundary.

**Orchestrator rules that bit in wave 1:** commit early; always `</dev/null` on scripted git; no `python -` heredocs; absolute paths for `git worktree add`; reviewers now may write their one report file; copy reports into `worknotes/reports/` before removing a worktree.

**Open owner items:** infra repo questions (spec section 13 items 2, 2a to 2d) are Phase 2 and no packet exists; `docs/ideas.md` note not written (owner hasn't said yes). Wave 2 owner questions: none blocking (no minimum success rate in the spec; bench `--runs` default 5 is the planner's pick).
