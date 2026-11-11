# FX-METRICS-TIMEOUT

## Problem

After the race fix (FX-METRICS-RACE), `stop()` awaits the in-flight metrics push. The push had no timeout, so a receiver that never answers would hang Body, MCP and eventsink shutdown, and periodic pushes would pile up behind it.

## Fix

- Each push passes `AbortSignal.timeout(options.timeoutMs ?? PUSH_TIMEOUT_MS)`, with `PUSH_TIMEOUT_MS = 5000` as a named constant in `golem/src/metrics.ts`, `threshold/mcp/src/metrics.ts` and `eventsink/src/metrics.ts`.
- A timeout goes through the existing catch as `telemetry_push_failed` with status 0. The URL and body are never logged.
- The timer callback skips a tick while a push is in flight.
- `timeoutMs` is an optional field on the options object, passed through from the entry points. `threshold/mcp/src/main.ts` is untouched: `TelemetryPorts` has no timeout field, so the timeout is exercised through `startTelemetry`.

## Tests

Per package:

- A never-answering receiver with a 50 ms timeout: the push aborts, `stop()` resolves, and no unhandled rejection occurs.
- A tick-while-in-flight test.

Eventsink's test `afterEach` calls `closeAllConnections()` before `close()`. The aborted socket otherwise held `close()` for about 4 s.

## Revert checks

Each file was restored from a scratchpad backup afterwards; `git diff --stat` was empty.

| Package | Revert | Result |
|---|---|---|
| golem | signal removed | timeout test fails at its 3 s limit |
| golem | guard removed | in-flight test fails with 8 posts instead of 1 |
| threshold/mcp | signal removed | fails at 3 s |
| threshold/mcp | guard removed | 5 posts instead of 1 |
| eventsink | signal removed | fails at 3 s |
| eventsink | guard removed | 9 posts instead of 1 |

## Loops

`src/metrics.test.ts` passed 20/20 runs in golem, threshold/mcp and eventsink.

## Targeted runs

- golem: `src/adam`, `src/players/main.test.ts`, `src/metrics.test.ts` (43 pass)
- threshold/mcp: `src/main.test.ts`, `src/metrics.test.ts` (47 pass)
- eventsink: `src/main.test.ts`, `src/metrics.test.ts` (20 pass)

Also: biome ci clean on the six files; typecheck clean for golem, `@geldar/mcp` and `@geldar/eventsink`; `check:repo` ok; `git merge-tree` against main exit 0.

## Not verified

- The full `./geldar.ps1 check`.
- The live stack. The telemetry URL was not touched.
