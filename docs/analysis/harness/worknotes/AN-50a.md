# AN-50a worknote: combat, exchange and take evidence registration

Branch `phase1/sheet-an-50a-evidence-registration`, on top of AN-28c (`phase1/an-28c-provenance-setup-acl`, merged at `27c86a49`).
Paper-only; do not enable on NeoForge until the human-handling question is decided.

## What changed

- `eventsink/src/xp/awards.ts`: `case 'combat_fact': return combatFactAwards(payload, award);` before `default`; the `awardsFor`
  doc comment names `combat_fact`.
- `eventsink/src/writer.ts`: one `ExchangeTracker` per `pgEventWriter`; its `awardsFor(event)` replaces the stateless one
  (the tracker already returns the stateless awards, so appending would count a give or craft twice).
- `eventsink/src/xp/awards.test.ts`: `describe('one combat key per encounter')`, two cases.
- `eventsink/src/xp/combat.test.ts`: one assertion changed. It asserted that `combat_fact_kill` gives `[]` (the case arm
  was owned by AN-50a). It now asserts that `combat_fact_kill` gives one key, the same key as `kill_uuid_completed`. This is
  the intended AN-50a change, not a weakened check.
- `eventsink/src/xp/evidence-table.test.ts` (new): every active XP row gives exactly one key on both paths; the inactive
  rows (flee by combat fact, flee by action, one-way overheard speech) give `[]`.
- `eventsink/src/writer.test.ts`: `exchange is active: a give award is produced once, by the tracker, never twice` (a real
  `give_completed` fixture, one `xp_evidence` insert and one `proficiency` insert).
- `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java`: `register` installs the take listener once,
  through the package-private seam `containerTakeListener(sink, cache, BooleanSupplier, tick, nextTick)`, switched by
  `setup.gate::on` (blockowner.enabled and provenance.enabled). The public seam `combatFactListener(exporter, sink, enabled,
  tick)` is the only construction site of `CombatFactListener`. It is public because `GeldarCore` (another package) calls it.
  Accessors `provenanceSwitch()` and `provenanceSink()` give GeldarCore the same gate and the NATS sink.
- `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java`: builds the combat listener through the seam with
  `owners.provenanceSwitch()`, registers it, and ticks it every server tick (`runTaskTimer(this, combat::tick, 1L, 1L)`).
- `plugin/core/src/test/java/dev/geldar/core/GeldarCoreTest.java`: the combat seam is silent while the switch is off and
  publishes one fact once it is on; source-text guards that `CombatFactListener` is constructed once, and that GeldarCore
  registers it once, ticks it once and switches it by `owners.provenanceSwitch()`.
- `plugin/core/src/test/java/dev/geldar/core/blockowner/ProvenanceWiringTest.java`: take listener silent with
  provenance off, one `take` message with both keys on, silent with blockowner off; a source-text guard that the take
  listener is constructed once and registered once with `setup.gate::on`.
- `plugin/core/build.gradle.kts`: `src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java` added to
  `scannedSourceRoots`. Reason: `verifyTestSourceInputs` fails when a test names a src/main path that no entry covers, and
  the two source-text guards name `BlockOwnerSetup.java`. Outside the card's may-edit list; a one-line change, reported.
- `plugin/core/src/test/resources/jar-contents.golden`: unchanged (no new classes).

## Revert-checks (output recorded)

Each mutant was applied to one file, the named test was run, and the file was restored from a backup in the scratchpad
(`git diff --stat` empty after each).

1. Delete the `combat_fact` case (`awards.ts`). `awards.test.ts`:
   `FAIL one combat key per encounter > the Body kill and the plugin kill of the same mob give the same single key`
   `AssertionError: expected [] to have a length of 1 but got +0`. `Tests 1 failed | 123 passed (124)`.
2. Register `ContainerTakeListener` twice (`BlockOwnerSetup.java`, one duplicate `registerEvents` line). Gradle:
   `ProvenanceWiringTest > ContainerTakeListener is built once and registered once, with the provenance gate as its switch FAILED`
   `AssertionFailedError at ProvenanceWiringTest.java:161`. `16 tests completed, 1 failed`.
3. Make the tracker produce a flee key (`awards.ts`: an action event yields `flee:<id>`). `evidence-table.test.ts`:
   `FAIL inactive rows give nothing > a flee action gives []`
   `AssertionError: expected [ { lifeId: 'ag_kestrel_01', …(4) } ] to deeply equal []`. `Tests 1 failed | 10 passed (11)`.
   Note: a first mutant on the `default:` branch was not caught, because unknown event types never reach the action rows.
4. Drop the exchange path, i.e. append the stateless awards to the tracker's (`writer.ts`, with the import). `writer.test.ts`:
   `FAIL pgEventWriter > exchange is active: a give award is produced once, by the tracker, never twice`
   `AssertionError: expected [ …(2) ] to have a length of 1 but got 2`. `Tests 1 failed | 8 passed (9)`.
5. Seam (take): hand `() -> setup.enabled` to the take listener in `register` (`BlockOwnerSetup.java`). Gradle:
   `ProvenanceWiringTest > ContainerTakeListener is built once ... FAILED`, `AssertionFailedError at ProvenanceWiringTest.java:161`.
5b. Seam (combat): replace `owners.provenanceSwitch()` in `GeldarCore.java` with `() -> true`. Gradle:
   `GeldarCoreTest > combatListenerIsBuiltOnceAndRegisteredOnceWithTheProvenanceSwitch() FAILED`,
   `AssertionFailedError at GeldarCoreTest.java:109`. `16 tests completed, 1 failed`.

## Gaps

- The "registered once" tests are source-text guards. Registration happens in `BlockOwnerSetup.register` and `onEnable`,
  which need a live Paper server; no test can count real `PluginManager.registerEvents` calls.
- The combat seam's behavioural test uses a plain `BooleanSupplier`, because `ProvenanceGate` is package-private in
  `blockowner` and `CombatFactListener.playerHurt` / `mobDied` are package-private in `dev.geldar.core`. The
  blockowner-on, provenance-off case at the combat seam is therefore covered by the gate's own tests and the source guard,
  not by a driven test.
- `writer.test.ts` catches the duplicate-append mutant, not a mutant that drops the tracker and uses the stateless
  awards alone. The exchange-window behaviour is covered by the exchange tests.
- The `writer.projection.test.ts` file mocks `./xp/awards.ts`, so it cannot check give or craft rules.
- Index line: the worknote index was not updated in this pass (its location was not checked within the budget).
- No live lane run. `live: pending`.
