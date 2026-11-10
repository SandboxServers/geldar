# Fix packet E: run harness, report honesty, Glass

Branch `fix/e-harness` from `wave6-main`. Items are committed one at a time; each behaviour change has a test that
fails when its line is reverted.

| Item | Status | Commit |
| --- | --- | --- |
| 1. Glass client: close, error listener, connect timeout, reconnect | done | (see git log) |

## Item 1 notes

- `createGlassClient` opens lazily, drops the connection on an `error` event or a failed query (the next query
  reconnects), sets `connectionTimeoutMillis` and exposes `close()`.
- `Sampler.close` delegates to the SQL client; `cli.ts` closes the sampler in a `finally` around `runSequence`.
- Tests: `src/glass-client.test.ts` (fake `pg`, separate file because `vi.mock` is file-wide) and a cli test that the
  sampler is closed when the run ends.
