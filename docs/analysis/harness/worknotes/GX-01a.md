# GX-01a worknote: harness and model stamp

- Branch `phase1/gx-01a-event-stamp` (worktree `.claude/worktrees/gx-01a`), from origin/main 817f16b7.
- Base sha for this pass: 817f16b7 (HEAD when the session started).
- Migration number: 0037 (`sql/0037_events_harness_model.sql`), as dispatched. Not applied: ops runs GATE-S.
- Field names `harness` and `model` (dispatch fixed values). Patterns from the card, working names to reconcile with kit HC-04.

## Done
- `contract/schemas/event.schema.json`: optional `harness` and `model` beside `thinker_id`; description extended. Generated files regenerated with `generate` only.
- `contract/test/event-stamp.test.ts` (new, 6 cases).
- `eventsink/src/writer.ts`: INSERT_SQL gains `harness, model` and unnest arrays `$9::text[]`, `$10::text[]`; insertParams binds them, null when absent.
- `eventsink/src/writer.test.ts`: param count 10; new case "binds harness and model per event, null when the envelope has none".
- `sql/0037_events_harness_model.sql` (new), `sql/test/check-schema-event-stamp.sql` (new), `.github/workflows/ci.yml` schema psql step gains `-f sql/test/check-schema-event-stamp.sql`.

## Not done / unconfirmed
- Live: GATE-S (apply sql/[0-9]*.sql to scratch DB, run check files, upgrade and reapply lanes) is ops. Not run by the coder.
- IT case in `eventsink/test/eventsink.it.test.ts` (one stamped and one unstamped event land with the right columns): not written. The card marks it optional and says write it only with exact names from a read; I did not read that file for this pass. Needs a database, so it is ops in any case.

## Index line to add
- `sql/README.md` index: add a line for `0037_events_harness_model.sql` (events harness and model stamp) and `test/check-schema-event-stamp.sql`. Not edited by this packet (must-not-edit).

## Checks run
- git diff --check, format, lint (no errors; existing warnings and infos unchanged in count), generate, check:generated, contract and eventsink typecheck, `pnpm test contract/test/event-stamp` (6 passed), `pnpm test eventsink/src/writer` (10 passed), check:repo ok.

## Split
- Contract and SQL first, then the sink write (card's split line).

## Names and harness/model headers
- Names harness and model: agreed with scriptorium (HC-04): headers X-Geldar-Harness and X-Geldar-Model, an absent header means claude; the patterns here are working names until HC-04 merges.

## Deploy order
1. Apply migration 0037 first.
2. Then the sink and every consumer of the contract.
3. Then the producers (GX-01b, GX-01c).
- If the sink image deploys before 0037, every insert fails (the sink writes the two new columns).
- A consumer on the old contract rejects a stamped event (additionalProperties false).
- No migration or contract change reaches the node without geldar-93's deploy window.
- The IT case is not written because eventsink.it.test.ts hard-codes host, port and password file.

## Fix round (ops SQL gate)
- `sql/0037_events_harness_model.sql`: ADD COLUMN IF NOT EXISTS for harness and model, so a reapply is a no-op.
- `sql/test/check-schema-event-stamp.sql`: every fixture is inside a rolled-back probe block, so the file runs twice on one database; adds a 129-character model refusal and the geldar_mcp no-read checks for harness and model.
- `contract/test/event-stamp.test.ts`: 32-character harness accepted, 33 rejected, '1abc' and '-abc' rejected, 128-character model accepted, 129 rejected.
