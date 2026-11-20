# AN-50b: the Body subscription to take and combat evidence, and the leakage gate

Status: the Body now subscribes to `provenance.take` and `provenance.combat` as well as break and pickup, with
the same drops, the same world filter, and per-subscription dedupe. Nothing turns it on: `observations`
stays absent in every production config (`adam-body.ts` is unchanged).

## Files

- `golem/src/perception/provenance/subscribe.ts` (250 lines, unchanged in review 1): four channels (`break`,
  `pickup`, `take`, `combat`). `carries(channel, msg)` pins each subject to its record: a take has no `kind`
  and only the take subject takes it; combat is `engaged` or `killed` and only the combat subject takes it.
  The world filter (`msg.world === bukkitWorldOf(bot)`) runs before every observer, and the world is passed to
  `observeFight`. Take and fight are dated on `worldAge`; with no age they are not observed. One `TakeKeyLru`
  for takes and one `FightWindows` per subscription.
- `golem/src/perception/provenance/subscribe.test.ts` (577 lines): the four-subject expectations; the wrong-kind
  test covers all 12 pairings; the partial-subscribe test covers a failure at call 2, 3 and 4; a take and a
  combat record with a bad shape are dropped as malformed at the subscription.
- `golem/src/perception/provenance/subscribe-evidence.test.ts` (526 lines): the evidence rows, guards,
  wrong-subject drops, the take-vs-break LRU separation, the leakage scan over every published body, and
  injected leaks per scan (including an uppercase `AG_` id).
- `golem/src/perception/provenance/subscribe-fight-wiring.test.ts` (new, 67 lines): the fight observer is called
  with the Body's world. It uses `vi.mock('./fight-seen.ts')`, so it checks the argument itself, not the filter
  in front of it.
- `golem/src/perception/provenance/leakage-scan.ts` (new, 30 lines): `leaksIn`, `HIDDEN_NAME`, `HIDDEN_LIFE`.
  Test-only. The `ag_` scan runs on the lower-cased body.
- `golem/src/perception/provenance/fixtures/take-real.json` (new): the captured chest-single withdrawal from
  `worknotes/AN-51a.md` (capture 73788889, shard phase0, tick 3982), field for field.
- `golem/src/adam/adam-body-observations.test.ts`: expectations only, four subjects.
- `threshold/mcp/src/events/leakage.test.ts` (287 lines): the `fight_seen` and `container_taken` cases through
  `mapMindEvent`, and the scanner self-tests (hand-built objects, named `scanner test:`).

`mind-event.ts`, presenters, `handlers/observation.ts`, `adam-body.ts`, contract, plugin, compose, shards and
docs/spec.md are untouched.

Presenter status (corrected in review 1): `fight_seen` and `container_taken` are mapped by `mapMindEvent` but
present no line. `handlers/observation.ts` sets `observationKind` only for `gift_received` and
`property_broken`, and the presenter returns nothing for an observation without one
(`handlers/observation.test.ts`, "maps and presents no line"). No presenter text was added. The card's
`container_taken` revert-check is therefore satisfied at the mapper output and at the scanner, not at a
presenter. The threshold tests assert `presented(...)` is `[]` for both kinds, and assert the real mapper
output with `leaksOf`. If the owner wants these kinds shown to the agent, that is a new presenter text and a
separate decision.

## Evidence table: the four active rows

Each row has a positive, a hidden, a repeat and a restart control in `subscribe-evidence.test.ts`. Restart
creates a new subscription on the same transport and asserts it requested no replay
(`Object.keys(opts) === ['callback']`) and observes the message once more.

