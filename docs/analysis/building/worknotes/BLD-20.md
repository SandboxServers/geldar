# BLD-20 worknote

Status: Done (pending the commit on the branch)
Branch: `phase1/bld-20-survey` (the brief's name; the packet's `phase1/bld-20-body-survey` was not used)
Worktree: `C:\Users\Steve\source\projects\geldar-wt-bld-20`
Base sha: 27a51834 (`building/integration`)
Commit: the single BLD-20 commit on `phase1/bld-20-survey` (see the coder report)
Checks: biome check clean; golem typecheck clean; `golem/src/building/seen/survey.test.ts` 9 of 9 pass
Revert check (test that failed): see the coder report
Live: pending (none in this packet)

## Rendering (the contract BLD-21 reads)

`surveyBox(map, box, nowTick, anchorY?)` returns `{ text, truncated }` and nothing else (no owner field).
`box` is inclusive on all three axes; an empty box answers the legend alone.

- Line 1 is the legend: `legend ?=unknown` then one `<symbol>=<block name>` per block, in the order the layers were rendered. Symbols are the letters `a` to `z` then `A` to `Z`. A 53rd distinct block name shares `*`, and `*=other` is then listed.
- Then one block per Y layer, `y=<y>`, in ascending Y.
- Then one line per Z row of that layer, `  z=<z> <run> <run> ...`, runs in ascending X.
- A run is `<count><symbol>@<minutes>` for a seen cell: `count` cells of that block, last seen `minutes` game minutes ago (`floor(max(0, now - lastSeen) / 1200)`, 1200 ticks a minute).
- An unseen cell is the run `<count>?` with no age. The legend reads `?` as `unknown`. Nothing is guessed about an unseen cell.
- Text is at most 6000 characters (`SURVEY_TEXT_CAP`, a payload cap). Layers are taken nearest to `anchorY` (default the box's lowest Y) first, and output in ascending Y. When a layer does not fit whole the nearest rows of the first layer are kept; `truncated` is `true` whenever a slice or row was left out.
- `decodeSurvey(text)` reads the text back to `{ legend, layers: [{ y, rows: [{ z, cells }] }] }`, each cell `{ name, ageMinutes }` (both undefined for unseen). The round-trip test uses it.

## Notes

- Deviation: the packet's gateway handler (the Body side of the snapshot request, next to `see` and `view`) is not in this coder's file list (the brief allowed only `survey.ts` and its tests). It is not written here; the Body wiring is for the packet that owns the gateway.
- Deviation: the branch name is the brief's `phase1/bld-20-survey`, and the commit message is the brief's, not the packet's wording.
- The world tick rate is assumed at 20 ticks a second (1200 ticks a minute) for the age.
