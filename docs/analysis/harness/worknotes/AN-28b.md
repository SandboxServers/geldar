# AN-28b: Body subscription and the leakage gate

Status: built on `phase1/an-28b-observation-wiring` (base `d0ae058d`). Off by default: nothing in
production sets `AdamBodyEnv.observations`, and `main.ts` and `body-host.ts` are unchanged.

## Files

- `golem/src/perception/provenance/subscribe.ts` (new): `startObservations` subscribes to
  `provenanceBreakSubject` and `provenancePickupSubject` with a plain `{ callback }` (no replay). A
  message over 4096 bytes, one that fails `validateProvenance`, or one of the wrong kind for its subject
  is dropped with a counter and one log line (no content, no name). A break or pickup in a world other
  than `bukkitWorldOf(bot)` is ignored. Breaks go to `observeBreak` with a `TakeKeyLru`; pickups go to
  `observeGift` with a `Set<string>`. A result becomes an `observation` WorldEvent with
  `source_event_id = eventIdFor('observation:' + lifeId + ':' + key)`, checked by `validateWorldEvent`,
  and published on `geldar.<shard>.observation` (a publish failure is logged). `startBodyObservations`
  is the Body's wiring: selfName = life id, `observedActor` for names, `canSeeBlock` for sight.
- `golem/src/perception/provenance/subscribe.test.ts` (new, 13 tests).
- `golem/src/adam/adam-body.ts` (442 lines): `observations?: boolean` on `AdamBodyEnv`. When it is
  `true` and `owners` is set, `watchHurts` gets a fourth argument (`observedActor`) and
  `startBodyObservations` runs; both are stopped in `stop()` and in the failed-start cleanup. Otherwise
  the code path is today's.
- `golem/src/adam/adam-body-observations.test.ts` (new, 5 tests).
- `threshold/mcp/src/events/leakage.test.ts` (new, 5 tests).

## Tests

Golem, `subscribe.test.ts`: both subjects subscribed and stop unsubscribes both; a subscription has
only a `callback` key; a message after stop is ignored; a bad shape is dropped and counted; a wrong
kind for its subject is dropped; an oversize message is dropped unread; a valid break for the owner
publishes one observation event; a break in another world gives nothing, the same world gives one; a
break the Body cannot see gives nothing; a break with an unseen breaker is published unattributed; a
repeated break is published once; a valid pickup publishes one gift; a publish failure is logged, not
thrown.

Golem, `adam-body-observations.test.ts`: observations absent, false, or on without `owners` give no
provenance subscription and `watchHurts` gets three arguments; observations on subscribe both subjects
with no replay option, `watchHurts` gets four, and stop unsubscribes both; a start that fails after
the subscription unsubscribes both.

Threshold, `leakage.test.ts`: a visible breaker and thrower are named, with no life id, key or
coordinate; a hidden breaker and thrower are unattributed, with no `actor` field; the real Body events
(`test/fixtures/real-body-events.json`) replay with no leak; the two injected-leak cases report a life
id and a coordinate.

Deviation: golem is not importable from threshold, so the leakage test does not run the golem
observers over the fake bot. Its observation payloads are built by hand from the shapes of
`golem/src/perception/provenance/fixtures/{break,pickup}-real.json`, with the sight of each actor
decided by the case (a player in sight is named; one out of sight is not). The sight decision is
therefore tested in golem (`subscribe.test.ts`, "a break the Body cannot see gives nothing").
The third-party, unowned and self cases are not repeated here; they rest on the existing
`property-break.test.ts` and `gift.test.ts`, which this packet did not re-read.

## Revert-checks (run for real, on the final code)

Each mutation changed one line; the file was restored from a scratchpad copy afterwards, and
`git diff --stat` was empty before the squash.

1. Default path and "observations off" (`adam-body.ts`):
   `const observeTransport = env.observations === true ? env.owners : undefined;` became
   `const observeTransport = env.owners;`. Failing:
   - `observations off (absent): no provenance subscription and watchHurts gets three arguments`
   - `observations false: the same as absent`
2. Bad shape dropped (`subscribe.ts`): `if (!validateProvenance(msg)) {` became
   `if (typeof msg !== "object" || msg === null) {`. Failing:
   `a provenance message with a bad shape is dropped and counted`.
3. Sight (`subscribe.ts`): `canSee: opts.canSee,` became `canSee: () => true,`. Failing:
   `a break the Body cannot see gives nothing`. The card's "fixture bot sees through the wall" case
   cannot run in threshold; this is its golem-side equivalent.
4. `ag_` scan removed (`leakage.test.ts`): the line
   `if (/ag_[a-z0-9_]+/.test(text)) leaks.push('life id');` was deleted. Failing:
   `an injected life id in an observation is reported as a leak`. The card expected both
   injected-leak cases to fail, but the coordinate case uses its own scan and still passes. Kept as
   written: each scan has its own case.
5. World filter (`subscribe.ts`): `const inWorld = ... === bukkitWorldOf(opts.bot);` became
   `const inWorld = true;`. Failing: `a break in another world gives nothing; the same world gives one`.

Both the default path and the world filter are in the list above (1 and 5).

## Index lines

None for `ledger.md` or `RESUME.md`. The worknote is the only index entry for this packet.

## Final checks

- `pnpm exec biome ci .`: exit 0 (2345 files; 75 warnings and 38 infos repo-wide, none failing).
- `pnpm exec tsc --noEmit -p golem`: exit 0.
- `pnpm exec tsc --noEmit -p threshold/mcp`: exit 0.
- `pnpm exec vitest run golem/src/perception/provenance golem/src/adam threshold/mcp/src/events`:
  40 files, 434 tests passed.
- `./geldar.ps1 pnpm check:repo`: no `error:` lines.
- `git diff --check`: clean.
