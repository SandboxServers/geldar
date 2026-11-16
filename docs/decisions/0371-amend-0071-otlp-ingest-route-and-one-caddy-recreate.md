# 0371. Amends 0071: the OTLP ingest route on the shared Caddy, and one container recreate for its token

- Status: Accepted (owner ruling geldar-93, 2026-11-16: the ingest route on the shared Caddy). Each node step still needs the owner's approval at the time.
- Date: 2026-11-16
- Spec: section 6.2 and 6.4 (public edge). Amends 0071 item 6 and its "reloaded and never restarted" rule (already superseded for the node by R39) for one case: one recreate. Builds on 0350 item 9, 0094 and `docs/analysis/telemetry/caddy-ingest-route.md`.

## Context

0071 item 6 has Geldar use the shared Caddy with its own site files, reloaded and never restarted. Mind hosts need an authenticated OTLP/HTTP endpoint on the Colo (0350 item 9). The route authenticates with a bearer token read from the Caddy environment, and a running Caddy cannot see a new environment value without a container recreate.

## Decision

1. The shared Caddy gains one more Geldar site, `deploy/caddy/otel.caddy` (kill switch `otel-off.caddy`), on a hostname held only in the environment (`GELDAR_INGEST_HOST`, an owner-held value, not in the repo). It passes only POST on `/v1/traces`, `/v1/metrics` and `/v1/logs` with the exact bearer token, and proxies to the gateway's loopback publish. Stock Caddy only: no custom image, no third-party module, no global timeouts, no rate limit.
2. Owner ruling R39 (see `deploy/README.md`, section Caddy) already replaced the "reloaded, never restarted" rule for the shared Caddy `board-proxy`: its admin API is OFF, so `caddy reload` cannot work and every change of a live file is one owner-approved `docker restart board-proxy`. This route follows R39 and adds one case: a restart keeps the container's old environment, so one owner-approved recreate of the container loads `GELDAR_INGEST_HOST`, `GELDAR_INGEST_UPSTREAM` and `GELDAR_INGEST_TOKEN`. After it, placing `otel.caddy`, every later edit, the kill switch swap (`otel-off.caddy` for `otel.caddy`) and the rollback are each one `docker restart board-proxy`, validated first with `caddy validate`. A token rotation needs the same recreate as its own approved window.
3. The recreate and every restart interrupt every site on the node for a few seconds (0071 consequence), including the long-lived `mcp.caddy` SSE streams, which reconnect. Each is requested as its own window with the exact diff and rollback, and changes are batched. The kill switch is a restart too, so it is not instant. The procedure checks that the other sites answer after each, and has a failed-restart path (README of `deploy/caddy`, OTLP ingest).

## Consequences

- The expected public hostname list gains the ingest hostname (owner-held, not in the repo). No new listener is added: the route uses the existing HTTPS port, and `tools/portscan` expected lists do not change; a scan after the reload confirms it.
- The SigNoz UI has no Caddy route (0350 clarification, 0352).
