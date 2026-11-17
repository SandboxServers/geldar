# Telemetry packet cards: the Mind host side (scriptorium kit, otel-agent, token)

Status: planning, docs only (T-28, 2026-11-16). Nothing here is built, installed or applied. Governing records: decision 0350 (full-text capture, no opt-out in development; agents never see or infer telemetry; principle 1), 0352 (ClickHouse), 0370. Design sources: `../collector-design.md` section 9 and 9.1 (ingest route, token handling), `../caddy-ingest-route.md`, `../rollout-plan.md` (A13 / N13), the survey sections 2.1, 3.2, 3.4, 4.6 and cards T-13, T-14, T-16, T-19. Content conventions come from the merged T-06c code (`threshold/mcp/src/telemetry.ts`) and the `@geldar/telemetry` package.

## Where the Mind code lives (read this first)

The Mind that thinks in production is NOT in this repository. It is the Scriptorium kit, in the separate repository `geldar-scriptorium` (checked out beside this one; its `origin/main` was read at commit `740b94e` on 2026-11-16). Paths below are relative to that repository unless a card says "geldar repo".

| What | Where (scriptorium repo) |
|---|---|
| Supervisor run loop, `childEnv`, `oneRun`, `oneTidy`, `status.json`, `supervisor.log`, `costs.csv` | `packages/supervisor/src/supervisor.ts` (668 lines today; near the 700 hard cap, so new code goes in NEW files, never into this one beyond a few call lines) |
| Supervisor settings, CLI entry, test fixture with fake `Deps` | `packages/supervisor/src/settings.ts`, `cli.ts`, `fixture.ts`, `deps.ts` |
| Session stream summary (the only reader of `session-<n>.jsonl` today) | `packages/verify/src/run-summary.ts` |
| ChatGPT harness (kit code is the MCP client) | `packages/chatgpt/src/{cli,responses,tools}.ts` |
| Kit image and compose (one compose project per player, `geldar-player-<id>`; networks `inside` internal, `keeper-net` internal, `outside`) | `image/Dockerfile`, `image/compose/player.yml`, `image/settings/*.json`, `image/proxy/*` |
| Launcher (bash and PowerShell, both) | `launcher/lib/player.sh`, `launcher/lib/player.ps1` |
| Template the model reads (`.mcp.json`, `.claude/settings.json`, skills, hooks) | `template/` |
| Stub CLI for tests | `packages/stub-cli/` |

