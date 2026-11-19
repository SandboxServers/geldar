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
- The handlers are one-line delegates to package-private seams that take entities: `damage(victim, damager, now)` (the
  `enabled` check, `shooterOf`, `isPlayerHurt`/`isPlayerHit`, the UUID, name, world and type reads, then `playerHurt` or
  `playerHit`) and `death(dead, now)` (the `enabled` check, the Player branch, the `getKiller()` null handling, then
  `playerDied` or `mobDied`). `EntityType.getKey().getKey()` works without a server, so `getType()` is answered by a
  `Proxy` double (`EntityType.ZOMBIE`, `SKELETON`, `ARROW`, `PLAYER`). The `tripwire` double throws on any call, so a
  seam that reads an entity while disabled fails its test. The `@EventHandler` priority `MONITOR` and
  `ignoreCancelled = true` on both handlers are pinned by reflection.
- Projectiles: a ranged hit is credited to its shooter (`shooterOf`), so a skeleton's arrow opens a hostile encounter
  against the player and a player's bow hit sends `engaged`. A projectile with no living shooter is not a hostile hit.
- Toggling: the `enabled` supplier gates every handler and seam, but disabling does not reset the tracker. Encounters
  open when it goes off stay open; `tick()` is silent while disabled, and after re-enabling it may emit a stale
  `fight_survived` for them (including for a player who died while disabled). This is reachable only if the supplier
  toggles at runtime. Pinned by `theTickIsSilentWhileDisabledAndAnOpenEncounterClosesOnReenable`; no code change.
- Deviation: `EventExporter.emit` adds a `player` property to every payload (as `death-event` also carries). The envelope
  payload therefore has five keys: `life_id`, `kind`, `mob`, `encounter_key` and `player`. The listener builds exactly the
  four. The test asserts the five and says why.
- Open item: payload vs combat-fact schema (extra `player` key from EventExporter). The schema has
  `additionalProperties: false` and no `player`, so the real payload does not validate against it; the test checks the
  envelope only. Owner ruling: option (a), an optional `player` property in `combat-fact-event.schema.json`, shipped on
  branch `phase1/sheet-an-46b-combat-player` @ `46ebfa53`, not yet merged. Follow-up, once AN-46b is on main: validate
  `e.payload()` against `combat-fact-event.schema.json` in `aRealShapedKillEmitsOneValidFactWithTheFourKeys`, require the
  life part of `encounter_key` to equal `life_id`, and carry `player` in the AN-47b `combat_fact_kill` fixture. The
  five-key assertion stays until then.
- Mutation proofs (each run as one line changed in `CombatFactListener.java`, the class test run, the file restored from
  a backup with a hash check afterwards). Killed, with the test that fails:
  - A `playerHurt` drops `isHostile`: `nonHostileMobsOpenNothingAndEmitNothing`.
  - B `mobDied` drops `isHostile`: `nonHostileMobsOpenNothingAndEmitNothing`.
  - C `tick()` drops `enabled`: `theTickIsSilentWhileDisabledAndAnOpenEncounterClosesOnReenable`.
  - F `playerHit` drops `isHostile`: `nonHostileMobsOpenNothingAndEmitNothing`.
  - G `playerDied` no longer calls `tracker.playerDied`: `aPlayersDeathClosesTheirOpenEncounterWithNoFact`.
  - I `playerHurt` drops `enabled`: `aHurtWhileDisabledOpensNothing`.
  - K `playerDied` drops `enabled`: `aDeathWhileDisabledKeepsTheEncounterOpen`.
  - L `combatJson` world and player swapped: `theFirstHitOfAnEncounterSendsOneExactEngagedMessage`.
  - M `tick()` advances at tick 0: five tests, including `tickClosesAQuietEncounterAfterMoreThanTwoHundredTicks`.
  - N `combatJson` mob replaced by the player name: `theFirstHitOfAnEncounterSendsOneExactEngagedMessage`.
  - Earlier, from part 2: `mobDied` killer filter (`aHumanNamedPlayerEmitsNothing`) and `playerHit` `isLifeId`
    (`aHumanNamedPlayerEmitsNothing`).
  - Handler glue (review 2, mutants on the seams; each run as one line changed, restored and hash-checked):
    - S6 `damage` reads `damager` instead of `shooterOf(damager)`: `aSkeletonsArrowHittingAPlayerIsOneSkeletonEncounter`
      and `aPlayersArrowHittingAZombieSendsOneEngagedMessage`.
    - S7 `damage` drops its `enabled` check: `theHandlerSeamsDoNothingWhileDisabledAndReadNoEntity` (tripwire doubles).
    - S8 `death` drops its `enabled` check: `theHandlerSeamsDoNothingWhileDisabledAndReadNoEntity`.
    - S9 `death` Player branch disabled: `aPlayersDeathThroughTheHandlerSeamClosesTheEncounter`.
    - S14 `shooterOf` rewritten as `getShooter() != null` then a cast: `aProjectileShotByADispenserStaysTheProjectile`.
  - Equivalent, not killed: H `playerDied` drops `isLifeId`. The tracker closes only encounters of the named player, and
    the hurt and hit seams never open one for a non-life name, so the mutant is behaviourally identical. The test
    `aDeathOfAnotherNameLeavesALivesEncounterOpen` pins the behaviour and does not kill it.

## Index line for AN-50a

- `all.add(new CombatFactListener(exporter, sink, enabledSupplier, worldTickSupplier));` in `GeldarCore`'s listener list
  (it needs the `EventExporter` and a `ProvenanceSink`, both already present for AN-47a's sink).
- A once-per-tick task that calls `combatFactListener.tick()`.

Ops capture pending: a real kill and a real survived payload before AN-47b fixtures freeze.