# AN-06b: the Body's audit producer

Branch `phase1/an-06b-audit-producer`, base `bdec86aa` (origin/main at session start). Commit `bd8f46f8` is the first pass; the fix pass after review is its own commit on top.

## What changed

- `golem/src/character/audit-events.ts` (new): pure builders. Each returns `{ ok, event }` or `{ ok: false, errors }`, validating the payload (contract validators) and then the WorldEvent envelope.
  - `rollEventId(key, drawIndex)` = `eventIdFor('roll:' + decisionId(key) + ':' + drawIndex)`.
  - `decisionEventId(id)` = `eventIdFor('decision:' + id)`; `sheetAdoptedEventId(life, hash)` = `eventIdFor('sheet_adopted:' + life + ':' + hash)`.
  - `rollRecord`, `decisionRecord` use the draw's `key.tick` as world tick (and its world day); `gapRecord` builds `body:<life>:<gen>:<tick>:audit_gap:<n>`; `adoptionRecord` builds `sheet_adopted`.
  - A roll or decision whose fx differs from the key's is refused; so is a draw index that is not a safe integer.
- `golem/src/character/audit-publisher.ts` (new): `AuditPublisher` as the card's signature, plus optional `retryDelayMs`, `maxRetryDelayMs` and `producer` (see deviations).
  - Each `record*` call builds, queues and returns; it never awaits the network and never throws (an invalid record, or a key from another life, generation or producer, is dropped and logged; `recordRoll` returns `''` for a key the engine refuses).
  - One background drain loop publishes in order, retrying each event with capped backoff (200 ms doubling to 5 s, as `NatsRecordSink.send`). The loop never rejects: its reset of `draining` runs however it ends.
  - When `maxPending` (default 2000) waiting events are queued, the oldest waiting event is dropped and `gaps` increases. After the next successful publish one `decision` with `kind: 'audit_gap'`, `dropped` and `since_tick` is sent.
  - A gap report that fails (its clock or its send) is merged back. A resend with no new drop keeps the first attempt's id (tick and drop count pinned); a merge with new drops gets a fresh id.
  - `flush(timeoutMs?)` resolves true when the queue is empty, nothing is in flight and no gap is pending. A pending gap gets one report attempt. It resolves false when a gap still fails, when the publisher is closed with records waiting, or when `timeoutMs` passes first.
  - `close()` stops the retry loop and its wait timer, logs how many events were not sent and how many dropped records are unreported, and drops (logged) any record queued after it.
- Tests: `audit-events.test.ts` (14 cases), `audit-publisher.test.ts` (16 cases). Cases cover stable ids with literal pinned id formats, a failing then recovering publisher, the backoff cap, the bounded queue with the right gap count and since tick, a 5000-call burst on a hung publisher, failed gap reports (merged, id pinned when the clock moves on, a clock that throws while a gap is pending), a closed, throwing or rejecting publisher, flush with a timeout, keys from another life, generation or producer, an invalid key that must not throw, a draw index that is not a safe integer, a log line with no sheet score, a malformed roll, and subjects.
- Not touched: `records-nats.ts`, reflexes, `adam-body.ts`, contract, psyche.

## Checks

- `vitest run golem/src/character/audit`: 2 files, 30 tests, all pass.
- `tsc -p golem --noEmit`: exit 0.
- `biome ci golem/src/character`: exit 0.

## Revert-checks

Each one-line mutation is applied to the committed file, the named test is run, and the file is restored from a backup. `git diff --stat` is checked after each restore.

- RC1, unbounded queue: `if (this.queue.length >= this.maxPending) this.dropOldest();` replaced by `... >= Infinity ...`. Fails the full-queue, burst and failed-gap tests.
- RC2, fresh id per call: the roll `return eventIdFor(...)` line gets `:${Math.random()}` appended. Fails the stable-id tests.

Review-fix mutations (run on the fix commit, one line each, file restored from a backup, `git diff` empty after each restore). All 14 fail, each on the named test:

- decision fx check off: "refuses a decision whose fx is not the key fx".
- `roll:`, `decision:` and `sheet_adopted:` prefixes changed: the pinned id test, plus the stable-id test for the roll prefix.
- ctx tick as the decision tick: "takes the world tick of a decision from the draw".
- `world_day` 0: "gives the world day of the draw tick".
- draw index check off: "refuses a draw index that is not a safe integer" and the publisher drawIndex test.
- backoff cap removed: "doubles the wait between attempts up to the cap".
- rethrow in `recordRoll`: "a key the engine refuses is dropped".
- a log line with the roll score: "a log line for a refused roll carries no sheet score value".
- key life check off: "a key of another life, generation or producer is refused".
- flush ignores the in-flight event: "flush with a timeout resolves false ... close ends the retry loop".
- flush timeout resolves true: the same flush test, and the closed-publisher test.
- gap id not pinned: "a failed gap report keeps its id when the clock has moved on".

