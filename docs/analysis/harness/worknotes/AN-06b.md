# AN-06b: the Body's audit producer

Branch `phase1/an-06b-audit-producer`, base `bdec86aa` (origin/main at session start).

## What changed

- `golem/src/character/audit-events.ts` (new): pure builders. Each returns `{ ok, event }` or `{ ok: false, errors }`, validating the payload (contract validators) and then the WorldEvent envelope.
  - `rollEventId(key, drawIndex)` = `eventIdFor('roll:' + decisionId(key) + ':' + drawIndex)`.
  - `decisionEventId(id)` = `eventIdFor('decision:' + id)`; `sheetAdoptedEventId(life, hash)` = `eventIdFor('sheet_adopted:' + life + ':' + hash)`.
  - `rollRecord`, `decisionRecord` use the draw's `key.tick` as world tick; `gapRecord` builds `body:<life>:<gen>:<tick>:audit_gap:<n>`; `adoptionRecord` builds `sheet_adopted`.
- `golem/src/character/audit-publisher.ts` (new): `AuditPublisher` as the card's signature, plus two optional options (see deviations).
  - Each `record*` call builds, queues and returns; it never awaits the network and never throws (an invalid record is dropped and logged).
  - One background drain loop publishes in order, retrying each event with capped backoff (200 ms doubling to 5 s, as `NatsRecordSink.send`).
  - When `maxPending` (default 2000) waiting events are queued, the oldest waiting event is dropped and `gaps` increases. After the next successful publish one `decision` with `kind: 'audit_gap'`, `dropped` and `since_tick` is sent. A failed gap report is merged back and sent after the next success.
  - `flush()` resolves when the queue and the in-flight publish are idle.
- Tests: `audit-events.test.ts` (9 cases), `audit-publisher.test.ts` (8 cases). Cases cover stable ids, a failing then recovering publisher, the bounded queue with the right gap count and since tick, a 5000-call burst on a hung publisher, a failed gap report, a throwing and a rejecting publisher, a malformed roll, and subjects.
- Not touched: `records-nats.ts`, reflexes, `adam-body.ts`, contract, psyche.

## Checks

- `vitest run golem/src/character/audit`: 2 files, 17 tests, all pass.
- `tsc -p golem --noEmit`: exit 0 (golem only; no contract or psyche change).
- `biome ci golem/src/character`: exit 0.

## Revert-checks

Each one-line mutation was applied to a copy-backed file, the tests were run, and the file was restored from the backup. `git diff --stat` was empty after each restore.

- RC1, unbounded queue: `if (this.queue.length >= this.maxPending) this.dropOldest();` replaced by `... >= Infinity ...`. Fails "a full queue drops the oldest and reports one gap with the right count and tick", plus the 5000-call burst and the failed-gap-report case. 3 of 8 publisher tests fail.
- RC2, fresh id per call: the roll `return eventIdFor(...)` line gets `:${Math.random()}` appended. Fails "gives one roll id for the same key and draw index" and "gives one id for the same key, and the stream sees the same message id twice", plus the failing-then-recovering and malformed-roll cases.

## Deviations and reasons

- `geldar.ps1 pnpm` could not run in this worktree: the corepack pnpm shim in the shared `node_modules/.corepack-bin` fails on the space in the Node install path. Checks ran through `node_modules/.bin/vitest.cmd`, `tsc.cmd` and `biome.cmd` directly.
- `golem/node_modules` is not a single junction. The main checkout's `golem/node_modules` lacks `@geldar/psyche`, and adding it would write into the main checkout. The worktree folder holds a junction per top-level package entry of the main `golem/node_modules`, plus `@geldar/contract` and `@geldar/psyche` junctions to this worktree. The earlier, all-in-one junction was removed as a link only (`rmdir` without recursion); no target was touched.
- Two optional options were added beyond the card's signature: `retryDelayMs` and `maxRetryDelayMs` (defaults 200 and 5000, as the sink). Without them the retry tests would take seconds.
- `recordRoll` and `recordDecision` refuse a record whose `fx` differs from `key.fx`. The id embeds `key.fx`, so a mismatch would label one draw's record with another draw's fx.
- `recordRoll` returns the roll's stable id even when the roll is dropped as malformed (the id is deterministic). It returns `''` only when the key itself throws in `decisionId`.
- Gap `n` in the decision id is the running total of dropped records at emission. Each gap event follows at least one new drop, so ids are unique within a generation and tick.
- `gaps` counts dropped records (not gap events).
- Retries never give up (as the audit sink's durable records): the queue bound is the only cap.

## Unverified

- Real NATS reconnect and a full buffer under JetStream are AN-07 ops cases; not run here.
- `pnpm check:repo` and `pnpm test` from the root were not run (see the shim deviation); the brief's `check:repo` check is left for the orchestrator.
- The `audit_gap` decision's `dropped` and `since_tick` are only checked by the publisher tests; the contract schema has no test for `audit_gap` beyond the validator accepting it.
- The live lane was not run (`live: pending`).
