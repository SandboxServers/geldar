# BLD-b8-seen worknote: seen map privacy and stale cells

Branch `phase1/b8-seen-privacy`, base `building/integration` at b014adde. Coordinator ruling 3-5 (2026-11-22), recorded in decision 0424 as an addendum ("Interpretation, 2026-11-22"; the owner may overrule).

## Done

- Ruling 3, out-of-view writes: `recordIfInView` (`golem/src/building/seen/recorder.ts`) writes a cell to the seen map only when `cellInView` holds with the current pose. The blockUpdate listener in `golem/src/building/wire-seen.ts` now goes through it, so a change to an out-of-view cell never enters or overwrites the map.
- Ruling 4, stale cells: `SeenCell` carries `inherited` (`golem/src/building/seen/section.ts`, a per-cell bit). `record` clears the bit unless inheritance sets it; a fresh sighting (ray or change in view) therefore clears the mark.
- Inheritance sets the mark on the predecessor's cells (`wire-seen.ts`, `inherited` argument); the same-life restart keeps the bit the store holds for its own cells.
- Survey text (`golem/src/building/seen/survey.ts`): an inherited run prints `@<minutes>i`; `decodeSurvey` reads the mark back into `DecodedCell.inherited`. The age stays in game minutes, computed from the stored last-seen tick (no schema change; the survey reply is text, so no contract file changed).

## Not done, and why

- Ruling 3(b), the mismatch report carrying no block name: no report path in golem carries a block name today. `cell-do.ts` returns cell codes only (`codeOf` drops the handler message), and `plan_check` returns counts (`unknown_cells`). Nothing was changed there; no test was written for a path that does not exist.
- Inherited mark across a flush: a predecessor cell is tracked as a change and written through `SeenStore.record`, which takes no inherited argument and so stores it as not inherited. This is the open finding "inheritance writes marks wrongly" (RESUME item 13). Left as is: it needs a `store.ts` change outside this packet's file list.

## Tests

- `golem/src/building/seen/in-view.test.ts`: an out-of-view verified read of an unseen cell does not enter the map; an out-of-view read leaves a seen cell as it was; an in-view read is recorded with its tick.
- `golem/src/building/seen/survey.test.ts`: a stale inherited cell reads back with its age and the `i` mark; a fresh sighting clears the mark.
- `golem/src/building/wire-seen.test.ts`: a predecessor cell is inherited with its last-seen tick, and a fresh sighting clears the mark.

Revert-checks (one line each, restored by copy): the `cellInView` guard in `recordIfInView` (in-view tests fail); the `cell.inherited` survey mark (survey test fails); `section.ts` read of the inherited bit (survey and wire-seen tests fail); the predecessor `true` argument (wire-seen test fails with `inherited` false).
