# AN-50b: the Body subscription to take and combat evidence, and the leakage gate

Status: the Body now subscribes to `provenance.take` and `provenance.combat` as well as break and pickup, with
the same drops, the same world filter, and per-subscription dedupe. Nothing turns it on: `observations`
stays absent in every production config (`adam-body.ts` is unchanged).

## Files

- `golem/src/perception/provenance/subscribe.ts` (250 lines): four channels (`break`, `pickup`, `take`,
  `combat`). `carries(channel, msg)` pins each subject to its record: a take has no `kind` and only the take
  subject takes it; combat is `engaged` or `killed` and only the combat subject takes it. The world filter
  (`msg.world === bukkitWorldOf(bot)`) runs before every observer. Take and fight are dated on `worldAge`;
  with no age they are not observed. One `TakeKeyLru` for takes and one `FightWindows` per subscription.
- `golem/src/perception/provenance/subscribe.test.ts` (538 lines): the "both subjects" expectations are now
  four subjects; `leaksIn` and the hidden-name constants moved to `leakage-scan.ts` (both files use them).
- `golem/src/perception/provenance/subscribe-evidence.test.ts` (new, 506 lines): the evidence rows, guards,
  wrong-subject drops, the leakage scan over every published body, and injected leaks per scan.
- `golem/src/perception/provenance/leakage-scan.ts` (new): `leaksIn`, `HIDDEN_NAME`, `HIDDEN_LIFE`.
  Test-only.
- `golem/src/perception/provenance/fixtures/take-real.json` (new): the captured chest-single withdrawal from
  `worknotes/AN-51a.md` (capture 73788889, shard phase0, tick 3982), field for field.
- `golem/src/adam/adam-body-observations.test.ts`: expectations only, four subjects.
- `threshold/mcp/src/events/leakage.test.ts`: `fight_seen` and `container_taken` cases through
  `mapMindEvent` and `presentEvents`, the injected life field, the injected key, and raw
  provenance and `combat_fact` never reaching the agent.

`mind-event.ts`, presenters, `adam-body.ts`, contract, plugin, compose, shards and docs/spec.md are untouched.
The presenter rows for `fight_seen` and `container_taken` already exist; no presenter text was needed.

## Evidence table: the four active rows

Each row has a positive, a hidden, a duplicate and a restart control in `subscribe-evidence.test.ts`.
Restart creates a new subscription on the same transport and asserts it requested no replay
(`Object.keys(opts) === ['callback']`) and observes the message once more.

| Row | Positive | Hidden | Duplicate | Restart |
|---|---|---|---|---|
| gift (AN-26) | `gift row ... positive: a thrower in sight is named, once` | `hidden: a thrower out of sight is unattributed` | `duplicate: an identical pickup twice is two gifts with ordinal keys` (see finding 1) | `restart: ... observes the same pickup once` |
| break (AN-27) | `break row ... positive: a breaker in sight is named, once` | `hidden: a breaker out of sight is unattributed` | `duplicate: the same break twice is one observation` | `restart: ... observes the same break once` |
| take (AN-51) | `take row ... positive: a taker in sight is named ...` | `hidden: a taker out of sight ...`; `hidden: a taker behind a wall is unattributed, though the container is seen` | `duplicate: the same take twice is one observation` | `restart: a fresh subscription has no take keys ...` |
| fight (AN-47c) | `fight row ... positive: a fighter in sight and a mob in view ...` | `hidden: a fighter out of sight ...`; `hidden: a mob behind a wall, out of reach, or no mob of the target type` | `duplicate: the same fight twice, and the same pair a tick later` | `restart: a fresh subscription has no fight windows ...` |

Other guards, each with a test: take and fight in another world give nothing, the same world gives one
(`guards: a take and a fight in another world ...`); a take from a container nobody owns, from another owner,
or taken by the Body gives nothing (`take row: a take from a container nobody owns ...`); a container the Body
cannot see gives nothing; a killed message and the Body's own fight give nothing; with the world age unknown a
take and a fight are not observed, nothing throws, and no contract refusal is logged; a message of the wrong kind
for its subject is malformed (four cases); after stop nothing is observed.

