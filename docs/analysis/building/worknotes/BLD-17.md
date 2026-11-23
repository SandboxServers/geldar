# BLD-17 worknote

- Branch `phase1/bld-17-seen-recorder`, base `building/integration` (eedba681).
- `golem/src/building/seen/section.ts`: `sectionOf` (16-cube section, negative coordinates floor), `Section` (palette, 0 means unseen; per-cell last-seen tick), `SeenMap` (record and read; an unseen cell reads `undefined`).
- `golem/src/building/seen/recorder.ts`: `recordSeen` casts up to `RAY_BUDGET` (64) rays of the viewport cone (21 by 9 grid, `rayAngles`/`lookVector` from `perception/view/viewport.ts`) every `RECORD_EVERY_TICKS` (10) ticks, with a cursor so the whole cone is covered over three sampled ticks. Each ray records air and transparent blocks and the first opaque block, stops at an unloaded chunk without recording it, and uses `DARK_RANGE` (6) in the dark. `recordChange` records a placed or broken block.
- Deviation: the `building.seen_fov` config is not read; the cone is the viewport's fixed 90 by 45 degrees, so the default holds. Wiring the config is not in the packet's files.
- Deviation: the packet's test list asks for the leak test's first half only; the tests are in `recorder.test.ts` and `section.test.ts` is not added (section behaviour is covered there).
