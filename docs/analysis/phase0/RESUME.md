# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), before acting. Rewrite at every wave boundary; 40 lines at most.

**State (2026-11-08):** scaffold PR #2 merged. `main` is protected (PR, required check `ci gate`). Owner decisions settled (Minecraft 26.1, Velocity from Phase 0). Branch `phase0/wave1` exists on origin; `.claude/state/active-campaign` = phase0.

**Current wave:** 1, the contract and a healthy stack (one PR `phase0/wave1` to `main`, not merged by the orchestrator).

**In flight (coders, background, started 2026-11-08):**

| Packet | Worktree | Branch | Stage |
|---|---|---|---|
| P0-00 | `phase0/p0-00-threat-model` | shipped, merged into wave1 |
| P0-01 | `.claude/worktrees/p0-01` | continuation 2 of 3 (first coder hit context before commit) |
| P0-05 | `.claude/worktrees/p0-05` | review fix pass 1 (owner: composite FK with edition; spec Appendix D needs correction, owner to record) |

`.claude/worktrees/wave1` is the orchestrator's checkout of `phase0/wave1` (ledger commits, merges). Do not touch `scriptorium-decisions`.

**Next actions:**

1. As each coder returns `done`, start a fresh `packet-reviewer` (pass 1; report `<worktree>/.claude/reports/phase0/<packet>-review-1.md`). `fix` goes to a fresh packet-coder, up to 3 passes. `decision` or `fix` after pass 3: ask the owner.
2. On `ship`, `git merge --no-ff` the branch into `phase0/wave1`, push, update the ledger row.
3. After P0-01 is merged: dispatch P0-02, P0-03, P0-04 in parallel from `origin/phase0/wave1`; resolve `contract/src/index.ts` and `contract/src/generated/*` conflicts per work-packets.md § Contract.
4. After P0-05 is merged: `ollama list`; if Qwen3 32B and 8B are both present, dispatch P0-06 with the exact tags, else ask the owner before pulling.
5. All seven shipped: wave review over `origin/main..phase0/wave1`, then `./geldar.ps1 check`, open the PR, wait for `ci gate`, tell the owner. Don't merge.
6. Before removing packet worktrees (only after the PR is open), copy useful `.claude/reports/` files into `worknotes/`.

**Open owner decisions:** none.
