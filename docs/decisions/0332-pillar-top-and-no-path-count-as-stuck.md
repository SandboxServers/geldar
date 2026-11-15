# 0332: A Body on its own pillar top that its walks cannot leave counts as stuck

- Status: Decided (owner direction via geldar-93, Body survival fixes)
- Date: 2026-11-15
- Cites: 0196 (idle_stuck B1 and B2, the stuck tests and the backoff), 0330 (the 120 s own-placement clock)
- Why: the GreenRanger case (diagnosis of 2026-11-15, `ag_tommy_01`) stood on its own tower at y 66, nine blocks above a pit floor, for about 23 minutes with no action. Its `goto`s ended `blocked` (noPath) from the same spot. The stall reflex fired once, and idle_stuck never fired, because the view saw an open-sky, step-off-capable spot: neither the enclosed test nor the ledge test held. The Body was functionally stuck and the rules called it free.

## Ruling

1. A Body is stuck, for idle_stuck, when all of these hold: it has been still (under 0.5 block of movement) with no Mind action, not asleep, not riding and not in a burrow; it stands on its own placement; it is not enclosed; and its last two `goto` outcomes both ended `blocked` from this spot (within one block).
2. Such a Body (reason `no_path`) uses the 120 s own-placement clock of decision 0330. It runs `unstick` through the same backoff, cap and hourly limit as the other idle_stuck runs (0196).
3. A Body waiting in the open, with no failed walk, does not fire. A free Body (not on its own placement) does not fire on this rule. An enclosed Body stays with the enclosure rules (enclosed by day fires, enclosed at night is a shelter), so this rule does not dig out a sealed shelter.
4. idle_stuck writes one operator line a minute while the Body stays still past its first minute: `event: idle_stuck_watch` with `idle_seconds`, `enclosed`, `canStepOff` and `onOwnPlacement`, on the Body's own log. It is operator output, not agent text, and fires no reflex. There is no contract change.

## Facts

- The no-path count is the last two `goto` outcomes, kept per view in `golem/src/body/reflexes/unstick.ts` (`failedWalksAt`). Any other outcome clears them. A failed blocked `mine` also goes through the same record, as `noteGoto` already receives it.
- The trigger is `noPathReason` in `golem/src/body/reflexes/idle-stuck.ts`. It runs only when the existing `enclosed` and `ledge` reasons do not hold.
- There is no view signal for the planner's safe-drop rule. `canStepOff` stays as it is, and the two failed walks stand in for "the only step-off is a drop the planner refuses". This was a deliberate choice, to avoid a view change in this record.
- Tests: `golem/src/body/reflexes/idle-stuck-no-path.test.ts` (fires at 120 s and not at 60 s, not on one failed walk, not after a completed goto between two, not from another spot, not for a free Body, not for an enclosed one) and `golem/src/body/reflexes/idle-stuck-watch.test.ts` (one line a minute from the first minute, none under an action or after a move).

## Follow-up, not yet done

- Item 1 is not done: the unstick "free" test must not accept a walk that ends with no reachable exit. A fix attempt made nine existing unstick fixture tests fail (they model walks that end on elevated or small fixtures and expect `completed`). The rule that separates those cases needs an owner or orchestrator decision. Until then unstick can still report "free" after a short walk on a pillar top.

## What is unchanged

- The B2 dark shelter trigger and `mayUnstick` (0196, 0330 "What is unchanged") are unchanged.
- Protection of own placements is unchanged (0164, 0330). Unstick can still dig an own block when no walk or step-off route exists.
- The stall reflex and the blocked-path reflex are unchanged.

## Rollback

Revert the commits that add `noPathReason`, `failedWalksAt` and `watchStill`, and this record with its README row. No data, schema or contract changes, so a revert is the whole rollback.
