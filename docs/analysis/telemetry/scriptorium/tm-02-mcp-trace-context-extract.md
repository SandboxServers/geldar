# TM-02: MCP extracts the Mind's trace context (T-14, MCP side) (geldar repo)

Repo: geldar. Depends on: T-06 and T-06c (merged). Unblocks: TM-20, the end-to-end proof of TM-22. `colo-images` path: YES (`threshold/mcp/**`). Hold the PR for the batch window (rollout-plan C1); do not merge it alone.

## Goal

Make every `tools/call` span a child of the Mind's run span, when the call carries W3C trace context. Two carriers, in this order (survey 3.2): MCP `params._meta.traceparent` (and `tracestate`), then the HTTP `traceparent` header. With neither, the span stays a root, as today. Nothing about this reaches the agent: the extracted context is used for the span parent only.

## Files (exactly these)

- `threshold/mcp/src/trace-parent.ts` (new): `extractToolParent(meta, headers)` returning an OpenTelemetry `Context` or `undefined`.
- `threshold/mcp/src/telemetry.ts` (edit: `SpanTracer.startSpan` options gain an optional `parent` context; `toolSpanRecorder` passes `ToolCallSpan.parent`).
- `threshold/mcp/src/world-session.ts` (edit: read `extra._meta` and `extra.requestInfo?.headers` in the CallTool handler, build the parent, hand it to the existing `onToolSpan` call. Few lines.)
- `threshold/mcp/src/trace-parent.test.ts` (new)
- `threshold/mcp/src/telemetry-parent.test.ts` (new)

Dependencies: do not edit `telemetry/` and do not add a package. Use `extractTrace(headersLike)` from `@geldar/telemetry`, which already turns a header carrier into a context (read `telemetry/src/nats-trace.ts`; it takes a `HeaderLike` with `get(name)`). Build a small `HeaderLike` over a plain object holding only `traceparent` (and `tracestate`). If `extractTrace` cannot do this, stop and report; do not add a dependency or edit `package.json` (a lockfile change would also be a `colo-images` trigger by itself).

## Steps

1. Read `threshold/mcp/src/telemetry.ts` (span recorder), `threshold/mcp/src/world-session.ts` lines 100 to 180 (the handler and `onToolSpan`), `telemetry/src/nats-trace.ts`.
2. Create `trace-parent.ts`:
   - `extractToolParent(meta: unknown, headers: Record<string, string | string[] | undefined> | undefined)`.
   - If `meta` is an object with a string `traceparent`, use it (and `tracestate` if a string). Else if `headers?.traceparent` is a string, use it. Else return `undefined`.
   - A value longer than 512 bytes is ignored (returns `undefined`). A malformed value yields no valid span context: return `undefined` (check `trace.getSpanContext(ctx)` is valid).
   - It never logs or returns the raw value in any error text.
3. In `telemetry.ts`, add `parent?: Context` to `ToolCallSpan` and pass `{ startTime, context: parent }` where the recorder calls `startSpan` (OpenTelemetry's `startSpan(name, options, context)` takes the context as the third argument: use that). Keep `TOOL_SPAN_FIELDS` unchanged: no trace id becomes an attribute.
4. In `world-session.ts`, inside the CallTool handler, compute `const parent = extractToolParent(extra._meta, extra.requestInfo?.headers)` once and add it to the `onToolSpan` payload. Do not change what `callTool` returns. Do not put `parent` in the logs.
5. Tests, in `trace-parent.test.ts`:
   - (a) `_meta.traceparent` valid -> context with that trace id; header also present with a different id -> the `_meta` one wins.
   - (b) only header -> that trace id. Neither -> `undefined`.
   - (c) malformed, oversized (600 bytes) and all-zero trace ids -> `undefined`.
6. In `telemetry-parent.test.ts` (use the in-memory exporter pattern of `telemetry-spans.test.ts`):
   - (d) a call with a valid `traceparent` produces a span whose `traceId` equals the carrier's and whose parent span id equals the carrier's span id.
   - (e) the tool result returned to the caller is byte-identical with and without a `traceparent` (serialize both, compare), and contains neither the trace id nor the span id.
   - (f) a call with no carrier is a root span, as before.
   - (g) with telemetry off (no recorder), a call carrying `traceparent` behaves exactly as before (no throw).
7. Revert check: change `extractToolParent` to ignore `_meta`; test (a) must fail. Restore. Remove the `parent` pass-through in the recorder; test (d) must fail. Restore.

## Checks

```powershell
./geldar.ps1 pnpm --filter @geldar/mcp test
./geldar.ps1 pnpm --filter @geldar/mcp typecheck
./geldar.ps1 pnpm check:repo
git diff --check
```

(Use the package name in `threshold/mcp/package.json` if it differs.)

## Commit

`T-14 TM-02: MCP tool spans take their parent from _meta.traceparent, then the traceparent header (mcp)` plus the two trailers.

## Do NOT

- Do not read or forward `tracestate` into any attribute, log line, error text or result.
- Do not add trace or span ids to any tool result, error, log field or `_meta` reply.
- Do not extract Baggage.
- Do not touch `contract/`, `world.ts` or the HTTP front door.
- Do not merge alone: this path redeploys the MCP and every Body.
