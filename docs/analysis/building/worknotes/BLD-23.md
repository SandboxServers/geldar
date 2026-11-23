# BLD-23 worknote

Status: Partial (wiring open: the plan_progress presenter is in df27bb82; status.active_plan has no source, so live status still omits it; refreshed by BLD-docsfix-1)
Branch: phase1/bld-23-presenter (the packet text names phase1/bld-23-mcp-present; the brief names this branch)
Worktree: C:\Users\Steve\source\projects\geldar-wt-bld-23
Base sha: 17645554 (building/integration at session start)
Commit: see the report
Checks: contract generate and check:generated; biome on touched files; vitest on the pin, status and contract tests; mcp and mcp-mock typecheck
Revert check (test that failed): act pin test (build-failure.test.ts) with the old act text in the generated mcp-tools.ts; status-plan.test.ts with the active_plan spread line removed from status.ts
Live: pending (none in this packet)
Notes:
- act text: the break and plan sentence sits in the intent description of act (the only place the old "Free-form build" sentence was). It names break and plan and says they are separate from intents.
- status: `active_plan` is a copy of the Body's PlanProgressPayload, left out when no plan runs. StatusDeps gained an optional `activePlan` source; nothing in the shard wires it yet, so live status still omits the block.
- Not done: the plan_progress presenter and the mapper entry. The MindEvent and SimEvent kinds do not carry plan_progress, and the player event type list (mcp-common.schema.json) would need a new value, which this packet does not sanction.

## Correction (2026-11-22)

- The Notes line "Not done: the plan_progress presenter" is stale. The presenter is merged in `df27bb82` and present: `threshold/mcp/src/events/present-handlers/plan-progress.ts`; the mapper handler is `threshold/mcp/src/events/handlers/plan-progress.ts`.
- Still open and correct: `status.active_plan` has no source. `threshold/mcp/src/tools/status.ts:38` reads `deps.activePlan`, and `threshold/mcp/src/world.ts` passes no `activePlan`. The Status line (Partial) stands for the status block.
