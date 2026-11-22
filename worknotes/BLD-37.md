# BLD-37: Glass plan-activity view

- `glass/src/plan-activity/model.ts`: builds one row from a `plan_progress` payload (contract/schemas/plan-progress-event.schema.json) and the agent label Glass already shows (`name`, else `agent_id`). It copies named fields only, so a seen map or unseen cells in a payload are dropped. A payload that does not match the schema throws.
- `glass/src/plan-activity/index.ts`: `renderPlanActivity(host, enabled, rows)` writes plain text with `textContent`. Off by default (`PLAN_ACTIVITY_ENABLED = false`); while off it never touches the host.
- `glass/src/static-files.ts`: `PLAN_ACTIVITY_MODULE` is now in `RENDER_MODULES` (served at `/js/plan-activity/index.ts`). `glass/src/render-view.ts` re-exports the panel so the dead-file check sees an importer; `glass/public/sw.js` SHELL lists the new path.
- Tests: `model.test.ts` (row fields, dropped keys, malformed payloads, text lines), `index.test.ts` (off/on, registry), `no-agent-path.test.ts` (no agent package names the panel; the panel imports no agent or server code and opens no feed).
- Not done here: the feed route, the `body_actions.building` gate and the live wiring of rows into the page. The panel stays off until that wiring lands.
