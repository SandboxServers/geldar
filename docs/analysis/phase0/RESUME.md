# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), [overnight-decisions.md](overnight-decisions.md) and [retro/wave-2.md](retro/wave-2.md) before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-09):** waves 1 and 2 are merged (PR #4, PR #16). Wave 2 closed with the benchmark recorded: 20 TPS, 10 runs each, all six scenarios 10/10, GATE: PASS; 10 and 5 TPS rows (5 runs) all pass but are findings only (decision 0038: the client is not slowed). Scriptorium Wave 3 (mock MCP world, PRs #5 to #15) is merged; its image `ghcr.io/sandboxservers/geldar-mcp-mock` is public. Wave 3 (Phase 0: the world to the record) is in progress on `phase0/wave3` (worktree `.claude/worktrees/wave3`).

**Wave 3 plan** (packets in [work-packets.md](work-packets.md)): P0-11 Geldar-Core plugin (event export, recipe grant on join) and P0-12 `eventsink/` run in parallel and get ONE batch review; then P0-13a (Velocity identity plugin, KV registry, fail closed) and P0-13b (Golem registers before connecting), reviewed together. Live checks are the orchestrator's, serial. Then wave close: docs sweep, retro `retro/wave-3.md`, `W3-process`, PR.

**Owner items (also in the overnight log):**
1. Decision 0032: the shard grants the whole recipe book (P0-11 does it on join). Is recipe discovery part of Adam's game?
2. Decision 0038 (spec 5.14): `/tick rate` does not slow a Mineflayer client. How does Adam get thinking time, if not time dilation?
3. Decision 0039 (corner-cutting pathing) and decisions 0029 to 0039 were written by the orchestrator.
4. Overnight decisions 1 to 17 are listed with reasons.
5. At the end of the campaign the orchestrator writes a full campaign retro (owner request).

**Worktrees:** about 30 packet worktrees remain under `.claude/worktrees/` (and `wave2`, now merged). Remove them after copying useful `.claude/reports/` files to `worknotes/`; never `git worktree prune`; do not touch `scriptorium-decisions`. Keep `p0-07b` (live secrets in `compose/secrets`) while the stack runs; live runs set `GELDAR_RCON_PASSWORD_FILE` to its `compose/secrets/rcon.txt`.

**Machine:** memory is tight (commit charge about 82 GB on 64 GB RAM). Run at most two or three agents at once; check for orphans (`find`, `python -`, stray containers) after agent runs.

**Process rules that mattered (details in the retro and skills):** coders commit after each finding and keep a report file; only the orchestrator uses the live lane; probes are read-only; never weaken an assertion or change a fixture to hide a Body finding; regenerate `pnpm-lock.yaml`, never hand-merge; always `</dev/null` on scripted git; no PowerShell backtick escapes in file content; raw benchmark JSON in `bench-runs/` is excluded from Biome.
