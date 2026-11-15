# AN-10a: exactly-once XP ledger and increment in the sink transaction

Branch `phase1/an-10a-xp-ledger`, from `origin/main` `203d9af2` (the base of this pass). Code against the AN-09a stubs: `awards.ts` (`awardsFor`) and `matrix.ts` are untouched and still throw, so the writer's XP branch is exercised by mocking `awardsFor` in tests.

## Files

- `eventsink/src/xp/ledger.ts`: `XpStore` (unchanged), `applyAward`. Evidence insert first; the bump runs only when the insert returned a row; `setLevel` and `enqueueLevel` run only when the level rose. Unknown life: logged as `xp_skipped_unknown_life`, nothing awarded.
- `eventsink/src/xp/pg-xp-store.ts`: `pgXpStore(client)`, one statement per `XpStore` method, on the writer's transaction client.
- `eventsink/src/xp/xp-config.ts`: `xpEnabled` (`GELDAR_XP === '1'`), `xpThresholds` (`GELDAR_PROFICIENCY_THRESHOLDS`, default psyche `DEFAULT_THRESHOLDS`).
- `eventsink/src/writer.ts`: `pgEventWriter(pool, xp = XP_OFF)`. With `xp.enabled`, every batch takes the transaction; after each event's projection, `awardsFor(event)` results go to `applyAward`. With XP off, the branch is not reached.
- Tests: `eventsink/src/xp/ledger.test.ts` (in-memory store, config), `eventsink/src/writer.projection.test.ts` (XP cases; `awards.ts` mocked), `eventsink/test/xp.it.test.ts` (real DB, `GELDAR_IT=1`, ops and CI).
- `.github/workflows/ci.yml`: `eventsink/test/xp.it.test.ts` added to the integration step after `audit.it.test.ts`.

## Deviations from the card (recorded)

1. `xpEnabled` and `xpThresholds` live in `xp-config.ts`, as the may-edit line and AN-S0 conflict 4 say; `ledger.ts` does not re-export them.
2. `applyAward` takes an optional fourth parameter, `log` (default `console.warn`), so the skip line has somewhere to go. The three-argument call of the scaffold is unchanged.
3. `pgEventWriter` takes an optional second parameter `xp` (default off). AN-12 wires it from `xpEnabled(env)` and `xpThresholds(env)`; nothing in `main.ts` changes here.
4. A set but malformed or unordered `GELDAR_PROFICIENCY_THRESHOLDS` throws `RangeError` at startup. The card says "else DEFAULT"; a typo silently counting with other thresholds was judged worse. Unset or blank gives the default.
5. The level rose when `levelForXp(xp)` is above the level stored in `proficiency.level`. The stored level comes back from the bump's `UPDATE ... RETURNING xp, level` in the same statement, under the same row lock, so it is the level before this award (0 for a new row). This replaces the first commit's stateless `levelForXp(xp) > levelForXp(xp - 1)`, which missed a level whenever the thresholds changed after a level was stored (a zero threshold, or lowered thresholds after a restart). `XpStore.bump` now returns `{ xp, level }`; this is the only signature change.
6. Tied thresholds (for example `5,5,70`): one award can cross two levels. Decision: only the highest is stored (`setLevel`) and enqueued, so one award gives one outbox row. The receiver only needs the highest level, so the lower one is not published. Lowered thresholds take effect at the next award that crosses a level; they do not re-announce a level already stored.

## Checks

- Revert-check 1 (`ledger.ts`, `if (!(await store.insertEvidence(award))) return ...` replaced by a bare `await store.insertEvidence(award);`): `ledger.test.ts` "a redelivered award adds nothing: the evidence insert returns no row and no bump runs" fails (`expected { awarded: true, level: null } to deeply equal { awarded: false, level: null }`). The IT case "a redelivered award adds one XP once" fails the same way on a real database (not run here).
- Revert-check 2 (`ledger.ts`, `const rose = level > levelForXp(xp - 1, thresholds);` replaced by `const rose = level > 0;`, so enqueue runs on every award at level 1 or more): `ledger.test.ts` "enqueues exactly one outbox row per level, at 10, 30 and 70, and none past the last" fails (enqueue list `[1, 1, 1, ...]` against `[1, 2, 3]`). This mutation is a guard change, not the card's "move enqueueLevel before setLevel's guard".
- Both files were restored from a scratchpad backup; the diff against the commit was empty.
- Revert-check 2 above names a guard that the fix pass replaced (deviation 5); its test still passes on the fix.

