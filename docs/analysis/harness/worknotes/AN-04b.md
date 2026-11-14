# AN-04b worknote

- Packet base sha (first pass, HEAD at session start, `origin/main`): `75118cfc`. Branch `phase1/an-04b-sheet-sql`.
- Migration number: `0051` (the brief's number, in the 0050 to 0059 block). File `sql/0051_character_audit.sql`. Test file `sql/test/check-schema-character-audit.sql`. Schema psql step: one `-f` appended to the existing schema-check line in `.github/workflows/ci.yml`.
- Additive only. Nothing is granted to `geldar_glass`. The three new tables have no grant to PUBLIC, geldar_mcp, geldar_glass, geldar_register or geldar_supervisor. `sheet_erase_life` has EXECUTE for geldar_register only.
- Verification: no psql ran in this pass. Every SQL step is verified by reading the migration and the test. The revert-check was not run (no database).

## What the migration adds

- `character_sheet_adoptions` (adoption log), `rolls` and `decisions` (projections), with the spec's columns, CHECKs and UNIQUE keys. Each has a foreign key to `events (source_event_id)` and to `agents (agent_id)`.
- `rolls_append_only` and `decisions_append_only` triggers (`journal_append_only`, 0007): UPDATE and DELETE raise.
- Indexes `rolls_life_fx` and `decisions_life_fx`.
- Export and retention comments on the new tables, and on `proficiency_outbox` (0050 said "to confirm in the AN-04b map"; this migration completes it). The 0050 comments are not edited.
- `sheet_erase_life(p_life_id TEXT) RETURNS void`, see below.

## sheet_erase_life

- Signature: `sheet_erase_life(p_life_id TEXT) RETURNS void`. The type is TEXT because `agents.agent_id` and every `life_id` in 0050 and 0051 are TEXT.
- SECURITY DEFINER, `SET search_path = pg_catalog, public, pg_temp`, `SET lock_timeout = '2s'`.
- Deletes the life's rows from `rolls`, `decisions`, `xp_evidence`, `character_sheet_adoptions`, `proficiency` and `proficiency_outbox`. Events, agents and other lives are not touched.
- Window for the append-only triggers: each trigger is disabled with `ALTER TABLE ... DISABLE TRIGGER` only for the DELETE on its own table, and re-enabled in the same statement sequence. The DDL is transactional, so an error anywhere rolls the disable back. The pattern of 0039 on `phase1/c7-09a` could not be checked: that branch is not on the remote (`git fetch origin phase1/c7-09a` finds no ref), so the pattern was designed here.
- A NULL life raises `null_value_not_allowed`. A repeated call deletes nothing. No RAISE NOTICE or other log line names a life.
- REVOKE ALL FROM PUBLIC, then GRANT EXECUTE TO geldar_register.

## Test (`check-schema-character-audit.sql`)

- Two lives, `cau_life_a` and `cau_life_b`, each with one row in every life-keyed table and events for each row.
- Refusals: roll without event, score 6, three dice, duplicate `(life, decision, draw_index)`, decision kind `x`, adoption without event, UPDATE and DELETE on rolls and decisions.
- Comment map, privileges and the function's definer, pinned settings and EXECUTE grants.
- Erase of life a: every table holds no row of life a and one row of life b; events of life a remain; the three triggers are enabled (`tgenabled = 'O'`); a roll of life b still refuses UPDATE; a second call is a no-op; a NULL life raises.
- Mutant notes: a DELETE without `life_id = p_life_id` removes life b's row, so the life b count step fails. Without `ENABLE TRIGGER`, rolls stay writable and the refusal step after the erase fails.

## Deviations and open items

1. `character_sheet_adoptions.source_event_id` is `NOT NULL UNIQUE REFERENCES events`. The card wrote it without NOT NULL; a NULL would bypass the "row exists only with its event" rule.
2. The card's adoption log has no append-only trigger, and this migration adds none (the card names triggers only on rolls and decisions). `sheet_erase_life` deletes adoption rows as the brief asks. Owner to decide whether adoptions should be append-only.
3. The retention text for the adoption log says "world history", but `sheet_erase_life` deletes its rows for one life. The function is a per-life erase tool. No account-deletion path calls it yet; C7-09 decides that path (decision 0171).
4. Decision 0281 is not in `docs/decisions/` on this base. Only 0171, 0186 and 0280 were read.
5. `sql/README.md` is not edited (the card and the brief both say not to). The index line for the README owner:

> Migration 0051 (AN-04b) adds the adoption log `character_sheet_adoptions`, the `rolls` and `decisions` projections (append-only, UPDATE and DELETE raise), the export and retention comments, and `sheet_erase_life(TEXT)`, the definer function that deletes one life's rows from the life-keyed tables of 0050 and 0051. PUBLIC and the named roles have no table privilege on the new tables; geldar_register alone executes the function; the check is `test/check-schema-character-audit.sql`.

6. The erase takes SHARE ROW EXCLUSIVE on each of rolls, decisions and xp_evidence for the length of its DELETE, so concurrent writes to those tables wait (up to the 2 s `lock_timeout`).
7. The `events` table has no life foreign key. Event rows of an erased life stay, as world history.
