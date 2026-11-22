# BLD-fix5: review code 4 fixes (base 6fe2448b)

Source: `.claude/reports/building/review-code-4.md` (in the integration worktree).

## Done

- F1 palette state reaches the cell target. `golem/src/building/wire-expand.ts` `toLaneCell` now
  builds the reference from the palette entry's `block` and `state` (`referenceOf`), then
  `canonicalBlockRef(parseBlockRef(...))`, so `oak_stairs` + `{half: top, facing: north}` gives
  `oak_stairs[facing=north,half=top]`. A non-string state value or a non-object state is refused
  with `PlanNotRunnable`. Tests in `wire-expand.test.ts`. Revert-check: the line that reads
  `entry.block` alone fails the two new tests.
- F5 cancel of a waiting plan keeps the active plan's checkpoint. `PlanPersistence.dropped`
  (`golem/src/building/wire-plan-store.ts`) reads the checkpoint and returns without deleting it
  when its `plan_id` is another plan. Tests in `wire-plan-store.test.ts`: waiting-plan cancel keeps
  the checkpoint and a restart resumes p1; cancel of the active plan removes it. Revert-check: the
  guard line removed fails the first test.

- F1 round trip through the lane: `golem/src/body/create-body-building.test.ts` runs a plan whose
  palette entry is `oak_stairs` with `state: {half: 'top'}` through the Body's lane and checks the
  place handler receives `placeState: {half: 'top'}`. Revert-check: `wire-expand.ts` reading
  `entry.block` alone fails it with `expected {} to deeply equal { placeState: { half: 'top' } }`.
- F2 foreground intents hold the plan lane (BLD-14, decision 0423). `IntentExecutor` takes an
  optional `foreground` gate (`ForegroundGate`, `golem/src/body/executor-types.ts`). `create-body.ts`
  passes the plan's `contention` only when building is on, so nothing is held with the flag off.
  A started intent holds `intent:<id>` once it is installed (`executor-intent.ts`, before it is
  marked running). `end()` releases in a `finally`, so a throw, a cancel, a stop and a death all
  release. A death or a stop during the hold leaves the intent ended and is not marked running.
  Tests in `golem/src/body/executor-foreground.test.ts` drive a real `PlanLane` at cursor 2:
  paused while active, resumed after with the cursor unchanged, release on a throw, on stop and on
  death, and no gate with the flag off. Revert-checks: removing the release fails 4 tests; removing
  the `holdLane` call fails 4 tests with `expected 'running' to be 'paused'`.
- Known gap: a replacing intent releases the old holder before it takes the new one, so the lane
  can take one cell between the two. The two are not in one tick in practice, but the gap is not
  closed here.

## Not done

- F4 (plan expansion unbounded): not started. `createPlanExpand` still expands eagerly. Open, see
  the review report for what is needed.
