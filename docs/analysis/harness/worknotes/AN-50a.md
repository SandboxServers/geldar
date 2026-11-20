# AN-50a worknote: combat, exchange and take evidence registration

Branch `phase1/sheet-an-50a-evidence-registration-v2`. True base: `origin/main` at `8d420e0d`, which holds AN-28c
(PR #817, #818) and AN-28c2 v2 (PR #819). This branch is merged with it (merge `c1bafcbb`), so `git diff origin/main...HEAD`
lists 16 files: the AN-50a changes, `RegisterWiringGuardTest.java` (created by AN-28c2, extended here) and the three docs
corrected in review 2. `GeldarCoreTest.java` is back to its origin/main content, so it is not listed. The AN-28c2 `AN-28c.md` and `build.gradle.kts` changes are on main, not in this diff.
Paper-only; do not enable on NeoForge until the human-handling question is decided.

## What changed

- `eventsink/src/xp/awards.ts`: `case 'combat_fact': return combatFactAwards(payload, award);` before `default`.
- `eventsink/src/writer.ts`: one `ExchangeTracker` per `pgEventWriter`; its `awardsFor(event)` replaces the stateless call
  (the tracker already returns the stateless awards, so appending would count a give or craft twice).
- `eventsink/src/xp/combat.test.ts`: `combat_fact_kill` now gives one key (the intended AN-50a change, not a weakened check).
- `eventsink/src/xp/evidence-table.test.ts` (new): every active XP row gives exactly one key on both paths; flee by combat
  fact, flee by action and one-way overheard speech give `[]`. The overheard test binds both names and gives each heard line
  its own text, so the speaker guard (`exchange.ts`, `if (speaker === pair.opener || pair.qualified)`) is what it tests.
- `eventsink/src/writer.test.ts`: `exchange is active` and `an exchange is paid across two batches on one writer`.
- `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java`: `register` installs the take listener through
  `containerTakeListener(sink, cache, ProvenanceGate gate, tick, nextTick)` with `setup.gate`. `combatFacts(exporter, tick)`
  is the one public combat entry point; it calls the package-private `combatFactListener(exporter, sink, gate, tick)`, which
  builds `new CombatFactListener(exporter, sink, gate::on, tick)`. No accessor exposes the gate or the sink.
- `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java`: `CombatFactListener combat = owners.combatFacts(exporter,
  Bukkit::getCurrentTick)`, registered once, ticked once (`runTaskTimer(this, combat::tick, 1L, 1L)`).
- `plugin/core/src/test/java/dev/geldar/core/blockowner/RegisterWiringGuardTest.java` (from AN-28c2, extended here): each seam
  call exactly once; comments and literals removed before matching; `ContainerTakeListener` and `CombatFactListener` are
  constructors only a seam may build; `GeldarCore` checked by `geldarCoreViolations` (one `owners.combatFacts(` call, one
  combat registration, one tick); `combatFacts()` must hand the gate to `combatFactListener`. Each rule has a synthetic test.
- `GeldarCoreTest.java` and `ProvenanceWiringTest.java`: the exact-text count guards for the take and combat listeners are
  deleted. The extended guard covers the same facts (construction count, gate argument, one registration, one tick).
- `ProvenanceWiringTest.java` (review 2): the take tests (`takeSilentWhenProvenanceOff`, `takeSendsWhenBothOn`,
  `takeSilentWhenBlockOwnerOff`) and the combat matrix (`combatSilentBeforeReload`, `combatSilentWhenProvenanceOff`,
  `combatPublishesWhenBothOn`, `combatSilentWhenBlockOwnerOff`). The matrix builds the listener through
  `BlockOwnerSetup.combatFactListener` and calls the package-private publish paths by reflection. `GeldarCoreTest.java`
  loses its combat case, which built the listener itself and so guarded nothing AN-50a added.
- `CombatFactListener.java`, `ContainerTakeListener.java`: one-line javadoc edits (review-1 finding 5), outside the packet's
  may-edit list.
- `docs/runbooks/block-owner.md`, `docs/runbooks/capture-real-payloads.md`, `docs/reference/geldar-core-plugin.md`: stale
  sentences about combat and take registration corrected (review-2 finding 3; see the index section).

## Revert-checks (card list)

Run in this session unless marked. Each mutant was applied to one file, the named tests were run, and the file was restored
from a scratchpad backup (`git diff --stat` empty after each; restore verified by hash).

1. Delete the `combat_fact` case (`awards.ts`). Recorded in an earlier AN-50a run, not re-run this session:
   `FAIL one combat key per encounter > the Body kill and the plugin kill of the same mob give the same single key`,
   `AssertionError: expected [] to have a length of 1 but got +0`.
2. Register `ContainerTakeListener` twice (`BlockOwnerSetup.java`, second registration with no space before the paren):
   `RegisterWiringGuardTest > register() hands setup.gate to every seam ... FAILED`,
   `expected: <[]> but was: <[register() calls containerTakeListener( 2 times, not once]>`.
3. Exchange tracker flee key (`awards.ts`: an action event yields `flee:<id>`). Recorded in an earlier run, not re-run:
   `FAIL inactive rows give nothing > a flee action gives []`, `expected [ { lifeId: 'ag_kestrel_01', ...(4) } ] to deeply equal []`.
4. Drop the exchange path, three writer mutants (`writer.ts`), `writer.test.ts`:
   - (a) stateless `awardsFor` only (`const exchange = { awardsFor };`, with import): FAIL `an exchange is paid across two
     batches ...`, `AssertionError: expected [] to have a length of 2 but got +0`.
   - (b) tracker built inside `insertBatch` (`new ExchangeTracker().awardsFor(event)`): same failure as (a).
   - (c) stateless appended to the tracker's awards: FAIL `exchange is active: a give award is produced once, by the tracker,
     never twice`, `AssertionError: expected [ ...(2) ] to have a length of 1 but got 2`.
5. Take seam handed `() -> setup.enabled`. The seam takes `ProvenanceGate`, so that lambda does not compile: the mutant fails
   `compileTestJava` at `ProvenanceWiringTest.java:200` (`ProvenanceGate cannot be converted to BooleanSupplier`). The
   compile-valid variant (`new ProvenanceGate()` with `/* setup.gate, */` in the comment) is caught by
   `RegisterWiringGuardTest > register() hands setup.gate ...`:
   `expected: <[]> but was: <[register() builds its own ProvenanceGate, register() passes containerTakeListener( something
   other than setup.gate as argument 2]>`.
5b. Combat seam, blockowner-only switch (`combatFacts()` returns `new CombatFactListener(exporter, link, () -> enabled, tick)`):
   `RegisterWiringGuardTest > register() hands setup.gate ... FAILED`, `expected: <[]> but was: <[combatFacts() does not hand
   the gate to combatFactListener(, new CombatFactListener( outside a seam]>`.
6. (review 2) Combat seam switch `gate::on` replaced by `() -> true` in `BlockOwnerSetup.combatFactListener`:
   `ProvenanceWiringTest` FAILED 3 of 15: `a combat fact sends nothing before the first reload`, `a combat fact is silent when
   blockowner.enabled is true and provenance.enabled is false`, `a combat fact is silent when blockowner.enabled is false and
   provenance.enabled is true`. Restored by hash.
7. (review 2) The three combat lines in `GeldarCore.java` (`owners.combatFacts`, `registerEvents`, `runTaskTimer`) deleted:
   `RegisterWiringGuardTest > GeldarCore takes its combat listener from the owner's combatFacts(), and registers and ticks
   it once` FAILED (1 of 35). `GeldarCoreTest` still passes: the matrix does not reach `GeldarCore`, which needs a server.
Also run: a second combat construction in `GeldarCore` (`RegisterWiringGuardTest`, `foreign scan` and `GeldarCore takes its
combat listener ...`: `GeldarCore builds CombatFactListener itself`); a removed take registration (`register() does not call
containerTakeListener(`); the overheard mutant (`exchange.ts` speaker guard replaced by `if (pair.qualified)`):
`evidence-table.test.ts > an overheard line that is not a reply ... FAIL`, `expected [ { lifeId: 'ag_ann', ...(4) }, ...(1) ]
to deeply equal []`.

## Gaps

- Combat gate behaviour: driven in `ProvenanceWiringTest` (the four `combat*` tests). It goes through
  `BlockOwnerSetup.combatFactListener`, the seam `combatFacts()` calls, and calls the package-private publish paths
  (`playerHurt`, `playerHit`, `mobDied`) by reflection. Not driven: `GeldarCore`'s own wiring (the `combatFacts` call, its
  `registerEvents` and its tick). That needs a server, so `RegisterWiringGuardTest` checks it by source (mutant 7).
- Evidence table: 8 active rows, flee (fact and action) and one-way overheard speech are covered. Not covered: third-party
  gift, break and take rows; promise (AN-48, deferred); estimates.
- The `writer.projection.test.ts` file mocks `./xp/awards.ts`, so it cannot check give or craft rules.
- No live lane run. `live: pending`.

## Index section (Fix note 6)

- Index line: `AN-50a | phase1/sheet-an-50a-evidence-registration-v2 | <final head sha, see the packet report> | no decision |
  worknote AN-50a.md`.
- AN-47a's index (`CombatFactListener` registered and ticked): done. It deviates in one place: the listener is built through
  `BlockOwnerSetup.combatFacts(...)` (it needs the owner's link and gate), not in a `listeners()` list in `GeldarCore`. The
  call sits at `GeldarCore.java` after the owners are created.
- AN-47b's index (`case 'combat_fact'`): done in `awards.ts`.
- AN-49's index (sink-held `ExchangeTracker` replacing the stateless call): done in `writer.ts`.
- AN-51a's index (`ContainerTakeListener` registration): done in `BlockOwnerSetup.register`.
- Docs corrected in this branch (review 2, finding 3): `docs/runbooks/block-owner.md` (the `provenance.enabled` paragraph),
  `docs/runbooks/capture-real-payloads.md` (item 3) and `docs/reference/geldar-core-plugin.md` (the `provenance.enabled` row)
  now say: with `provenance.enabled` and `blockowner.enabled` both true the plugin publishes break, pickup, take and combat
  provenance messages; `CombatFactListener` is registered and ticked in `GeldarCore`, `ContainerTakeListener` in
  `BlockOwnerSetup.register`; all are inert while the flag is false.
- AN-50b: the subscriptions and the leakage gate are still its job; the plugin publishes `take` and `combat` when both keys
  are on.
