# Fix packet E: run harness, report honesty, Glass

Branch `fix/e-harness` from `wave6-main`. Items are committed one at a time; each behaviour change has a test that
fails when its line is reverted.

| Item | Status | Commit |
| --- | --- | --- |
| 1. Glass client: close, error listener, connect timeout, reconnect | done | 9f4a06b |
| 2. Child timeouts (60 s, `adam up` 600 s); sampler tolerates 5 failures in a row | done | 1da3b0b |
| 3. Refuse a start while another run's services live; failed `adam up` runs no safe stop | done | (this commit) |

## Item 1 notes

- `createGlassClient` opens lazily, drops the connection on an `error` event or a failed query (the next query
  reconnects), sets `connectionTimeoutMillis` and exposes `close()`.
- `Sampler.close` delegates to the SQL client; `cli.ts` closes the sampler in a `finally` around `runSequence`.
- Tests: `src/glass-client.test.ts` (fake `pg`, separate file because `vi.mock` is file-wide) and a cli test that the
  sampler is closed when the run ends.

## Item 2 notes

- `Runner.exec` takes an optional `timeoutMs`; a killed child returns code 124 with a `timed out` stderr.
- `adam up` passes 600 s. `processes.list` has a 60 s cap, which throws and so counts as a failed sample. That cap
  has no direct test: forcing PowerShell to hang is not practical in the unit suite.
- `sampler_failed` status lines are written per failure; the fifth in a row aborts with rule `error`.

## Item 3 notes

- `start` refuses (exit 1, manifest untouched) when any process whose command line carries a `SERVICE_MARKERS` entry
  is alive. Those are the stack's services, shared by every run.
- A failed `adam up` writes an abort line that says no safe stop ran, reports, and returns without calling the
  supervisor. A stack that half-started is left for the operator to read in status.log.

## Item 3 revert checks (run after 413c67f)

- `cli.ts` `if (others.length > 0)` mutated to `> 999`: `cli.test.ts` "refuses a start while service processes of another run are alive" fails (expected 0 to be 1). Restored; clean.
- `sequence.ts` failed `adam up` path: one line `await finish('abort', 'error', reason);` added before `await report(now);`. `sequence.test.ts` "a failed adam up runs no safe stop" fails (supervisor calls `stop:lantern-local` recorded). Restored; clean.

## Items B and C (findings 4 and 5), session 2

- B (be88e95): `liveOwner` drops the run-id match. A process started without `--run-id` has the marker, pid and
  start time only; the run id is generated after start, so it cannot be in the command line. The packet's
  "always include --run-id in the spawned process" is not possible for an operator-started process (`geldar.ps1`
  passes the args through unchanged). Test: "a run started without --run-id is live to status and stop" (cli.test.ts).
  Revert-check: run-id match restored on the one line; that test fails. Restored.
- C1 (1f41c01): sampler count, latency and active intent take rows from the run start (`at >= $2`; intents via the
  thoughts of the run). Test: "the sampler reads only this run" (adapters.test.ts). Revert-check: the count query's
  `at >= $2` removed (the diff shows 2 lines: the SQL and its params); that test fails. Restored.
- C2 (4479a3a): report intents, actions and receipts bound to the window. Test: "loadRunData reads only the window"
  (adam-report test/db.test.ts). Revert-check: receipt window removed; that test fails. Restored.
  Not run: `test/report.it.test.ts` needs Postgres and skips here; its query expectations were not re-checked.
- C3 NOT DONE: the start precondition (refuse when the life already has thoughts or intents rows) needs a new
  preflight fact in adapters.ts gather, checkPreconditions in preconditions.ts and the fake in test/fakes.ts.
  Stopped for context. Decision 0064 wording still to be applied: "a fresh life id is needed".
- Items 6-12 not started.
## Session 3: fresh-volume start gate (step 1 of the wave-6 follow-up)

- Committed as dff3983 and 00153ad. Start no longer reads the prepared volume as empty and unmounted. It inspects the
  running Paper container (`paperVolumes`, `docker ps` by the compose service label, then `docker inspect` Mounts) and
  refuses unless Paper mounts exactly the prepared volume at /data. The empty and unused check stays at prepare-volume.
- The 8B and 32B runbooks and `preparedText` now recreate the stack with `docker compose -f compose/phase0.yml -p
  geldar-phase0 up -d --wait` after setting GELDAR_WORLD_VOLUME. `adam down` and `adam up` do not recreate Paper.
