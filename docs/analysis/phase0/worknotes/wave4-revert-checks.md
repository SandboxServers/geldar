# Wave 4 revert checks

Evidence that each wave 4 fix test fails when the old behaviour comes back. Each row: the old behaviour reintroduced in the source, the named test run, the result, source restored. The first part is copied from the fix coders' reports (w4x, w4y, w4z, w4w, w4w2, w4-int); the second part is the round 2 fixes (coder Q).

## Round 1 fix coders (copied from their reports)

| Fix | Test | Old behaviour reintroduced | Result |
| --- | --- | --- | --- |
| w4x (A1 A2 A6 A7 A8 A9 A12 reflex, A14 safe-spot, A15 A16 L3 L5) | the new tests of those items | not listed in the report (it states only that `./geldar.ps1 check` passed) | no revert-check evidence recorded |
| w4y (A3 A4 A5 A10 A11 A12 A13 A14 A17 B3) | the new tests of those items | the report says each new test was revert-checked (fix reverted, test failed, restored) but names none | stated, not itemised |
| w4z B1 | "stores an interrupted intent as cancelled..." | `rowState` returns undefined for `interrupted` (old: not projected) | failed |
| w4z B2 | "retries an action and a receipt past the attempt limit" | audit records use the finite `attempts` again | failed |
| w4z B2 | "drops the oldest non-audit record first" | victim search takes the oldest record of any kind | failed |
| w4z B9 | "fills the intent columns from the accepted event" | goal not copied | failed |
| w4z B15 | "destroys the client when the rollback itself fails" | `client.release()` without the flag | failed |
| w4z B15 | "does not take a same-id receipt of another phase for a redelivery" | same-id branch disabled (old `some` on id only) | failed |
| w4z B13 | "receiptIdFor ..." | key mixed with `Math.random()` (old: random id) | failed (4 tests) |
| w4z B4 | "retries a failed delete" and "gives up after its tries" | `if (true)` in the delete retry (no retry) | 2 failed |
| w4z B14 | "skips a step whose entry equals..." | unchanged-content skip removed | failed |
| w4z B14 | "writes an unchanged entry again when the earlier write failed" | `lastContent` reset removed | failed |
| w4z B14 | "logs the first failure of a run and then one in thirty" | log every failure | failed |
| w4z B14 | loopback guard in `openRestartKv` | cannot be exercised without NATS; `assertLoopbackNatsUrl` has a unit test | not revert-checked |
| w4z B7 | "throws CheckpointUnreadable..." and "says checkpoint_unreadable" | `load` returns null on a read error (old) | 4 failed |
| w4z B6 | "caps the ticks left" | `entry.expires_tick - tick` without the min | failed |
| w4z B6 | "with no tick expires nothing" | null-tick return removed | failed |
| w4z B6 | "waits for a tick" | no waiting loop | failed |
| w4z B5 | "waits for the record sink to flush" | `flushSink` call removed | failed |
| w4z B5 | "does not wait forever" | race with the timeout removed | failed |
| w4w L4 | `craft-table.yield.test.ts`, `craft.yield.test.ts` | craft count ignores the observed result-slot yield | 4 clicks (16 sticks) without the fix |
| w4w2 | craft yield tests (8) | old `made += slot count` | 8 yield tests failed |
| w4-int (a) | "carries the intent on the accepted change only" | fix removed | failed |
| w4-int (b) | "derives each receipt id from its action and phase" | fix removed | failed |
| w4-int (c) | block_operations_used resume test in `restart.test.ts` | fix removed | failed |
| w4-int (d) | first put never skipped, unchanged put skipped, changed budget written (`checkpoint.test.ts`) | not itemised; the report lists the tests but only (a) to (c) as revert-checked | not recorded |

Gaps recorded by the integrator: B16 (the `GELDAR_IT=1` projection run) needs docker and is the orchestrator's; w4x and w4y did not itemise their revert-checks.

## Round 2 (coder Q)

| Item | Test | Old behaviour reintroduced | Result |
| --- | --- | --- | --- |
| B2-1 | `eventsink/src/projection.test.ts` "treats a higher body generation as a new run of the same intent" | the higher-generation branch in `mergeIntent` disabled (first final state kept) | failed: row stays `cancelled`, generation 1 |
| B2-1 | `eventsink/test/projection.it.test.ts` resumed-intent case | not run (needs the live stack; the orchestrator runs `GELDAR_IT=1`) | not revert-checked |
| B2-2 | `records-nats.queue.test.ts` "retries an accepted and a final intent event until NATS is back, like an audit record" | `isDurable` returns false for every intent event | failed (only `interrupted` got through) |
| B2-2 | "still gives up on a running or paused intent heartbeat after its attempts" | `running` made durable (removed from the droppable set) | failed (retries without end, test timed out) |
| B2-3 | "retries an action and a receipt past the attempt limit..." (log assertions) | retry log removed | failed |
| B2-3 | "logs the first failure and then one attempt in retryLogEvery, not every one" | retry log removed; also a variant logging every attempt | failed (both variants) |
| B2-3 | `records-nats.test.ts` "keeps a retried publish on the same id" (one line, attempt 1) | retry log removed; log-every-attempt variant | failed (both variants) |
| B2-4 | "cuts an oversize action result to a marker and publishes the record" | size check (`fitsPayload`) removed | failed |
| B2-4 | "drops an audit record that is still too large, as an error, and sends the next one" | size check removed | failed |
| B2-4 | "counts an audit record that fails validation and keeps the queue moving" | invalid audit record not counted (`refuse` called as non-audit) | failed |
| B2-5 | `restart.fixes.test.ts` "does not wait forever for a sink that cannot send" (log assertion) | the flush result ignored again (no log) | failed |
| B2-5 | "logs nothing about the flush when the sink sends in time" | a guard against logging when the flush succeeds; passes before and after the change by design | not applicable (negative pin) |
| B2-8 | `checkpoint.test.ts` "stops retrying once a newer write is waiting" | the `if (this.waiting) return;` line removed | failed: `kv.deletes` was 4, expected 1 |
| L7 | `eventsink.it.test.ts`, `projection.it.test.ts` | each has its own shard (`phaseitsink`, `phaseitproj`); needs the live stack | not revert-checkable here |
