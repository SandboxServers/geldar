# Phase 0 — resume card

Read this, then [README.md](../../../README.md) (the ledger), [overnight-decisions.md](overnight-decisions.md) and the retros in [retro/](retro/) before acting. Rewrite at every phase boundary; 40 lines at most.

**State (Phase 0 closed as proof of life, 2026-11-10):** the owner closed Phase 0 by [decision 0066](../../decisions/0066-phase0-closed-as-proof-of-life.md). The spec section 10 exit criteria are waived by the owner, not met. The long exit runs (the 24-hour 32B run, the 5-day survival, the 8B run) are not performed; they are deferred to later phases.

**Merged on `wave6-main` (57576f6):** Wave 6 (W6-01 to W6-26), including the wave M live fixes (`697f555`, `cfbaa0b`, `80cc758`), the damage-wakes rule (decision 0065, `2b2a79a`) and the life-ended rule (`d7288cb`). The Body benchmark passed at 20 TPS, 100% (bench-results.md). Evidence list: decision 0066.

**Open (not in code or not decided):**
- Body: an abandoned action gets no `aborted` receipt (W6-26, "Open Body issue" in adam-run-owner-decisions.md).
- Body: `gather` made no action at spawn in one live run (L4 open question in wm-live-findings.md).
- Cancelled and interrupted have no wake reason in the contract.
- Owner cap: 3 in the spec (5.15.6) against 20 in decision 0052; owner-cap enforcement is not implemented in code.

**Next phase:** scaling. More agents per player (up to 20 per player), the sovereign players and rangers. The phase plan is not written yet; the owner will set it.

**Deferred by decision 0066:** the spec section 10 exit runs; the 32B protocol and the restart steps (documented, unexercised); the 5-day survival; the 8B run.

**Owner items still open:**
- MineSkin upload: yes or no (the key and the PNGs are present locally; nothing uploaded).
- `sovereign.mcp.trusted_proxies` value for the tunnel.
- WM-10b least-privilege NATS user.
- Sleep cursor column.
- Cancelled and interrupted wake reason (above).
- Spec edits: player and agent terms; owner cap 3 vs 20 (5.15.6); the personal name; observer disclosure (0059).
- BC-10 v3 default switch; the `uuid` pnpm override.
- Journal deletion: `golem/test/live/adam-reset.ts` deletes rows of `ag_adam_02` before each live case; decision 0064 says append-only (O-10 to O-15 in adam-run-owner-decisions.md).
- The `wave6` shards edit: `shards/phase0.yaml` select.
- Recreate `.claude/agents/ops.md`.
- Decision 0060 verification (maximal personas against `num_ctx` 8192).

**Owner rulings in force:** reviews and live tests once per wave at its end; `W<N>-process` after the retro; a full campaign retro at the end; the benchmark gate is 20 TPS at 100% (10 and 5 TPS rows informational); no time dilation (0047); recipes are discovered (0048); identity mode is about human observation, never agent belief (0059); persona files are not artificially limited (0060).

**Worktrees:** packet worktrees remain under `.claude/worktrees/` (never `git worktree prune`; do not touch `scriptorium-decisions`). Leftover folders from Phase 0 are owner items to clean up. Create worktrees from the repo root, not a subdirectory.

**Next free decision number:** 0067.

**Machine:** about 20 GB free after closing Firefox and ChatGPT; at most about six agents at once.
