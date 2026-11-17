# Telemetry campaign RESUME (geldar-telemetry), 2026-11-17
Owner: freeze exemption for this session; full-text capture, no opt-out, 1-year retention; outside players captured, erase on request; Paper telemetry via the plugin jar (name Ledger); bStats off; Paper limit 15 GiB (node step); option B (own ClickHouse+SigNoz); UI by SSH tunnel only; operator Claude may query read-only. Decision block 0350-0359.

## State (2026-11-17)
- Node: steps N1-N9 done (stack, collector, gateway, end-to-end proof). See the window log in `deploy/telemetry/README.md`.
- Body, MCP and eventsink instrumentation deployed through the colo pipeline at 04:44Z. Telemetry is enabled through the env pass-through (compose lines for eventsink and geldar-mcp merged in #612); the deploy env file holds the in-network gateway address. The player Bodies push nothing.
- Paper plugin "Ledger" merged to main in waves 1-7: PRs #590 #595 #598 #602 #605 #616 #618 #621 #623 #624. No jar is placed on any server. The plugin runs a no-op ledger without an OpenTelemetry agent and ships disabled.
- Collectors ON when the plugin is enabled: tick, world, server, container (cgroup), connections, snapshots (agents only).
- Collectors OPT-IN (`collector.<id>.enabled=true`): census (390 event classes); curated (blocks/items, containers/sleep/animals, combat/movement, text chat/sign/book, operator audit/RCON, raids/tab/lifecycle/exceptions); bridge.
- JFR mappers are built but not started (no wiring).
- Dashboard JSON merged, not imported into SigNoz.
- The gateway on the node predates PT-12: it needs a restage and restart (owner-gated).
- Shared redactor merged (TypeScript and Java ports). Scans PT-18a and PT-18b run in CI.
- Free-text credentials in a log body are stored as sent by the gateway (it masks addresses only); the SDK and the Java plugin scrub before sending.

## Held / owner-gated
- Caddy ingest window: one outage plan in `deploy/caddy/README.md`; needs the owner's time and the ingest DNS name.
- Scratch telemetry Paper run (15 GB RAM, up to 6 CPUs, 20-40 min), after the NeoForge scratch re-run.
- Gateway restage for PT-12.
- PT-11 (touches the deployed geldar-core jar), PT-15, PT-16.
- No tag or release of `@geldar/telemetry` until told (tag ruleset on `telemetry-v*` is an owner follow-up).
- The `src.old*` trees and stage tarballs on the node stay until geldar-ch and keeper are recreated from the new src.

## Owner decisions pending
- D1: kick-reason free text.
- D2: item-event block positions.
- D3: a human named like a life id.
- D4: offline UUID is reversible.
- D-A: human actors recorded without id but with position and time.
- D-B: pvp damage keeps the victim only.
- D-C: kill excludes players.
- D-D: vanilla RCON thread lines dropped at the gateway.
- D-F: human chat, sign and book verbatim, no speaker id.
- D-G: command allow-list or deny-list.
- D-H: names typed inside commands exported.
- D-I: cancelled chat not captured.
- D-J: async exceptions dropped.
- Snapshots opt-in or not.

## Remaining cards
- PT-04c (spark bridge): needs a verified spark-api artifact.
- PT-06d (duty-cycle defaults from measured rates): needs the scratch run.
- PT-08c, PT-08d, PT-17b.
- PT-01 (throwaway census run): branch only.
- PT-02a, PT-03l: held, enablement.
- PT-11a-e, PT-15, PT-16.
- Older: PT-03n (second Java port of the `--password`, `curl -u` and query-key rules); T-06d (errors, pre-handler failures, capture order; see `t06d-errors-card.md`, `batch-deploy-plan.md`); N15 helper read-only stats route (separate window).
- Known gaps: no body_generation baseline; Caddy image digest pinning; stray worktree cleanup; T-03 deferrals F8, F9, F11, F12.

## Decided
- T-15: Caddy route for INGEST only; UI SSH-tunnel only; token by role only.
- JEP 509 CPU sampling off until the owner says yes.
- Paper limit lives in the node colo.yml (repo copy stale).
- TM-02 and TM-20 to TM-23 dropped 2026-11-16 by owner ruling: spans join by player_id plus time (R3, 0350 point 7); see `scriptorium/README.md`.

## Rules
No code by me; coders work in worktrees; the ops subagent pushes and queues; no agent sees telemetry; no node changes without the owner's go. Never restart Bodies; announce every node step.
Merge a PR only if no changed file is in the colo-images path filter (colo-deploy recreates all Bodies): golem, animus, eventsink, threshold/mcp|register, tools/admin|mcp-tokens|players-cli|migrate, glass, sql, contract, shards/phase0.yaml, root package.json, pnpm-workspace.yaml, pnpm-lock.yaml.

## Known flakes
- The glass integration test (poll interval).
- Colo-related repo-check timeouts under load.

## Paper plugin cards
Cards for Ledger (`plugin/ledger-core` plus the Paper adapter `plugin/ledger`) are in `docs/analysis/telemetry/paper-plugin/`: README.md, cards-*.md, scratch-test-plan.md, safety-rules.md. PT-08e (Velocity) is optional and needs the owner's nod.
NeoForge plan (additive; Paper stays supported, cards PT-N1 to PT-N14): `docs/analysis/telemetry/neoforge-telemetry.md`.

## First hour for a replacement session
1. Read this file.
2. `git worktree list` and `gh pr list`.
3. Read the "Rows pending a live scratch run" table in `paper-plugin/scratch-test-plan.md`.
4. Never restart Bodies; announce every node step.