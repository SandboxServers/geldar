# TM-19: tail the session file for per-turn latency (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-17. Unblocks: honest timing for TM-17's spans. Mind redeploy: next kit image (batched). `colo-images` path: n/a.

## Goal

The stream has no per-line timestamps (README A4). While a run is going, read `session-<n>.jsonl` as it grows, remember when each line first appeared, and hand those times to `exportSession` so `chat` and `execute_tool` spans have real start and end times (to the polling interval, 1 s). The tail is read-only and runs in the supervisor.

## Files (exactly these)

- `packages/supervisor/src/telemetry/tail.ts` (new): `class SessionTail { poll(): void; arrivals(): Array<{ line: string; atMs: number }> ; stop(): void }`
- `packages/supervisor/src/supervisor.ts` (edit: 2 lines: start the tail with `this.deps.every(1000, () => tail.poll())` before `exec`, stop it after)
- `packages/supervisor/src/telemetry/run-span.ts` (edit: pass the tail's arrivals to `exportSession` as `timing`)
- `packages/supervisor/src/telemetry-tail.test.ts` (new)

## Steps

1. Read `deps.ts` (`every`, `now` in whole seconds). Millisecond times come from an injected `nowMs()` (default `Date.now`); the fixture passes a fake.
2. `SessionTail` keeps a byte offset, opens the file read-only on each poll, reads from the offset to the end (at most 1 MiB per poll), splits complete lines (keeps a partial line for the next poll), and records `{ line, atMs }`. It keeps at most 20,000 lines and 64 MiB; beyond that it stops recording and sets `overflow` (the export then falls back to `timing=none` for later lines).
3. A missing file, a read error or a truncated file is not an error: skip and try again. Never throws.
4. Memory: the arrivals are held until the run ends and the export consumes them, then released. Nothing is written to disk.
5. `exportSession` matches arrivals to records by line index (the parser emits records per line; use the line number the parser reports, or count lines in step). A `chat` span starts at the previous line's arrival (or the run start for the first turn) and ends at its own line's arrival; an `execute_tool` span starts at its `tool_use` turn's arrival and ends at its `tool_result` line's arrival.
6. With telemetry off the tail is never created (`every` is not called). The fake `Deps.every` count in existing tests must stay as today when telemetry is off.
7. Tests:
   - (a) with fake time advancing 1 s per poll, a stream written in three steps yields spans whose start and end times equal the poll times at which each line first appeared; `timing=observed`.
   - (b) a partial line is not recorded until completed.
   - (c) an unreadable file never throws and recording resumes.
   - (d) overflow sets `timing=none` for the remaining spans and the loop is unaffected.
   - (e) telemetry off: `every` is called exactly as often as before this card (read the number from the existing fixture tests).
   - (f) the poll never opens the file for writing (assert via a fake `fs` wrapper or by making the file read-only) and the session file is byte-identical.
8. Revert check: always use the run end time for spans; (a) must fail. Call `every` when telemetry is off; (e) must fail.

## Checks and commit

Same as TM-13. Commit: `T-13 TM-19: tail the session file so spans get real turn latency (supervisor)` plus the two trailers.

## Do NOT

- Do not watch files with `fs.watch` (platform quirks); poll.
- Do not read the workspace, the journal or memory files.
- Do not hold raw lines longer than needed, and do not log them.
- Do not poll faster than once a second.
