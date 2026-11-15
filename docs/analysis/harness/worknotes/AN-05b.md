# AN-05b: roster creation writes the sheet and its adoption

Scope: `tools/mcp-tokens` only (`players.ts`, `players.test.ts`, `cli.ts`, `cli.test.ts`). `roster.ts` and `golem/` are not touched.

## What changed

- `SovereignShard.characterMode` is read from `character.mode`. Omitted (or a `character:` with no value) is `off`; `off` and `sheet` are the only values; anything else throws.
- `NewPlayer.characterSheet?: unknown`. `player add ... [--sheet-file <yaml|json>]` reads the file (16 KiB limit, fixed error text, no echo of its contents).
- Shard `off` with a sheet: refused with `the shard has character mode off`, before any write.
- Shard `sheet`: the sheet is checked with psyche's `normalizeSheet` before the transaction (a malformed sheet is refused, never repaired; errors name fields only). With no sheet, `STANDARD_SHEET` is adopted.
- Inside the existing `addPlayer` transaction, for `sheet` mode:
  1. `agents` INSERT carries `character_sheet`, `sheet_hash` (SHA-256 of psyche's `canonicalSheetJson`, via `node:crypto`) and `sheet_adopted_at` (`now()`).
  2. `events` INSERT, type `sheet_adopted` (the contract's `sheet-adopted-event.schema.json`), `source_event_id` `roster:sheet_adopted:<life>`.
  3. `character_sheet_adoptions` INSERT, `source 'roster'`, `result 'adopted'`.
- Shard `off` (or absent): the agents INSERT passes NULL for the three new columns, which are the column defaults. No events or adoption rows are written.

## Why the events row

`character_sheet_adoptions.source_event_id` is a foreign key to `events.source_event_id` (sql 0051), so the adoption cannot exist without its event row. The card did not name the event; the contract schema names it.

## Checks

- Fake Sql (`players.test.ts`): adoption recorded between BEGIN and COMMIT; given sheet adopted with its canonical hash; malformed sheet refused before any write; off shard refuses a sheet and writes nothing; adoption insert failure rolls the whole add back.
- CLI (`cli.test.ts`): `--sheet-file` in an off shard errors and sends no BEGIN, INSERT or UPDATE.
- Real-DB case (ops lane, GATE-S): one `player add` against a sheet-mode shard, then check `agents.character_sheet`, `sheet_hash` (64 hex), `sheet_adopted_at`, one `character_sheet_adoptions` row and one `events` row. The write path needs the operator role to be allowed to INSERT into `events`, `agents` (sheet columns) and `character_sheet_adoptions`; grants were not checked.
