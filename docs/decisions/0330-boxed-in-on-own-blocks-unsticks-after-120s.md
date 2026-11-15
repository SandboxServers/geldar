# 0330: A Body boxed in on its own placed block unsticks after 120 s

- Status: Decided (owner ruling relayed by geldar-93)
- Date: 2026-11-15
- Amends: 0196 (idle_stuck B1, the clause that skips a Body standing on its own placement). Cites 0196, 0183 and the owner ruling of 2026-11-14 on own placements (recorded in 0196, Limits).
- Why: a ranger that built a pillar and then stood on its top with no way off was never run by idle_stuck, so it could wait for ever. In the GreenRanger case (diagnosis of 2026-11-15, GreenRanger, `ag_tommy_01`) the Body stood on its own tower for 20+ minutes with no action and no Mind call that could free it.

## Ruling

Once a Body has been stationary and boxed in for 120 s, the unstick reflex (idle_stuck B1) may act even when the block under its feet is one it placed itself. Before 120 s nothing changes: a Body only briefly on its own plank (building, waiting) does not fire. The 120 s clock starts fresh and resets on any movement of 0.5 block or more, and on any finished Mind action, as the 60 s clock already did.

## Fallback

When idle_stuck acts for a Body boxed in on its own placed blocks (after the 120 s), the unstick order is: a step-off route first, then unowned or natural blocks, and only if neither exists the Body's own placed block is broken. A boxed-in Body is therefore never left permanently trapped: the own block is the last resort, not a refusal.

## Facts

- `IDLE_TICKS_ON_OWN` = 2400 ticks (120 s) in `golem/src/body/reflexes/idle-stuck.ts`. The still clock for a Body on any other block stays `IDLE_TICKS` (1200 ticks, 60 s).
- Before this record, `mayUnstick` returned false on an own placement, and the idle clock restarted on every tick the Body stood there. B1 could not fire on a pillar top.
- The boxed-in test is unchanged: enclosed by day (not at night), or a ledge the Body cannot step off (`canStepOff` false). A read the view cannot make is still not a yes.
- The idle guards are unchanged: no Mind action running, not asleep, not riding, not in a burrow the Body dug. A failed guard restarts the clock as before.
- The log line is unchanged. For an own-placement run `idle_seconds` is the time since the still spell began (120 or more).
- Tests: `golem/src/body/reflexes/idle-stuck.test.ts`, the block-underfoot describe. They cover: firing at 120 s on own ground, not firing at 60 s on own ground, and movement or a finished Mind action restarting the 120 s clock.

## What is unchanged

- The dark shelter refusal trigger (B2, decision 0196) still does not run on an own placement: `mayUnstick` keeps its own-placement check, and B2 uses it. Whether B2 should follow the new ruling is not decided here.
- Unstick's ownership rules (decision 0164) are not changed, and digging is not widened. Another player's block stays protected.
- Own placements are not newly protected. Under 0164 (`isProtected` in `golem/src/actions/protected-blocks.ts`) a block the Body placed itself is not protected, so an unstick dig step can still dig it when no walk or step-off route exists. The ruling asks that own planks stay protected from digging; that is an owner call, not made here, and is open.
- The hostile-nearby rule (0196, Limits) is still not in place.

## Rollback

Revert the commit that adds `IDLE_TICKS_ON_OWN` and this record. No data, schema or contract changes, so a revert is the whole rollback.
