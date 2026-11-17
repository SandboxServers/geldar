# Telemetry campaign RESUME (geldar-telemetry), 2026-11-17
Owner: freeze exemption for this session; full-text capture, no opt-out, 1-year retention; outside players captured, erase on request; Paper telemetry via new plugin jar (name TBD, default Ledger); bStats off; Paper limit 15 GiB (node step); option B (own ClickHouse+SigNoz); UI by SSH tunnel only; operator Claude may query read-only. Decision block 0350-0359.

## State (2026-11-17)
- Node: N1-N9 done (stack, collector, gateway; N9 end-to-end proof passed 2026-11-17 03:03Z). See the window log in `deploy/telemetry/README.md`.
- Merged: Paper plugin waves 1-2 and the credential scrub (no-op ledger, nothing wired); the shared redactor; the Caddy ingest route file (NOT placed on the node).
- Draft PR 608: Body, MCP and eventsink instrumentation, awaiting the announced deploy window (colo-images path files; colo-deploy recreates all Bodies).
- Telemetry hooks emit nothing while GELDAR_TELEMETRY_URL is unset on the node.
- Free-text credentials in a log body are stored as sent: the gateway masks addresses only; the SDK and the Java plugin scrub before sending.

## Remaining
- PT-03l wiring.
- PT-03n: second Java port of the `--password`, `curl -u` and query-key rules.
- JFR handlers; later Paper waves.
- Caddy ingest window (after the gateway); import the dashboard; set GELDAR_TELEMETRY_URL.
- Owner follow-ups: tag ruleset on `telemetry-v*`; release when told.
- T-06d (errors, pre-handler failures, capture order): cards written (t06d-errors-card.md), not started; one batched deploy window (batch-deploy-plan.md).
- N15: helper read-only stats route (separate window).
- Known gaps: no body_generation baseline; Caddy image digest pinning; stray worktree cleanup; T-03 deferrals F8, F9, F11, F12.

## Decided
- T-15: Caddy route for INGEST only; UI SSH-tunnel only; token by role only.
- JEP 509 CPU sampling off until owner says yes.
- Paper limit lives in node colo.yml (repo copy stale).
- Merge rule: merge only docs/telemetry-only PRs with no colo-images path file.
- TM-02 and TM-20 to TM-23 dropped 2026-11-16 by owner ruling: spans join by player_id plus time (R3, 0350 point 7); see scriptorium/README.md.

## Rules
No code by me; Haiku coders in worktrees; ops subagent pushes/queues; no agent sees telemetry; no node changes without geldar-93.
Merge a PR only if no changed file is in the colo-images path filter (colo-deploy recreates all Bodies): golem, animus, eventsink, threshold/mcp|register, tools/admin|mcp-tokens|players-cli|migrate, glass, sql, contract, shards/phase0.yaml, root package.json, pnpm-workspace.yaml, pnpm-lock.yaml.

## Paper plugin packet cards
Cards for the Ledger plugin (loader-neutral `plugin/ledger-core` plus thin Paper adapter `plugin/ledger`) are in `docs/analysis/telemetry/paper-plugin/`: README.md (index, dependency graph), cards-*.md, scratch-test-plan.md, safety-rules.md. Held cards (touch live compose or deploy files, PR-only until the PT-16 window): PT-02a, PT-03l, PT-16. PT-08e (Velocity) is optional and needs the owner's nod.
