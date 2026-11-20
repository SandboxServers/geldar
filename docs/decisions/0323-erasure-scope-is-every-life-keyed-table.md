# 0323. Erasure scope is every life-keyed table; OD-12 confirmed

- Status: Accepted (operator ruling, 2026-11-18)
- Date: 2026-11-18
- Spec: none. A campaign record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: 0171, 0262 (account deletion erases every life), 0282 (sheet erasure covers dead lives; not amended); `sql/0040_account_deletion_all_lives.sql`, `sql/0051_character_audit.sql`; card S9-00 in [work-packets-sheet-w9-w12.md](../analysis/harness/work-packets-sheet-w9-w12.md)

## Context

S9-00 is a CI gate: every public table with a `life_id` column must be erased with its life. As written it checks `sheet_erase_life` only, which covers the six sheet tables, so it fails on main: the other life-keyed tables (`mcp_players`, `mcp_budget`, `mcp_journal`, `mcp_sleep_marks`, `mcp_life_deaths`, `mcp_death_events`, `actions`, `intents`, `skill_runs`, `turn_records`) are erased by `register_account_delete` (0040) or not at all. `turn_records` (0060) is in neither function. OD-12 asked to confirm that account erasure also removes the sheet rows of an owner's dead lives.

## Decision

1. **The erasure scope is every life-keyed table, not only the sheet tables.** S9-00 checks that each public table holding a life id is erased, for every life of a deleted owner account, by `sheet_erase_life` or by `register_account_delete`. The card fixes the column list and how a derived erase counts (for example `mcp_journal`, erased by ids collected from the lives).
2. **`turn_records` is a real gap.** It is life-keyed and in neither function. It is fixed in its own card (a new migration that adds it to the account-deletion path), and S9-00 does not pass until that fix has merged.
3. **OD-12 is confirmed: 0282 as merged.** Account erasure removes the sheet rows of every life of the owner, alive or dead. 0282 is not amended.

## Consequences

- S9-00 is corrected before dispatch to option (b) of the verification note (the union of both erase functions).
- The `turn_records` fix needs a migration number from the registry (0053 is free in the sheet block) and the owner of `turn_records` is told.
- 0282 rule 3 still holds for sheet tables. A new life-keyed table outside the sheet must join one of the two erase functions in the card that creates it, or S9-00 fails.
- OD-12's sub-question (a deleted parent's child loses the ancestry edge) is moot while there are no births (0327).