In THIS repository the only Mind-like code is `animus/` (the Phase 0 Mind that talks to the Thinker hub) and `supervisor/` (the Colo's Body lifecycle supervisor, a different thing). Neither runs the 19 production Minds, and neither is in scope of these cards. Both are in the `colo-images` path filter. If the owner wants Phase 0 `animus/` instrumented too, that is a separate card (gap G-1).

A kit session is: the supervisor (uid 1001) starts `claude -p ... --output-format stream-json` or `geldar-chatgpt run` as the model child (uid 1000) with an explicit environment (`childEnv`), stdout to `/state/supervisor/session-<n>.jsonl`. The model has no shell (`Bash` denied in `image/settings/managed.json`) and cannot read outside `/player`.

Because the scriptorium repo is separate, the cards that live there are written for "the repo-owner session" (the session that owns scriptorium PRs). A coder is dispatched in a worktree of that repo, never of this one. Cards marked `geldar repo` run here.

## Rules for every card (copy of the campaign rules; the coder skips CLAUDE.md)

- R1. Work only in the worktree named in the brief; create or change only the files the card lists. PowerShell 7. No `git push`, `gh pr`, `git stash`. Commit locally with the message in the card plus the two trailers the brief gives.
- R2. Content (decision 0350 point 2): prompts, assistant text, reasoning, thoughts, journal text, speech, tool arguments and results are captured IN FULL, no opt-out, through `capText` (32 KiB cap, truncation marked) and `addContentEvent` (span event `geldar.content.<name>` with `.bytes` and `.truncated`). Never as a metric label or value. Never a content attribute without the `geldar.content.` prefix.
- R3. Never visible to an agent (0350 point 7): nothing the instrumentation emits may reach a prompt, a skill, a tool result, chat, a sign, a file under `/player` or the player repo, or the model child's environment. No trace id, no telemetry word in anything the model reads. Telemetry state is in memory or under `/state/supervisor` (supervisor uid only), never under the workspace.
- R4. No secrets in any attribute. Allow-list attributes only (`filterAttributes`). Names containing `token`, `secret`, `authorization`, `cookie`, `email`, `password`, `credential` are dropped by the package; do not work around that.
- R5. The exporter never blocks the Mind: asynchronous, bounded queue that drops when full, 5 s export timeout, every emit call wrapped so a throw or a rejection is swallowed and counted. A dead or absent collector must not change run timing, exit codes, backoff, `status.json` or `costs.csv`. Every card that adds an emit point has a test with a dead exporter.
- R6. Off unless the endpoint variable is set (`GELDAR_TELEMETRY_URL`): no SDK, no queue, no timer, no extra file read, behaviour byte-identical to today.
- R7. Pin exact versions (npm exact, Docker images by digest, GitHub Actions by SHA), at least two weeks old. Files under 500 lines soft, 700 hard (config and JSON included). No `utils.ts`, `helpers.ts`. LF endings. No secrets, owner hostnames, account names or IP addresses in the repo (`127.0.0.1` is fine).
- R8. A behavior change needs a test that fails when the change is reverted. Before reporting done, revert the change locally, run the named test, see it fail for the stated reason, restore. Say so in the report.
- R9. Scriptorium checks (repo root of that repo): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:repo`, and `pnpm check:template` when `template/` changes. Geldar checks: `pwsh -NoProfile -File ./geldar.ps1 pnpm check:repo`, then the package tests (CI is the full check; no local full run). At most five fix rounds per check, then stop and report.
- R10. Never edit a released prompt template. This campaign changes no template file (TM-26 only adds a test over it).
- R11. Never run `adam up`, the benchmark, live lanes or anything on the node. Docker tests run only where a card says so, by the ops agent.
- R12. Report to the path in the brief: `<card> <done|blocked|failed> <sha|-> <report-path>`, with the revert-check result and the list of files changed.

## Cards

Size is changed lines (code and tests, estimate). `CI?` says whether any file is in the geldar `colo-images` path filter (golem, animus, player-core, eventsink, threshold/mcp, threshold/register, tools/admin, tools/mcp-tokens, tools/players-cli, tools/migrate, supervisor, sql, contract, glass, shards/phase0.yaml, root package.json, pnpm-workspace.yaml, pnpm-lock.yaml). Scriptorium-repo cards can never hit that filter; they change the KIT image instead (see Batching). `Sup dir` below means `packages/supervisor/src/telemetry/` (new directory).

| Card | Repo | What | Depends on | Size | Files touched | Node / owner | CI? |
|---|---|---|---|---|---|---|---|
| [TM-01](tm-01-allow-list-mind-keys.md) | geldar | allow-list keys for Mind spans and logs | none | 80 | `telemetry/src/attributes.ts`, `telemetry/test/mind-keys.test.ts` | no | no |
| [TM-10](tm-10-kit-telemetry-copy-a.md) | scriptorium | kit telemetry package, part A: allow-list, capText, content | TM-01 | 260 (copied) | `packages/telemetry/{package.json,tsconfig.json,src/attributes.ts,src/cap-text.ts,src/content.ts}` | no | n/a |
| [TM-11](tm-11-kit-telemetry-copy-b.md) | scriptorium | kit telemetry package, part B: SDK, processors, index, drift test | TM-10 | 330 (copied) | `packages/telemetry/src/{sdk,sdk-processors,index}.ts`, `packages/telemetry/test/drift.test.ts`, lockfile | no | n/a |
| [TM-12](tm-12-supervisor-settings-start.md) | scriptorium | `GELDAR_TELEMETRY_URL` setting, start and stop in the CLI, off by default | TM-11 | 140 | `settings.ts`, `cli.ts`, `Sup dir/start.ts` (new), `package.json`, test | no | n/a |
| [TM-13](tm-13-run-span-and-metrics.md) | scriptorium | `mind.run` span, run metrics, state gauge, limit and stop events | TM-12 | 260 | `Sup dir/run-span.ts` (new), `supervisor.ts` (call lines), test | no | n/a |
| [TM-14](tm-14-prompt-build.md) | scriptorium | prompt build attributes, template hash, prompt text event | TM-13 | 150 | `Sup dir/prompt.ts` (new), `supervisor.ts` (2 lines), test | no | n/a |
| [TM-15](tm-15-log-lines-and-errors.md) | scriptorium | `supervisor.log` lines and failures as OTLP logs | TM-12 | 150 | `Sup dir/logs.ts` (new), `supervisor.ts` (1 line), test | no | n/a |
| [TM-16](tm-16-session-stream-parser.md) | scriptorium | pure session stream parser (shared with HC-41a) | none | 280 | `packages/verify/src/session-stream.ts` (new), `index` export, test, fixtures | no | n/a |
| [TM-17](tm-17-genai-spans.md) | scriptorium | stream to GenAI spans (`chat`, `execute_tool`), tokens, subagent nesting, no content | TM-13, TM-16 | 280 | `Sup dir/stream-spans.ts` (new), `supervisor.ts` (1 line), test | no | n/a |
| [TM-18](tm-18-content-events.md) | scriptorium | content events: assistant text, reasoning, tool arguments and results, journal | TM-17 | 200 | `Sup dir/stream-content.ts` (new), `stream-spans.ts` (small), test | no | n/a |
| [TM-19](tm-19-live-tail-latency.md) | scriptorium | tail the session file for per-turn latency | TM-17 | 220 | `Sup dir/tail.ts` (new), `supervisor.ts` (2 lines), test | no | n/a |
| [TM-24](tm-24-isolation-test-unit.md) | scriptorium | HC-26 extension, unit: child env carries nothing of the supervisor's | none (write first) | 200 | `packages/supervisor/src/child-env-isolation.test.ts` (new) | no | n/a |
| [TM-25](tm-25-isolation-test-container.md) | scriptorium | HC-26 extension, container: model uid cannot read the supervisor's environment | TM-24 | 180 | `tests/isolation/` docker test (new) | ops docker run | n/a |
| [TM-26](tm-26-leak-scan-kit.md) | scriptorium | telemetry vocabulary scan over template, prompt text, skills, file names | none | 150 | `tests/template/telemetry-words.test.ts` (new) | no | n/a |
| [TM-30](tm-30-otel-agent-config.md) | scriptorium | otel-agent collector config, tests | none | 160 | `image/otel-agent/config.yaml`, test | no | n/a |
| [TM-31](tm-31-otel-agent-compose.md) | scriptorium | otel-agent compose file, host network `geldar-otel`, resource caps, player overlay | TM-30 | 140 | `image/compose/otel-agent.yml`, `image/compose/player-otel.yml`, test | no | n/a |
| [TM-32](tm-32-launcher-bash-wiring.md) | scriptorium | launcher (bash): opt-in overlay for a player | TM-31 | 120 | `launcher/lib/player.sh`, test | no | n/a |
| [TM-33](tm-33-launcher-pwsh-wiring.md) | scriptorium | launcher (PowerShell): same, same tests | TM-31 | 120 | `launcher/lib/player.ps1`, test | no | n/a |
| [TM-34](tm-34-mind-host-install-runbook.md) | scriptorium (docs) | N13 install runbook for the owner, per Mind host | TM-31, B1, TM-35 | 120 | `docs/runbooks/otel-agent.md` | owner (node step N13) | n/a |
| [TM-35](tm-35-token-rotation.md) | geldar (docs) | ingest token rotation procedure and stop conditions | none | 140 | this directory only | owner | no |

## Dependency graph

```
 TM-01 (geldar keys) --> TM-10 --> TM-11 --> TM-12 --+--> TM-13 --+--> TM-14
                                                     |            +--> TM-17 --> TM-18
 TM-16 (pure parser) --------------------------------+--> TM-15   |         \--> TM-19
 TM-24 (unit isolation) --> TM-25 (container isolation)
 TM-30 --> TM-31 --> TM-32 + TM-33 --> TM-34 (owner, N13, after B1 and TM-35)
 TM-16 also feeds TM-17. TM-26 (leak scan) and TM-35 (rotation doc) have no dependencies.
```

## What can start NOW, in parallel

Wave 1, all independent, no shared files: TM-01 (geldar `telemetry/`), TM-16 (`packages/verify`), TM-24 (one new supervisor test file), TM-26 (template tests), TM-30 (`image/otel-agent/`), TM-35 (doc), TM-10 (it copies the geldar files at their current state plus the TM-01 key list; if TM-01 is not merged yet, TM-10 copies from the TM-01 branch).

Wave 2 (after TM-10 and TM-11 merge): TM-12, then in parallel TM-13, TM-15, TM-31. After TM-13: TM-14, TM-17, After TM-17: TM-18, TM-19. TM-32 and TM-33 in parallel after TM-31. TM-25 after TM-24.

Front-loaded because they unblock the most: the chain TM-01, TM-10, TM-11, TM-12 (everything on the supervisor waits on it); TM-16 (needed by TM-17, TM-18, TM-19 and by HC-41a); TM-24 (the isolation test must exist BEFORE any env change); TM-30 (the agent config is the long pole for the node).

### Overlap between parallel coders

`packages/supervisor/src/supervisor.ts` is touched, by a few call lines each, by TM-13, TM-14, TM-15, TM-17 and TM-19. It is at 668 of 700 lines: each of those cards adds only call lines and puts the logic in `packages/supervisor/src/telemetry/`. Merge them in the order TM-13, TM-15, TM-14, TM-17, TM-19; each coder rebases on the last, and conflicts are one-line hunks. TM-13 must report the line count after its change; if it would pass 690, TM-13 first moves the `status()` writer out (the card says how). No two cards create the same new file. `packages/supervisor/package.json` is touched by TM-12 only. The launcher cards TM-32 and TM-33 touch different files.

## Batching: Body, Mind and Colo redeploys

- Scriptorium cards are not in the geldar `colo-images` filter. Their effect reaches a Mind only when the kit image is rebuilt and each Mind is restarted by the launcher on the Mind host (the owner's machine). Batch them: merge all kit cards behind the off-by-default switch (R6), cut ONE kit image release, restart Minds once, and switch the endpoint on later in a second owner step. Nothing on the Colo restarts for any of them.
- Geldar cards that hit the filter: the T-19 vocabulary change in `contract/**` (another session's card). It recreates the MCP and, by the filter, every Body through `colo-deploy`. Hold it and batch it into the C1 window with the other held PRs (rollout-plan C1), never in the same window as B1 or D2. Merge rule from RESUME: do not merge a PR with a `colo-images` path file outside the batch window.
- Geldar cards that do NOT hit the filter: TM-01 (`telemetry/**`), TM-35 and these docs. They can merge at any time.
- Ordering between windows: none from the dropped cards. The tool span stays a root and joins by player_id plus time (see Dropped cards).

## Node and owner steps (no card does these)

1. B1 (shared Caddy route, one recreate for the token) is a Colo step in the rollout plan; N13 needs it first.
2. The owner generates and places the ingest token (never in a repo, chat or log). TM-35 is the rotation procedure that rollout-plan risk 8 says must exist before N13.
3. TM-34 (install on each Mind host): an owner session per host.
4. TM-25 docker run: the ops agent, on a machine with Docker.

## Assumptions

- A1. The otel-agent holds the ingest token, NOT the supervisor and NOT the player container (collector-design 9: "on each Mind host, as the OTEL headers environment of the `otel-agent` only"). The brief for this task said the supervisor holds it; the stricter reading is used because the agent runs in its own container and the supervisor then has nothing to leak. If the owner prefers the supervisor to post to the Colo directly through `proxy-player`, TM-30 and TM-31 are replaced by an egress allowlist entry and the token moves into the supervisor environment; TM-24 and TM-25 are written with a canary named like the token so they pass in both variants and protect the token in the second.
- A2. `GELDAR_TELEMETRY_URL` is the kit variable (name only in compose, value from the launcher's environment like `GELDAR_MCP_URL`). It is NOT in `PASS_THROUGH`, so the child never gets it.
- A3. The stream-json line shapes (assistant `message.usage`, `message.model`, `message.stop_reason`; `tool_use` blocks with `id`, `name`, `input`; `user` lines with `tool_result` blocks and `tool_use_id`; `parent_tool_use_id` on subagent lines; the `result` line) come from the survey and `run-summary.ts`. They are UNVERIFIED against a real 2.1.310 transcript. TM-16 starts from `packages/stub-cli` output and records any shape that differs.
- A4. Per-turn latency is not in the stream (no per-line timestamps are known). TM-17 gives turn spans honest timing only when TM-19 (tail) is on; otherwise the spans carry `timing=none` and the run's own start and end.
- A5. `run_id` for Mind spans is `<player_id>/<run number>`. `player_id` is a span attribute (0350 allows it), read from a new name-only compose variable `GELDAR_PLAYER_ID`, never passed to the child (TM-12). `life_id` is a Body-side id the Mind does not know; the join key is `player_id` plus time plus the MCP session.
- A6. The `inside` network is per player project and `internal: true`, so a host-wide agent needs a shared network. TM-31 uses one external internal network `geldar-otel`, joined by the agent and by each player's `player` service only, through an overlay file the launcher merges when the owner enables it (TM-32, TM-33). A missing network would fail `compose up` for a player, which is why the overlay is opt-in.

## Gaps and risks (for the owner and the orchestrator)

- G-1. `animus/` (Phase 0 Mind, geldar repo) has no card. It is not one of the 19 production Minds. A small card can be written on request.
- G-2. HC-41a (`turns.jsonl`, the parser's other consumer) is not on scriptorium `main`. TM-16 exports the parsed record type that HC-41a should adopt, so the two cannot disagree.
- G-3. The kit cannot import `@geldar/telemetry` (a private workspace package in another repository). TM-10 and TM-11 vendor a copy, and TM-11 adds a drift test against a manifest naming the geldar commit. Owner decision: vendor (default here) or publish the package privately. Drift is the main risk: any change to `telemetry/src/attributes.ts` in geldar needs a matching kit card.
- G-4. The keeper (survey M6: push outcome, HELD) runs on `keeper-net`, which cannot reach the agent. No card; the supervisor already reads HELD and TM-13's state gauge reports `held`.
- G-5. Claude Code native OpenTelemetry (T-16) and `OTEL_*` names in the child environment are NOT carded. They would put telemetry vocabulary in the model process. Needs the owner, and TM-24 updated first.
- G-6. Cost for the ChatGPT harness is always 0 (a kit metering gap); TM-13 reports it as is.
- G-7. Stock Caddy has one token slot, so rotation (TM-35) has a short window in which posts get 401; OTLP does not retry a 401, so telemetry sent in that window is lost. A two-token Caddy matcher would remove the gap; that is a change to `caddy-ingest-route.md` and `deploy/caddy/otel.caddy`, outside this task.
- G-8. `supervisor.ts` is 668 lines against a 700 hard cap (see Overlap).
- G-9. The otel-agent image digest and the exact `otlphttp` exporter keys are UNVERIFIED here; TM-30 resolves the digest at implementation time and compares it with the gateway's pin (collector-design section 2).
- G-10. Whether the kit image build copies workspace packages (so `packages/telemetry` reaches the container) is UNVERIFIED; TM-12 checks `image/Dockerfile` and stops if it does not.
- G-11. The `player_id` and `run_id` attribute values (A5) and the content event names are this plan's choice; the owner or the T-17 dashboards card may rename them. Names are pinned in one file in the kit (`Sup dir/names.ts`, created by TM-13) so a rename is one edit.

## Dropped cards

TM-02 (MCP extracts `_meta.traceparent`, then the HTTP `traceparent` header, to parent the tool span), TM-20 (ChatGPT harness `_meta.traceparent`), TM-21 (CLI header proof harness), TM-22 (`TRACEPARENT` in the model child environment) and TM-23 (run-id header fallback, both halves, including TM-23b) were written and then dropped before any code was started. Their card files are deleted.

- Why: the owner ruled (owner/geldar-93, relayed 2026-11-16) that spans join by `player_id` plus time, per R3 above and decision 0350 point 7: trace context is forwarded as `traceparent`/`tracestate` only where the SDKs do it, Baggage is not used, and nothing is injected into the model process. The model child environment must stay free of telemetry context. This is consistent with TM-24 and TM-25, which assert that the child gets NO `TRACEPARENT` and no `OTEL_*` variable (they plant `TRACEPARENT` as a canary that must NOT appear; keep them as written).
- Join key now: `player_id` (span attribute, A5) plus time plus the MCP session. `run_id` is defined in A5 and TM-17 (`gen_ai.conversation.id`); attribute names are pinned in `packages/supervisor/src/telemetry/names.ts` (created by TM-13, G-11). No dropped card defined either.
- Who and when: the owner, relayed 2026-11-16, approving the scriptorium orchestrator plan except these four cards.
- TM-02 specifically: with TM-20 to TM-23 dropped nothing sends a carrier, so the extraction has no sender (spans join by `player_id` plus time, 0350 point 7; R3), and it lives in a `colo-images` path (`threshold/mcp/**`), so it would put dead code into the one batched Body/MCP deploy. The MCP tool span stays a root span; no surviving card depends on TM-02.
