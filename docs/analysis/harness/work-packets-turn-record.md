# Harness cards: the per-turn record (GX-05, HC-41)

Status: **Proposed, inactive, nothing dispatched.** Decision [0185](../../decisions/0185-per-turn-record-for-kit-minds.md). Written 2026-11-14 by the geldar coordinator from the owner's scope (confirmed to geldar-93): the full Appendix D record, prompt text and hidden reasoning included, **operator-only**. Neither card is `Ready` until the retention and erasure gate below is settled by the owner; they may be built behind a flag that defaults off once their `(to confirm)` items are resolved.

## Precondition (gate for both cards, owner)

Nothing stores a prompt or reasoning for a live player until the owner settles: the retention period; erasure when an account is erased (0171); who can read it; backups and the dump copies; the size and cost cap; and whether children's records link to lineage. Until then the writers ship with `turn_record: false` and the sink drops the event before it reaches a table.

## Findings the cards rest on (read 2026-11-14)

- `geldar_glass` has a table-wide `SELECT` on `thoughts` (`sql/0005_glass_reader.sql:23`). The full record therefore must **not** go in `thoughts`. `geldar_mcp` has no grant on `thoughts`.
- `thoughts` is append-only (`sql/0007_journals_append_only.sql`). The new table needs its own erasure path.
- `sovereign_call` events are stored in `events`; the sink stores every non-projected type there. The turn record must not ride `sovereign_call` or any event type that `events` replays to players or Glass. `events` is not read by `geldar_glass`, but this is `(to confirm)` per column grant.
- The MCP stream skips `sovereign_call` (`threshold/mcp/src/events/stream.ts:89`); the new type must be added to the guard list that keeps it out of the agent-visible stream (the same test AN-07 adds for `MIND_EVENT_TYPES`).

## GX-05: the `turn_record` event, table, sink writer and erasure path (world)

- **Repo** geldar. **Branch** `phase1/gx-05-turn-record`. **Depends on** GX-01a (harness and model names), the gate above, decision 0185. **Size** over 50k: split before dispatch into GX-05a (contract and SQL), GX-05b (sink writer, grants test), GX-05c (erasure function and the exposure tests). **Status** Proposed.
- **Do.**
  - Contract: schema `turn-record-event` (`TurnRecordPayload`) and WorldEvent type `turn_record` (3-token subject; sink-only). Fields: `turn_id`, `life_id`, `harness`, `model`, `template_version` (64 hex), `wake_reason`, `world_day`, `world_tick` `(to confirm: where the kit reads the tick)`, `model_input` (text or JSON, bounded), `raw_output` (text, bounded, includes reasoning as the harness exposes it), `tokens_in`, `tokens_out`, `usage_source` (`provider` or `estimated`), `latency_ms`, `context_tokens`, `context_window`, optional credits. Hard size cap per field and per event; over-cap truncates with a marker, never drops the numeric fields.
  - SQL (migration number `<allocate via registry>`, SQL 0037 or higher after #336): table `turn_records`; **no grant to `geldar_glass`, `geldar_mcp`, `geldar_register` or any player-facing role**; sink writes it; an operator role reads it; a definer function `erase_turn_records(life_id)` for 0171 (the delete path; the table is not append-only, or has its own exempt trigger). Schema test asserts `has_table_privilege` is false for every role except the sink and the operator role.
  - eventsink: writer for the type, off unless `GELDAR_TURN_RECORD=1`; the guard test adds `turn_record` to the types kept out of the MCP stream and Glass queries.
- **Prove.** Exposure tests (each fails if the guard is reverted): no role but the sink and the operator can select; `geldar_glass` and `geldar_mcp` get permission denied; the MCP stream never emits `turn_record`; a Glass query over `thoughts` is unchanged; flag off means no row; erasure removes a life's rows.
- **Must not.** Edit `thoughts`, its grants or its trigger; add a Glass column or view; put the text in `sovereign_call`; touch `docs/spec.md`.

## HC-41: the kit emits the turn record (kit)

- **Repo** geldar-scriptorium. **Depends on** HC-03 (meter), HC-04 (stamps), HC-05 (mind-loop), GX-05, the gate. **Size** over 40k: split into HC-41a (Claude and ChatGPT streams to a local `turns.jsonl`) and HC-41b (the send to the world). **Status** Proposed.
- **Do.** The supervisor and the owned loop write one row per model call to `turns.jsonl` in the supervisor volume: harness, model, template hash, usage and its source, latency, context size, and the input and output as the harness exposes them (Claude: the session stream; ChatGPT: the Responses stream; local: the chat transport). HC-41b sends the row to the world as a `turn_record` over a path the model cannot see or call (the supervisor's own link, not an MCP tool and not a header on `act`), flagged off by default.
- **Prove.** The child-environment test (HC-26) still shows no turn data or switch in the model's environment; the model's tool list gains nothing; the flag off sends nothing; a leak scan of prompts and skills finds no mention of the record.
- **Open.** How a Claude CLI session exposes reasoning (hidden thinking may not be in the stream) `(to confirm)`; the template-hash input set; how the kit learns the world tick.

## Open items

Everything under the gate above; the migration and event names `(allocate via registry)`; whether the operator role is a new role or an existing one `(to confirm)`; the size caps; how Adam's own record is handled (frozen animus `thoughts` stays as is).
