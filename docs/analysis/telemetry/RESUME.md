# Telemetry campaign RESUME (geldar-telemetry), 2026-11-16
Owner: freeze exemption for this session; full-text capture, no opt-out, 1-year retention; outside players captured, erase on request; Paper telemetry via new plugin jar (name TBD, default Ledger); bStats off; Paper limit 15 GiB (node step); option B (own ClickHouse+SigNoz); UI by SSH tunnel only; operator Claude may query read-only. Decision block 0350-0359.

## Merged
0350 (#546), T-02 design (#547) + rewritten for B (#553), 0351 Paper scope (#548, Proposed), 0352 option B (#549, #550, #552), T-03 @geldar/telemetry (#551).
#555 and #556: Caddy OTLP ingest route. Stock Caddy only, no custom image, no rate limit module.

## Not merged
#554 (T-05): PR held open, CI green. Merging deploys all Bodies and Mind.

## Decided
T-15: Caddy route for INGEST only; UI SSH-tunnel only; token by role only.
Shared-Caddy window request on hold until geldar-93 says.

## Open
- T-06..T-08 not approved; wait for geldar-93's go.
- JEP 509 CPU sampling off until owner says yes.
- Paper limit lives in node colo.yml (repo copy stale).
- T-03 deferred: per-service key seam for trace/metric, shutdown tail, free-text filter, import cost.
- Scratch host for tests: unnamed; owner names it.

## Next (each needs geldar-93 go + owner narrow exemption outside telemetry/)
T-05 contract/src/nats-connect.ts status events (PR held, see above); T-06 mcp; T-07 golem; T-08 eventsink (+migration trace_id); T-13/14 scriptorium; PT cards (Paper plugin) after scratch test. Node steps N1-N15 in collector-design.md, one request each (caps, window, rollback).

## Rules
No code by me; Haiku coders in worktrees; ops subagent pushes/queues; no agent sees telemetry; no node changes without geldar-93.
Merge a PR only if no changed file is in the colo-images path filter (colo-deploy recreates all Bodies): golem, animus, eventsink, threshold/mcp|register, tools/admin|mcp-tokens|players-cli|migrate, glass, sql, contract, shards/phase0.yaml, root package.json, pnpm-workspace.yaml, pnpm-lock.yaml.
