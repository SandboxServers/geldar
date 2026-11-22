# BLD-08 worknote: place blockstate and orientation

- Base for this pass: `663081ab` (building/integration at session start; no `origin/building/integration` ref exists, so the worktree was cut from the local branch).
- `golem/src/actions/place-state.ts`: pure planner. `planPlaceState` picks the first reference whose click gives the wanted axis, facing or half; yaw comes from the facing (the placed block faces back toward the bot), pitch from the reference side, cursor height from the half.
- Tiers: axis for logs, wood and pillars; facing for stairs, doors, furnaces and chests; half for slabs (stored as `type`) and stairs (stored as `half`). A key the block does not take gives null.
- Not done in this pass: wiring into `place.ts` (the `placeState` run option, the look before the click, the post-placement property check and the `state_unachievable` outcome). The option must reach the handler the way `mineAt` does (registry.ts, decision 0349), and `place()` needs its reference choice changed, which is outside the one-line allowance in the brief.
- Tests: `golem/src/actions/place-state.test.ts`, 13 cases (tiers, log axis, stair facing and half, slab half, yaw and pitch, unachievable cases).

## Correction (2026-11-22)

- "facing for stairs, doors, furnaces and chests" describes the tier table, not the behaviour. `golem/src/actions/place-state.ts:37` sets `FACING_VERIFIED` to an empty list, so every facing is refused (`state_unachievable`). Only half and axis are achieved. Ledger: Partial (fix3a).
- "Not done: wiring into `place.ts`" is stale in part: `golem/src/actions/place.ts:145` and `:177` read `ctx.placeState`. End-to-end behaviour is not re-checked here.
