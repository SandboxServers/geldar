# Telemetry campaign RESUME (geldar-telemetry), 2026-11-16
Owner: freeze exemption for this session; full-text capture, no opt-out, 1-year retention; outside players captured, erase on request; Paper telemetry via new plugin jar (name TBD, default Ledger); bStats off; Paper limit 15 GiB (node step); option B (own ClickHouse+SigNoz); UI by SSH tunnel only; operator Claude may query read-only. Decision block 0350-0359.

## Merged to main and deployed (batch window, verified 2026-11-16 ~15:00Z)
- Code: #567 (T-08 eventsink: sql/0066_events_trace_id.sql adds nullable trace_id; eventsink reads traceparent), #554 (T-05: contract/src/nats-connect.ts watchNatsStatus hooks), #571 (T-06: threshold/mcp telemetry), #572 (T-06c: MCP content capture), #569 (T-07: golem action spans).
- Docs: #553, #555, #556 (Caddy OTLP ingest route, stock Caddy only), #565, #566, #568 (T-17 card and 0066-first ordering), #570 (T-03b, traces-off and stale-handle shutdown), #574.
- Earlier: decisions 0350 (#546), T-02 design (#547), T-02 rewritten for B (#553), 0351 Paper scope (#548, Proposed), 0352 option B (#549, #550, #552). Telemetry package: #551 (T-03).

## Verification result (since deploy)
- Migration 0066 recorded.
- eventsink consuming, 0 errors, 0 DLQ.
- MCP healthy.
- All 19 Bodies Up (restarted once ~14:56Z).
- Paper TPS 20.0.
- 0 deaths and 0 Velocity denials since deploy.
- Telemetry hooks emit nothing while GELDAR_TELEMETRY_URL is unset on the node.

## Known gaps
- No body_generation baseline.
- Merge queue did not coalesce: colo-images ran 5x, colo-deploy ran 4x.

## Still held (each needs geldar-93's go)
- Node stack steps N1-N13 in collector-design.md, one request each (caps, window, rollback).
- N14: Caddy ingest window (after gateway).
- N15: helper read-only stats route (separate window).
- T-06d (errors, pre-handler failures, capture order): cards written (t06d-errors-card.md: d1 telemetry, d2 MCP, d3 Body, d4 eventsink); not started. One batched deploy window: batch-deploy-plan.md.
- Paper plugin cards: scratch shard first. JEP 509 CPU sampling stays off until owner says yes.
- Paper limit edit in node colo.yml (repo copy stale).

## Decided
- T-15: Caddy route for INGEST only; UI SSH-tunnel only; token by role only.
- Shared-Caddy window request on hold until geldar-93 says.
- Merge rule: merge only docs/telemetry-only PRs with no colo-images path file.

## Open
- Batch window order was: sql/0066 first, then images (done).
- JEP 509 CPU sampling off until owner says yes.
- Paper limit lives in node colo.yml (repo copy stale).
- T-03 deferred: per-service key seam for trace/metric, shutdown tail, free-text filter, import cost.
- Scratch host for tests: unnamed; owner names it.

## Follow-ups
- Caddy image digest pinning.
- Stray worktree cleanup.
- T-03 deferrals F8, F9, F11, F12.

## Next (each needs geldar-93 go + owner narrow exemption outside telemetry/)
- Node steps N1-N15 and the Caddy ingest window (see Still held).
- T-06d (not started).
- T-13/14 scriptorium: cards written in docs/analysis/telemetry/scriptorium/README.md (T-28); wave 1 can start now (TM-01, TM-16, TM-24, TM-26, TM-30, TM-35, TM-21 code, TM-02 held for the batch window).
- PT cards (Paper plugin) after scratch test.

## Rules
No code by me; Haiku coders in worktrees; ops subagent pushes/queues; no agent sees telemetry; no node changes without geldar-93.
Merge a PR only if no changed file is in the colo-images path filter (colo-deploy recreates all Bodies): golem, animus, eventsink, threshold/mcp|register, tools/admin|mcp-tokens|players-cli|migrate, glass, sql, contract, shards/phase0.yaml, root package.json, pnpm-workspace.yaml, pnpm-lock.yaml.

## Paper plugin packet cards (2026-11-16, branch telemetry/t27-paper-cards)
- Cards for the Ledger plugin (loader-neutral `plugin/ledger-core` plus thin Paper adapter `plugin/ledger`) are in `docs/analysis/telemetry/paper-plugin/`: README.md (index, dependency graph, start-now set), cards-*.md, scratch-test-plan.md, safety-rules.md.
- Finding: `deploy/scratch/scratch.sh` allows suffixes of at most 8 characters; `telemetry` has 9 (PT-03j fixes).
- Held cards (touch live compose or deploy files, PR-only until the PT-16 window): PT-02a, PT-03l, PT-16. PT-08e (Velocity) is optional and needs the owner's nod.
