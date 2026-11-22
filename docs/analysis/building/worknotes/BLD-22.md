# BLD-22 worknote

Status: Done (one commit on `phase1/bld-22-plan-check`; the commit is the one whose message is `BLD-22: MCP plan_check tool`)
Branch: `phase1/bld-22-plan-check`
Worktree: `C:\Users\Steve\source\projects\geldar-wt-bld-22`
Base sha: e9cb3e13 (`building/integration`, local; no `origin/building/integration` ref exists)
Checks: `threshold/mcp` typecheck clean; `contract` typecheck clean; `vitest run threshold/mcp threshold/mcp-mock contract player-core/src/building` 2 failures in the first run (contract list tests), fixed; the contract and plan-check tests pass after the fix; `contract` `check:generated` up to date
Revert check: the origin-shift line in `threshold/mcp/src/tools/plan-check.ts` mutated to a zero origin; `plan-check.test.ts` tests "shifts relative cells by a coordinate origin on every axis" and "resolves origin 'here' to the life's feet cell" fail; file restored from a scratchpad copy
Live: none (no live lane in this packet)

Notes:

- The tool is exposed: `mcp-plan-check` is out of `NOT_YET_EXPOSED` (contract/scripts/generator.ts), and `plan_check` is in `MCP_TOOL_NAMES` (regenerated). It stays hidden by name while the flag is off (`NOT_YET_EXPOSED_TOOLS` in unavailable.ts; the list name is now a misnomer for this tool).
- `planCheckTool(deps, call, input)` takes one `read(lifeId)` port (the pack by item name, the feet cell, and a `seen(cell)` boolean) and `isOpen`. Order: closed session, then contract input check, then the Body read, then the dry run. A failed read or a failed seen map is `body_unavailable`; a bad step is listed in `invalid_steps`, not an error.
- The dry run expands with `expandPlan` and `tallyMaterials` from `player-core/src/building`, lazily per step. A step that fails to expand adds nothing to the counts.
- `estimated_ticks` is `cells * PLAN_CHECK_TICKS_PER_CELL` (1). No timing model exists in the repo; this is a placeholder for the lane's model.
- Origin: a coordinate origin shifts the cells, and `here` uses the feet cell from the read. The reply carries counts only, never coordinates of unseen cells.
- The world registers `plan_check` as a `not_available` refusal (the Body read is not wired), as BLD-21 did for `survey`.
- Fixtures: `ItemName` in the contract has no namespace prefix (`stone`, not `minecraft:stone`).
