# BLD-fix7a: review-code-5 fixes (partial)

Base: a5082ec4 (building/integration). Branch: phase1/bld-fix7a-gate-state.

## Done

- F1 (createBody foreground gate): `golem/src/body/create-body-building.test.ts` now has a
  `the foreground gate reaches the intent executor` describe. With `building: true`, an intent pauses
  the plan lane while it runs and resumes it after; with `building: false` the same intent runs with
  no lane and no throw. Revert-check: deleting the `foreground` spread in `create-body.ts` fails the
  pause assertion.
- F4 (hold before install): `startIntentRun` takes the plan-lane hold before the old intent ends,
  awaits it, then re-checks the death floor and whether the executor is stopping. Only then does it
  install and record `running`. A stop or death during the hold ends the intent (its end releases the
  hold) and it never runs. `IntentStartDeps` gains `stopping()`. Tests in
  `golem/src/body/executor-foreground.test.ts`: a tick during a slow hold runs no step; a stop during
  the hold and a death during the hold each run no step and resume the lane once.
  Revert-check: install moved back before the hold fails the slow-hold test (1 step ran).
- F5 (replace resume gap): the new intent's hold is taken before the old intent ends. Test: replacing
  an intent does not resume the lane. Revert-check: moving the hold back below the old end fails it.

- F2 (slab half and unsettable state, review option b): `cell-do.ts` refuses, before any dig, walk
  or placement, every reference key the block cannot take (`takesProps` in `block-ref.ts`: a key the
  place action sets, or the name the world stores it by). A slab's `half` is stored as `type`
  (`propertyOf` from `place-state.ts`, now exported); `storedProps` maps the reference to that name
  for both the done check and the verify. `placeStateOf` reads a slab's `type` as its half, so
  `oak_slab[type=top]` places the top half. Refused keys: `open`, `waterlogged`, `type` on a stair,
  `facing` on a stair (facing is not verified). Tests: `cell-do.test.ts` (slab by `half`, slab by
  `type`, done through the stored `type`, open door and waterlogged stair refused with no dig or
  placement, `type` on a stair refused), `block-ref.test.ts` (`takesProps`, `storedProps`, slab
  `placeStateOf`). Revert-checks: see the report.
  The walk is not in `doCell`; the refusal returns before the lane's dig and place calls.
- F6 (bad palette state message): `wire-expand.ts` names the block from the bare name (the part
  before `[`); a state that does not parse as a block reference now reports
  `palette key X has an invalid state`. A bad block name still reports `names no block`. Test:
  `wire-expand.test.ts`, the named-state case and the bad-name case.
