# Telemetry campaign RESUME (geldar-telemetry), 2026-11-17

> Stale banner (2026-11-21): not refreshed since 2026-11-17. Telemetry branches merged to origin/main since then include #837 to #840, #847, #848, #853, #855, #857 and #858 (first-parent merge list). This file does not record them: read those PRs and `docs/analysis/telemetry/gap-plan/` before acting.
Owner: freeze exemption for this session; full-text capture, no opt-out, 1-year retention; outside players captured, erase on request; Paper telemetry via the plugin jar (name Ledger); bStats off; Paper limit 15 GiB (node step); option B (own ClickHouse+SigNoz); UI by SSH tunnel only; operator Claude may query read-only. Decision block 0350-0359.

## State (2026-11-17)
- Node: steps N1-N9 done (stack, collector, gateway, end-to-end proof). See the window log in `deploy/telemetry/README.md`.
- Body, MCP and eventsink instrumentation deployed through the colo pipeline at 04:44Z. Telemetry is enabled through the env pass-through (compose lines for eventsink and geldar-mcp merged in #612); the deploy env file holds the in-network gateway address. The player Bodies push nothing.
- Paper plugin "Ledger" merged to main in waves 1-7: PRs #590 #595 #598 #602 #605 #616 #618 #621 #623 #624. No jar is placed on any server. The plugin runs a no-op ledger without an OpenTelemetry agent and ships disabled.
- Collectors ON when the plugin is enabled: tick, world, server, container (cgroup), connections, snapshots (agents only).
- Collectors OPT-IN (`collector.<id>.enabled=true`): census (390 event classes); curated (blocks/items, containers/sleep/animals, combat/movement, text chat/sign/book, operator audit/RCON, raids/tab/lifecycle/exceptions); bridge.
- PT-08c opt-in progress collector merged (#626).
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
- NeoForge privacy defaults P-N1 to P-N6 (`neoforge-telemetry.md` section 5): open until the owner answers; defaults as stated there.
- D2 note (NeoForge): NeoForge container events carry no position. The PT-N7 card text and the Paper build do not match on positions; recorded as a mismatch, not resolved.

## Remaining cards
- PT-04c (spark bridge): needs a verified spark-api artifact.
- PT-06d (duty-cycle defaults from measured rates): needs the scratch run.
- PT-08d, PT-17b.
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

## NeoForge telemetry (2026-11-17)
- Merged to main: plan #628; PT-N2 #629; PT-N5 #630; PT-N11 #631; PT-N1 #635; PT-N10 #636; PT-N4a #637; PT-N3 #638; follow-up #639; PT-N9 #640; PT-N7 #641; PT-N8 #642.
- Remaining: PT-N6 (blocked on the node join test: which UUID and name the server sees behind Velocity); PT-N4b (world, server and snapshot collectors; unblocked by PT-N5); PT-N12 (blocked on geldar-neoforge P3/P4); PT-N13 (scratch NeoForge telemetry run, owner-gated); PT-N14 (enablement window, owner-gated); G1 (neoforge CI lane; owner-approved PR needed; module's own tests do not run in CI today).
- Full state and unverified items: `docs/analysis/telemetry/neoforge-telemetry.md`, "Current state".
- Paper stays fully supported.

## First hour for a replacement session
1. Read this file.
2. `git worktree list` and `gh pr list`.
3. Read the "Rows pending a live scratch run" table in `paper-plugin/scratch-test-plan.md`.
4. Never restart Bodies; announce every node step.
## Gap plan 2026-11-20 (geldar-telemetry; owner approved steps 1-4; coders and PRs allowed)
- Live: Ledger on Paper since 23:08:37Z (six default-on collectors, opt-ins off, jar 912d2841, core a77c89c3, agent 2.33.1; post-restart tick p95 4.9-5.3 ms, dropped 0). Console log lines ship via the agent's log4j appender (owner: fine).
- Packets: `gap-plan/packets.md`. G1 SigNoz import (telemetry/g1-import), G2 NATS and Postgres monitors (telemetry/g2-monitors), G3 player host Body metrics and decision 0353 (telemetry/g3-body). Each reviewed once (fix-first), fixed; PRs pending. G3b (aggregate counters, managed host env) and G5 (host stats route) not started.
- Step 4 blocked: scriptorium TM-10..13 and TM-31 not started; needs the Caddy ingest window and the owner's token.
- Decision block 0353-0359 (0353 used by G3). Every node step needs the owner's fresh OK, run by geldar-69's ops from an exact brief; colo-images merges go to geldar-69 with the head sha first.
