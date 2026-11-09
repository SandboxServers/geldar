# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), [overnight-decisions.md](overnight-decisions.md) and [retro/wave-2.md](retro/wave-2.md) before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-09):** wave 1 is merged (PR #4). Wave 2 (the Golem, nine body actions, the body benchmark harness and six scenarios) is complete on `phase0/wave2` and its PR is open to `main` but NOT merged. Scriptorium Wave 3 (the mock Geldar MCP world, PRs #5 to #15) is merged to `main` and recorded in decisions 0033 to 0036. `./geldar.ps1 check` passes (about 1035 tests); the full live lane (58 tests) passed twice on the final code.

**Why the wave 2 PR is not merged:** the exit criterion "benchmark recorded" is open. The first recorded run (`./geldar.ps1 bench --scenario all --tps 20 --runs 10 --max-minutes 240 --record --note "wave 2 first recorded run, 20 TPS, shared desktop RTX 4090 host"`) was killed by Claude Code for critically low system memory after wood-to-stone-tools, food, shelter, bed (10/10 passes each) and 9 chest runs; nothing is written until the run ends. Partial log: `worknotes/bench-first-run-partial-20tps.log`. Do not restart it until the owner says memory is free; then run it with a clean tree, close heavy apps first, and run the 10 and 5 TPS rows separately (`--tps 10,5 --runs 5`). Afterwards the benchmark commit, the PR update and the merge (owner ruling: merge when green and the exit criteria are met).

**Before any further work:** the killed run may have left the shard in a state: run `./geldar.ps1 bench --restore` (puts the tick rate and gamerules back; it needs the RCON secret: `GELDAR_RCON_PASSWORD_FILE=<worktree>/compose/secrets/rcon.txt`; the live stack was started from the `p0-07b` worktree, whose `compose/secrets` hold the live secret) and check `list` for a left-over `GolemBench` session.

**Owner items (also in the overnight log):**
1. Decision 0032: the shard grants the whole recipe book to the Body (P0-11 plugin grants on join). Is recipe discovery part of Adam's game?
2. Decision 0038 (spec 5.14): `/tick rate` does not slow a Mineflayer client; the 10 and 5 TPS benchmark rows measure an unslowed client against a slowed server. How does Adam get thinking time (waits and intents), if not time dilation?
3. The gate: every scenario 100% at 20 TPS before wave 4 (set by the owner); 10 and 5 TPS are findings only.
4. `ghcr.io/sandboxservers/geldar-mcp-mock` is private until someone with org rights makes it public.
5. Decisions 0029 to 0039 were written by the orchestrator; the overnight decisions 1 to 17 are listed with reasons.

**Next actions (after the PR merges):** write the wave 3 packets (P0-11 Geldar-Core plugin skeleton and NATS event export, with the recipe-book grant on join; P0-12 eventsink; P0-13 Velocity identity plugin keeping the whitelist working), with batch review for parallel packets (dispatch rule 11), then waves 4 to 6 per README.md; report to the owner at each wave boundary.

**Worktrees:** about 30 packet worktrees remain under `.claude/worktrees/`; remove them (copy useful `.claude/reports/` files to `worknotes/` first; never `git worktree prune`; do not touch `scriptorium-decisions`). Keep `p0-07b` (live secrets) until the shard is rebuilt.

**Process rules that mattered (details in the retro and skills):** coders commit after each finding and keep a report file; only the orchestrator (or one named coder) uses the live lane; probes are read-only; never weaken an assertion or change a fixture to hide a Body finding; regenerate `pnpm-lock.yaml`, never hand-merge; always `</dev/null` on scripted git; no PowerShell backtick escapes in file content.
