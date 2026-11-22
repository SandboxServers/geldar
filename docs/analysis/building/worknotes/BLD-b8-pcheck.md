# BLD-b8-pcheck: plan_check streams its dry run with no cell cap

Decision 0423 (no policy caps) applied to the plan_check dry run.

## What changed

- `golem/src/building/plan-check-reply.ts`: `PLAN_CHECK_CELL_CAP` (8192) and the `WORK_BOUND` (4x) pre-check are
  removed, with `plan_too_large` from the Body's answer. The dry run now walks each step with `lazyBottomUp`
  (the production bottom-up order), one layer at a time, and counts each cell as it arrives. Counts per palette
  key are order-independent, so the reply is the same as the eager count.
- The walk yields to the event loop (`setImmediate`) after each slice of cells; the slice is `COUNT_SLICE`
  (512) by default, or `sliceFor()` when the caller passes one. The adam Body does not pass a TPS-aware slice
  (the lane's TPS estimator is built inside `wire-lane.ts`, not in the Body's wiring), so the default applies.
- `answerPlanCheck` is async and takes an optional `AbortSignal`. `planCheckFrom` aborts the walk still running
  when a newer `plan_check` arrives, and takes a life signal that the adam Body aborts on `onEnd` and `stop()`.
  An aborted walk answers `not_available`.
- `golem/src/mind-link/server.ts`: `answerFrom` awaits the answer (the plan_check answer is now a promise).
- Flag off: still `not_available`, the seen map is not read.
- Out-of-view cells: the walk reads the seen map only through `SeenMap.read`, as before. Block names are not
  read or returned.

## Left for follow-up

- `threshold/mcp/src/tools/plan-check.ts` still maps a Body `plan_too_large` refusal to a tool error. The Body no
  longer sends it, so that branch is unreachable. Removing it touches the MCP tool's error set and its tests.
- The contract's `PlanCheckResult` has no size limit field (nothing to edit in `contract/`).