## Fix pass (review of 0992bcef)

- Level rise from the stored level (deviation 5). Unit tests: "a zero threshold reaches level 1 on the first award" (`[0,30,70]`) and "lowered thresholds after a restart reach the new level at the next award" (7 awards at `10,30,70`, then `5,30,70`) failed on the first commit and pass now. "tied thresholds" (`5,5,70`) passes on both: it pins the highest-only choice.
- `setLevel` is asserted: the unit store records levels, and "the stored level follows each crossing" checks 0, 1, 2, 3 at 9, 10, 30, 70. The IT case "setLevel stores the level in proficiency at each crossing" reads `proficiency.level` after 9, 10, 29, 30, 69, 70 awards.
- `version` is the life total: "the outbox version is the life total across domains" (5 combat, then 10 mining; version 15) in the unit file and the IT file.
- Writer case in the IT file: `pgEventWriter(pool, { enabled: true, ... })` with `awards.ts` mocked (the stub throws). Eleven events, ten keys (one key from two sources): xp 10, level 1, 10 evidence rows, 11 events; the same batch again adds nothing. This exercises the batch transaction, `SET xp = EXCLUDED.xp` and the evidence `ON CONFLICT DO NOTHING` end to end.
- Not run (no Postgres here; `GELDAR_IT=1` in CI). Hand trace against `sql/0001_init.sql` and `sql/0050_character_sheet_xp.sql`: `events` has no NOT NULL column beyond the INSERT's own (`type` is free text, no CHECK), so the `speech` events in the writer case insert; `proficiency.domain` and `proficiency_outbox` accept `mining` and `combat`; `level` is SMALLINT, read back with `Number`; the seeded agent sets every NOT NULL column as before; each life id matches the LifeId pattern; the 201-character key is still refused by the evidence CHECK.

## Notes for AN-10b, AN-11a and AN-12

- Version ordering (what holds). `version` is `SUM(xp)` for the life, read at READ COMMITTED inside the award's transaction. With one consumer writing one life, transactions run one after another and each sees every earlier committed bump, so `version` is non-decreasing per life in `outbox_id` order. With two writers on one life (two sinks handling different domains of the same life at once), a transaction's sum can miss the other's uncommitted bump, so `version` can decrease across rows. The row locks themselves are correct (no lost update, the crossing is seen once). AN-10b and AN-11a must treat `version` as non-decreasing per life only while one writer per life holds; otherwise they order by the rows' level per (life, domain) and do not drop a row because its `version` is lower than one already seen.
- AN-12: call `xpThresholds(env)` only when `xpEnabled(env)` is true (a malformed value throws, so with XP off it would crash the sink for nothing).
- AN-12: do not set `GELDAR_XP=1` before AN-09a is merged. The stub `awardsFor` throws a plain `Error` with no SQLSTATE, so `isPermanentDbError` is false and `consumer.ts` naks the batch forever: the stream stalls with no dead letter.

## Not run here

- `eventsink/test/xp.it.test.ts` is written, not run (no Postgres here; `GELDAR_IT=1` on a throwaway database, as CI does). Each case was checked against `sql/0050_character_sheet_xp.sql` and `sql/0001_init.sql` by reading: the `agents` seed sets every NOT NULL column; the life id matches the LifeId pattern; the evidence key is 1 to 200 characters in the cases that pass; the poison case (201 characters) is refused by `CHECK (length(evidence_key) BETWEEN 1 AND 200)` with 23514, which `isPermanentDbError` treats as permanent.
- The writer does not yet run `applyAward` in production (AN-12 wires it), and `awardsFor` is still a stub: with `GELDAR_XP=1` before AN-09a lands, every event's award call throws.
