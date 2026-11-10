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