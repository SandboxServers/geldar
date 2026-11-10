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
