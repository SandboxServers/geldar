# TM-13: `mind.run` span, run metrics and state gauge (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-12. Unblocks: TM-14, TM-17. Mind redeploy: next kit image (batched). `colo-images` path: n/a.

## Goal

One span `mind.run` per run (play or tidy), the root of the Mind half of a trace; counters and a gauge for runs, cost, tokens, limits and state. All emitted from outside the model's process. Survey M1 and M5.

## Files (exactly these)

- `packages/supervisor/src/telemetry/names.ts` (new): the pinned names (span names, metric names, event names, attribute names). One place, so a rename is one edit.
- `packages/supervisor/src/telemetry/run-span.ts` (new): `RunTelemetry` class.
- `packages/supervisor/src/supervisor.ts` (edit, call lines only; see line budget)
- `packages/supervisor/src/telemetry-run.test.ts` (new)

## Line budget for `supervisor.ts`

It is 668 lines; the hard cap is 700. Add at most 12 lines. If the finished file would pass 690, first move the private `status()` writer (lines about 189 to 212) into `packages/supervisor/src/status-file.ts` as a pure function `writeStatus(path, body)` and call it; that file is then also in this card. Report the final line count.

## Names (`names.ts`)

- Span: `mind.run`. Attributes (trace allow-list names from TM-01): `harness`, `run_number`, `run_kind` (`play` or `tidy`), `run_id` (`<player_id>/<n>`), `player_id`, `gen_ai.request.model` (the declared model, `GELDAR_RUN_MODEL`, empty string omitted), `gen_ai.operation.name` = `invoke_agent`, `gen_ai.provider.name` (`anthropic` for claude, `openai` for chatgpt), `gen_ai.conversation.id` (= `run_id`), `exit_code`, `turns`, `cost_usd`, `duration_s`, `outcome` (`ok`, `failed`, `limited`), `fails`, `limit_kind` (only when limited).
- Metrics (names from the survey; labels only `harness`, `result`, `state`, `kind`, `direction`; NEVER `player_id`): counter `mind_runs_total{harness,result}`, histogram `mind_run_seconds{harness}`, counter `mind_cost_usd_total{harness}` (add the run's cost), counter `mind_tokens_total{harness,direction}` (filled by TM-17; declared here), counter `mind_limit_waits_total{kind}`, observable gauge `mind_state{state}` with one series per state and value 1 for the current one (`running`, `sleeping`, `limited`, `held`, `stopped`, `idle`).
- Span events on `mind.run`: `limit_wait` (attr `limit_kind`), `held`, `auto_stop`. Event text never includes the STOP file text (it can hold a free-form reason).

## Steps

1. Read `supervisor.ts` around `rounds()`, `oneRun`, `oneTidy`, `hold`, `idle`, `waitLimit` (about lines 336 to 470, 600 to 668) and `fixture.ts` once.
2. Write `run-span.ts`: `class RunTelemetry { constructor(handle, settings, nowMs) ; start(n, kind): void; end(result: { code, turns, cost, secs, outcome, limitKind? }): void; state(name): void; limit(kind): void; context(): Context | undefined }`. With a disabled handle every method is a no-op that allocates nothing.
3. Every method body is wrapped in `try { ... } catch { dropped++ }`. No method returns a promise the loop must await.
4. In `rounds()`: create `const tel = new RunTelemetry(...)` once; call `tel.start(n, tidy ? 'tidy' : 'play')` right after `n = nextRunNumber(...)`; `tel.end(...)` right after `costs.csv` is appended (when `turns`, `cost`, `code`, `secs`, `ok` are known); `tel.state(...)` next to each `this.status(...)` call that sets a state; `tel.limit(kind)` inside `waitLimit`. Nothing else.
5. The span start time is the run start (`t0`), the end time is `t1`, taken from the supervisor's existing clock values (seconds, converted to ms), so the span matches `supervisor.log` exactly.
6. Tests (`telemetry-run.test.ts`, using `makeFixture` and the package's in-memory exporter seam):
   - (a) a successful run produces one `mind.run` span with `run_number`, `exit_code` 0, `turns`, `cost_usd`, `outcome=ok` and no attribute outside the allow-list (zero drops: `attributeDropCount()` unchanged).
   - (b) a failed run (exit 1) gives `outcome=failed`; a usage-limit run gives `outcome=limited`, `limit_kind` set, and a `limit_wait` event.
   - (c) metrics: `mind_runs_total` increments with `result` matching `supervisor.log`'s `result=`; no metric series carries `player_id` or `run_id`.
   - (d) dead exporter (exporter throws on every call and one that never resolves): `rounds()` finishes in the same number of fake-clock steps as with telemetry off, and `status.json`, `costs.csv`, `supervisor.log` and the exit code are byte-identical to the telemetry-off run.
   - (e) telemetry off: no span, no metric, and the three files are byte-identical to a run on the unmodified loop (store the expected strings from the existing `supervisor.test.ts` cases).
   - (f) no file under the workspace directory changes because of telemetry (list the workspace before and after).
7. Revert check: delete the `tel.end(...)` call; (a) must fail. Make `RunTelemetry.start` throw; (d) must fail because the loop would change.

## Checks

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm check:repo
git diff --check
```

## Commit

`T-13 TM-13: mind.run span, run metrics and state gauge (supervisor)` plus the two trailers.

## Do NOT

- Do not add `player_id`, `run_id` or any identity to a metric label (0350 point 1, 0088).
- Do not record STOP, HELD or `status.json` text, only the closed state and reason codes above.
- Do not await any telemetry call in the loop; do not add a timer other than the SDK's.
- Do not change `costs.csv`, `status.json`, `supervisor.log` or `heartbeat` formats.
- Do not pass the span context to the child: the child environment stays free of telemetry context (R3, 0350 point 7).
