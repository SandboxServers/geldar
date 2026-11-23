# BLD-38d worknote: seen map and survey wired into the Body

- Built only with `body_actions.building` on (`createBody`: `seen` is null when off, nothing constructed).
- `golem/src/building/wire-seen.ts` (`createSeenWiring`): the recorder reads `viewFromBot` on sampled ticks
  (`RECORD_EVERY_TICKS`), line of sight only. An observed `blockUpdate` changes a cell only when this life
  already saw it, so a change behind a wall reveals nothing new.
- Persistence: cells written through the map are kept in a changed-cell map and drained into `SeenStore`
  (coalesced) on a 30 s timer, on death and on bot end; `SeenStore.flush` writes dirty sections.
- Death keeps the map. The next life (a `predecessor` with the same agent) copies the predecessor's stored
  sections into its map where it has no cell of its own; cells of another agent are never read.
- `survey(box, nowTick)` on the Body is `surveyBox` over the life's map. `eraseLife()` removes this life's sections.
- Not wired (see the report): the `geldar-seen` bucket is not opened by `openRestartKv`; the MCP `survey` port
  (`threshold/mcp/src/ports.ts` BodyGateway) has no survey method; own-break provenance (BLD-12) has no caller.
