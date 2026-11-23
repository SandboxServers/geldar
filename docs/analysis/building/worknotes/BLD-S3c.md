# BLD-S3c worknotes

- Branch `phase1/bld-s3c-glass` from `building/integration` (0468c634). Commit `1c9131ed`.
- `glass/src/plan-activity/index.ts`: stub, off (`PLAN_ACTIVITY_ENABLED = false`), `renderPlanActivity` returns without touching the host while off.
- `glass/src/static-files.ts`: `PLAN_ACTIVITY_MODULE = 'plan-activity/index'` is the registry line. It is deliberately not in `RENDER_MODULES`: a served module nothing imports fails the dead-file test in `glass/test/static-files.test.ts`, and that assertion is not weakened.
- BLD-37 must move the module into the served list (and make the page import it) when it ships the panel, and resolve that dead-file check then.
- Decision 0410 (Glass mobile and PWA) and 0411 (tabs and roster) govern Glass; `render-tabs.ts` `VIEWS` is left alone, so no tab appears.
