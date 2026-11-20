# AN-47b: combat key, the Body's kill pays the encounter key

Packet: docs/analysis/harness/work-packets-sheet-w6-w8.md, section AN-47b. Branch `phase1/sheet-an-47b-combat-key`.
Decisions: D-CS-04, 0321 (the encounter key). AN-46 provides `encounterKey` and `validateCombatFactPayload`.

## What changed

- **Body (golem).** `golem/src/actions/attack.ts` reads the target entity's `uuid` and puts it in the completed kill detail as `target_uuid`, only when it is a string. Nothing else changes.
- **Sink (eventsink).** `eventsink/src/xp/combat.ts` (new): `killKey` (the encounter key of a kill's `target_uuid`, or null) and `combatFactAwards` (one award per encounter from a `combat_fact` payload). `awards.ts`: the `attack` row pays `killKey` instead of `kill:<action_id>`; `Award` is exported for AN-50a.
- **Fixtures.** `kill_uuid_completed` and `combat_fact_kill` in `fixtures.ts` are HAND-BUILT (the comment above them says so). Both pass `validateWorldEvent`. The `combat_fact_kill` payload carries `player: "Kestrel"` as the Paper payload does.
- **Tests.** `combat.test.ts` (new), `awards.test.ts`, `attack.test.ts`.

## Known effect

A completed kill whose record has no `target_uuid` (records written before this card, or a mob mineflayer gave no UUID) awards nothing from the attack row. The combat fact still awards it when the plugin source is on. Keys already in `xp_evidence` (`kill:<action_id>`) stay; there is no SQL.

## Index line for AN-50a

`case 'combat_fact': return combatFactAwards(payload, award);`

AN-50a adds this case arm. Nothing registers `combat_fact` in this card; the test `no awards row registers combat_fact yet` pins that.

## Inert and gated

- Nothing registers `combat_fact` yet (AN-50a owns the case arms), so no XP changes from the plugin source in this card.
- Paper-only data path; do not enable on NeoForge until the human-handling question is decided (the plugin combat_fact source).

## Body benchmark note (geldar-8a)

The Body change (`attack.ts` adds `target_uuid` to the kill detail) runs only on a completed kill. It does not change what agents see: the detail field is not in any agent-facing text. It is Body code (attack.ts), so the body-benchmark question geldar-8a tracks should count it as a Body change.

## Owed

- A real-payload capture of `combat_fact` from the Paper plugin is owed by ops. The two fixtures are hand-built until then.

## Contract (Step 0)

`contract/` is not edited. `encounterKey` is reached through `contract/src/index.ts` `export * from './perception-events.ts'`, which re-exports `encounterKey` from `evidence.ts` (AN-46). The literal grep for `encounterKey` in `index.ts` finds nothing because the line is a star export. Intent of Step 0 is met.

## Revert-checks (run on the committed state, each restored from a scratchpad backup)

1. `eventsink/src/xp/awards.ts`: attack case restored to `` `kill:${id}` ``. "one fight, one row" fails: `expected [ true, true ] to deeply equal [ true, false ]` (two evidence rows, xp 2, in both orders). Result: as specified.
2. `eventsink/src/xp/combat.ts` life check, single line: removing `if (!key.startsWith(prefix)) return [];` alone does NOT fail any test. The equality check `encounterKey(lifeId, uuid) === key` rejects the other life's key too. So the life check is two guards, not one line.
2b. Both guards removed (the prefix check and the equality, leaving `return award('combat', key);`): "gives [] for another life's key, even a valid one" fails, and "gives [] for a key that is not the life and UUID form..." fails. Result: the test is sensitive to the life check as a whole. Single-line result recorded as a finding.
3. `eventsink/src/xp/combat.ts` `killKey` passes `target_uuid` through unchanged (no `encounterKey`): "gives the lowercase encounter key of an uppercase target_uuid" fails, and "gives null for a target_uuid that is not a UUID" fails. Result: as specified.
4. `golem/src/actions/attack.ts`: the `target_uuid` line removed from the kill detail: "puts the target entity UUID in the kill detail as target_uuid" fails. Result: as specified.

## Checks

- `tsc -p eventsink --noEmit`, `tsc -p golem --noEmit`: clean.
- `biome check` on the seven changed files: clean.
- `pnpm test eventsink/src/xp golem/src/actions/attack`: 8 files, 247 tests passed.

## Review 1 mutations (AN-47b-fix-1: tests only, no source change)

Each mutation was run on the fix commit, then the file was restored from a scratchpad backup; `git diff --stat` was empty after each restore. Baseline after the new tests: 251 passed.

- `awards.ts` attack case, `detail.killed === true && detail.target_kind === 'mob'` -> `detail.target_kind === 'mob'`: 1 fails ("a kill needs killed true, not only a mob target").
- Same line -> `detail.killed === true`: 2 fail (the two "target_kind" combat-row tests with a target_uuid).
- Same line -> `true`: 3 fail (the two above, plus the killed test).
- `combat.ts` `combatFactAwards`, `encounterKey(...) === key` -> `encounterKey(...) !== null`: 1 fails ("gives [] for an uppercase UUID in the key").
- `attack.ts` `typeof first.uuid === 'string' ? first.uuid : null` -> `(first.uuid as string | undefined) ?? null`: 1 fails ("leaves target_uuid out when the mob uuid is not a string").
