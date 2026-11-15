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
- Shard `off` (or absent): addPlayer uses the agents INSERT as it was before the sheet columns existed (it names no character_sheet, sheet_hash or sheet_adopted_at), so the add also works on a database without 0050. No events or adoption rows are written.

## Why the events row

`character_sheet_adoptions.source_event_id` is a foreign key to `events.source_event_id` (sql 0051), so the adoption cannot exist without its event row. The card did not name the event; the contract schema names it.

## Checks

- Fake Sql (`players.test.ts`): adoption recorded between BEGIN and COMMIT; given sheet adopted with its canonical hash; malformed sheet refused before any write; off shard refuses a sheet and writes nothing; adoption insert failure rolls the whole add back.
- CLI (`cli.test.ts`): `--sheet-file` in an off shard errors and sends no BEGIN, INSERT or UPDATE.
- Real-DB case (ops lane, GATE-S): one `player add` against a sheet-mode shard, then check `agents.character_sheet`, `sheet_hash` (64 hex), `sheet_adopted_at`, one `character_sheet_adoptions` row and one `events` row. The write path needs the operator role to be allowed to INSERT into `events`, `agents` (sheet columns) and `character_sheet_adoptions`; grants, from reading only (no database run): the tool connects as PGUSER=geldar (cli.ts Client; geldar.ps1 default), the POSTGRES_USER that runs the migrations and owns the tables (sql/0034 line 7 says so). 0050 and 0051 revoke only from PUBLIC and the geldar_* roles, not from geldar, and addPlayer already writes agents and mcp_players as that role.

## Fix pass (review of 4be1ce62)

- Sheet life: the contract validator (validateSheetAdoptedPayload) threw is not a function at its call in players.ts under vitest, and the same call in players.sheet.test.ts failed too. Root cause not found in the time box; the call text itself changes the outcome. Fallback: players.ts checks the life with SHEET_LIFE_ID, a copy of the contract LifeId pattern (common.schema.json), and a drift test in players.sheet.test.ts reads the schema and asserts equality. The sheet itself is still checked by normalizeSheet before any write.
- Mutations run on players.ts against players.sheet.test.ts and players.test.ts (each restored byte for byte, checked by hash): sheet_adopted_at set to NULL (fails the sheet-mode write test); LifeId check removed (fails the two refusal tests); SHEET_FILE_MAX_BYTES raised to 1000000000 (fails the exactly-16384 test); the `$8::jsonb, $9::text` placeholders swapped (fails the two sheet-mode write tests).
- Not yet run as mutations: events id differs from the adoption source_event_id, events type changed, adoption source/result literals changed, off-mode statement leaking the new columns.
