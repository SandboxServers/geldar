# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-08):** the scaffold PR (GitHub #2: repo setup, agent setup, CI, this campaign folder) is merged to `main`. Already done in repo settings: `main` is protected (PR required, required check `ci gate`, no force-push or deletion; admins can bypass), Dependabot alerts and security updates are on. No packet has been dispatched.

**Current wave:** 1, the contract and a healthy stack (ships as the wave 1 PR).

**In flight:** nothing.

**Next action:**

1. Owner decisions are settled: Minecraft 26.1 (D-P0-07, decision 0022) and Velocity from Phase 0 (D-P0-08, decision 0021).
2. Create `phase0/wave1` from `main` and push it. Packet worktrees branch from it (work-packets.md, wave 1 intro).
3. Dispatch in parallel: P0-00 (threat model, Sonnet), P0-01 (contract), P0-05 (sql).
4. When P0-01 has `ship`, merge it into `phase0/wave1`, then dispatch P0-02, P0-03, P0-04 in parallel from there. Resolve their `contract/src/index.ts` and generated-file conflicts at merge as work-packets.md § Contract says.
5. When P0-05 has `ship`, dispatch P0-06 with the Ollama model tags filled in (versions are in its packet).
6. Wave review, then one PR from `phase0/wave1` to `main`.

**Open owner decisions:** none.

**Worktrees:** none.
