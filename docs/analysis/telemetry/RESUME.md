# Telemetry campaign RESUME (geldar-telemetry), 2026-11-16
Owner: freeze exemption for this session; full-text capture, no opt-out, 1-year retention; outside players captured, erase on request; Paper telemetry via new plugin jar (name TBD, default Ledger); bStats off; Paper limit 15 GiB (node step); option B (own ClickHouse+SigNoz); UI by SSH tunnel only; operator Claude may query read-only. Decision block 0350-0359.

## Merged
- Decisions: 0350 (#546), T-02 design (#547) + rewritten for B (#553), 0351 Paper scope (#548, Proposed), 0352 option B (#549, #550, #552).
- Docs: #553, #555, #556 (Caddy OTLP ingest route, stock Caddy only), #565, #566, #568 (T-17 card and 0066-first ordering).
- Telemetry package: #551 (T-03), #570 (T-03b, traces-off and stale-handle shutdown).

## Held (code PRs, open, unmerged)
- #554 (T-05): CI green. Merging deploys all Bodies and Mind.
- #567 (T-08 eventsink), #569 (T-07 golem), #571 (T-06 mcp).
- #572 (T-06c content capture): built and reviewed, stacked on #571, held.

## Decided
- T-15: Caddy route for INGEST only; UI SSH-tunnel only; token by role only.
- Shared-Caddy window request on hold until geldar-93 says.
- Merge rule: merge only docs/telemetry-only PRs with no colo-images path file.

## Open
- Batch window order: sql/0066 first, then images.
- Still held: all node steps, Caddy window, batch deploy.
- T-06d (content capture follow-up, see t06c card): not started; needs geldar-93's go.
- T-06..T-08 code PRs wait for geldar-93's go before merge.
- JEP 509 CPU sampling off until owner says yes.
- Paper limit lives in node colo.yml (repo copy stale).
- T-03 deferred: per-service key seam for trace/metric, shutdown tail, free-text filter, import cost.
- Scratch host for tests: unnamed; owner names it.

## Next (each needs geldar-93 go + owner narrow exemption outside telemetry/)
T-05 merge decision (held, see above); T-06d (not started); T-13/14 scriptorium; PT cards (Paper plugin) after scratch test. Node steps N1-N15 in collector-design.md, one request each (caps, window, rollback).

## Rules
No code by me; Haiku coders in worktrees; ops subagent pushes/queues; no agent sees telemetry; no node changes without geldar-93.
Merge a PR only if no changed file is in the colo-images path filter (colo-deploy recreates all Bodies): golem, animus, eventsink, threshold/mcp|register, tools/admin|mcp-tokens|players-cli|migrate, glass, sql, contract, shards/phase0.yaml, root package.json, pnpm-workspace.yaml, pnpm-lock.yaml.
