# 0282. Sheet erasure covers the dead lives of a deleted owner

- Status: Accepted (owner ruling, 2026-11-15, relayed by geldar-registration as its decision 0262).
- Date: 2026-11-14
- Spec: none. This is a contract record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: 0171 (account erasure, point 2 superseded here), 0280 (proficiency contract and state subjects), 0281 (psyche package boundary); migrations `sql/0051_character_audit.sql` (the erase function and the guard) and `sql/0052_character_erase_comments.sql` (the comments that state this rule); geldar-registration decision 0262

## Context

Decision 0171, point 2, kept the public thoughts, events and death records of dead lives as world history with the owner link removed. The character-sheet tables were written under that rule: `sql/0051_character_audit.sql` comments say that rows of dead lives stay with no owner link, and `sheet_erase_life` was called only for lives that were alive when the owner deleted the account.

The owner ruled on 2026-11-15 (geldar-registration decision 0262) that when an owner account is deleted, everything about all of that owner's lives is erased, dead or alive. That includes the six life-keyed sheet tables. The ruling supersedes 0171 point 2 for the sheet tables, and the 0051 comments that repeat it are wrong. Applied migrations are immutable, so the comments are corrected in a new migration and not by editing 0051.

## Decision

1. **Every life is erased.** `sheet_erase_life` is called for every life of a deleted owner account, alive or dead. The erase covers `rolls`, `decisions`, `xp_evidence`, `character_sheet_adoptions`, `proficiency` and `proficiency_outbox`.
2. **The signature is stable.** `sheet_erase_life(p_life_id TEXT)` keeps its name, its argument and its grant to `geldar_register`. It deletes by life id only and has no alive-only condition.
3. **New life-keyed tables join the erase in the same card.** Any future table keyed by `life_id` must be added to `sheet_erase_life` in the same card that creates it, with its comment saying it is erased for every life of a deleted owner account, alive or dead. geldar-registration is told in that card.
4. **Events are unchanged.** The public events rows of an erased life stay, as the 0171 open question on events of retired lives still records.

## Why

- The owner's ruling is the account-deletion promise: a deleted owner leaves no sheet data behind, whether the life was alive or dead.
- Keeping one function that erases by life id means the deletion path does not need to know whether a life is alive. It only needs the owner's list of lives.
- A table added later and left out of the erase would keep owner data after deletion. Rule 3 closes that gap.

## Consequences

- geldar-registration calls `sheet_erase_life` for every life of the owner, not only the alive ones. Its deletion path changes in its own card.
- `sql/0052_character_erase_comments.sql` changes comments only. The database behaviour is the same as after 0051.
- The CI schema check `sql/test/check-schema-character-audit.sql` asserts that the comments carry the new wording and not the 0051 wording.
- The erase is not a new export or audit row. Logs nothing, as in 0051.

## Not decided here

- The events rows of erased lives: the 0171 open question stays open.
- The export format of the sheet tables (C7-09).
