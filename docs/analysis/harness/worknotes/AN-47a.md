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

## Review 1 fixes (part 1)

Rulings from the owner:

- Cap-dropped encounters are not remembered as closed. Nothing was emitted for them, so a fight still going on opens
  fresh and can pay once (the sink dedups by key anyway). `oldest` means oldest opened, not least recently active.
- `playerHitMob` returns `engaged` once per encounter, on the player's first hit, even if the mob hurt the player first.
  Hurt then hit still engages once.
- Shared provenance file: `ProvenanceJson.java` is created here with only `combatJson`. Whichever of AN-27a and AN-47a
  lands second keeps both `combatJson` and `breakJson` in it (AN-27a is already merged without `ProvenanceJson`).

New tests and their mutation proofs (`EncounterTracker.java` mutated, run, restored from a backup; `git diff` checked):

1. `closedKeyBoundRemembers512AndForgetsTheOldest` (513 closes, key 1 still closed, key 0 forgotten):
   - `MAX_CLOSED = 1`: fails at line 163 (key 1 emits again).
   - `MAX_CLOSED = 511`: fails at line 163.
   - `MAX_CLOSED = 513`: fails at line 166 (key 0 stays closed).
   - `MAX_CLOSED = 100000`: fails at line 166.
2. `cappedDropIsNotRememberedSoItOpensFreshAndPaysOnce` (513 opens, touch the dropped key):
   - `rememberClosed(oldest.key())` restored on the cap drop: fails at line 177 (no kill emitted).
3. `hurtThenHitStillEngagesOnce`: passes on the current rule (no code change for it).

## Index line for AN-50a

Part 2 pending. The expected registration lines are `all.add(new CombatFactListener(...))` and the tick task; they are
written in part 2's worknote update.

## Part 2: the Paper listener (`CombatFactListener`)

Files: `plugin/core/src/main/java/dev/geldar/core/CombatFactListener.java` (new), its test, and one line in
`plugin/core/src/test/resources/jar-contents.golden` (the jar test lists every class). Nothing registers the listener;
`GeldarCore.java` and `EventExporter.java` are untouched.

- Events: `EntityDamageByEntityEvent` (player hurt by a hostile: `playerHurtByMob`; player hitting a hostile: `playerHitMob`,
  an `engaged` step goes to `sink.send("combat", ProvenanceJson.combatJson(...))`) and `EntityDeathEvent` (a player's death
  calls `playerDied`; a mob's death calls `mobDied` with the killer only when the killer's name is a life id). Both are
  `MONITOR`, `ignoreCancelled = true`. `tick()` calls `advance`; the registrant schedules it once per tick.
- Every handler and seam checks `enabled` first; a name failing `EventEnvelope.isLifeId` is ignored; non-hostile mob
  types are ignored through `HostileMobs.isHostile`.
- The handlers read the entity (`getType().getKey().getKey()`, UUID, world name) and call package-private seams that take
  strings (`playerHurt`, `playerHit`, `mobDied`, `playerDied`). The tests drive the seams, because entity types need a
  server (same pattern as AN-26a). Ops capture covers the glue lines.
- Deviation: `EventExporter.emit` adds a `player` property to every payload (as `death-event` also carries). The envelope
  payload therefore has five keys: `life_id`, `kind`, `mob`, `encounter_key` and `player`. The listener builds exactly the
  four. The test asserts the five and says why.
- Mutation proofs (the file restored from a backup, `git diff` empty afterwards):
  1. Drop the `isLifeId` filter in `playerHurt`: `aHumanNamedPlayerEmitsNothing` fails (line 55).
  2. Drop the `enabled` check in `mobDied`: `disabledEmitsNothing` fails (line 68).

## Index line for AN-50a

- `all.add(new CombatFactListener(exporter, sink, enabledSupplier, worldTickSupplier));` in `GeldarCore`'s listener list
  (it needs the `EventExporter` and a `ProvenanceSink`, both already present for AN-47a's sink).
- A once-per-tick task that calls `combatFactListener.tick()`.

Ops capture pending: a real kill and a real survived payload before AN-47b fixtures freeze.