# Wave 1 review fixes (pass 1 of 3)

Branch phase0/wave1-fix. Applies only the five fixes named in the brief.

## Changes

1. **Loopback port check.** New `tools/repo-checks/src/loopback-ports.ts` (rule and scan) and `loopback-ports.test.ts` (7 tests). `cli.ts` runs it over `compose/*.yml`, working and untracked files included. A `ports:` entry that does not start with `127.0.0.1:` fails `pnpm check:repo` with file and line.
   - Proof by revert: `compose/phase0.yml` with `"127.0.0.1:5432:5432"` changed to `"5432:5432"` made `check:repo` fail at `compose/phase0.yml:27`. The file was restored, and `check:repo` passed again.
   - Threat model section 1 now states that CI enforces only the port rule, and that ONLINE_MODE, the whitelist and secrets-not-in-env are proven by `compose/probe/login-probe.mjs`.
2. **Threat model section 4 rule 4.** Lists the open objects in the merged contract, each checked against `contract/schemas`: snapshot `events_since_last_thought` items, `WorldEvent.payload`, `ActionRecord.args` and `.result`, `Intent.arguments` and `.checkpoint`, `use_skill.args`. Each must be validated against a per-kind schema before use and is otherwise bounded only by `MAX_FRAME_BYTES`.
3. **Final-receipt constraint (`sql/0001_init.sql`).**
   - `receipts.phase` CHECK (`prepared`, `committed`, `aborted`).
   - `CREATE UNIQUE INDEX receipts_one_final_per_action ON receipts (action_id) WHERE phase IN ('committed','aborted')`.
   - `actions.state` CHECK (the five contract states), in the same style as `intents.state`.
   - Each is marked `-- differs from spec Appendix D: ...`.
   - `sql/test/check-schema.sql`: the existing unique-key query now skips partial indexes (`indpred IS NULL`), so the new partial index is not reported as a unique key on `action_id` alone. Added assertions for the partial index, the `receipts.phase` CHECK and the `actions.state` CHECK.
4. **`sql/README.md`.** Note that Phase 0 is one database per shard, so `WorldEvent.shard` has no column and the event sink drops it. Revisit before Phase 1 multi-shard.
5. **`.claude/skills/run-shard/SKILL.md`.** Deleted the stale P0-06 sentence.

## Verification (throwaway container)

Container `geldar-wave1-fix-pg` from the CI digest (`pgvector/pgvector:0.8.6-pg16@sha256:ccc6e83d...`), published on `127.0.0.1:55432`, removed afterwards.

- Unmodified `0001_init.sql` plus `check-schema.sql`: passes (18 tables, pgvector 0.8.6).
- Each guarded item removed, then `check-schema.sql` run:
  - no phase CHECK: `receipts.phase needs a CHECK limited to prepared, committed and aborted`
  - no partial index: `receipts needs a partial unique index on (action_id) WHERE phase IN (committed, aborted)`
  - no state CHECK: `actions.state needs a CHECK limited to the contract action states`
- Insert behaviour on the full schema:
  - committed then aborted for one `action_id`: rejected (`duplicate key ... receipts_one_final_per_action`)
  - prepared then committed: accepted
  - phase `bogus`: rejected

## Checks

- `./geldar.ps1 check`: `All checks passed.` (biome, typecheck, vitest 140 passed, repo checks ok, generated up to date, compose config).
- `pnpm lint` was first red on the new test (template-like string) and on formatting; fixed. Typecheck was first red on `noUncheckedIndexedAccess`; fixed.

## Deviations

- Commit trailers: used the two lines in the brief (Co-Authored-By: Claude Sonnet 5.5). The attribution note in the session context asks for Claude Haiku 5.5 instead. Not changed; the lines may need correcting.
- `docs/threat-model.md` and `sql/README.md` are LF in the index (`.gitattributes` eol=lf), not CRLF as the brief's note says. Left LF, as the repo stores them.
- The report is in `.claude/reports/`, which is gitignored, so it is not part of the commit.
