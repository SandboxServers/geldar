# TM-23: CONDITIONAL fallback: neutral run-id header and deterministic trace ids (two coders, two repos)

Run this card ONLY if TM-21 returns `header_not_sent` (or `header_sent_other_trace`). Otherwise skip it. Part A is in the geldar repo (`colo-images` path: YES, `threshold/mcp/**`; batch with TM-02). Part B is in the scriptorium repo and changes the model-readable template, which is the reason this is the fallback and not the plan (survey 3.2, option 2). It needs the owner's approval of the exact header name before dispatch.

## Design (from survey 3.2)

The supervisor already has a run number and `player_id`. Both sides derive the same trace deterministically, so no trace id has to be sent:

- Run id string: `rn_` plus the 26-character ULID the supervisor mints per run (kept in memory and in `mind.run` as `run_id`).
- Trace id: first 16 bytes of `SHA-256("geldar-run:" + runId)`, lowercase hex. Parent span id: the next 8 bytes. All-zero results are impossible in practice; if hit, flip the last bit.
- The header name is neutral (proposed `X-Geldar-Run`; the owner confirms). No W3C vocabulary on the model's side, no word "trace", "telemetry", "otel" or "monitor" anywhere the model reads.
- The model's `.mcp.json` carries the value through `${GELDAR_RUN_ID}` expansion exactly as `Authorization` already carries `${GELDAR_MCP_TOKEN}`. The variable name is `GELDAR_RUN_ID` (neutral), added to the child env by the supervisor per run.

## Part A (geldar repo): `threshold/mcp/`

Files: `threshold/mcp/src/trace-parent.ts` (edit TM-02's file: add `deriveRunParent(runId)` and accept the header), `threshold/mcp/src/world-session.ts` (pass `headers['x-geldar-run']` as a third carrier, lowest priority), `threshold/mcp/src/trace-parent-run.test.ts` (new). Does not touch `contract/`.
Steps: (1) validate the header: `^rn_[0-9A-HJKMNP-TV-Z]{26}$`, else ignore. (2) derive trace id and parent span id as above using `node:crypto`. (3) Order of carriers: `_meta.traceparent`, then `traceparent` header, then `x-geldar-run`. (4) The run id is never logged, put on a span attribute other than the allow-listed `run_id` (allowed by 0350), or returned in any result.
Tests: (a) known vector: `deriveRunParent('rn_01ARZ3NDEKTSV4RRFFQ69G5FAV')` equals the hard-coded hex values the coder computes with a stated one-line command and pastes into the test; (b) a call with only `x-geldar-run` yields a span with that trace id; (c) malformed ids are ignored; (d) results byte-identical with and without the header; (e) priority order. Revert check: break the SHA-256 slice offset; (a) must fail.
Commit: `T-14 TM-23a: MCP derives the Mind trace from a neutral run-id header (mcp)`.

## Part B (scriptorium repo): kit

Files: `packages/supervisor/src/supervisor.ts` (`childEnv` only: add `GELDAR_RUN_ID` when telemetry is on), `packages/supervisor/src/telemetry/run-span.ts` (create the `mind.run` span with the derived ids), `template/.mcp.json` (add the header; this changes a model-readable released file, so it needs a template version bump per R10: the coder reads `template/` release rules and stops if unclear), `packages/supervisor/src/telemetry-runid.test.ts` (new).
Steps: (1) mint the run id per run with the existing ULID helper if the kit has one, else a 26-character Crockford base32 from `crypto.randomBytes` plus a timestamp prefix. (2) the `mind.run` span uses the derived trace id and span id as its own ids (OpenTelemetry: create the span with a remote parent context whose span id is the derived parent span id; the run span is a child of that virtual parent). (3) `childEnv` gets `GELDAR_RUN_ID` only when telemetry is on, and TM-24's allow-set gains that single name. (4) update TM-26's vocabulary list to allow the header name only.
Tests: (a) the derived ids on the run span equal part A's vector; (b) `GELDAR_RUN_ID` in the child env only with telemetry on; (c) TM-24's key-set test passes with exactly that one new name; (d) `.mcp.json` check (`pnpm check:template`) passes and the header text contains none of the telemetry words; (e) telemetry off: the child env and the template-rendered config are what they were before except for the static header line, which expands to an empty value (the MCP then ignores an empty header: part A step 1).
Revert check: add `OTEL_`-named variable; (c) must fail.
Commit: `T-14 TM-23b: kit passes a neutral run id and derives the run trace from it (supervisor, template)`.

## Do NOT (both parts)

- Do not use the word `trace`, `traceparent`, `telemetry` or `otel` in the header name, the variable name or any template text.
- Do not store the run id in the workspace or the player repo.
- Do not run both TM-22 and TM-23 in production at once.
