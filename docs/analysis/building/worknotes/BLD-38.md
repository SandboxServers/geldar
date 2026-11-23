# BLD-38: wire the building modules into the Body

Base sha: `df15d856` (building/integration at session start). Branch `phase1/bld-38-wiring`.

## Status

Blocked before any code change. The audit (grep over `golem/src`, non-test, outside `building/`) shows that every building module except the flag-gated `break` and `plan` registrations has no caller on the real Body path. The wiring needs pieces that are not in the tree or that sit outside this packet's files. Details and the item list are in the packet report.

## Audit result (summary)

- `createPlanLane(flag)` is called in `golem/src/body/create-body.ts` and its result is discarded.
- `PlanQueue`, `resumePlanLane`, `PlanLane`, `doCell`, the plan store, the plan checkpoint, the progress module, the materials wait, `throttleWait`/`gapTicksFor`, the seen recorder, the seen store (`SeenStore`, `eraseLife`), `surveyBox`/`decodeSurvey`, `contendFor`, `standFor`, `scaffoldFor`, `orderCells`, `laneStateOf`, and the `PLAN_*`/`SEEN_BUCKET`/`PLAN_BUCKET` names have no caller outside `building/`.
- `planHandler(flag)` is registered with no queue, so with the flag on `plan` throws `not_implemented: plan`.
- `cancelForDeath` is called from create-body but does not touch any plan queue.
- The plan expander (`PlanExpand`, the BLD-04 geometry) has no implementation in `golem/src/building/`.

No code changed.

## Correction (2026-11-22)

- Superseded by BLD-38e, BLD-38g and the rest of the BLD-38 family (ledger: Done). "Blocked before any code change" and the audit above describe base `df15d856` only.
- On this branch `golem/src/body/create-body.ts:229` registers `planHandler` with the plan queue, and `golem/src/adam/adam-body.ts:392-393` passes `survey` and `planCheck` to the Body's MindLink server. The audit's "no caller" list is not current; re-audit before quoting it.
