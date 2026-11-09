# eventsink

Copies world events from NATS JetStream into Postgres `events` (spec section 7, Appendix D; [decision 0041](../docs/decisions/0041-event-export-stream-and-sink.md)). It runs as the `eventsink` service in `compose/phase0.yml` (built from `eventsink/Dockerfile`, started after healthy Postgres and NATS, restarted by compose). It uses `@nats-io/transport-node` and `@nats-io/jetstream` 3.4.0 and `pg`.

## Behaviour

- Durable pull consumer `eventsink` on stream `GELDAR_EVENTS`. The stream is created if missing.
- Each message is validated with the generated `@geldar/contract` `WorldEvent` validator, and its subject must be `geldar.<shard>.<type>` matching the event.
- Valid messages are written in small batches with `INSERT ... ON CONFLICT (source_event_id) DO NOTHING` in one statement, and acked only after it commits. Redelivery and duplicates are harmless.
- A batch that holds `intent`, `action` or `receipt` events runs in one transaction: the `events` insert, then the projection of those events (see Projection below), then commit. If either part fails the whole batch rolls back (a client whose ROLLBACK also fails is destroyed, not returned to the pool), so a row in a query table always has its `events` row. A batch with no such type keeps the single INSERT.
- An invalid message is published to `geldar.<shard>.dlq` (body below) and then acked: never lost, never retried forever. The DLQ subject is inside the stream's `geldar.*.*`, so the sink acks and skips `*.dlq` messages itself.
- A connection or timeout error naks the batch with backoff (1 s doubling to 30 s); a failed DLQ publish naks too. A permanent database error (SQLSTATE class 22 or 23, such as a NUL in jsonb or an out-of-range integer) retries the batch row by row and dead-letters only the rejected rows. The consumer's `max_deliver` is 20 and counts every delivery, including ones that failed only because Postgres was down; JetStream stops redelivering after the 20th and says nothing, so a transient failure on the 20th delivery is dead-lettered instead of retrying (reason `database unavailable after 20 deliveries`). With the backoff that is about 7.5 minutes of outage before events start landing in the DLQ.
- A dead letter body is `{ reason, subject, data, data_bytes, data_truncated }`; data is cut to 8 KB. Every nak (with the event ids) and every dead letter is logged.
- Only *.dlq bodies without a source_event_id are skipped; an event of type dlq with an id is stored like any other.
- After 5 failed fetches in a row the stream and consumer are re-created if missing; after 20 the process exits so compose restarts it.
- SIGINT and SIGTERM stop fetching, finish the batch in hand, drain NATS and close the pool.

## Projection (`src/projection.ts`)

After its `events` row is written, an event of type `intent`, `action` or `receipt` also fills a query table (spec section 7, Appendix D, decisions 0020 and 0043). Other types are stored in `events` only.

| Event | Table | Rule |
| --- | --- | --- |
| `intent` | `intents` (by `intent_id`) | Moves only forward: `accepted`, then `running`, then one final state (`completed`, `failed`, `cancelled`); the first final state stays. `interrupted` is stored as `cancelled` with an `end_reason` that starts `interrupted:`. `paused` is not stored. The `accepted` event fills `goal`, `program`, `arguments`, `preconditions`, `wake_on` and `limits` (also when it arrives after a later event). `thought_id` and `checkpoint` stay null: no event carries a thought id, and the running checkpoint lives in NATS KV (decision 0043). |
| `action` | `actions` (by `action_id`) | Same forward-only upsert over the contract's action states. |
| `receipt` | `receipts` | One row per `(action_id, phase)`; at most one final (`committed` or `aborted`) receipt per action, optionally after a `prepared` one. The same `receipt_id` and phase again is a redelivery and changes nothing. |

A second final receipt for an action, or a receipt whose id is already stored for another phase, is rejected with a permanent error (SQLSTATE 23505): the consumer retries the batch row by row and dead-letters only that event, with the reason. The Body derives `receipt_id` from `(action_id, phase)`, so a replayed action after a restart produces the same id (a redelivery) and not a second receipt.

Redelivery and reordering converge because every write is an upsert that checks the stored rank first. The projection reads an existing row with `FOR UPDATE`; for the first event of a new intent or action there is no row to lock, so two sink replicas could race on the insert (the loser fails on the primary key and its redelivery merges). Compose runs one sink, so this is documented and not handled.

## Stream definition (one constant)

The same definition is created by the Geldar-Core plugin (P0-11, see `plugin/README.md`) and by this service, whichever starts first. The code constant is `STREAM_CONFIG` in `src/config.ts`; change both places together.

| Setting | Value |
| --- | --- |
| name | `GELDAR_EVENTS` |
| subjects | `geldar.*.*` |
| storage | file |
| retention | limits, `max_age` 30 days |

## Configuration

| Variable | Default |
| --- | --- |
| `GELDAR_NATS_URL` | `nats://127.0.0.1:4222` |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_DB` | `127.0.0.1`, `5432`, `geldar`, `geldar` |
| `POSTGRES_PASSWORD_FILE` | required; compose points it at the `postgres` Docker secret |
| `EVENTSINK_BATCH_SIZE`, `EVENTSINK_FETCH_WAIT_MS` | `50`, `1000` |

Phase 0 has one open NATS on the compose network; per-service accounts arrive later (spec 6.5).

## Tests

`./geldar.ps1 pnpm test` (repository root) runs the unit tests with fakes. `test/eventsink.it.test.ts` is skipped unless the live stack is up (`./geldar.ps1 shard up phase0`) and `GELDAR_IT=1` is set, for example `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink`; it publishes one event twice, a second event and one malformed message, then expects one row per event and one dead letter (counting only geldar.phaseit.>). It is the only test that runs the real INSERT; the unit tests use fakes. `test/projection.it.test.ts` (same switch and stack) runs the real projection SQL: it publishes intent, action and receipt events, repeats and reorders them, and expects one converged row per intent, action and receipt and a dead letter for a second final receipt.