| Row | Positive | Hidden | Repeat | Restart |
|---|---|---|---|---|
| gift (AN-26) | `gift row ... positive: a thrower in sight is named, once` | `hidden: a thrower out of sight is unattributed` | `identical pickups in one tick are two observations, keys :0 and :1` (see finding 1) | `restart: ... observes the same pickup once` |
| break (AN-27) | `break row ... positive: a breaker in sight is named, once` | `hidden: a breaker out of sight is unattributed` | `duplicate: the same break twice is one observation` | `restart: ... observes the same break once` |
| take (AN-51) | `take row ... positive: a taker in sight is named ...` | `hidden: a taker out of sight ...`; `hidden: a taker behind a wall is unattributed, though the container is seen` | `duplicate: the same take twice is one observation` | `restart: a fresh subscription has no take keys ...` |
| fight (AN-47c) | `fight row ... positive: a fighter in sight and a mob in view ...` | `hidden: a fighter out of sight ...`; `hidden: a mob behind a wall, out of reach, or no mob of the target type` | `duplicate: the same fight twice, and the same pair a tick later` | `restart: a fresh subscription has no fight windows ...` |

Gift repeat, by design: none. Identical pickups are two observations with ordinal keys `:0` and `:1` (the
count of earlier keys with the same prefix). A restarted subscription starts at `:0` again. This is not a
duplicate control: there is no dedupe for gifts. AN-26b ruling: core NATS has no redelivery, so two identical
pickups are two gifts.

Other guards, each with a test: take and fight in another world give nothing, the same world gives one
(`guards: a take and a fight in another world ...`); a take from a container nobody owns, from another owner,
or taken by the Body gives nothing; a container the Body cannot see gives nothing; a killed message and the
Body's own fight give nothing; with the world age unknown a take and a fight are not observed, nothing throws,
and no contract refusal is logged; a message of the wrong kind for its subject is malformed (all 12
pairings); a take or combat record with a bad shape is malformed at the subscription; after stop nothing is
observed; the take and break LRUs are separate (257 takes do not evict a break key).

Leakage: `leakage scan over every published observation` checks every published body with `leaksIn`
(provenance word, coordinates in the payload fields, `ag_` ids outside the allow-list, hidden name or life in
any case, the key included, `ag_` matched on the lower-cased body). Injected cases prove each scan fires: a
provenance word, coordinates in a payload field (and not in the key), a foreign life id, an uppercase
`AG_ZACK_01` (reported in lower case), an uppercase allow-list entry that still matches, and an uppercase
hidden name or life in the key.

Threshold side (`leakage.test.ts`): the mapped `fight_seen` and `container_taken` events, visible and hidden,
carry no life id, key, coordinate or hidden name (checked over the serialised mapper output, with the
visible name present as a positive control). An input `container_taken` carrying `actor.life` maps to an
event with no life id (the mapper passes only the visible name through, so there is no mapper leak). The
scanner self-tests check the `life`, `key`, `take:`/`fight:` prefix, `provenance` and hidden-name scans on
hand-built objects.

## Revert-checks (run for real, review 1)

Each mutation changed one line of the named file, the affected vitest scope was run, and the file was restored
from a scratchpad backup. After each restore `git diff --stat` for the file was the same as before the
mutation (empty for the subscription and fight files, which are unchanged from `1db9b229`; the edited test and
scanner files show the review-1 edit).

