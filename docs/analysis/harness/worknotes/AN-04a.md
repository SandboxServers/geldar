# AN-04a worknote

- Packet base sha (first pass, origin/main at session start): `c1189326`. Packet commit: `e7e94b9d` on `phase1/an-04a-sheet-sql`. Review fix pass: one commit on top of `e7e94b9d`, not squashed below it.
- Migration number: `0050` (the brief's number). `work-packets-geldar-a.md` recommends 0037 and up; origin/main's highest file was 0037 at the time. Check the number against the ledger before merge.
- Test file: `sql/test/check-schema-character-sheet.sql`. Schema psql step: one `-f` line in `.github/workflows/ci.yml`.

## Sql/README.md index line (not added)

The card marks `sql/README.md` must-not-edit, so the first pass's paragraph was reverted in the review fix pass. If the index owner wants the line, it reads:

> Migration 0050 (AN-04a) adds the adopted character sheet (`agents.character_sheet`, immutable once set, decision 0186), the `proficiency` projection, the append-only `xp_evidence` key and the `proficiency_outbox` publication queue. PUBLIC and the named roles geldar_mcp, geldar_glass, geldar_register and geldar_supervisor have no table privilege on the three tables and no SELECT or UPDATE on the three sheet columns of `agents`; the check is `test/check-schema-character-sheet.sql`.

The first pass said "No role other than the owner can read them". The test does not check roles outside the named four plus PUBLIC, so that sentence was removed.

## Open design call (for AN-04b and C7-09)

1. Erasure path. `xp_evidence` is append-only (`journal_append_only`, 0007), so DELETE raises. `proficiency` and `proficiency_outbox` have foreign keys to `agents (agent_id)`, so deleting a life row fails while they hold rows. Choose one:
   - a SECURITY DEFINER erase function, owned by the migration owner, executable only by the deletion role, that removes the life's rows from all three tables; or
   - an exempt trigger, keyed on a session setting that only the erase function sets.
   Either needs a test that a plain DELETE still raises.
2. Export membership. `proficiency` and `xp_evidence` are in the owner's own-rows export (COMMENT ON TABLE says "format to confirm with C7-09"). `proficiency_outbox` is marked "export: none" and its retention is "to confirm in the AN-04b map". The comments are provisional.

## Ambiguities from the first-pass report (still open)

1. The commit message of `e7e94b9d` says "roll and decision tables", but the card puts those in AN-04b. The message was committed as the brief wrote it. Reword only with the owner's approval.
2. Sheet inner keys (attributes, alignment, op_modes) come from `work-packets-geldar-a.md`, since the AN-04a card does not list them.
3. `agents_sheet_shape` lets a NULL `sheet_hash` through (NULL regex is NULL). The migration adds `sheet_hash IS NOT NULL` and a test step for it.
4. `character_sheet_valid` and the group helper are plpgsql, not `LANGUAGE sql`, so key and score checks short-circuit.
5. `proficiency_outbox` has no `domain` CHECK. A CHECK is a sensible follow-up. The test therefore has no bad-domain refusal for the outbox.
6. The card says "no GRANT". The migration also runs REVOKE ALL on the three tables from PUBLIC and the four named roles. After that REVOKE, relacl is no longer the default (NULL), so a "relacl is default" assertion would be false. It was not added.
7. The agents fixture uses mode `headless` with no owner, to avoid owner FKs. Other CHECKs on agents were not confirmed, because no psql was run.
8. The ADR allocation (card `<allocate via registry>`) is not done.

## Findings (not fixed in this pass)

- The migration header (lines 12-13) says "Sheet data is operator-readable only". The test checks only PUBLIC and the four named roles. That sentence is wider than the test and should be narrowed in a later migration comment pass. The migration was not edited in this pass.
- The test step label "the five named roles and PUBLIC" covers four named roles plus PUBLIC. The label is kept as is.
- No psql ran, so every new step is verified by reading the migration only. Revert-check not run.