Leakage: `leakage scan over every published observation` checks every published body with `leaksIn`
(provenance word, coordinates in the payload fields, `ag_` ids outside the allow-list, hidden name or life in
any case, the key included). Injected cases prove each scan fires: a provenance word, coordinates in a payload
field (and not in the key), a foreign life id, and an uppercase hidden name or life in the key.

## Revert-checks (run for real)

Each mutation changed one line, the three affected files were run, and the file was restored from a
scratchpad backup. After each restore `git diff --stat` was empty.

| Mutation | Failing tests |
|---|---|
| M1 drop take dispatch (`carries` returns false for take) | 6: `take row: positive`, `hidden` (both), `duplicate`, `restart`, `guards: a take and a fight in another world` |
| M2 drop combat dispatch | 4: `fight row: positive`, `duplicate`, `restart`, `guards: a take and a fight in another world` |
| M3a remove the world filter for take and combat (subscribe only) | 1: `guards: a take and a fight in another world give nothing` |
| M3b the same, and the observer's world argument removed | 1: the same test |
| M4 accept a `killed` (fight-seen.ts, temporary, restored) | 1: `guards: a killed message and the Body's own fight give nothing` |
| M5 remove FightWindows (fresh per message) | 1: `fight row: duplicate` |
| M6 remove TakeKeyLru (fresh per message) | 1: `take row: duplicate` |
| M7 unknown-age guard removed (`now === undefined` instead of `null`) | 1: `guards: with the world age unknown, a take and a fight are not observed, nothing throws` |
| M8 subscribe gate off (no `validateProvenance`) | 1: `a provenance message with a bad shape is dropped and counted` |
| M9 leakage gate: the `life id` scan removed (`leakage.test.ts`) | 2: `an injected life id in an observation is reported as a leak`; `an injected life field on a container_taken is reported as a leak` |

M7 first passed: the unknown-age test asserted only that nothing was published, and the contract's world-tick
check refused the event downstream. The test now also asserts that no contract refusal is logged, and M7 fails
for that reason. The card's two revert-checks are M9 (the `container_taken` life field) and M8 (the gate off).

## Ops still to run (listed, not run)

- Real NATS role denial of raw `provenance.>` to the MCP, eventsink and mind roles.
- Observer-to-player-event for every active row (break, gift, take, fight), and producer-to-sink XP.
- `./geldar.ps1 check`, the integration floor, and the 20 TPS bench.

## Findings

1. **Gift duplicates are observed twice.** The gift key carries an ordinal (`gift.ts`: the count of earlier keys
   with the same prefix), so an identical pickup in the same tick is a second gift by design. The subscription
   cannot tell a redelivered message from a second identical gift. Core NATS is at-most-once, so this is not a
   redelivery path today, but the gift duplicate control asserts the ordinal behaviour rather than one
   observation. Owner decision: keep the ordinal, or key the gift by the message identity.
2. **A take names its taker through `observedActor`, not the injected resolver.** `observeTake` has no resolver
   seam (the brief forbids a world seam), so a taker is named only when the taker is a visible player entity on
   the Body's bot. The tests use the bot's entities for this.
3. **The `container_taken` presenter renders a fixed sentence with no actor.** A `life` field on a presented
   `container_taken` cannot reach the output through `mapMindEvent` and `presentEvents`, so the presenter-path
   revert-check cannot fail. The leak gate is proven by the injected `leaksOf` case (M9), which asserts that a
   `life` string in the serialised output is reported.
4. **Test-first was not followed for `subscribe.ts`.** The implementation was written before the new test file,
   so the new tests were not seen to fail against the old code. The M1 to M9 mutation runs are the failing evidence
   instead.
5. **Test-file edits beyond the expectations.** `subscribe.test.ts` moved `leaksIn` and the hidden constants to
   `leakage-scan.ts` (shared by two files). `subscribe-evidence.test.ts` (506 lines) sits above the 500-line soft
   cap but under 700.
