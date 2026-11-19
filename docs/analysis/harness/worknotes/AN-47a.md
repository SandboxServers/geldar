# AN-47a worknote: combat facts in the plugin

Status: part 1 done (core-common tracker, hostile list, combat provenance JSON). Part 2 pending: the Paper listener
`CombatFactListener` and `CombatFactListenerTest` in `plugin/core`, with the `isLifeId` filter.

## Corrections to the card

- Step 0 paths: `ProvenanceSink` is at `plugin/core-common/src/main/java/dev/geldar/core/blockowner/ProvenanceSink.java`
  (it has `void send(String tail, String json);`). `ProvenanceJson.java` and `breakJson` did not exist. Part 1 creates
  `ProvenanceJson.java` with only `combatJson`.
- The combat schema `contract/schemas/combat-fact-event.schema.json` contains `"life_id"`.
- `HostileMobsTest` reads `geldar.schemas` as the card says; `plugin/core-common/build.gradle.kts` already sets it for
  the core-common test task. No new mechanism.
- Provenance schema check: `EventSchemaCheck` validates only `event.schema.json`, so `ProvenanceJsonTest` carries its own
  small loader of the same shape for `provenance.schema.json`.

## Files (part 1)

- `plugin/core-common/src/main/java/dev/geldar/core/combat/EncounterTracker.java` (new)
- `plugin/core-common/src/main/java/dev/geldar/core/combat/HostileMobs.java` (new)
- `plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceJson.java` (new)
- `plugin/core-common/src/test/java/dev/geldar/core/combat/EncounterTrackerTest.java` (new)
- `plugin/core-common/src/test/java/dev/geldar/core/combat/HostileMobsTest.java` (new)
- `plugin/core-common/src/test/java/dev/geldar/core/provenance/ProvenanceJsonTest.java` (new)

## Revert-checks (part 1)

Each run against the committed code, with one line mutated in `EncounterTracker.java` and the file restored from a
backup afterwards (`git diff --stat` empty after each restore).

1. Key by tick: `touch` slot becomes `player|mob|tick`. Fails: `perTickDamageKeepsOneEncounter` and five others.
2. Killer only: the kill credit goes to the last damager of the mob. Fails: `multipleAttackersCreditOnlyTheKillerNotTheLastDamager`.
3. Died emits nothing: `playerDied` leaves the encounter open and aged so `advance` closes it. Fails:
   `playerDeathEmitsNothingForItsEncounters`.
4. The `isLifeId` check: part 2 (listener filter).

## Index line for AN-50a

Part 2 pending. The expected registration lines are `all.add(new CombatFactListener(...))` and the tick task; they are
written in part 2's worknote update.
