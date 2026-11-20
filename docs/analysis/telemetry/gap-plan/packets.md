# Telemetry gap plan packets (2026-11-20)

Owner approved steps 1-4 on 2026-11-20 (relayed by geldar-93/69, direct owner answers). Coders and PRs are allowed. Every node step needs a fresh owner OK with a window and runs through geldar-93/69's ops agent. Decision block 0353-0359. Evidence: SigNoz and node read 2026-11-20 ~23:20Z.

Rules for every packet: no secrets, account names or IPs in the repo; pinned versions at least two weeks old; behaviour change needs a test that fails when reverted; files under 500 lines; LF; commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never edit docs/spec.md; no prompt or thought text is ever collected; labels never name a player or life (decision 0088); nothing here is visible to an agent. Colo-images paths (golem/**, eventsink/**, threshold/mcp|register/**, contract/**, sql/**, glass/**, supervisor/**, tools/*, shards/phase0.yaml, package.json, pnpm files, colo workflows) must not merge before geldar-69 is told.

## G1: import the dashboards and alerts into SigNoz (step 1)
Files: CREATE `deploy/signoz/import.sh` and `docs/runbooks/signoz-import.md`; CREATE a test under `tools/repo-checks/src/` (name `signoz-import.test.ts`).
- The script posts each `deploy/signoz/*-dashboard.json` and `*-alerts-*.json` to the SigNoz v0.148.1 API on the loopback port through the SSH tunnel; the admin token is read from a file path passed as an argument, never printed, never in the repo. Dry-run flag prints what it would send and sends nothing. Idempotent: it lists existing dashboards and alert rules by title first and skips or updates, never duplicates. It writes nothing outside a temp dir it removes.
- The runbook gives the exact steps, rollback (delete by title) and the check that the dashboards show data.
- Test (fails when reverted): every JSON file parses; every metric name used in a dashboard or alert query is in the list of names the repo emits (grep the Ledger metric ids in `plugin/ledger*` and the TS metric constants); the script has no URL, token or account literal.
- Checks: `./geldar.ps1 check` scope for repo-checks; shellcheck-style review by hand.

## G2: NATS and Postgres monitors (step 2)
Files: CREATE `compose/opt-in/colo-nats-exporter.yml`; EDIT `deploy/telemetry/gateway.yaml`; CREATE `deploy/telemetry/postgres-monitor.sql` and `docs/runbooks/telemetry-monitors.md`; tests in `tools/repo-checks/src/`.
- NATS: `natsio/prometheus-nats-exporter` pinned by digest (collector-design section 11: `0.20.3`), `network_mode: service:nats`, reads `/varz` and `/jsz` only; caps 0.1 CPU, 64m, 64 pids; no `subsz`, no connection or route series; no published port. Gateway scrapes it.
- Postgres: SQL creates a read-only monitoring role (`pg_monitor` reads query text, so grant specific `pg_read_all_stats` only and document the risk) with the password in a secret file, not in the repo; gateway gets a `postgresql` receiver reading the password from a file path env.
- Tests: the overlay renders with `docker compose config`; caps present; no published ports; no `subsz`; the SQL has no password literal and the role cannot INSERT.
- Does NOT restart NATS or Postgres. Node steps (exporter start, role creation, gateway restage) are separate requests.

## G3: Body metrics from the player host (step 3)
Files: EDIT `golem/src/players/main.ts` and tests; EDIT `compose/colo.yml` (players-host env `GELDAR_TELEMETRY_URL` pass-through only); possibly `golem/src/metrics.ts` for new counters.
- Today only the Adam Body (`golem/src/adam/main.ts`) calls `startGolemTelemetry`; the player host (one Body per ranger, the 19 agents) pushes nothing.
- Wire `startGolemTelemetry(process.env, ...)` into the player host so it pushes `geldar_body_connected`, `geldar_tps`, `geldar_tick_lag_ms`, `geldar_wakeups_total`, `geldar_action_outcomes_total{status,reason}` with NO life or player label. Add aggregate counters: deaths, escape-ladder rung, stuck episodes, sleep outcome, eat outcome (reasons from a fixed list, no free text).
- Per-agent breakdown is a decision (0353, to write): metrics stay aggregate; per-agent rows go as operator-only events or logs with `player_id` (0350 point 7 joins spans by player id plus time).
- Test that fails when reverted: with `GELDAR_TELEMETRY_URL` set the player host starts a push and with it unset starts nothing (no timer, no request); a metric declared with a `life`/`player` label is refused.
- Merge: colo-images path. Bundle with other golem changes; tell geldar-69 the head sha first (deploy restarts all 19 Bodies for about 2 minutes).

## G4: Mind cost and token metrics (step 4)
Owned by the scriptorium (TM-10..TM-13, `docs/analysis/telemetry/scriptorium/`). I coordinate only: ask scriptorium-orchestrator for status of TM-10..13, the otel-agent on the Mind host, and which series carry cost and tokens. Needs the Caddy ingest window (`caddy-ingest-route.md`) and the owner's token, given directly by the owner, never in the repo or a message.

## G5 (later): host headroom route (N15)
Read-only stats route on the host helper; colo-images path (tools/*); separate window. Not started.