## Review fixes (fix pass after review of `bd8f46f8`)

- Drain loop: `reportGap` wraps the clock, the build and the send; a throw restores the run and logs. `run` resets `draining` in a `finally`. Test: a clock that throws while a gap is pending, then recovers; later records and the gap are published.
- `close()` and `flush(timeoutMs?)` added (see above). Tests: an always-failing publisher with `flush(50)` resolving false and `close()` ending the loop (no attempts after it); a closed publisher's queued events are counted in the close log.
- A key whose life, generation or producer differs from the publisher's is refused in `recordRoll` and `recordDecision`. `adoptionRecord` takes its life from the publisher options, so there is no key to compare on that path.
- Id tests: literal ids built with `eventIdFor` from literal strings (roll, decision, sheet_adopted), so a prefix change fails. `decisionId` is pinned as a literal too.
- Decision fx mismatch test; decision and roll world tick and world day (tick 30000 gives day 1) tests.
- Backoff test: the waits between attempts are 1, 2, 4, 4, 4 with a cap of 4 (spy on `setTimeout`).
- A draw index that is not a safe integer is refused (`1e21` was accepted before).
- Log test: a refused roll with score 99 logs no `99`.

## Deviations and reasons

- `geldar.ps1 pnpm` could not run in this worktree: the corepack pnpm shim in the shared `node_modules/.corepack-bin` fails on the space in the Node install path. Checks ran through `node_modules/.bin/vitest.cmd`, `tsc.cmd` and `biome.cmd` directly.
- `golem/node_modules` is not a single junction. The main checkout's `golem/node_modules` lacks `@geldar/psyche`, and adding it would write into the main checkout. The worktree folder holds a junction per top-level package entry of the main `golem/node_modules`, plus `@geldar/contract` and `@geldar/psyche` junctions to this worktree.
- Optional options beyond the card's signature: `retryDelayMs` and `maxRetryDelayMs` (defaults 200 and 5000, as the sink), and `producer` (default `'body'`, the producer this Body's keys carry; the refusal of other producers needs it).
- `recordRoll` and `recordDecision` refuse a record whose `fx` differs from `key.fx`. The id embeds `key.fx`, so a mismatch would label one draw's record with another draw's fx.
- `recordRoll` returns the roll's stable id even when the roll is dropped as malformed (the id is deterministic). It returns `''` when the key itself is refused.
- Gap `n` in the decision id is the running total of dropped records at the first attempt. Each gap event follows at least one new drop, so ids are unique within a generation and tick.
- `gaps` counts dropped records (not gap events).
- Retries never give up while the publisher is open (as the audit sink's durable records): the queue bound is the only cap; `close()` is the stop.
- `flush()` now returns a boolean (the card's signature said `Promise<void>`); the boolean is what lets a shutdown path tell an idle queue from a stuck one.

## Follow-ups for AN-07 (not implemented here)

- Queue-head poison: an event the server permanently refuses (no matching stream, or an oversize payload) blocks the head of the line; later events pile up and are dropped as the oldest. NatsRecordSink has a `maxEventBytes` guard (1,000,000) that this producer lacks. AN-07 should decide between a per-event refusal limit (dead letter) and a size check at enqueue.
- `sheet_adopted` embeds the whole sheet, so its size matters for the size guard above.
- `dropOldest` can drop a `sheet_adopted` or a decision whose roll was kept; the gap event carries only a count, not the kinds. Unmeasured.
- A failed gap report whose first send landed but whose ack was lost is re-sent under the same id only while no new drop happened; a merged resend gets a new id, so the count can be reported twice across two events.

## Unverified

- Real NATS reconnect and a full buffer under JetStream are AN-07 ops cases; not run here.
- `pnpm check:repo` and `pnpm test` from the root were not run (see the shim deviation).
- The `audit_gap` decision's `dropped` and `since_tick` are only checked by the publisher tests; the contract schema has no test for `audit_gap` beyond the validator accepting it.
- The live lane was not run (`live: pending`).
