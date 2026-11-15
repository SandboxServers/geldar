# AN-12a: Body wiring of the threat policy (inactive by default)

Split of AN-12 (Body wiring). The sink wiring, ACL and fixtures stay in AN-12b.

## Rulings applied (orchestrator)

1. May-edit exception: `golem/src/body/restart.ts` goes beyond a pass-through. `RestartBodyOptions.bindThreat?: (generation: number) => ThreatPolicy | undefined` is called by `restartBody` after the generation is taken and before `createBody`, `runtime.start()` and `executor.start()`, and its result is passed as `CreateBodyOptions.threat`. Absent `bindThreat` (or an `undefined` return) is the old behaviour (`restart.threat.test.ts`).
2. Chunk visits: `golem/src/body/evidence/chunk-visits.ts` still types `publish` as `(event) => void`. It already handles a returned promise (marks known while in flight, unmarks on rejection, gives up after 3 failures), so a promise-returning stamped publisher is passed directly. No adapter. The wiring test with a rejecting publisher is part of the AN-12b / Body-side wiring follow-up; it is not in this slice.
3. Standard fallback: no policy is built for `source` `standard` or `off`, as AN-07 does (`adam-body.ts` `bindThreat` returns `undefined` unless `source === 'config'`).
4. `enabledReflexes(config, threat?: ThreatPolicy)`. With no policy the shared `combatReflexes` instances are returned (identity test in `create-body.test.ts`).

## Shape

- `golem/src/body/create-body.ts`: `CreateBodyOptions.threat`; `enabledReflexes` builds `createCombatReflexes(threat)` only when a policy is given.
- `golem/src/body/restart.ts`: `bindThreat` as above.
- `golem/src/character/runtime.ts`: `lifeThreatPolicy` binds the config sheet's aggression, the roll switch and the roller. Each d20 is keyed by the Body's generation, the world tick, the life and a per-policy sequence (`DrawKey`), and recorded through the audit publisher's `recordRoll` before the decision uses it.
- `golem/src/adam/adam-body.ts`: passes `bindThreat`. The audit publisher is created inside `bindThreat` with the bound generation, so the policy's rolls and the sheet adoption share one producer.

## Second commit (Body wiring, slice 2)

- Proficiency cache: `golem/src/character/proficiency-host.ts` builds the `StateTransport` over the host's NATS connection and starts `ProficiencyCache` only for a config sheet (`startProficiency`). It requests on start and refreshes on each reconnect (status stream). `adam/main.ts` and `players/main.ts` stop it on shutdown, and pass it into `startAdamBody` as `AdamBodyEnv.proficiency`. The cache reply carries no sheet (AN-11c).
- Combat level: `lifeThreatPolicy` reads `combatLevel()` at each decision (`env.proficiency?.level('combat') ?? 0`). A degraded cache serves what the cache defines (zero before any adoption, the last adopted level after).
- Chunk evidence: `adam-body.ts` attaches `watchChunkVisits` through the stamped publisher for a config sheet only, and detaches it on stop and on a failed start. The publisher's promise is passed straight through; the watcher handles rejections.
- Decisions: every threat decision is recorded with `AuditPublisher.recordDecision`. A decision with a roll is kind `d20`, keyed like its roll, citing its `roll_event_id`. A decision without a roll (rolls off, flee at or below the floor, unarmed) is kind `deterministic`, with fx `threat` and a fresh key under the Body generation.
### Tests and mutation runs (tests-only pass)

Each mutation was applied to one line, the named tests were run, and the file was restored from a scratchpad copy (`git diff --stat` empty after each).

- `golem/src/adam/adam-body.character.test.ts` (new, 7 tests):
  - off, omitted and standard: no AuditPublisher built, `bindThreat` returns `undefined`, nothing published, no chunk visit published (`it.each`).
  - a config sheet binds a threat policy for its generation.
  - the chunk watcher publishes while running and stops on `stop()`.
  - a failed start (`serve` throws) detaches the chunk watcher and quits the bot.
  - a rejecting chunk-visit publisher: exactly 3 attempts, then the chunk is given up; no `unhandledRejection` (listened on `process`).
- `golem/src/character/proficiency-host.test.ts` (new, 6 tests): `natsStateTransport` request and subscribe (error frames dropped, one unsubscribe); `startProficiency` returns no cache and sends no request for undefined, standard or off; a config sheet requests on start; refresh on `reconnect` only; `stop()` is idempotent, unsubscribes once, and a later refresh sends nothing.
- `golem/src/character/runtime.test.ts` and `proficiency-cache.test.ts` already held the combat-level and decision-key tests; no change.

Mutation results (each run by its test file, then restored):

| Mutation (one line) | Result |
| --- | --- |
| (a) `adam-body.ts`: the chunk and audit block tests `sheet !== null` only, not `source === 'config'` | fails: `builds no audit producer ... when standard` (expected 1 to be +0) |
| (b) `adam-body.ts` `stop()`: `detachChunks();` removed | fails: `publishes first visits while running, and stops on stop()` (2 events, expected 1) |
| (b') `adam/main.ts`: `proficiency?.stop();` removed | NOT CAUGHT: all 20 tests in `src/adam/`, `proficiency-host.test.ts` and `main.test.ts` still pass. The stop lives in the supervisor, not in `startAdamBody`; see the gap below |
| (c) `adam-body.ts`: `publisher.publish(` in the chunk watcher wiring made `void` (result dropped) | fails: `retries a rejected chunk visit ...` (expected 1 to be 3) |
| (d) `runtime.ts` `decide`: `decideWith(combatLevel())` replaced by `decideWith(0 as Level)` | fails: `reads the combat level at each decision, not a fixed 0` (expected [0, 0] to equal [2, 3]) |
| (e) `runtime.ts`: the d20 `recordDecision` key generation set to `0` | fails: `records a d20 decision keyed like its roll, citing the roll` |
| (f) `proficiency-host.ts`: `source !== 'config'` replaced by `character === undefined` | fails: `starts only for a config sheet ...` (expected ProficiencyCache{} to be undefined) |

Gap (b'): the proficiency cache is started and stopped by the supervisor (`golem/src/adam/main.ts`, `golem/src/players/main.ts`), not by `startAdamBody`, so no test in this slice can fail when that stop is removed. Pinning it needs a supervisor test with a fake `startProficiency`; left for the follow-up.

Also still open for ops: real NATS and scratch-stack fixtures.
- `golem/src/adam/adam-body.test.ts` was already 591 lines, so the new adam wiring tests go in a separate file.

## Not in this slice (deviations to be picked up later)

- The sheet comes from the config only, not the cache's adopted baseline (ruling of the first pass, kept).
