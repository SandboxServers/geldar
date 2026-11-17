# TM-15: `supervisor.log` lines and failures as OTLP logs (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-12. Unblocks: nothing. Mind redeploy: next kit image (batched). `colo-images` path: n/a.

## Goal

Every line the supervisor appends to `supervisor.log` is also emitted as an OTLP log record, with severity, an `event` name and the active trace and span ids. Failures (non-zero exit, no result line, fast fail, save failed, journal page not fresh, upstream refused, stop reasons) become `ERROR` or `WARN` records with a closed `error.type` code. Survey M1 "re-emitted as OTLP logs" and 4.7 (the `started` record).

## Files (exactly these)

- `packages/supervisor/src/telemetry/logs.ts` (new): `emitLogLine(handle, line, ctx)` and `classify(line)`.
- `packages/supervisor/src/supervisor.ts` (edit: the private `log(text)` method gains one call)
- `packages/supervisor/src/telemetry-logs.test.ts` (new)

## Steps

1. Read `supervisor.ts` `log()` and every `this.log(` call site (about 12) to list the line shapes: `run=N turns=.. cost=.. secs=.. exit=.. result=.. delay=.. fails=..`, `tidy run=`, `limited:`, `cap reached`, `stopped`, `held by the keeper`, `save failed`, `journal page not fresh (CODE)`, `prompt run=`.
2. `classify(line)` maps a line to `{ event, severity, errorType? }` using a fixed table, by prefix: `run=` (INFO; WARN when `result=failed`, `error.type` `run_failed`), `tidy run=` (INFO), `limited:` (WARN, `usage_limit`), `cap reached` (WARN, `daily_cap`), `stopped` (INFO), `held by the keeper` (WARN, `held`), `save failed` (ERROR, `save_failed`), `journal page not fresh` (WARN, `journal_page`), `prompt run=` (INFO, `prompt_built`), anything else (INFO, `event=supervisor_line`). `error.type` values are closed codes, never message text.
3. `emitLogLine` emits an OTLP log record through the SDK logger of the handle. Body: the same text the file got (it holds only counts, codes and a reset time; it never holds model text). Attributes: `event`, `run_number`, `player_id`, `error.type` when set; trace and span ids from the open `mind.run` span when one is active (the SDK stamps them from the active context: run the emit inside `context.with(runContext, ...)`).
4. Add a `started` record when a run begins (`event=run_started`, `run_number`), so an orphan start without an end is a log query (survey 4.7). This is the only new record; it is emitted from `RunTelemetry.start` in TM-13's file only if TM-13 is already merged; otherwise from `log()`'s `run_start` hook in this card (the coder picks the one that applies and says which).
5. Wrap in try and catch; never throw. With telemetry off, `log()` is byte-for-byte what it is today.
6. Tests:
   - (a) a failed run yields one `ERROR` or `WARN` record with `error.type=run_failed` and the body equal to the line in the file.
   - (b) every line shape in the table classifies as listed (table-driven test).
   - (c) the log body never contains text from the model: run with a stream whose last text is a canary string; the canary is not in any record.
   - (d) `supervisor.log` is byte-identical with telemetry on and off; a throwing log exporter changes nothing.
7. Revert check: remove the call in `log()`; (a) must fail. Change `classify` so `save failed` is INFO; (b) must fail.

## Checks and commit

Same checks as TM-13. Commit: `T-13 TM-15: supervisor.log lines and failures as OTLP logs (supervisor)` plus the two trailers.

## Do NOT

- Do not log STOP file text, HELD file text, `status.json` or any path under the workspace.
- Do not add a line to `supervisor.log` that was not there before (telemetry-only records are OTLP only).
- Do not raise log volume: no per-heartbeat record.