| Mutation | Failing tests |
|---|---|
| M1 drop take dispatch (`carries` returns false for take) | 8: `take row: positive`, `hidden` (both), `duplicate`, `restart`, `the take keys and the break keys have separate LRUs`, `guards: a take and a fight in another world`, `guards: with the world age unknown` |
| M2 drop combat dispatch (`carries` returns false for combat) | 6: `fight row: positive`, `duplicate`, `restart`, `guards: a take and a fight in another world`, `guards: with the world age unknown`, `fight observer is given the Body world` |
| M2b combat accepts a take (`kind === undefined` added) | 1: `a message of the wrong kind for its subject ... all 12 pairings publish nothing` |
| M3a remove the world filter for take and combat (subscribe only) | 1: `guards: a take and a fight in another world give nothing` |
| M3b remove the `world` argument to `observeFight` | 1: `fight observer is given the Body world (AN-50b wiring)` |
| M4 accept a `killed` (`fight-seen.ts`, `msg.kind !== 'engaged'` check, temporary, restored) | 2: `fight-seen.test.ts > observeFight > killed gives null`; `guards: a killed message and the Body's own fight give nothing on the combat subject` |
| M5 remove FightWindows (fresh per message) | 1: `fight row: duplicate` |
| M6 remove TakeKeyLru (fresh per message) | 1: `take row: duplicate` |
| M7 unknown-age guard removed (`now === undefined` instead of `null`) | 1: `guards: with the world age unknown, a take and a fight are not observed, nothing throws` |
| M8 subscribe gate off (no `validateProvenance`) | 2: `a provenance message with a bad shape is dropped and counted`; `a take or a combat record with a bad shape is dropped as malformed` |
| M9 leakage gate: the `life id` scan removed (`leakage.test.ts`) | 2: `an injected life id in an observation is reported as a leak`; `scanner test: a life field on a container_taken object is reported as a leak` |
| M9b leakage gate: `take|fight` removed from the key regex | 1: `scanner test: a take or fight key prefix in an output is reported as a leak` |
| M10 `ag_` scan on the un-lowercased body (`leakage-scan.ts`) | 1: `injected: an uppercase life id in a payload is reported in lower case ...` |
| M10b allow-list not lower-cased (`leakage-scan.ts`) | 1: the same test |
| M11 take dedupe shares the break LRU (`seen: breakSeen`) | 1: `the take keys and the break keys have separate LRUs: 257 takes do not evict a break key` |
| M12 partial-subscribe cleanup unsubscribes only the first | 2: `a subscribe that fails at call 3 ...`; `... at call 4 ...` (call 2 passes, as the first is the only one before it) |

M7 first passed in an earlier session: the unknown-age test asserted only that nothing was published, and the
contract's world-tick check refused the event downstream. The test now also asserts that no contract refusal
is logged, and M7 fails for that reason.

Review 1 counts: M1 was 6 and M2 was 4 in the first worknote (the unknown-age test was omitted); both are
corrected above. M4 was recorded as 1; it fails 2 tests. M3b was recorded as proof of the world argument; it
now fails the wiring test.

## Ops still to run (listed, not run)

- Real NATS role denial of raw `provenance.>` to the MCP, eventsink and mind roles.
- Observer-to-player-event for every active row (break, gift, take, fight), and producer-to-sink XP.
- `./geldar.ps1 check`, the integration floor, and the 20 TPS bench.

## Findings

1. **Gift repeats are observed twice, by design.** The gift key carries an ordinal (`gift.ts`: the count of
   earlier keys with the same prefix), so identical pickups in the same tick are two observations with keys
   `:0` and `:1`, and a restarted subscription starts at `:0` again. Core NATS has no redelivery (AN-26b
   ruling), so this is not a duplicate control and there is no dedupe for gifts. Owner ruling (review 1): keep
   the ordinal keys.
2. **A take names its taker through `observedActor`, not the injected resolver.** `observeTake` has no resolver
   seam (the brief forbids a world seam), so a taker is named only when the taker is a visible player entity on
   the Body's bot. The tests use the bot's entities for this.
3. **`container_taken` and `fight_seen` present no line to the agent** (see the presenter status above). The
   leakage tests for these kinds check the mapper output, and assert that the presented output is empty. This is
   a decision for the owner, not a gap in the gate.
4. **Test-first was not followed for `subscribe.ts`.** The implementation was written before the new test file,
   so the new tests were not seen to fail against the old code. The M1 to M12 mutation runs are the failing
   evidence instead.
5. **Test-file edits beyond the expectations.** `subscribe.test.ts` moved `leaksIn` and the hidden constants to
   `leakage-scan.ts` (shared by two files). `subscribe-evidence.test.ts` (526 lines) and `subscribe.test.ts`
   (577 lines) sit above the 500-line soft cap but under 600 and under 700.
