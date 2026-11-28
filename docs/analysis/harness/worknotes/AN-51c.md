# AN-51c: perceived positions in `agents[].pos`

**Card.** AN-51c in `docs/analysis/harness/work-packets-sheet-w6-w8.md`. Authority: 0391 item 4 (agents may be told positions their own Body perceived; never an id). Shape approved in principle by 0289 and 0391, so no record 0451 was taken.

**Contract slot.** AN-51c follows AN-45c (`feat(contract): optional actor basis for observation evidence, named only when seen`, `a6b8a0e2`). It is the next serial contract change. It edits `contract/schemas/snapshot.schema.json` and `contract/schemas/mcp-common.schema.json` (the MCP copy of the same agents item) and regenerates `contract/src/generated/` with `pnpm generate`.

**Where agents[] is built.** `golem/src/perception/entities.ts`, `observeEntities`. It is the only producer of `agents` on the Body. Each player passes the line-of-sight check (`canSeeBody`) before it becomes an entry, so an entry exists only for an agent the Body perceives. `pos` is the block position (`Math.floor` of the entity position on each axis).

**Emitted.** `pos` is emitted whenever the Body perceives an agent; nothing gates it, by owner ruling (decision 0391 item 4, 0289 item 6). **Clamp:** an agent whose floored y is outside -64..320, or whose x or z is outside ±30000000, is still listed but without `pos`, so the snapshot stays within `contract/schemas/snapshot.schema.json`.

**No ids.** The entry carries no `life`, no `ag_` id and no UUID. The contract's `pos` object rejects extra keys, so an id cannot ride along in it.
