# TM-21: proof harness: does the pinned Claude CLI send `traceparent` to an MCP server? (scriptorium repo)

Repo: geldar-scriptorium. Depends on: none. Unblocks: the TM-22 versus TM-23 decision. Mind redeploy: none. `colo-images` path: n/a. NEEDS A LIVE RUN by the ops agent with an owner-approved OAuth token (not a player's token).

## Goal

The design assumes that the kit's pinned CLI (2.1.310, `image/Dockerfile`) reads `TRACEPARENT` from its environment and sends `traceparent` on outbound MCP HTTP requests. That is documented behaviour but UNVERIFIED on 2.1.310 (survey 3.2). Build a small harness that proves or refutes it against a scratch MCP server on loopback. The result decides whether TM-22 or TM-23 goes ahead.

## Files (exactly these)

- `tools/live-check/src/header-probe-server.ts` (new): a minimal MCP server over HTTP on `127.0.0.1` with an ephemeral port that answers `initialize`, `notifications/initialized`, `tools/list` (one tool `probe_ping`) and `tools/call`, and records, per request, the header NAMES and the values of `traceparent` and `tracestate` only (no other header value is stored).
- `tools/live-check/src/header-probe.ts` (new): starts the server, writes a temporary `--mcp-config` file in a fresh temp directory outside any repo, runs the CLI once and writes the verdict.
- `tools/live-check/src/header-probe.test.ts` (new): runs the server against plain `fetch` and the verdict function against recorded samples. It does not run the real CLI.

## What the live run does (the ops agent runs it; the coder only builds it)

```
TRACEPARENT=00-<fixed 32 hex>-<fixed 16 hex>-01 \
claude -p "Call the probe_ping tool once, then stop." --mcp-config <temp config> \
  --max-turns 3 --output-format stream-json --verbose
```

Variants, each one run: (1) as above; (2) with `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` and `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` set (only to see if per-call parents appear; no collector is configured so nothing is sent); (3) with `TRACEPARENT` unset (control). The harness reads the OAuth token from the operator's environment variable by name and never prints or stores it.

## Verdict (written as JSON to the path argument, no secrets)

`{ cliVersion, variant, requests: [{ method, hasTraceparent, sameTraceId, sameSpanId, hasTracestate }], verdict }` with `verdict` one of:
- `header_sent_same_trace`: at least one `tools/call` (or any) request carried a `traceparent` with the injected trace id. TM-22 proceeds. Record whether the span id equals the injected one (run-level parent) or differs (a CLI-made child span).
- `header_sent_other_trace`: a `traceparent` was sent but with another trace id. TM-22 must not be used as is; report to the orchestrator.
- `header_not_sent`: no request carried it. TM-23 (fallback) proceeds.

## Steps

1. Read `tools/live-check/src/rules.ts` and `evaluate.ts` for the repo's script style; do not edit them.
2. Build the server and the harness; the harness refuses to run unless `GELDAR_PROBE_OK=1` is set, so a test run never starts a real CLI.
3. Tests: (a) the server answers the five MCP calls with valid JSON-RPC; (b) it records `traceparent` when present and records nothing of `Authorization` or any other header value (send a canary `Authorization` and assert it is nowhere in the recorder's output); (c) verdict function: samples for the three verdict values; (d) the harness refuses to start the CLI without the guard variable; (e) the temp config file is created outside the repo and deleted on exit, even when the CLI exits non-zero.
4. Revert check: record all headers; (b) must fail. Skip the guard; (d) must fail.

## Checks and commit

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:repo`, `git diff --check`. Commit: `T-14 TM-21: proof harness for CLI traceparent on outbound MCP requests (live-check)` plus the two trailers.

## Hand-off to the ops agent

Run on a machine with the pinned CLI, with `GELDAR_PROBE_OK=1` and the owner-approved token in its environment variable. Not on the Colo, not in a player container, not with `adam up`. Save the three verdict files under the repo's worknotes folder as `docs/analysis/scriptorium/worknotes/telemetry-header-probe.md` (a human-written summary of the JSON; the JSON contains only ids and header names). Report the verdict line to the orchestrator.

## Do NOT

- Do not point the CLI at a real MCP server, a player token or the Colo.
- Do not store any header value except `traceparent` and `tracestate`.
- Do not add an npm dependency (use `node:http`).
