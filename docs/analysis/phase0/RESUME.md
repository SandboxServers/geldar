# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), [overnight-decisions.md](overnight-decisions.md) and [retro/wave-2.md](retro/wave-2.md) before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-09):** wave 1 is merged (PR #4). Wave 2 (the Golem, nine body actions, the body benchmark harness and six scenarios) is complete on `phase0/wave2` and its PR is open to `main` awaiting CI and merge. Scriptorium Wave 3 (the mock Geldar MCP world, PRs #5 to #15) is merged to `main` and recorded in decisions 0033 to 0036. `./geldar.ps1 check` passes (about 1035 tests); the full live lane (58 tests) passed twice on the final code.

**Benchmark:** recorded. 20 TPS, 10 runs each, all six scenarios 10/10, GATE: PASS (8934be9). 10 and 5 TPS, 5 runs each, all pass (findings only; client is not slowed, decision 0038). Raw JSON in `bench-runs/`. The earlier "killed" reading was wrong: only the shell wrapper was reaped.


**Owner items (also in the overnight log):**
1. Decision 0032: the shard grants the whole recipe book to the Body (P0-11 plugin grants on join). Is recipe discovery part of Adam's game?
2. Decision 0038 (spec 5.14): `/tick rate` does not slow a Mineflayer client; the 10 and 5 TPS benchmark rows measure an unslowed client against a slowed server. How does Adam get thinking time (waits and intents), if not time dilation?
3. The gate: every scenario 100% at 20 TPS before wave 4 (set by the owner); 10 and 5 TPS are findings only.
4. `ghcr.io/sandboxservers/geldar-mcp-mock` is PUBLIC (verified anonymously 2026-11-09: manifest `:main` and digest `sha256:fa442113...1e9d` return HTTP 200; the org package settings page says "This package is currently public").
5. Decisions 0029 to 0039 were written by the orchestrator; the overnight decisions 1 to 17 are listed with reasons.

**Next actions (after the PR merges):** write the wave 3 packets (P0-11 Geldar-Core plugin skeleton and NATS event export, with the recipe-book grant on join; P0-12 eventsink; P0-13 Velocity identity plugin keeping the whitelist working), with batch review for parallel packets (dispatch rule 11), then waves 4 to 6 per README.md; report to the owner at each wave boundary.

**Worktrees:** about 30 packet worktrees remain under `.claude/worktrees/`; remove them (copy useful `.claude/reports/` files to `worknotes/` first; never `git worktree prune`; do not touch `scriptorium-decisions`). Keep `p0-07b` (live secrets) until the shard is rebuilt.

**Process rules that mattered (details in the retro and skills):** coders commit after each finding and keep a report file; only the orchestrator (or one named coder) uses the live lane; probes are read-only; never weaken an assertion or change a fixture to hide a Body finding; regenerate `pnpm-lock.yaml`, never hand-merge; always `</dev/null` on scripted git; no PowerShell backtick escapes in file content.
