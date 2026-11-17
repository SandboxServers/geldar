# 0382. An event for another shard is dead-lettered, not acked and skipped

- Status: Proposed (lead-accepted 2026-11-17; owner to confirm)
- Date: 2026-11-17
- Spec: section 7 (event bus), Appendix F (event export); decision D-P0-10; builds on 0026 and 0041

## Decision

1. A sink serves one shard (`GELDAR_EVENTSINK_SHARD`). When it receives a `WorldEvent` whose `shard` field differs from the served shard, it does not store the event and does not silently ack it. It sends the message to `geldar.<served shard>.dlq` with the reason `shard_mismatch` and a truncated body, exactly as 0041 dead-letters other events it cannot store.
2. The same rule covers a subject whose shard segment differs from the event's `shard` field: today's `validate.ts` check already refuses that case; the dead-letter reason stays as it is.
3. An event with no shard field is refused as invalid, as 0041 already does.

## Why

Decision 0026 says the sink checks the shard field against the shard it serves. The code does not do it: `eventsink/src/validate.ts` (lines 24-45) checks the subject against the event's own fields only. A mismatch that is acked and skipped disappears; one that is stored breaks the one-database-per-shard model. Dead-lettering keeps it visible, the rule 0041 uses for anything the sink cannot store.

## Consequences

- **Implementation gap, not yet fixed.** The served-shard check is missing. The fix is a trigger-path packet (`eventsink/**` is in the colo-images trigger list): add the check to `validate.ts` or `main.ts`, with a test that a `geldar.colo.x` message to an `nf` sink is dead-lettered and that no row is written. The packet also needs abort and error-path tests: a failed dead-letter publish must nak, not ack.
- The check is not in the colo sink's path until the sink is restarted on the new image (record 0380 and the design note section 5).
- Until the packet lands, a NeoForge sink must not be started on a stream that could carry another shard's subjects. With a per-shard NATS (record 0380) the risk is removed by separation, but the check is still required.
