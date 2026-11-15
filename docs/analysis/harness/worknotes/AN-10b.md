# AN-10b: level outbox publisher and reconciliation

Branch `phase1/an-10b-xp-outbox`, from `origin/main` `5df59f9a` (the base of this pass). Replaces the AN-S0 stub in `eventsink/src/xp/outbox.ts`; exported signatures kept (`LevelPush`, `startOutboxPublisher`, `stop`, `drainOnce`). Not wired into `eventsink/src/main.ts` (AN-12).

## Files

- `eventsink/src/xp/outbox.ts`: `startOutboxPublisher`, plus two exported helpers (`RETRY_CAP_MS`, `retryDelayMs`).
- `eventsink/src/xp/outbox.test.ts`: unit cases over an in-memory fake of `proficiency_outbox` and `agents` (staged marks, applied on COMMIT, dropped on ROLLBACK), with fake-timer cases for the loop and a subject drift block that imports `contract/src/subjects.ts` by relative path.
- `eventsink/test/xp-outbox.it.test.ts`: 8 cases, real Postgres and the CI NATS (`127.0.0.1:4222`, no credentials), `GELDAR_IT=1`, shard `phaseitoutbox`. `beforeAll` marks every pre-existing unpublished row published; the bogus-domain row is unique per run and marked published in `afterEach`.
- `.github/workflows/ci.yml`: the IT file is a separate step, `xp outbox integration test (serial)`, after the parallel integration step and before `stop the eventsink`. It is not in the parallel list, because the publisher claims every unpublished row in the shared database and `xp.it.test.ts` leaves unpublished rows.

## Design

- One transaction per pass: `BEGIN`; claim up to `batch` rows; push each in `outbox_id` order; `UPDATE ... SET published_at = now()` for the rows pushed (and the collapsed ones); `COMMIT`. A push that throws stops the pass after the rows already pushed; those are marked, the failed row and the rest stay unpublished. A crash before `COMMIT` rolls every mark back, so the rows go out again (at least once).
- Claim: `ORDER BY o.outbox_id LIMIT $1 FOR UPDATE OF o SKIP LOCKED`, joined to `agents` for the shard.
- Monotonic version: `version` is the life total XP, so it is not monotonic per domain under two sinks. A row whose version is below the highest version already published for the same (life, domain) (committed rows, or pushed earlier in this pass) is marked published without a push (collapsed). An equal version is pushed again (duplicates tolerated).
- Contract failure: a row failing `validateProficiencyLevelPayload`, or whose shard does not match the contract's `SHARD` pattern (`^[a-z][a-z0-9-]{1,31}$`), is logged as `outbox_rejected outbox_id=<id> total=<n>`, left unpublished, not deleted. The process remembers the id and excludes it from later claims, so a poison row cannot starve the batch. The log holds no level, XP or sheet value.
- Retry: a failed pass (push or database error) waits `retryDelayMs(intervalMs, failures)`: `intervalMs` doubled per consecutive failure, capped at `max(intervalMs, 30000)`. A full batch schedules the next pass at once. `stop()` clears the timer and waits for the pass in flight; no pass starts after `stop()`, and `drainOnce` after `stop()` returns 0 without taking a connection. The timers are unref-ed.
- Client hygiene: a transaction that throws releases its client with that error, so a dead connection is destroyed, not pooled. A failed `ROLLBACK` does not replace the original error.
- The first loop pass waits one interval (not zero), so a caller's `drainOnce` is never raced by the loop.
- Writer isolation: the publisher takes its own pool client; it never shares the writer's transaction.

## Deviations from the card (recorded)

1. The subject is built locally, `geldar.<shard>.state.<life>.level`. `proficiencyPushSubject` exists in `contract/src/subjects.ts` but is not exported from `contract/src/index.ts` and the package exports no subpath. The contract is not in the may-edit list, so it was not edited. The shard is checked with the contract's own pattern (copied, and a drift test imports the contract helper); the life id is checked by `validateProficiencyLevelPayload`, which uses the same `LifeId` pattern.
2. Claim is `FOR UPDATE OF o SKIP LOCKED` (the card says `FOR UPDATE SKIP LOCKED`). With a join, the bare form also locks the `agents` row, which the Mind updates; `OF o` locks only the outbox row.
3. The rejected-row counter is per process: a counter with the ids in the log, not a column (the card's "counter" has no table; `proficiency_outbox` has no column for it and the schema is 0050's).
4. Stale rows are marked published (not deleted), which is what the 0050 comment says the publisher does.
5. The IT file runs `publish` against the real NATS client; `drainOnce` is explicit, the loop never runs in the IT.
6. Collapse compares `version`, not `level` as the AN-10a note said. This supersedes the AN-10a "level" wording. Collapsing by version is safe: `version` is non-decreasing per (life, domain) in level order, because the proficiency row lock serializes the SUM statements that write it, so each later level carries a version at least as high. A row below a published version can therefore only be an earlier level that a later one overtook (it was left behind by a crash or a skipped lock), and dropping it cannot move the Body backwards. Version is kept because it is the field the Body compares (`push.version <= cached` is ignored), so the collapse rule and the Body rule match.

## Revert-checks

Each mutation was applied to one file alone, the named test run with `vitest run eventsink/src/xp`, and the file restored from a scratchpad backup (`git diff --stat` empty afterwards).

- Drop order (`ORDER BY o.outbox_id` removed from the claim): "publishes in outbox_id order even when the rows are stored out of order" fails.
- Allow version decrease (`if (version < floor)` replaced by `if (false)`): "collapses a stale row ..." and "a stale row inside one batch ..." fail.
- No retry backoff cap: "retryDelayMs doubles from the interval and never exceeds the cap" fails.
- Mark before publish (`marks.push(id)` moved above the push): "a failed push leaves the row unpublished ..." and "a push that dies after the send ..." fail.
- Drop SKIP LOCKED: the claim-text unit case "the claim locks only the outbox row ..." fails; the IT case "two publishers do not double-claim" is the live guard (not run here, no Postgres).
- The loop and client mutations are listed in the commit's report (`removing if (!stopped)`, `ignoring retryDelayMs on failure`, `release without the error`, `unguarded ROLLBACK`, `drainOnce after stop without the guard`, `the timer not unref-ed`).

## Checks

- Not run here: the IT file (no Postgres or NATS on this machine; CI runs it in the serial step). Each case was reasoned through `sql/0050` by hand: the outbox has no CHECK on `domain`, `level` is 1 to 3, `version` is BIGINT (read back as a string and converted), `UNIQUE (life_id, domain, level)` is not hit.
- Seed: every NOT NULL column of `sql/0001_init.sql` (`agent_id`, `name`, `life_seq`, `game_account`, `shard`, `model_config`, `tier`).
- Life ids: `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`, fresh per case.
