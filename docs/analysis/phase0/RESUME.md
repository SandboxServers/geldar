# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), [known-gaps.md](known-gaps.md) (the Phase 1 backlog), [overnight-decisions.md](overnight-decisions.md) and the retros in [retro/](retro/) before acting. Rewrite at every phase boundary; 40 lines at most.

**State (Phase 0 closed as proof of life, 2026-11-10):** the owner closed Phase 0 by [decision 0066](../../decisions/0066-phase0-closed-as-proof-of-life.md). The spec section 10 exit criteria are waived by the owner, not met.

**Done on `phase0/integration` (83b0922):** Wave 6 (W6-01 to W6-26 except W6-08, see below), fix rounds A to F, and the wave M live fixes (`697f555`, `cfbaa0b`, `80cc758`). W6-08 (investigate `intent_link_gave_up`) is not done and unverified: it has no branch, no merge and no worknote. W6-15 to W6-19 have branches merged into `phase0/integration` but no ledger rows. The Body benchmark (OPS-0) passed at 20 TPS, 100% at several commits (last full pass 403a9cc and 98d5394); the final clean rebench at 57576f6 was stopped by the owner (bench-results.md). OPS-1 (20-minute smoke) was run, not passed: smoke-w6-20-a aborted on a process-probe bug; smoke-w6-25-a ended when the 8B Adam died to a zombie about 6 minutes in, and the harness treated the death as a stall (since fixed as `life_ended`). No clean pass exists. The campaign retro is written: [retro/campaign.md](retro/campaign.md).

**Open (not in code or not decided):**
- Body: an abandoned action gets no `aborted` receipt, and the `prepared` receipt is not implemented (decision 0020; W6-26; adam-run-owner-decisions.md).
- Body crash reconciliation is partial: no-checkpoint case and running actions are open.
- `gather` made no action at spawn in one live run (L4 open question in wm-live-findings.md).
- Cancelled and interrupted have no wake reason in the contract.
- Owner cap: 3 in the spec (5.15.6) against 20 in decision 0052; `owner add` needs `--cap 20`.
- NATS auth overlay (`compose/nats-auth.yml`, decision 0067) is untested against a live `nats-server`.

**Next phase:** scaling. More agents per player (up to 20 per player), the sovereign players and rangers. The Phase 1 backlog is in known-gaps.md; the phase plan is not written yet and the owner will set it.

**Deferred by decision 0066:** the exit runs: OPS-2 (32B, `ag_adam_03`), OPS-3 (8B, `ag_adam_04`) and OPS-4 (final gate); the 24-hour run; the 5-day survival. The 32B protocol and the restart steps are documented and unexercised.

**Owner items still open:**
- MineSkin upload: yes or no (the key and the PNGs are present locally; nothing uploaded).
- Public MCP topology (decision 0053): `sovereign.mcp.trusted_proxies` value for the tunnel, and the client header.
- Per-component NATS credentials (fix-a2; see known-gaps.md).
- Sleep cursor column.
- Cancelled and interrupted wake reason (above).
- Spec edits (for the owner; the orchestrator does not edit `docs/spec.md`): player and agent terms in 2a and 3; owner cap 3 vs 20 (5.15.6); the observers sentence (~1584, removed in prompt v4, decision 0068); about 30 lines with personal names.
- BC-10 v3 default switch; the `uuid` pnpm override.
- Journal deletion: `golem/test/live/adam-reset.ts` deletes rows of `ag_adam_02` before each live case; decision 0064 says append-only (O-10 to O-15 in adam-run-owner-decisions.md).
- The `wave6` shards edit: `shards/phase0.yaml` select.
- Recreate `.claude/agents/ops.md`.
- Decision 0060 verification (maximal personas against `num_ctx` 8192).

**Owner rulings in force:** reviews and live tests once per wave at its end; `W<N>-process` after the retro; a full campaign retro at the end; the benchmark gate is 20 TPS at 100% (10 and 5 TPS rows informational); no time dilation (0047); recipes are discovered (0048); identity mode is about human observation, never agent belief (0059); persona files are not artificially limited (0060).

**Worktrees:** packet worktrees remain under `.claude/worktrees/` (never `git worktree prune`; do not touch `scriptorium-decisions`). Leftover folders from Phase 0 are owner items to clean up. Create worktrees from the repo root, not a subdirectory.

**Next free decision number:** 0130 (Phase 1 blocks reserve 0081 to 0129; 0068 is prompt v4). **Phase 1 entry point:** [phase1/ledger.md](../phase1/ledger.md) and [phase1/packets/](../phase1/packets/).

**Machine:** about 20 GB free after closing Firefox and ChatGPT; at most about six agents at once.
