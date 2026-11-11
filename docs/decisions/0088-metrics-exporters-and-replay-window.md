# 0088: Metrics exporters and the MCP replay window

Status: Proposed (wave C1, packet P1-C1-07)

## Context

Phase 1 needs metrics from the components (TPS, tick lag, Body count, wakeups, thought latency, MCP request counts and latency, NATS reconnects, eventsink lag, DLQ depth). Decision 0130 answered where they go: the SigNoz instance on the Colo node, reached by OTLP. The URL is configuration (`GELDAR_TELEMETRY_URL`, or `telemetry_url` in the shard config, already declared by C1-00) and never goes in the repo.

The MCP's startup replay already starts `replay_minutes` before now (`threshold/mcp/src/main.ts`, `events/stream.ts`). The window was required in the config and had no default; this record makes it optional.

## Decision

1. Exporter scope: counters, gauges and histograms only. No label may name a player, a life or a token, and the registry refuses such a label when a metric is declared. Values are numbers. Thought text, persona text, prompts and tokens are never recorded.
2. Endpoint: pushed only when `GELDAR_TELEMETRY_URL` is set. Without it there is no timer and no request. A failed push is logged with its status code and does not stop the component.
3. Wire format: Prometheus text for `/metrics`, and OTLP/HTTP JSON posted to `<url>/v1/metrics`. Both are written by hand in `threshold/mcp/src/metrics.ts`; no dependency is added.
4. Replay window: `sovereign.mcp.replay_minutes` is optional. Absent means 60. Present means an integer from 1 to 1440; anything else stops the MCP at start and the error names the value.

Metric names (planned; the MCP module exists, the wiring is pending):

- `geldar_mcp_requests_total{route,outcome}` (counter)
- `geldar_mcp_request_seconds{route}` (histogram)
- `geldar_nats_reconnects_total` (counter)
- `geldar_eventsink_lag_seconds` (gauge)
- `geldar_dlq_depth` (gauge)
- `geldar_body_count`, `geldar_tps`, `geldar_tick_lag_ms`, `geldar_wakeups_total`, `geldar_thought_seconds` (golem and eventsink exporters, pending)

## Consequences

- The MCP can be given a telemetry URL, and nothing is sent until the owner sets one.
- A recreated MCP container starts its replay at most `replay_minutes` back, not at the stream start. Redeliveries are still dropped by sequence.
- Not yet done: the `/metrics` route, the start-up call to `startTelemetry`, and the golem and eventsink exporters. These are the next packet step.
