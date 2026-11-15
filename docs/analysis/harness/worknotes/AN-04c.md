# AN-04c worknote: sheet erasure covers dead lives

- Card: AN-04c (branch `phase1/an-04c-erase-comments`, from `origin/main`).
- Ruling: geldar-registration decision 0262, owner ruling 2026-11-15. Recorded as `docs/decisions/0282-sheet-erasure-covers-dead-lives.md`. It supersedes the dead-life part of 0171 point 2 and the 0051 comments that repeat it.

## What changed

- `sql/0052_character_erase_comments.sql`: comments only. Re-issues the COMMENT ON TABLE texts for `character_sheet_adoptions`, `rolls`, `decisions`, `xp_evidence`, `proficiency` and `proficiency_outbox`, and the COMMENT ON FUNCTION text for `sheet_erase_life(TEXT)`. The retention wording now says erased for every life of a deleted owner account, alive or dead (decisions 0262 and 0282). Writes the ledger row `0052`.
- `sql/0051_character_audit.sql` is not edited. Applied migrations stay immutable.
- `sheet_erase_life` is not changed. It deletes by `life_id` only and has no alive-only condition, so it already erases any life id it is given.
- `sql/test/check-schema-character-audit.sql` (the existing 0051 audit check, already wired in the sql lane of `.github/workflows/ci.yml`): a new step asserts that the six tables and the function say `alive or dead` and no longer carry the 0051 dead-life wording.
- `tools/migrate/src/migrate.test.ts`: `0052_character_erase_comments.sql` added to the expected migration list, after `0051`.
- `docs/decisions/0282-sheet-erasure-covers-dead-lives.md` and its row in `docs/decisions/README.md`.

## Not run

- No psql and no Docker in this session. The SQL was not executed. CI's sql lane is the first run of migration 0052 and of the new step in the audit check.

## Index

- `sql/README.md` has no per-migration index. It has prose only, so no `0050`, `0051` or `0052` line was added there. Adding an index is a separate change if one is wanted.

## Follow-ups

- geldar-registration calls `sheet_erase_life` for every life of a deleted owner, not only the alive ones. That change lives in its own card.
- Any future table keyed by `life_id` joins `sheet_erase_life` in the card that creates it (decision 0282, rule 3).
- The events rows of erased lives remain the open question recorded in 0171.
