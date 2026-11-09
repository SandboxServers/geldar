# 0043. Phase 0 keeps Body checkpoints and generations in NATS KV; record rules for intents, audit records and receipts

- Status: Accepted (made by the orchestrator in wave 4; see `docs/analysis/phase0/overnight-decisions.md` rows 26 to 32)
- Date: 2026-11-09
- Spec: 5.2 (process model: durable state in Postgres), 5.3, section 7 (states, receipts), Appendix D; decisions 0020, 0040, 0041

## Decision

1. The running intent's checkpoint is stored in the NATS KV bucket `geldar-checkpoints` (key `<life_id>`) and the Body generation counter in `geldar-body-generation` (key `<life_id>`, compare-and-swap). The spec says all durable Body state is in Postgres: in Phase 0 these two small records live in KV so a Body restart needs no Postgres access; the audit record (events, intents, actions, receipts) still goes to Postgres through the sink. Moving checkpoints to Postgres is a later change.
2. `action` and `receipt` records are audit records, and the `intent` events that set a row's state or end it (`accepted`, `completed`, `failed`, `cancelled`, `interrupted`) are treated the same way: the record sink retries them in order with capped backoff until they are sent, logging the first failure and then one in N with the attempt count, queue depth and event id. Without a terminal or `accepted` intent event the projection keeps a row `running` or its end columns null. Only `running` and `paused` intent heartbeats and reflex and wake records may be dropped under pressure (after a few attempts, or first when the queue is full). In normal operation a durable record is lost in two cases, both logged as an error and counted (`auditDropped`): the queue holds nothing but durable records and is full (the oldest is dropped), or the one record can never be sent (it fails validation, or is still over the NATS payload limit once an action's `result` is cut to a marker); that record alone is dropped so it never blocks the queue. Outside normal operation, queued records are also lost when a flush times out on stop and when the process crashes.
3. The `intents` table is projected from the intent events: `interrupted` becomes `cancelled` with an `interrupted:` end reason, `paused` is events-only, and the `accepted` event carries goal, program, arguments, preconditions, wake_on and limits.
4. `receipt_id` is derived from `(action_id, phase)`; a replayed plan after a restart is rejected by the `body_generation` check.

## Consequences

- A lost NATS KV loses the resume point (the Body then starts idle and wakes the Mind with `no_plan`), never an audit record.
- Postgres remains the record of what happened; KV is the Body's working memory.
