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
- `eventsink/src/audit/projection.test.ts` (new): 20 unit tests, including SQL-text tests and fake-database tests on `pgAuditStore` (the decision keys, the agents row).
- `eventsink/src/writer.ts`: the batch transaction also runs for `AUDIT_TYPES`; after `projectEvent`, `projectAudit(event, pgAuditStore(client))` runs in the same transaction. `projection.ts` and `ProjectionStore` are unchanged.
- `eventsink/src/writer.projection.test.ts`: 3 dispatch tests (roll and decision in one transaction; a failing roll insert rolls back; a `sheet_adopted` reaches the adoption path and is refused).
- `eventsink/test/audit.it.test.ts` (new): real-DB test, skipped unless `GELDAR_IT=1`. Not run here (ops). The agent seed inserts every NOT NULL column of `agents` (`sql/0001_init.sql`), with `game_account` set to the fresh life id.
- `docs/analysis/harness/worknotes/AN-06a.md` (this note).

## Deviations from the card, and why

- The adoption log insert is `ON CONFLICT (source_event_id) DO NOTHING`. The card does not say this. Without it, a redelivered `sheet_adopted` event would hit the unique key on `source_event_id` and be dead-lettered.
- `adopt` uses `UPDATE ... RETURNING agent_id` instead of a row count, because the `Queryable` type in `projection.ts` returns rows only.
- An unknown life in `adopt` throws `ProjectionRejectedError('23503')` directly. This is the same refusal the foreign key gives, and the consumer treats it as permanent.
- The branch is `phase1/an-06a-sink-audit` as the brief says. The card names `codex/an-06a-sink-audit`.
- `node_modules`: the worktree has junctions to the main checkout's root and `contract/node_modules`. `eventsink/node_modules` is a real folder with junctions to the main checkout's entries, and `@geldar/contract` is a junction to this worktree's `contract/`. A plain junction would have made `@geldar/contract` resolve to the main checkout's older contract. All of these are untracked and git-ignored.
- `./geldar.ps1 pnpm` fails on this machine: the corepack shim cannot find `node` under `C:\Users\Steve\source\Program Files\nodejs`. I ran `node node_modules/vitest/vitest.mjs`, `node node_modules/typescript/bin/tsc` and `node node_modules/@biomejs/biome/bin/biome` directly.

## Checks run

- First pass, `vitest run eventsink/src/audit eventsink/src/writer`: 3 files, 29 tests passed (after the implementation).
- Fix pass (second commit), same command: 3 files, 33 tests passed. `tsc -p eventsink --noEmit`: exit 0. `biome check` on the touched files: clean.
- Before the implementation: 3 writer tests failed (no dispatch) and the audit test file failed to load (module missing), as expected.
- Not run: the whole `./geldar.ps1 check`, the live lane, Docker, and `audit.it.test.ts`.

## Revert-checks (run on the committed fix; one line changed, file restored from a scratchpad backup)

Each line names the test expected to fail.

1. Rolls `ON CONFLICT DO NOTHING` removed (`store.ts`): `pgAuditStore SQL > inserts a roll with ON CONFLICT DO NOTHING`. This is a text match only. The durability proof for roll redelivery is the IT case `a redelivered roll and a producer retry of the same draw are one row each`, which is written but not run here.
2. Life check replaced with `if (false) {` (`projection.ts`): `a payload for another life > rejects a payload for another life, for every audit type, and writes nothing`.
3. Decisions `ON CONFLICT DO NOTHING` removed (`store.ts`): `pgAuditStore SQL > a decision redelivered, or retried under a new event id, is one row and no error`. The test uses a fake that enforces the decision keys and throws 23505 without the clause. The IT case `a redelivered decision and a producer retry of the same decision are one row` is written, not run.
4. `AND character_sheet IS NULL` removed from the adopt UPDATE (`store.ts`): `pgAuditStore SQL > a second adoption of another sheet is a conflict and the first sheet stays`. The test uses a fake agents row that the UPDATE overwrites when the guard is absent. The IT case `a second adoption of another sheet is a conflict row and leaves the baseline sheet and hash` is written, not run.
5. `FOR UPDATE` removed from the stored-hash SELECT (`store.ts`): `pgAuditStore SQL > reads the stored hash FOR UPDATE ...`. This is a text match only. The lock is checked by the IT case `an adoption that finds a baseline holds the agent row lock until its transaction ends` (a second connection's `FOR UPDATE NOWAIT` must get 55P03), which is written, not run.

## Not verified

- `eventsink/test/audit.it.test.ts` has not been run. Ops must run it with `GELDAR_IT=1` on a throwaway database. The seed's column list was checked against `sql/0001_init.sql` by reading; it has not been executed.
- The "kill the transaction mid-batch" case is simulated with an unknown life (foreign key failure), not with a killed connection.
- The SQL-text tests check statement text, not behaviour. The fake-database tests check the decision keys and the adopt guard. Only the IT checks the real lock.
- The malformed-roll and unknown-life cases check that the write is refused with its reason. The dead-letter route for 23514 and 23503 (`writer.ts`, permanent-error classing) is not exercised by a test in this card.
- No live Mind, sink or NATS run.
- CI lane: `eventsink/test/audit.it.test.ts` is in the explicit file list of the "integration tests that need Postgres or NATS" step in `.github/workflows/ci.yml`, after `projection.it.test.ts`.
- It skips unless `GELDAR_IT=1` (as `projection.it.test.ts` does) and connects as `geldar` at 127.0.0.1 with the CI password file and the shared-DB guard (`GELDAR_IT_ALLOW_SHARED_DB`, `GITHUB_ACTIONS`), the same as the other ITs in that step; it runs after the step that applies `sql/[0-9]*.sql`, so migrations 0050 and 0051 are in place.
- No change to `audit.it.test.ts` was needed for the CI env. The lane has not run it yet; the first CI run is the first execution.
