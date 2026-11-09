# eventsink

Copies world events from NATS JetStream into Postgres `events` (spec section 7, Appendix D).

## Behaviour

- Durable pull consumer `eventsink` on stream `GELDAR_EVENTS`. The stream is created if missing.
- Each message is validated with the generated `@geldar/contract` `WorldEvent` validator, and its subject must be `geldar.<shard>.<type>` matching the event.
- Valid messages are written in small batches with `INSERT ... ON CONFLICT (source_event_id) DO NOTHING` in one statement, and acked only after it commits. Redelivery and duplicates are harmless.
- An invalid message is published to `geldar.<shard>.dlq` as JSON `{ reason, subject, data }` and then acked: never lost, never retried forever. The DLQ subject is inside the stream's `geldar.*.*`, so the sink acks and skips `*.dlq` messages itself.
- A connection or timeout error naks the batch with backoff (1 s doubling to 30 s); a failed DLQ publish naks too. A permanent database error (SQLSTATE class 22 or 23, such as a NUL in jsonb or an out-of-range integer) retries the batch row by row and dead-letters only the rejected rows. The consumer's max_deliver is 20 as a backstop.
- A dead letter body is { reason, subject, data, data_bytes, data_truncated }; data is cut to 8 KB. Every nak (with the event ids) and every dead letter is logged.
- Only *.dlq bodies without a source_event_id are skipped; an event of type dlq with an id is stored like any other.
- After 5 failed fetches in a row the stream and consumer are re-created if missing; after 20 the process exits so compose restarts it.
- SIGINT and SIGTERM stop fetching, finish the batch in hand, drain NATS and close the pool.

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

`pnpm test` runs the unit tests with fakes. `test/eventsink.it.test.ts` needs the live stack (`./geldar.ps1 shard up phase0`) and `GELDAR_IT=1`; it publishes one event twice, a second event and one malformed message, then expects one row per event and one dead letter (counting only geldar.phaseit.>). It is the only test that runs the real INSERT; the unit tests use fakes.
