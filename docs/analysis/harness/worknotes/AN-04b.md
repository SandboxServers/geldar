# AN-04b worknote

- Packet base sha (first pass, HEAD at session start, `origin/main`): `75118cfc`. Branch `phase1/an-04b-sheet-sql`.
- Packet commit `4d87b785`; review fixes are one new commit on top of it (not an amend, not a squash below it).
- Migration number: `0051` (the brief's number, in the 0050 to 0059 block). File `sql/0051_character_audit.sql`. Test file `sql/test/check-schema-character-audit.sql` (218 to about 330 lines; no split needed). The schema psql step for this test is already on the existing schema-check line in `.github/workflows/ci.yml`.
- Additive, except that `xp_evidence_append_only` (0050) is recreated on `sheet_append_only` (same name, same UPDATE and DELETE refusal, TRUNCATE added).
- Nothing is granted to `geldar_glass`. The three new tables have no grant to PUBLIC, geldar_mcp, geldar_glass, geldar_register or geldar_supervisor. `sheet_erase_life` has EXECUTE for geldar_register only.

## Unexecuted SQL caveat

- No database ran in this worktree. The SQL of 0051 and of the test is verified by reading only. The review fix pass ran `check:repo`, `git diff --check` and the vitest checks; it did not run `psql`, `migrate` against Postgres, or the SQL test. The first run of `check-schema-character-audit.sql` against a real database is still open.
- Two assumptions are unverified until that run: `'search_path=pg_catalog, public, pg_temp'` is the stored `proconfig` text for `SET search_path = pg_catalog, public, pg_temp`, and `SET LOCAL ROLE geldar_register` works in the test (schema usage for the role).

## Rulings (coordinator, review round)

- R1 (locking): no `ALTER TABLE ... DISABLE TRIGGER` or `ENABLE TRIGGER` anywhere. `sheet_append_only()` (pinned search_path, returns trigger) guards `rolls`, `decisions` and `xp_evidence`. Each table has a row trigger `<table>_append_only` (UPDATE OR DELETE) and a statement trigger `<table>_append_only_truncate` (TRUNCATE, which PostgreSQL does not allow on a row trigger). UPDATE and TRUNCATE always raise; DELETE raises unless `current_setting('geldar.erase_life', true) = OLD.life_id`. `sheet_erase_life` sets `geldar.erase_life` with `set_config(..., true)` before its deletes and resets it to `''` after. The setting is a guard against accidents, not a privilege boundary: any session can set the name, and the grants are what keep other roles off these tables.
- R2 (scope): `sheet_erase_life` erases one life's rows in all six life-keyed tables. It is called only for a life that was alive when its owner deleted the account. Rows of dead lives stay as world history with no owner link (decision 0171). The matching `events` rows stay (0171 open question for events of retired lives). The contract is in the function COMMENT and in the new COMMENT ON TABLE texts in 0051 for the six tables. 0050 is not edited; its comments on proficiency, xp_evidence and proficiency_outbox are replaced by 0051.
- R3 (mechanical): the comment check fails on a NULL comment (`IS NULL OR NOT LIKE`); the proficiency_outbox comment must name `sheet_erase_life`; the function comment must state the alive contract. Tests added for: FK to events (decisions and adoptions); FK to agents (all three new tables); UNIQUE (life_id, decision_id); UNIQUE adoption source_event_id; one refusal each for rolls proficiency 4, draw_index -1, mode x, producer x, score 0, empty dice, adoption sheet_hash, source x, result x. Harness and model columns of events and agents exist. Privileges over the six tables with `has_any_column_privilege` and `has_table_privilege` for SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, for PUBLIC (aclexplode) and for each named role including geldar_glass. The function search_path is exactly `pg_catalog, public, pg_temp`. The erase is called after `SET LOCAL ROLE geldar_register` and `RESET ROLE`.
- R4 (findings 6 and 7): the table below is the export and retention map. The function body names every table as `public.<table>`.

## Export and retention map (the six life-keyed tables)

| table | export | retention |
| --- | --- | --- |
| `rolls` | own-rows export of the owner (format to confirm with C7-09) | agent-internal audit like thoughts; removed by `sheet_erase_life` for a life still alive when its owner deletes the account (owner to confirm); dead lives keep their rows as world history with no owner link (0171) |
| `decisions` | own-rows export of the owner (format to confirm with C7-09) | the same as `rolls` |
| `character_sheet_adoptions` | own-rows export of the owner (format to confirm with C7-09) | removed by `sheet_erase_life` for a life still alive when its owner deletes the account (owner to confirm); dead lives keep their rows as world history with no owner link (0171) |
| `xp_evidence` | own-rows export of the owner (format to confirm with C7-09) | removed by `sheet_erase_life` for a life still alive when its owner deletes the account (owner to confirm); dead lives keep their rows (0171) |
| `proficiency` | own-rows export of the owner (format to confirm with C7-09) | removed by `sheet_erase_life` for a life still alive when its owner deletes the account (owner to confirm); dead lives keep their rows (0171) |
| `proficiency_outbox` | none: internal publication queue, not owner data | removed only by `sheet_erase_life`, for a life still alive when its owner deletes the account; dead lives keep their rows (0171) |

The events rows that match any erased row stay in all cases.

## What the migration adds

- `character_sheet_adoptions` (adoption log), `rolls` and `decisions` (projections), with the spec's columns, CHECKs and UNIQUE keys. Each has a foreign key to `events (source_event_id)` and to `agents (agent_id)`.
- The guard `sheet_append_only()` and its six triggers (see R1).
- Indexes `rolls_life_fx` and `decisions_life_fx`.
- Export and retention comments for the six tables (table above).
- `sheet_erase_life(p_life_id TEXT) RETURNS void`, see below.

## sheet_erase_life

- Signature: `sheet_erase_life(p_life_id TEXT) RETURNS void`. The type is TEXT because `agents.agent_id` and every `life_id` in 0050 and 0051 are TEXT.
- SECURITY DEFINER, `SET search_path = pg_catalog, public, pg_temp`, `SET lock_timeout = '2s'`. No trigger DDL: no ALTER TABLE, no lock beyond the DELETEs.
- Deletes the life's rows from the six tables (R2). Events, agents and other lives are not touched.
- A NULL life raises `null_value_not_allowed`. A repeated call deletes nothing. No RAISE NOTICE or other log line names a life.
- REVOKE ALL FROM PUBLIC, then GRANT EXECUTE TO geldar_register.

## Test (`check-schema-character-audit.sql`)

- Two lives, `cau_life_a` and `cau_life_b`, each with one row in every life-keyed table and events for each row.
- Refusals with `check_violation`, `foreign_key_violation`, `unique_violation` and `not_null_violation`, as listed under R3.
- Guard: UPDATE and DELETE of rolls, decisions and xp_evidence raise with the setting unset; TRUNCATE of rolls raises; six guard triggers enabled.
- Comment map (six tables and the function), privileges, and the pinned settings and EXECUTE grants.
- Erase of life a by `geldar_register` (SET LOCAL ROLE): every table holds no row of life a and one row of life b; events of life a remain; the setting is reset; a DELETE of life b while the setting names life a raises; a roll of life b still refuses UPDATE and TRUNCATE; a second call is a no-op; a NULL life raises.
- Mutant notes: see the header of the test file.

## Deviations and open items

1. `character_sheet_adoptions.source_event_id` is `NOT NULL UNIQUE REFERENCES events`. The card wrote it without NOT NULL; a NULL would bypass the "row exists only with its event" rule.
2. The card's adoption log has no append-only trigger, and this migration adds none (the card names triggers only on rolls and decisions). `sheet_erase_life` deletes adoption rows as the brief asks. Owner to decide whether adoptions should be append-only.
3. No account-deletion path calls `sheet_erase_life` yet; C7-09 decides that path (decision 0171), and only for lives alive at the deletion.
4. Decision 0281 is not in `docs/decisions/` on this base. Only 0171, 0186 and 0280 were read.
5. `sql/README.md` is not edited (the card and the brief both say not to). The index line for the README owner:

> Migration 0051 (AN-04b) adds the adoption log `character_sheet_adoptions`, the `rolls` and `decisions` projections, the guard `sheet_append_only` on rolls, decisions and xp_evidence (UPDATE and TRUNCATE refused, DELETE only inside `sheet_erase_life`), the export and retention comments, and `sheet_erase_life(TEXT)`, the definer function that deletes one life's rows from the six life-keyed tables. PUBLIC and the named roles have no table privilege on the new tables; geldar_register alone executes the function; the check is `test/check-schema-character-audit.sql`.

6. The events table has no life foreign key. Event rows of an erased life stay, as world history (0171 open question for events of retired lives).