- Tests: preconditions.test.ts (Paper on the old default, on no volume, on two volumes, not running; Paper on the
  prepared volume passes), world-volume.test.ts (paperVolumes: null, prepared, old default, two containers refused;
  preparedText names the compose recreate), adapters.test.ts (facts carry paperVolumes).
- Revert checks: the Paper-mount condition replaced by `false` makes 3 preconditions tests fail. The `/data` filter in
  paperVolumes removed made the first version of the test pass (its only other mount was a bind), so the test gained a
  named volume at /cache; with the filter removed, that test fails. Both restored, `git diff --stat` clean.
- adam-run: typecheck clean, 233 tests pass.

## Step 2 (adam-report honesty): NOT STARTED, design decided

Nothing committed for step 2. Plan, one commit per measure:
1. calls (calls.ts): add `INFO` to `Verdict` (types.ts); `calls` returns INFO, not PASS, with the note "recorded, no
   threshold in the spec". Render snapshot update.
2. latency (calls.ts latencyMeasure) and receipts (intents.ts receiptMeasure): UNKNOWN below a minimum sample count
   and minimum span (chosen values to be written in the commit message).
3. model_floor (report.ts modelFloor): echo as INFO only when the value is in an allowed set (proposed: qwen3:8b,
   qwen3:32b, to confirm against the criteria file); otherwise UNKNOWN.
4. continuity restarts: parse `status.log` next to the manifest (JSON lines; `restart_stack` is planned, `body_kill` is
   body; see adam-run sequence.ts lines 293 and 345). Pure parser in a new adam-report file. Missing file means no
   restarts and a note, not a PASS.
5. report header (render.ts): status line from status.log (`abort` line -> aborted, no `end` line -> partial) and the
   window length in hours.
Each needs a test that fails when its line is reverted.

## Step 3

This entry is the record. Items 8-12 remain not started.

## Session 4: adam-report honesty (step 1 of the follow-up)

Committed, one commit per criterion group, each with a revert check:
- calls is INFO, not PASS (5575861). Revert: `calls.ts` verdict set to PASS; 3 tests fail; restored clean.
- latency and receipts: a PASS needs 20 samples over 10 minutes (latency) or 20 terminal actions with receipts over
  10 minutes (receipts); below that, UNKNOWN. FAIL is unchanged (2120f65). Revert: sample floor 0 fails 1 latency test;
  span floor 0 fails 1 receipts test; both restored.
- model_floor: INFO for an allowed tier (8B, 32B, qwen3:8b, qwen3:32b, my choice; the owner confirms), UNKNOWN for any
  other value (e41870a). Revert: allowed-set check disabled; 1 test fails; restored.

NOT DONE (stopped for context):
- continuity restarts from status.log (`restart_stack` planned, `body_kill` body; `at` is ISO). A pure parser in a new
  file, wired in cli.ts, plus a test. config.ts still sets restarts to [].
- report header: aborted (an `abort` line), partial (no `end` or `ended` line), window length in hours (render.ts).
- Step 2 items 8 and 9 not started.

## Session 5: adam-report continuity and header; adam-run abort baseline

Committed, each with a revert check:
- status.log parser (e948d37): `src/status-run.ts` reads planned restarts (`restart_stack`), Body kills (`body_kill`)
  with their `at`, the `abort` line and the `end` line. Revert (body_kill mapped to planned): 2 tests fail; restored.
- continuity and header (3a6c363): cli.ts reads status.log beside manifest.json and sets the restarts; the report
  header states `Run: aborted|not aborted, partial|complete` and `Window length: N hours`. Render snapshots updated.
  Revert (restarts forced to []): 1 cli test fails; restored. Revert (aborted text): cli test fails; restored.
- adam-run lifeEnded baseline (9530bdf): `last.deaths > 0`, since deaths are counted from the run start. The old
  test "a death already counted at the start does not fire again" encoded the bug and now asserts life_ended.
  Revert: 1 test fails; restored.

NOT DONE (stopped for context):
- Step 2a: TPS rule (`tps` is always null in adapters.ts). Not started; the reader or the rule removal is open.
- Step 2b: `bodyConnected` is only "process alive" (adapters.ts). Not started.
- Items 9-12 not started.
