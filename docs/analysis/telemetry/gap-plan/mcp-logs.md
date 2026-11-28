# MCP log shipping (packets A and B)

Status: packet A (refusal spans) and packet B (log records) are in the branch `telemetry/mcp-refusals-and-logs`, not merged. Notes only; no code is described here beyond what the commits do.

## What the packets change

- **A, refusal spans.** Every refused MCP request reaches the front door's `onRefusal` once and emits one `mcp.auth_refused` span with `outcome` (a closed reason, such as `rate_limited`, `unauthorized`, `kill_switch`) and `http.response.status_code`. Responses, headers and limits are unchanged.
- **B, log records.** `startMcp` routes every log line through one `sink`: the stderr line is written as before, and when the span SDK is on the line also ships as one OTLP log record (`emitLogRecord`, scope `geldar-mcp`). Only the fields the record code keeps leave the process; the player id, cause and any other key are dropped. A 5xx or `internal` outcome is ERROR, other refusals and non-ok outcomes are WARN, the rest INFO.

## Querying in SigNoz

- Service: `geldar-mcp`.
- Refusal spans: span name `mcp.auth_refused`, group or filter by attribute `outcome`; the status is `http.response.status_code`.
- Log records: filter by body (the line's `event`, such as `tool_call`, `rate_limited`, `listening`), then by attributes `event`, `outcome`, `reason`.
- Caveat: the SDK's log allow-list (`telemetry/src/sdk-processors.ts`, `telemetry/src/attributes.ts`) drops any attribute not on it. Today `status`, `tool` and `duration_ms` are not on the list, so they do not reach SigNoz: a `tool_call` record carries `event` and `outcome`, a 429 refusal record carries `event` and `reason`. The severity is still set from the data. Adding them needs `extraKeys` for the service, a decision for the telemetry owner.

## Volume

- `tool_call` lines: about 20 to 70 thousand per day, about 0.3 KB each, so roughly 6 to 25 MB per day.
- Refusal lines are fewer; they are bounded by the rate limits.

## Deploy consequence

- `threshold/mcp` and `telemetry` are on the colo-images paths. Merging recreates `geldar-mcp`.
- A colo-images merge also recreates the player hosts, one at a time, so it needs the orchestrator's window.

## What is not shipped

- The `mcp_start` line and the metrics-setup lines run before the span SDK starts, so they are never shipped. `mcp_stopped` runs after the SDK shuts down, so it is not shipped either. They still reach stderr.

## PART C (not built): Mind host supervisor and keeper run logs

Shipping the Mind host supervisor and keeper run logs needs:

- an otel-agent on the Mind host; its config is in the scriptorium repo, and its cards TM-10 to TM-13 and TM-31 are not started;
- the Caddy ingest route and its window (decision 0371);
- the owner's ingest token, supplied directly.

## Owner decisions

1. Approve the ingest hostname and the Caddy window.
2. Give the ingest token directly, not in a file or a message.
3. Mind-host logs carry usage and cost fields only, or also model run text? Recommend usage and cost only, since the TM-16 parser reads those.
4. Accept one year of retention.
