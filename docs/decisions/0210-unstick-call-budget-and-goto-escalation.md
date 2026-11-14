# 0210: unstick spends one time budget per call; goto escalates to the escape ladder after identical replans

- Status: Accepted
- Date: 2026-11-14
- Why: two Bodies hit the limits of the Body's own escape code. Picard hit two unstick timeouts at (-294, 68, 373): the dig steps each got a fresh 25 s (`DIG_BUDGET_S` was per step), so one call could run past its 30 s action limit. Worf's goto ran for its full 120 s timeout at (-261.5, 67, 353.7) in a dirt-walled pocket: the stall handler only re-set the same path, and the escape ladder ran only at the 600-tick stall or after a blocked search, so it never ran.

## (a) One time budget per unstick call

Every unstick dig step (stair, sideways, down, and the last-resort pass) must end inside the action's 30 s limit counted from the start of the call, with the 1 s hop reserve. The walks and digs a call has already spent are not free again. A step whose hand-dig time is over `DIG_BUDGET_S`, or that would end past the limit, is refused before it starts. A walk does not start once less than 1.2 s of the limit is left (`MOVE_TICKS / 20`). The failure text states the seconds used against the limit, for example `; 24 s of the 30 s limit used`. Commit 27a61638.

## (b) goto escalates to the escape ladder after identical replans

A goto whose Body stays on one spot runs the escape ladder after three identical replans (`ESCALATE_AFTER_REPLANS = 3` in `golem/src/actions/stall-ladder.ts`). The next stall tick after the third replan runs the ladder in place of another replan. The ladder keeps its existing rules: the door skip, `MAX_LADDERS` per goto, the ownership record of decision 0164, and the hand-dig refusals of decision 0183. No new dig rule is added. One `stall_diag` line with `reason: escalate`, `trigger` and `replans` is logged per escalation.

The escalation follows decisions 0164 and 0183 exactly like unstick does: the same ownership record, the same hand-dig and refusal rules, and no dig through another player's work. This was agreed with geldar-93 on 2026-11-14.

Stall cutoffs are counted in world ticks (`bot.time.age`), not wall time (`golem/src/actions/pathing.ts`). A replan is triggered after 60 world ticks with less than 0.03 block of movement, so three replans take about 180 world ticks: about 9 s at 20 TPS, about 36 s at 5 TPS. The 600-tick stall (the default limit) is 30 s at 20 TPS and 120 s at 5 TPS, which is the goto timeout. The 120 s goto timeout is wall time. On a slow server the timeout can therefore end a walk before a tick-counted stall ends it.

Open items, not settled by this record:

- The skip reasons on Worf's logs (why the ladder did not run in that window) are inconclusive. The logs do not say which rung refused.
- The TPS of Worf's window is not checked. Whether the 120 s timeout or a tick-counted stall ended the walk is unknown until it is.

## (c) Test-only pins

No behaviour change. These tests pin behaviour that already exists:

- `idle_stuck` damage and slot pins (`golem/src/body/reflexes/idle-stuck-damage.test.ts`).
- The sleep retry signal (`golem/src/actions/sleep-hardstop.test.ts`).
- The unstick walk gate (`golem/src/actions/unstick.test.ts`).

`golem/src/actions/unstick.ts` was split with no behaviour change: the drop and move planning rules moved to `golem/src/actions/unstick-plan.ts`, and `unstick.ts` re-exports the names its tests import. The existing unstick tests are unchanged.
