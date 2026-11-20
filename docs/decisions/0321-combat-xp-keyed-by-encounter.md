# 0321. Combat XP is keyed by encounter

- Status: Accepted (operator ruling, 2026-11-18)
- Date: 2026-11-18
- Spec: none. A campaign record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: 0280 (proficiency contract; the sink is the only XP writer); D-CS-04 (combat row) in [decisions-before-packets.md](../analysis/character-sheet/decisions-before-packets.md); cards AN-47a, AN-47b, AN-50 in [work-packets-sheet-w6-w8.md](../analysis/harness/work-packets-sheet-w6-w8.md)

## Context

A mob kill already awards combat XP: in `eventsink/src/xp/awards.ts`, `actionAwards` `case 'attack'` awards `combat` with key `kill:<action_id>` when a completed attack has `detail.killed === true` and `target_kind === 'mob'`. AN-47b adds an encounter award with key `combat:enc:<encounter_key>`. The exactly-once ledger (`xp_evidence`, unique per life, domain and evidence key) treats two different keys as two accomplishments, so one fight would award combat XP twice.

## Decision

1. **One encounter, one combat award.** Combat XP is keyed by the encounter.
2. **The `kill:` row and the AN-47b award share one evidence key.** Both produce the same encounter key for the same fight, so the ledger's uniqueness gives at most one combat award per encounter, whichever source arrives first.
3. The `kill:<action_id>` key is replaced by the shared encounter key. A kill and a survived encounter in the same fight are one award (D-CS-04 combat row: "same-encounter kill and survive do not both award").

## Consequences

- AN-47b is corrected before dispatch: it writes the shared key and changes the `kill:` row in `eventsink/src/xp/awards.ts` to the same key, with a test that one fight carrying both a kill attack record and an encounter end yields one `xp_evidence` row. AN-50a stays the owner of the registration `case` arms.
- The card fixes the exact key format and how the Body's attack record and AN-47a's encounter tracker agree on it. If they cannot agree on a key from the attack record alone, the card stops and the planner asks.
- Rows already written with `kill:` keys are not rewritten. The feature is held on the live server (2026-11-15 held-live ruling), so none is expected outside test runs.
- The NeoForge kill-credit difference (OD-NF-4) and progression's "combat is never awarded" (OD-NF-8) are not ruled here.

## Not decided here

- The rest of D-CS-04 (other domains, crop list, torchflower and pitcher gap).
- `FIGHT_END_TICKS` (200) and the encounter cap (512), unmeasured parameters.
