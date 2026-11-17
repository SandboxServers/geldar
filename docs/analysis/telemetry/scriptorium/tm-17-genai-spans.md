# TM-17: stream to GenAI spans: `chat`, `execute_tool`, tokens, subagent nesting (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-13 (the run span), TM-16 (the parser). Unblocks: TM-18, TM-19. Mind redeploy: next kit image (batched). `colo-images` path: n/a.

## Goal

After each run, read `session-<n>.jsonl` and export, as children of the `mind.run` span: one `chat` span per assistant turn (model, tokens, finish reason), one `execute_tool` span per tool call (tool name, call id, error flag), nested under the delegating tool span for subagent turns. No content in this card (TM-18). Survey M2, 4.6.

## Files (exactly these)

- `packages/supervisor/src/telemetry/stream-spans.ts` (new): `exportSession(tel, records, timing)`.
- `packages/supervisor/src/supervisor.ts` (edit: 1 to 3 lines right after `tel.end(...)`, calling `tel.exportSession(path)`; the run span is already ended, which is allowed: child spans carry their own explicit start and end times and the parent's span context is kept by `RunTelemetry`)
- `packages/supervisor/src/telemetry/run-span.ts` (edit: `exportSession` method delegating to `stream-spans.ts`; about 8 lines)
- `packages/supervisor/src/telemetry-stream.test.ts` (new)
- Uses the fixtures of TM-16 via `@geldar/scriptorium-verify`'s export; add no new fixture.

## Span shapes

- `chat <model>`: `gen_ai.operation.name=chat`, `gen_ai.provider.name`, `gen_ai.request.model` (turn model, else the run's declared model), `gen_ai.conversation.id` (= `run_id`), `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`, `gen_ai.response.finish_reasons` (the stop reason as a string), `turn_index`, `timing` (`observed` or `none`).
- `execute_tool <name>`: `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name` (a tool name outside the contract's list becomes `other`, as the MCP does), `gen_ai.tool.call.id`, `outcome` (`ok` or `error`, from the matching `tool_result.isError`), `error.type` = `tool_error` when an error. The span's parent is its turn's `chat` span.
- A `turn` with `parentToolUseId` set (a subagent turn) is parented to the `execute_tool` span with that call id when it exists; otherwise to `mind.run`.
- Metrics: `mind_tokens_total{harness,direction}` with direction `input`, `output`, `cache_read`, `cache_creation`, from the same usage numbers (once per turn, never double counted with the `result` line's totals).

## Timing

`timing` is a parameter. Without the tail (TM-19) there are no per-line times: every `chat` and `execute_tool` span gets start = end = the run's end time and `timing=none`, EXCEPT that the order of spans is kept by `turn_index`. With the tail, spans use the observed arrival times (TM-19 passes them). Never invent spread times.

## Steps

1. Read `telemetry/run-span.ts` (TM-13) to see how the run context is held; read the parser's types.
2. `exportSession(tel, records, timing)`: iterate records once; maintain a map `toolUseId -> span` for open `execute_tool` spans; on `turn` create a `chat` span (parent: run span, or the subagent parent) and one `execute_tool` span per `toolUses` entry (start at the turn); on `tool_result` end the matching tool span with its outcome; at the end, end every span still open with `outcome=unknown`.
3. The caller reads the file with the parser through a bounded reader: at most 64 MiB of text and 20,000 records per run; beyond that the export stops and one log record `event=session_export_truncated` is emitted. (A normal run is far below this.)
4. The whole export runs in a `setImmediate` after `tel.end(...)` decides the outcome, wrapped in try and catch, never awaited by the loop. It must not delay the next run's start by more than the time of a synchronous parse: parse in chunks of 500 lines, yielding between chunks.
5. Tests (`telemetry-stream.test.ts`):
   - (a) fixture 1: one `chat` span and one `execute_tool` span, correct parent ids, token attributes equal to the fixture's usage, `mind_tokens_total` increments by the same numbers.
   - (b) fixture 2: the subagent turn is a child of the delegating `execute_tool` span.
   - (c) a tool result with `isError` gives `outcome=error`, `error.type=tool_error`; an unmatched `tool_use` ends with `outcome=unknown`.
   - (d) `timing=none` spans all carry the run end time and ascending `turn_index`.
   - (e) no content: no span attribute or event holds any text from the fixtures (use a canary in assistant text and in a tool input; scan every exported span, event and metric for it).
   - (f) a 20,001-record stream stops at the limit and emits the truncation log; the loop's files are byte-identical to the telemetry-off run; a throwing exporter changes nothing.
6. Revert check: skip the subagent parenting; (b) must fail. Count tokens from the `result` line as well as turns; (a)'s metric assertion must fail.

## Checks and commit

Same as TM-13. Commit: `T-13 TM-17: stream-derived GenAI spans and token metrics (supervisor)` plus the two trailers.

## Do NOT

- Do not export text, tool input or tool results here (TM-18).
- Do not use hooks (`template/.claude/hooks/*`) or write any file the model can read.
- Do not hold the whole file in memory: stream it.
- Do not guess latency (see Timing).
