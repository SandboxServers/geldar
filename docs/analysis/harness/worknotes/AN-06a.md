# AN-06a: sink audit projection (rolls, decisions, adoptions)

Branch `phase1/an-06a-sink-audit` (from origin/main bdec86aa). Card: `docs/analysis/harness/work-packets-geldar-a.md`, section AN-06a.

## What changed

- `eventsink/src/audit/projection.ts` (new): `AUDIT_TYPES`, `AuditStore`, `RollRow`, `DecisionRow`, `projectAudit`.
  - Validates with `validateRollEventPayload`, `validateDecisionEventPayload`, `validateSheetAdoptedPayload`.
  - `payload.life_id` must equal `event.agent_id`, else `ProjectionRejectedError('23514')` (dead letter).
  - A `d20` decision is stored without its rolls (no foreign key on `roll_event_ids`).
- `eventsink/src/audit/store.ts` (new): `pgAuditStore(db)`.
  - `insertRoll` and `insertDecision`: `ON CONFLICT DO NOTHING`.
  - `adopt`: `UPDATE agents ... WHERE character_sheet IS NULL RETURNING agent_id`; when no row changed, `SELECT sheet_hash ... FOR UPDATE` gives `same` or `conflict`; then one `character_sheet_adoptions` row.
- `eventsink/src/audit/projection.fakes.ts` (new): `MemoryAuditStore` and the `rollEvent`, `decisionEvent`, `sheetEvent` builders.
- `eventsink/src/audit/projection.test.ts` (new): 16 unit tests, including two SQL-text tests on `pgAuditStore`.
- `eventsink/src/writer.ts`: the batch transaction also runs for `AUDIT_TYPES`; after `projectEvent`, `projectAudit(event, pgAuditStore(client))` runs in the same transaction. `projection.ts` and `ProjectionStore` are unchanged.
- `eventsink/src/writer.projection.test.ts`: 3 dispatch tests (roll and decision in one transaction; a failing roll insert rolls back; a `sheet_adopted` reaches the adoption path and is refused).
- `eventsink/test/audit.it.test.ts` (new): real-DB test, skipped unless `GELDAR_IT=1`. Not run here (ops).
- `docs/analysis/harness/worknotes/AN-06a.md` (this note).

## Deviations from the card, and why

- The adoption log insert is `ON CONFLICT (source_event_id) DO NOTHING`. The card does not say this. Without it, a redelivered `sheet_adopted` event would hit the unique key on `source_event_id` and be dead-lettered.
- `adopt` uses `UPDATE ... RETURNING agent_id` instead of a row count, because the `Queryable` type in `projection.ts` returns rows only.
- An unknown life in `adopt` throws `ProjectionRejectedError('23503')` directly. This is the same refusal the foreign key gives, and the consumer treats it as permanent.
- The branch is `phase1/an-06a-sink-audit` as the brief says. The card names `codex/an-06a-sink-audit`.
- `node_modules`: the worktree has junctions to the main checkout's root and `contract/node_modules`. `eventsink/node_modules` is a real folder with junctions to the main checkout's entries, and `@geldar/contract` is a junction to this worktree's `contract/`. A plain junction would have made `@geldar/contract` resolve to the main checkout's older contract. All of these are untracked and git-ignored.
- `./geldar.ps1 pnpm` fails on this machine: the corepack shim cannot find `node` under `C:\Users\Steve\source\Program Files\nodejs`. I ran `node node_modules/vitest/vitest.mjs`, `node node_modules/typescript/bin/tsc` and `node node_modules/@biomejs/biome/bin/biome` directly.

## Checks run

- `vitest run eventsink/src/audit eventsink/src/writer`: 3 files, 29 tests passed (after the implementation).
- Before the implementation: 3 writer tests failed (no dispatch) and the audit test file failed to load (module missing), as expected.
- `tsc -p eventsink --noEmit`: exit 0.
- `biome check --write` on the 6 changed files: "Checked 6 files. Fixed 2 files." (formatting only); a second check is clean.
- Not run: the whole `./geldar.ps1 check`, the live lane, Docker, and `audit.it.test.ts`.

## Revert-checks (run on the committed WIP, file restored from a scratchpad backup)

1. Removed `ON CONFLICT DO NOTHING` from the `rolls` insert (`store.ts`, 1 line): `pgAuditStore SQL > inserts a roll with ON CONFLICT DO NOTHING` failed (`INSERT INTO rolls ... ` does not match `/ON CONFLICT DO NOTHING\s*$/`).
2. Replaced the life check with `if (false) {` (`projection.ts`, 1 line): `a payload for another life > rejects a payload for another life, for every audit type, and writes nothing` failed ("promise resolved instead of rejecting").

Both restored; `git diff --stat` empty afterwards.

## Not verified

- `eventsink/test/audit.it.test.ts` has not been run. Ops must run it with `GELDAR_IT=1` on a throwaway database.
- The agent seed in that test inserts only `agent_id`. The other NOT NULL columns of `agents` were not checked against the schema.
- The "kill the transaction mid-batch" case is simulated with an unknown life (foreign key failure), not with a killed connection.
- The SQL tests check statement text, not behaviour; the IT test is the durability proof.
- No live Mind, sink or NATS run.
