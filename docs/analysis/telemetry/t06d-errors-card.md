# T-06d cards: capture errors, pre-handler failures and capture order

Status: card written 2026-11-16, not started. Every card here is PR-only and needs geldar-93's go. None of them merges alone: see [batch-deploy-plan.md](batch-deploy-plan.md) (they all touch colo-images paths, so they land together on one integration branch).

Governing record: decision [0350](../../decisions/0350-telemetry-scope-and-full-capture.md) point 2 (full capture, errors included, no opt-out), point 6 (operator-only readers), point 7 (nothing flows back to an agent). Option B stack: [0352](../../decisions/0352-telemetry-dedicated-clickhouse-database.md). Predecessors: T-06 (#571 spans), T-06c (#572 content, see [t06c card](t06c-content-capture-card.md)), T-07 (#569 Body action spans), T-08 (#567 eventsink `trace_id`), T-05 (#554 NATS status hooks).

## What T-06c left open (the four gaps this card closes)

1. ToolError text is not captured. `logged()` in `threshold/mcp/src/world.ts` records only the outcome code on a throw.
2. Calls rejected before the handler (unknown tool, `invalid_input`, hidden tool, auth) produce no span and no arguments. `callTool` in `threshold/mcp-mock/src/registry.ts` returns `failure(...)` before `logged()` runs.
3. Redaction is key-based and covers arguments only (`redactArguments` in `telemetry.ts`). Results, error text and value-embedded secrets (a bearer string inside text) pass through.
4. Capture order. The result is captured inside `logged()`, before `callTool` applies `validateToolResult` and the `maxResultBytes` cap, so the span can show a result the agent never saw, and a rejected call is invisible.

Plus two older open points: a concurrent second `shutdown()` in `@geldar/telemetry` returns at once instead of waiting for the first (`telemetry/src/sdk.ts`, the `stopped` flag), and the Body and eventsink error paths (survey B3, B4, E1).

## Split (each under 6 files and 300 lines of change)

| Card | Scope | Files (non-test) | Depends on |
|---|---|---|---|
| T-06d1 | `@geldar/telemetry`: concurrent shutdown waits; shared `redactContent` (key and value) and `errorFields` helpers; reference doc | `telemetry/src/sdk.ts`, `telemetry/src/redact.ts` (new), `telemetry/src/index.ts`, `docs/reference/telemetry-package.md` | none |
| T-06d2 | MCP: one span per call at the session seam, ordered capture, pre-handler and error capture, result redaction | `threshold/mcp/src/telemetry.ts`, `world.ts`, `world-session.ts`, `main.ts` | T-06d1 |
| T-06d3 | Body: failed-action span carries the error text; internal fault line carries action id and life id; mind-link handler failure logged | `golem/src/adam/adam-body.ts`, `golem/src/body/executor-action.ts`, `golem/src/mind-link/server.ts` | T-06d1 |
| T-06d4 | eventsink: DLQ and nak paths as OTLP error logs with subject, reason and trace id (needs the SDK dependency, so it is the largest) | `eventsink/src/consumer.ts`, `eventsink/src/main.ts`, `eventsink/package.json`, `eventsink/Dockerfile.dockerignore`, `pnpm-lock.yaml` | T-06d1 |

T-06d2, d3 and d4 are independent of each other and fan out in parallel once T-06d1 is committed (they import its helpers). Order of merge into the integration branch: d1, then d2, d3, d4 in any order.

All four share these rules:

- Helpers only: `@geldar/telemetry` (`filterAttributes`, `addContentEvent`, `capText`, `createLogger`). No raw OTLP calls. Content is a span event or log record, never a metric label or value.
- Off unless the endpoint is set: with `GELDAR_TELEMETRY_URL` unset no capture runs, and the bytes returned to the agent are identical either way (the T-06c test (b) stays green and is extended).
- Error text is captured in full (0350 point 2), capped at 32 KiB by `capText`, after `redactContent`. Nothing about telemetry appears in any agent-visible text (0350 point 7; `contract/src/agent-text.ts` marker scan stays green).
- A capture failure never changes a result, an outcome or a latency. Every capture call sits in a try/catch that swallows.
- Span and log attributes are allow-listed (`TOOL_SPAN_FIELDS` style). Raw text goes only into `geldar.content.*` fields or `exception.*` fields, which the allow-list already caps.

---

## T-06d1: telemetry package (shutdown and shared redaction)

Goal: a concurrent second `shutdown()` awaits the first; one shared redaction and error-field helper for MCP, Body and eventsink.

Files (exact): `telemetry/src/sdk.ts`, new `telemetry/src/redact.ts`, `telemetry/src/index.ts` (export), `docs/reference/telemetry-package.md` (add the two helpers). Tests: `telemetry/test/sdk-shutdown-concurrent.test.ts` (new), `telemetry/test/redact.test.ts` (new).

Edits:

1. `sdk.ts`: replace `let stopped = false` with `let stopping: Promise<void> | undefined`. `shutdown` is `() => (stopping ??= run())`, where `run` clears `active` only if `active === handle`, clears this start's `registered` globals, then `await shutdownAll(made)`. Both callers get the same promise, so a second call resolves only after the flush finishes, and the existing "a second shutdown of a stale handle keeps the globals of the later start" test (`sdk-signals.test.ts:293`) must still pass: the second call must not run `run()` again.
2. `redact.ts`: export `redactContent(value: unknown): unknown` (key redaction by `hasForbiddenSegment`, as `redactArguments` does today, moved here with its depth, cycle and `__proto__` guards, and the same `REDACTED` text) and `scrubText(text: string): string`. `scrubText` replaces, with `[redacted]`: `Bearer <non-space run>`, `Authorization:` header values, any run matching the MCP token shape (read `TOKEN_PATTERN` in `threshold/mcp/src/store/token-hash.ts` and mirror it as a string literal regex with a comment naming the source; do not import from threshold), and URL userinfo (`scheme://user:pass@`). It does not touch ordinary prose. `redactContent` applies `scrubText` to every string value it keeps.
3. `redact.ts` also exports `errorFields(error: unknown): { 'exception.type': string; 'exception.message': string; 'exception.stacktrace'?: string }` (message and stack both through `scrubText`; a non-Error value is `String(value)`; never throws).
4. Re-export from `index.ts`. `threshold/mcp/src/telemetry.ts` keeps exporting `redactArguments` as a thin alias of `redactContent` so T-06c tests do not move.

Tests that must fail on revert:

- `sdk-shutdown-concurrent`: an exporter whose `forceFlush`/`shutdown` blocks on a deferred promise; call `handle.shutdown()` twice; assert the second promise is still pending while the first export is blocked, and resolves only after release. On the old code the second resolves immediately.
- `redact.test`: nested key redaction; a string value `Bearer abc123` and a token-shaped string become `[redacted]`; plain text `the bearer of bad news` is unchanged; a `__proto__` key survives as an own key; `errorFields` of a thrown object with a token in its message hides the token.

Checks: `pnpm --filter @geldar/telemetry test`, typecheck, biome, `check:repo`. Revert-check: restore the `stopped` boolean and confirm the new shutdown test fails; empty `scrubText` and confirm the redact test fails.

Commit message: `T-06d1: telemetry shutdown awaits the first call; shared redactContent and errorFields (code)`.

---

## T-06d2: MCP errors, pre-handler failures, capture order

Goal: every call, accepted or refused, ends in exactly one `mcp.tool_call` span, with the same ordered events, full error text, and redacted arguments and results.

Files (exact): `threshold/mcp/src/telemetry.ts`, `threshold/mcp/src/world.ts`, `threshold/mcp/src/world-session.ts`, `threshold/mcp/src/main.ts` (wiring only). Tests: new `threshold/mcp/src/telemetry-errors.test.ts` (test files are excluded from the image by `**/*.test.ts`, so no dockerignore change). Read first: `world.ts` `logged()` (lines ~465-510), `world-session.ts` CallTool handler (~121-146), `threshold/mcp-mock/src/registry.ts` `callTool`, `threshold/mcp/src/tools/unavailable.ts` `refuseHiddenCall`, `threshold/mcp/src/http/front.ts` (~250-290, the auth verdict) and `http/log.ts`.

Design (the seam): the span moves from `logged()` to the session handler, which sees the final response.

1. `world.ts` `logged()`: keep the log line and `onToolCall` metric exactly as they are. Stop calling `deps.onToolSpan`. Instead store a `PendingCall { tool, handlerOutcome, durationMs, arguments, result?, error? }` in a module `WeakMap<object, PendingCall>` keyed by the `ctx` object (the session builds a fresh `ctx` per call and `callTool` passes it through unchanged); export `takePendingCall(ctx)`. On success store the raw `result` (before the cap and validation, as T-06c does); on a throw store `error` from `errorFields(err)` plus the ToolError `code` when it is one. A wrong-key lookup must return undefined (test it).
2. `world-session.ts`: build `ctx` into a local before `callTool`. After `callTool` returns (also on a throw out of it), call `deps.onToolSpan?.(...)` once, inside try/catch, with: tool name as received (`request.params.name`), the raw `request.params.arguments` (so a call refused for bad arguments is still seen), the pending call if any, and the final response. The final outcome is the closed code parsed from the response text when `isError` is set (the part before the first `:`; one of `unknown_tool`, `invalid_input`, `invalid_output`, `result_too_large`, `internal_error`, or a ToolError code; anything else is `internal`), else `ok`. The hidden-tool refusal (`refuseHiddenCall`) takes the same path with outcome `not_available`. The tool name in the span attribute stays the contract list or `other` (existing rule); the raw name goes in the request event.
3. `telemetry.ts`: `ToolCallSpan.content` becomes `{ name: string; arguments: unknown; result?: unknown; error?: {...errorFields}; response?: string }`. `addToolContentEvents` emits events in this fixed order, each only if it has data, each text through `redactContent` then `addContentEvent` (capped): (1) `tool_arguments` (the raw input, always first, before anything the cap or validation can drop); (2) `tool_result` (the handler's raw result, as today, with the `see` shape rule); (3) `tool_error` (full `exception.*` text: the handler's error, or for a pre-handler refusal the failure text the agent received); (4) `tool_response` (the final text the agent was sent, so a result cut or replaced by the size cap or validation is visible next to the raw result). Sizes go in the `.bytes` siblings only, not in new span attributes. Set span status error on any outcome other than `ok` (via the recorder's `setStatus`, add it to the structural `SpanTracer` type, optional) and set `error.type` to the final outcome (already done for non-ok).
4. Rate limits (`rate_limited` from `journal`, act budget refusals) are ToolErrors, so they ride the same path; no extra code, but a test must prove it.
5. Auth refusals (HTTP 401, `unauthorized` and `auth_unavailable`) happen before a session exists. In `http/front.ts` add one optional `onRefusal?: (r: { reason: string; status: number }) => void` call beside the existing `unauthorized` log line, wired in `main.ts` to a span `mcp.auth_refused` with attributes `outcome` (the closed reason from `REFUSAL_REASONS`) and `http.response.status_code`. Never the token, header, address or body. If reading `front.ts` shows the seam is not as described, stop and report; do not widen scope.
6. Result redaction: `redactContent` now runs over the result too (decision: key redaction plus value scrub, as T-06d1).

Tests (`telemetry-errors.test.ts`; fake tracer as in `telemetry-spans.test.ts`; each must fail when its change is reverted):

- (a) handler throws a ToolError: one span, `outcome` is the code, a `tool_error` event holds the full message; revert the `logged` store and it has none.
- (b) unknown tool name: one span with `outcome=unknown_tool`, a `tool_arguments` event with the raw arguments and a `tool_error` event; on the old code there is no span.
- (c) `invalid_input` and the hidden tool: one span each, arguments present.
- (d) `result_too_large` (set `maxResultBytes` small) and `invalid_output`: the span has the raw `tool_result` AND a `tool_response` event whose text is the `result_too_large: <tool>` failure; event order is arguments, result, error, response (assert the order of event names).
- (e) handler throws a non-ToolError carrying a token in its message: span outcome `internal`; the stored text contains `[redacted]` and not the token; the agent-visible text is unchanged (`PLAYER_FAULT`).
- (f) a result containing `{ "api_key": "..." }` and a string `Bearer ...`: both redacted in the event.
- (g) bytes returned to the agent are identical with the recorder on and off, for an ok, a ToolError and a pre-handler refusal (extends the T-06c test).
- (h) a tracer whose `startSpan` throws, and an `addEvent` that throws: the response is unchanged and no exception escapes.
- (i) `mcp.auth_refused` carries the reason code and no token or header text.
- (j) rate limit: three `journal` calls past the limit give `rate_limited` spans.

Checks: `pnpm --filter @geldar/mcp test` (the whole package, including `container.test.ts`, `imports.test.ts`, `main-spans.test.ts`, `telemetry-spans.test.ts`, `telemetry-content.test.ts`), typecheck, biome, `check:repo`. The T-06 and T-07 container lessons apply: if you add a runtime (non-test) source file, confirm `threshold/mcp/Dockerfile.dockerignore` keeps `!threshold/mcp` and `!telemetry`, that `threshold/mcp/package.json` already lists `@geldar/telemetry` (it does), and run `container.test.ts` and `imports.test.ts` before committing. This card adds no new runtime file. Update the T-06c tests that assert the old single-span timing only where the seam moved (`telemetry-spans.test.ts`, `main-spans.test.ts`); do not weaken any assertion.

Commit message: `T-06d2: MCP spans for refused and failed calls, ordered capture, result redaction (code)`.

---

## T-06d3: Body error paths

Goal: a failed action's span and logs say why, in full; nothing else about Body behavior changes.

Files (exact): `golem/src/adam/adam-body.ts` (`actionSpanSink`, `ActionSpan`), `golem/src/body/executor-action.ts` (the internal-fault `console.error`, ~line 51), `golem/src/mind-link/server.ts` (`natsRequestServer` catch, ~line 80). Tests: extend `golem/src/adam/action-span.test.ts`; new `golem/src/body/executor-action-fault.test.ts`; new `golem/src/mind-link/request-server-fault.test.ts`.

Edits:

1. `ActionSpan` gets an optional `addEvent(name, attributes)` (T-07's structural type, so the SDK span still satisfies it). In `finish`, when the record's result status is not `ok` (read the status and `reason`, `message` fields that `ActionRecord.result` already has), add one event `action_error` with `contentAttributes('error', redactContent(message))` and attributes `reason` (closed). The span attributes stay `action_id` and `outcome` only.
2. `executor-action.ts`: the internal-fault line becomes a JSON line through the existing host log (or `console.error` of one JSON object if no log is in scope) with `action_id` and the life id, `reason: 'internal'`, and `errorFields(error)`. Keep the printed stack text. No change to the returned result.
3. `server.ts`: the handler `catch` writes the same style line with the subject and `errorFields`. Do NOT change replies (a refused snapshot still sends none; that behavior change is the survey's idea B3 and belongs in `docs/ideas.md`).

Tests (revert-failing): a failed action emits an `action_error` event with the message and the span attribute set is still exactly `action_id` and `outcome`; a message holding a token is redacted; an `ok` action emits no event; the internal-fault line is valid JSON containing the action id; a throwing `addEvent` does not stop `end()` or the record reaching `inner` (existing T-07 guarantee); the record stream to `inner` is byte-identical with and without the tracer.

Checks: `pnpm --filter @geldar/golem test` (unit only, no `test:live`), typecheck, biome, `check:repo`. `golem/Dockerfile.dockerignore` already has `!telemetry` and `golem/package.json` already lists `@geldar/telemetry`; re-run the golem container test if one exists (`git grep -l dockerignore golem`). No bench and no live run from this card.

Commit message: `T-06d3: Body failed-action spans carry the error text; fault lines carry ids (code)`.

---

## T-06d4: eventsink DLQ and retry paths

Goal: a dead letter, a failed DLQ publish, a write failure that naks, and a fetch failure each produce one OTLP error log with the subject, reason and trace id.

Files (exact): `eventsink/src/consumer.ts` (the four `log(...)` sites at ~131, 137, 178, 233 plus the fetch failure in the loop), `eventsink/src/main.ts` (start the SDK with `service: 'geldar-eventsink'`, build a logger, pass it as the `log` dependency while still writing the same text line to stderr), `eventsink/package.json` (add `"@geldar/telemetry": "workspace:*"`, exact), `eventsink/Dockerfile.dockerignore` (add `!telemetry`), `pnpm-lock.yaml` (regenerate with the pinned pnpm). Tests: extend `eventsink/src/consumer.test.ts`; new `eventsink/src/consumer-error-logs.test.ts`; the dockerignore allow-list test for eventsink if one exists (`git grep -l "eventsink/Dockerfile.dockerignore"`).

Edits: the existing text lines stay unchanged (operators and tests read them); next to each, `logger.error('dead_letter' | 'dlq_publish_failed' | 'write_failed_nak' | 'fetch_failed', { subject, reason, trace_id, delivery_count })` with `reason` through `scrubText` and capped. `trace_id` comes from the existing `traceIdOf`. The event body is not logged (it is content; the DLQ already stores it, capped). With the URL unset the logger is a no-op, as `createLogger` already is.

Tests (revert-failing): a dead letter produces one error record with the subject, reason and trace id and the original text line is still written; DLQ publish failure and write failure each produce theirs and still nak with the same delay; with no endpoint the consumer's acks, naks and DLQ publishes are identical (same calls in the same order); a reason holding a token is scrubbed. Container: build context allows `telemetry` (the dockerignore test), and `pnpm install --frozen-lockfile` passes.

Hard stop: if adding the dependency changes `pnpm-lock.yaml` beyond the new workspace link, stop and report. If this card is judged too big, it ships alone and the batch plan drops its row; the others do not wait for it.

Commit message: `T-06d4: eventsink dead-letter and retry paths logged to OTLP with trace id (code)`.

---

## Delivery, for every card

- Each coder works in its own worktree off the integration branch named in the batch plan, edits only its listed files, commits locally, does not push. The ops agent pushes.
- `./geldar.ps1 check` is not run locally (CI is the full check). Run the card's package tests, `pnpm check:repo`, `git diff --check`.
- A reviewer reads each diff against this card before it joins the integration branch (wave-end review, once per wave).
- No live run from these cards. The one live proof is the batch window's verification.

## What NOT to do

- Do not add telemetry text, trace ids or the word telemetry to any tool result, error, prompt or skill an agent can read.
- Do not capture at the HTTP layer (headers, bodies, addresses, tokens).
- Do not change tool results, error texts, outcome codes, reply behavior or latency, or add a retry or a wait for the exporter.
- Do not edit `contract/`, `sql/` or a prompt. No new metric labels. No new env var.
- Do not set `GELDAR_TELEMETRY_URL` anywhere (the batch plan owns that).
- Do not edit generated code or released prompts.
