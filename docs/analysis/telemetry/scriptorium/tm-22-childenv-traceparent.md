# TM-22: `TRACEPARENT` per run in the child's environment, gated (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-13 (run context), TM-21 verdict `header_sent_same_trace`, TM-24 (unit isolation test) merged. Unblocks: end-to-end traces from a Mind run into the MCP (with TM-02 deployed). Mind redeploy: next kit image (batched). `colo-images` path: n/a. If TM-21 says `header_not_sent`, do NOT start this card; use TM-23.

## Goal

Add exactly one environment variable to the model child, `TRACEPARENT` (and no other), carrying the `mind.run` span's context, only when telemetry is enabled. The model cannot read it: it has no shell, cannot read outside `/player`, and runs as another uid; TM-24 and TM-25 prove it, and this card changes them to allow exactly this one name and prove nothing else is allowed.

## Files (exactly these)

- `packages/supervisor/src/supervisor.ts` (edit `childEnv` only: new optional parameter `traceparent?: string`, added to the output when defined; the three call sites pass `tel.traceparent()`)
- `packages/supervisor/src/telemetry/run-span.ts` (edit: `traceparent()` returns the W3C string of the open run span or `undefined`)
- `packages/supervisor/src/child-env-isolation.test.ts` (edit, from TM-24: the allow-set gains `TRACEPARENT`)
- `packages/supervisor/src/telemetry-traceparent.test.ts` (new)

## Steps

1. Read TM-24's test and `childEnv`. The signature becomes `childEnv(settings, env, maxTurns?, traceparent?)`; existing callers and tests keep working.
2. `traceparent()` formats `00-<traceId>-<spanId>-01` from the span context, `undefined` when telemetry is off or the span is not recording.
3. Only the exec of the model child (`oneRun`, `oneTidy`) passes it. The save step (`save()`, git) never does.
4. NEVER pass `TRACESTATE`, and never copy a `TRACEPARENT` from the supervisor's own environment (the existing `PASS_THROUGH` list stays closed: a canary `TRACEPARENT` in the supervisor env must not reach the child unless the supervisor made it for this run).
5. Tests (`telemetry-traceparent.test.ts` plus the edited TM-24 file):
   - (a) telemetry on: the exec spec for a run carries `TRACEPARENT` matching `^00-[0-9a-f]{32}-[0-9a-f]{16}-01$` whose trace id equals the exported `mind.run` span's trace id and span id equals that span's id.
   - (b) telemetry off: the exec spec's env is key-for-key what it was before this card.
   - (c) a canary `TRACEPARENT` and `TRACESTATE` in the supervisor environment do not reach the child (telemetry off) and are replaced by the run's own (telemetry on, only `TRACEPARENT`).
   - (d) the save step's env never contains `TRACEPARENT`.
   - (e) TM-24's key-set test: the child env keys are the old set plus, when telemetry is on, `TRACEPARENT`; any other new key fails.
   - (f) the prompt text, `prompt.txt`, `status.json`, `supervisor.log` and the session file contain no trace id.
6. Revert check: pass `TRACESTATE` too; (e) must fail. Pass the supervisor's own `TRACEPARENT` through; (c) must fail.

## Checks and commit

Same as TM-13, plus TM-25 run by the ops agent before the kit image is cut. Commit: `T-14 TM-22: one TRACEPARENT per run in the model child's environment, telemetry on only (supervisor)` plus the two trailers.

## Do NOT

- Do not write the trace id into `.mcp.json`, any file in `/player`, or a header in the template (the survey's fallback is TM-23, not this).
- Do not add `OTEL_*` names, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` or any other variable.
- Do not enable this on a Mind before TM-02 is deployed on the Colo and TM-25 passed on the kit image.
- Do not change the `Bash` deny in `image/settings/managed.json`: it is what makes this safe (the CLI's subprocesses inherit `TRACEPARENT`).
