# 0210: unstick spends one time budget per call; goto escalates to the escape ladder after identical replans

- Status: Accepted
- Date: 2026-11-14
- Why: two Bodies hit the limits of the Body's own escape code. Picard hit two unstick timeouts at (-294, 68, 373): the dig steps each got a fresh 25 s (`DIG_BUDGET_S` was per step), so one call could run past its 30 s action limit. Worf's goto ran for its full 120 s timeout at (-261.5, 67, 353.7) in a dirt-walled pocket: the stall handler only re-set the same path, and the escape ladder ran only at the 600-tick stall or after a blocked search. The logs do not show whether the ladder ran in that window: they are inconclusive, so the cause is probable, not proven.

## (a) One time budget per unstick call

Every unstick dig step (stair, sideways, down, and the last-resort pass) must end inside the action's 30 s limit counted from the start of the call, with the 1 s hop reserve. The walks and digs a call has already spent are not free again. A walk does not start once less than 1.2 s of the limit is left (`MOVE_TICKS / 20`). A step whose dig time is over `DIG_BUDGET_S`, or that would end past the limit, is refused before it starts. The failure text states the seconds used against the limit, for example `; 24 s of the 30 s limit used`.

The dig time is tool-aware: it is estimated with the tool `dig()` will equip (`bestHarvestTool`, the same selection). With a harvest tool the hand estimate (5 s per hardness point) is divided by 5, a low divisor, so the estimate stays on the safe side (for example stone with a pickaxe is 1.5 s, not 7.5 s). With no tool the hand estimate stands. Owner call: the divisor is not a measured tool speed; a pickaxe Body still refuses obsidian (50 s estimate, about 9 s in the game).

The first commit of this branch (PR #363, "Body batch 0210 (a)") carries the walk gate and the budget. The walk gate is part of (a), not a test-only pin.

## (b) goto escalates to the escape ladder after identical replans

A goto whose Body stays on one spot runs the escape ladder after three identical replans (`ESCALATE_AFTER_REPLANS = 3` in `golem/src/actions/stall-ladder.ts`). The next stall check after the third replan runs the ladder in place of another replan. The ladder keeps its existing rules: the door skip, `MAX_LADDERS` (2) per goto, the ownership record of decision 0164, and the hand-dig refusals of decision 0183. No new dig rule is added. One `stall_diag` line with `reason: escalate`, `trigger` and `replans` is logged per escalation. A movement of the Body (0.03 block from the last replan spot) restarts the count, and so does a ladder that frees the Body.

Two clocks decide when the check is due:

- The tick arm: the replan cadence is 60 world ticks (`REPLAN_STALL_TICKS`) with less than 0.03 block of movement. Three replans put the escalation at tick 240 of a still Body: 12 s at 20 TPS, 48 s at 5 TPS, 120 s at 2 TPS.
- The wall-clock arm: `ESCALATE_WALL_MS` (15 s) of wall time since the Body last moved, with three replans behind it, is also due. It runs once per still spell. At 2 TPS it runs at about 90 to 95 s, before the 120 s goto timeout.

The escalation follows decisions 0164 and 0183 exactly like unstick does: the same ownership record, the same hand-dig and refusal rules, and no dig through another player's work. This was agreed with geldar-93 on 2026-11-14.

Open items, not settled by this record:

- The TPS of Worf's window is not checked. Whether the 120 s timeout or a stall ended the walk is unknown until it is.

## (c) Test-only pins

These tests pin behaviour that already exists, with no behaviour change:

- `idle_stuck` damage and slot pins (`golem/src/body/reflexes/idle-stuck-damage.test.ts`).
- The sleep retry signal (`golem/src/actions/sleep-hardstop.test.ts`).

`golem/src/actions/unstick.ts` was split with no behaviour change: the drop and move planning rules moved to `golem/src/actions/unstick-plan.ts`, and `unstick.ts` re-exports the names its tests import. `digDown`, `digStair` and `lastResortDig` are exported for the budget tests.

## Known limits (not fixed by this record)

- Friends blocking a corridor: nothing protects a Body held in a corridor by other players, so the ladder runs at 12 s of stall instead of 30 s. The ladder's rungs (jump, sprint jump, dig, stairs, pillar) are the same as the 600-tick stall; one of the two `MAX_LADDERS` is spent earlier.
- A second replan-triggered escalation in one goto is effectively impossible: `replans` is never reset, and the replan branch needs `replans < MAX_REPLANS` (6). The 600-tick stall still covers that case. Not reset in this fix.
- The 30 s limit: `timeoutMs` of `unstick` is derived from `ACTION_LIMIT_S` (`ACTION_LIMIT_S * 1000`), with a test that ties them.
- The budget is an estimate checked before a step. `dig()` retries once on "aborted", and walks and digs count ticks, so at low TPS the wall time can stretch past the nominal seconds.
- The climb rung (`digUp`) uses the same tool-aware estimate (`digSeconds`).
- Test gaps: the budget gate at the unstick() call sites of the elevated dig-down and the main stair are pinned through the exported helpers, not through `unstick()` itself. `MAX_LADDERS` is pinned by its value, not by a two-ladder behaviour test.
