# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-08):** PR 1 (repo scaffolding, agent setup, CI, this campaign folder) is open. No packet has been dispatched.

**Current wave:** 1, the contract and a healthy stack (ships as PR 2).

**In flight:** nothing.

**Next action, after PR 1 merges:**

1. Ask the owner D-P0-07 (Minecraft version) and D-P0-08 (Velocity in Phase 0). Settle D-P0-09, D-P0-10, D-P0-11 as proposed unless the owner objects.
2. Dispatch in parallel: P0-00 (threat model, Sonnet), P0-01 (contract), P0-05 (sql).
3. When P0-01 has `ship`, dispatch P0-02, P0-03, P0-04 in parallel on top of it.
4. When P0-05 has `ship` and D-P0-07 is settled, dispatch P0-06 with the version, Paper build and Ollama model tags filled in.
5. Wave review, then ship wave 1 as one PR from an integration branch `phase0/wave1`.

**Open owner decisions:** D-P0-07, D-P0-08.

**Worktrees:** none.
