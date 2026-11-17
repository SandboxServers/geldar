# Batched deploy plan: the one window that restarts the Bodies for telemetry

Status: plan, 2026-11-16. Nothing here is approved. Every step needs geldar-93's go and the owner's narrow exemption outside `telemetry/`. This is the ONE window in which `GELDAR_TELEMETRY_URL` is set on the node.

Why one window: `colo-deploy` recreates all 19 Bodies whenever `colo-images` publishes. Each restart disturbs live agents. The earlier batch (2026-11-16, see [RESUME.md](RESUME.md)) restarted the Bodies once on purpose, but the merge queue ran `colo-images` 5 times and `colo-deploy` 4 times. This plan makes the next deploy exactly one run of each.

## 1. Why the queue did not coalesce, and how to avoid it

Read from `.github/workflows/colo-images.yml` and `colo-deploy.yml` (INFERRED from the workflow definitions; the run logs of the 5 runs were not re-read for this plan):

- `colo-images` triggers on every `push` to `main` whose changed files match its `paths` filter. A merge queue lands PRs one at a time, so each PR that touches a filtered path is its own push to `main` and its own run.
- Its `concurrency` group is `colo-images-${{ github.ref }}` with `cancel-in-progress: false`. Concurrency groups hold at most one running and one pending run; a pending run is replaced by a newer one, so some pushes can be skipped, but runs that arrive after the first one finished each run in full. Nothing batches pushes.
- `colo-deploy` is a `workflow_run` on `colo-images`, one deploy per successful run, with group `colo-deploy` and `cancel-in-progress: false`. A deploy resolves the images of its own run's commit, so several deploys can each recreate the Bodies.
- There is no coalescing step in either workflow. The queue is therefore not the fix; fewer pushes is.

Avoidance (one rule): exactly ONE commit reaches `main` that touches a filtered path during the window.

1. Create branch `telemetry/batch-integration` from `origin/main`. Open the PRs of every code card against it as the base (not `main`). CI runs on those PRs (`pull_request`); a push to a non-`main` branch does not trigger `colo-images` (its `on.push.branches` is `[main]`).
2. Merge each card PR into the integration branch after its review. The ops agent resolves conflicts there, not on `main`.
3. When all are in and `telemetry/batch-integration` passes CI, open ONE PR `telemetry/batch-integration` to `main`. Use squash or one merge commit (never rebase-and-merge, which would push N commits). That PR enters the merge queue alone. The merge produces one push: one `colo-images`, one `colo-deploy`.
4. Freeze: from step 1 until the window ends, no other PR with a filtered-path file merges to `main`. Docs-only and telemetry-only PRs may still merge, but each one that changes `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or `.github/workflows/colo-images.yml` counts as a filtered path. If one merges anyway, the integration branch must be rebased and the step repeated; a second `colo-images` run is then expected, so say so before the window.
5. Verify before the merge: `gh api repos/<owner>/<repo>/actions/workflows/colo-images.yml/runs?branch=main&per_page=10` shows no run in progress or queued; afterwards it shows exactly one new run, and `colo-deploy` shows exactly one.

Note on `telemetry/**`: it is NOT in the `colo-images` filter, although every image copies it (`!telemetry` in the Dockerfile allow-lists). A change to `telemetry/` alone publishes nothing and deploys nothing; it reaches the Bodies only when a filtered-path file merges with it. That is why T-06d1 rides in this batch and costs no extra window.

## 2. The change set (every pending or planned code change in a colo-images path)

The filter, copied from `colo-images.yml` `on.push.paths`: `golem/**`, `animus/**`, `player-core/**`, `eventsink/**`, `threshold/mcp/**`, `tools/admin/**`, `glass/**`, `threshold/register/**`, `supervisor/**`, `tools/mcp-tokens/**`, `tools/players-cli/**`, `tools/migrate/**`, `golem/src/players/**`, `sql/**`, `shards/phase0.yaml`, `tools/repo-checks/src/identity-mode.ts`, `contract/**`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.github/workflows/colo-images.yml`.

| # | Card | Files in the filter | Notes |
|---|---|---|---|
| 1 | T-06d1 (`@geldar/telemetry`) | none in the filter (`telemetry/**`, `docs/**`) | Rides with the others (section 1). Must merge first into the integration branch. |
| 2 | T-06d2 (MCP errors, capture order) | `threshold/mcp/src/{telemetry,world,world-session,main}.ts`, possibly `threshold/mcp/src/http/front.ts` | The auth seam in `front.ts` is UNVERIFIED until the coder reads it. |
| 3 | T-06d3 (Body error paths) | `golem/src/adam/adam-body.ts`, `golem/src/body/executor-action.ts`, `golem/src/mind-link/server.ts` | |
| 4 | T-06d4 (eventsink logs) | `eventsink/src/{consumer,main}.ts`, `eventsink/package.json`, `pnpm-lock.yaml` | Optional: if it slips, the batch ships without it. A lockfile change touches every image build, which is fine in a batch that rebuilds them all anyway. |
| 5 | Gateway wiring (compose) | none in the filter: `compose/colo.yml` is not in the filter | Add `GELDAR_TELEMETRY_URL:` pass-through (no value) to the `eventsink` (line ~202) and `geldar-mcp` (line ~324) service blocks of `compose/colo.yml`. Today only `golem-body` (267) and `animus` (307) carry it, although eventsink and MCP read it. Also update `deploy/test/fixtures/colo-merged-config.yml` and run `tools/repo-checks` colo tests. The value is set on the node host, not in the repo. |
| 6 | Scriptorium cards T-13 to T-16 | none (Mind kit runs off the Colo, in the scriptorium repo) | No Colo restart. `animus/**` is in the filter, so a Mind-code change there would join the batch; none is planned, and no `animus` code reads the variable today (`docs/reference/environment-variables.md`). |
| 7 | Paper plugin cards (PT) | none (new plugin jar, scratch shard first) | Separate Paper window (D2 in `rollout-plan.md`); not this batch. |
| 8 | Docs | none | May merge before or after; not part of the freeze. |

Not in this batch: new migrations. T-08's `sql/0066_events_trace_id.sql` is already applied. If a later card adds a `sql/` file, it goes first under the 0066-first ordering (its own earlier window), never inside the image batch.

## 3. Where `GELDAR_TELEMETRY_URL` is set, and what it is

- The variable is passed through from the HOST environment into each container (`GELDAR_TELEMETRY_URL:` with no value in `compose/colo.yml`). Unset on the host means unset in the container. The code reads it in `golem/src/adam/main.ts` (Body: metrics push and the span SDK, service `geldar-golem-adam`), `threshold/mcp/src/cli.ts` and `main.ts` (service `geldar-mcp`), and `eventsink/src/main.ts` and `metrics.ts` (metrics; T-06d4 adds the SDK, service `geldar-eventsink`). No Mind code reads it.
- Which file the node uses: the node runs the compose files of its own checkout (`deploy/common.sh` builds the `docker compose -f` chain from `COMPOSE_FILE` and overlays). RESUME.md records that the repo's `compose/colo.yml` is stale against the node copy (the Paper memory limit lives only in the node file). So the repo file is not authoritative: before the window, ops reads the node's effective config (`docker compose ... config` on the node, env section for `eventsink`, `geldar-mcp`, `golem-body`/players only, no secrets printed) and confirms the pass-through lines exist there. If the node copy lacks them, adding them on the node is a node change that geldar-93 approves in the window request.
- The value: the Geldar gateway on the `geldar-colo` network, port 4318, plain HTTP, no path (the SDK appends `/v1/traces`, `/v1/logs`, `/v1/metrics`): `http://geldar-gateway:4318`. NAME CONFLICT: the task brief says `otel-gateway`; `collector-design.md` (section 9 and the env list) says `geldar-gateway`, "formerly `otel-gateway`". Ops confirms the real container name and network alias on the node (`docker network inspect` of the Geldar network, names only) and uses that one. The same value goes to MCP, Body and eventsink (one setting in the host env file the deploy reads).
- Service names (resource attribute `service.name`, namespace `geldar`): `geldar-mcp`, `geldar-golem-adam` (the Body), `geldar-eventsink`. These are set in code (T-06, T-07, T-06d4), not by env.
- Timing relative to the deploy: `colo-deploy` recreates the services with the environment present at that moment. Set the host variable BEFORE the merge (so the new images start already on) or set it after and recreate once more (a second restart, which this plan forbids). Choose before. Rollback unsets it (section 6).

## 4. Prerequisites (all must be true before the merge)

1. N7 (SigNoz collector, writer to `geldar-ch`) healthy for at least one hour, `docker stats` inside its caps.
2. N8 (Geldar gateway, `GELDAR_OTEL_ENABLED` set) healthy, health check green, sending queue not growing, send-failed counter flat.
3. A proven end-to-end test event, with NO Body or service restart: run a one-shot client container on the `geldar-colo` network (for example a pinned `otel-cli` or a `curl` image, by digest) that POSTs one OTLP trace with a marker name to `http://<gateway>:4318/v1/traces`, then confirm the marker in SigNoz through the SSH tunnel (or the read-only operator ClickHouse user) and `system.parts` growth. Remove the one-shot container. This is step N9 of `collector-design.md`. The run, the marker and the result go in the window request; without the proof the window does not open.
4. The integration branch is green on CI, reviewed once at wave end (owner rule), and the `check:repo` colo tests pass with the compose change.
5. Prior images' digests recorded (section 6). Owner approval of the window time (low load) and that the Bodies restart knowingly.
6. Disk: C: and the node meet the thresholds in `rollout-plan.md`; ClickHouse budget unchanged.

## 5. The window, in order

1. Pre-checks (read-only, record UTC time and source of each figure; do not reuse another session's numbers):
   - Migrations: `sql/` has no new file in the batch; the node's migration table shows 0066 applied (it was). If any `sql/` file is in the batch, STOP: it goes first in its own window.
   - Node baseline: `body_generation` for all 19 lives (there is no baseline today, per RESUME.md; this check creates it), the count of Bodies Up, Paper TPS, `docker stats` of Paper and the Bodies, eventsink lag and DLQ depth, MCP health.
   - Quiet-life query: lives with no action in the last 10 minutes and none mid-sleep or mid-trade are the safe ones. If more than the agreed number of lives is mid-action, wait. The exact query is written by ops from the `events` table and recorded in the window request (UNVERIFIED: the repo has no named quiet-life query yet).
   - `colo-images` and `colo-deploy` idle (section 1 step 5).
2. Set `GELDAR_TELEMETRY_URL` on the node host (value in section 3). Nothing restarts yet.
3. Merge the one PR from `telemetry/batch-integration` (ops). Expect one `colo-images` run (about the image build time) and one `colo-deploy`.
4. Verify (read-only), within 15 minutes of the deploy:
   - Exactly one `colo-images` and one `colo-deploy` run for the merge commit.
   - All 19 Bodies Up; `body_generation` +1 for each (the single restart); 0 deaths and 0 Velocity denials since deploy; Paper TPS 20.0 or equal to baseline within the baseline tolerance; eventsink consuming, 0 errors, 0 DLQ; MCP healthy.
   - Telemetry arrives: `service.name` in `geldar-mcp`, `geldar-golem-adam`, `geldar-eventsink` each present in SigNoz; a spans query shows `mcp.tool_call` with events in the T-06d2 order; one deliberately invalid call from an operator-owned test token (never an agent) shows an `invalid_input` span with arguments. No credential or `[redacted]`-bypass in a text search of the last 100 tool spans.
   - Gateway: queue below capacity, refused and send-failed counters flat; `docker stats` of the gateway at its caps; Paper MSPT unchanged.
   - Agent side unchanged: a sample of tool results and error texts is byte-identical in shape to before (the code tests prove it; the live check is a spot read of the MCP log lines only).
5. Record results in RESUME.md, with UTC times.

## 6. Rollback

- Fastest and cheapest first: unset `GELDAR_TELEMETRY_URL` on the host and recreate only the three telemetry-reading services through `colo-deploy` workflow dispatch with the SAME digests. The Body recreate is a second restart; accept it only if the stop rules fire. (T-03: with no URL the SDK starts nothing.)
- Full: `colo-deploy` workflow dispatch with the previous commit's SHA (its `colo-images` run, recorded in pre-checks, already exists, so no rebuild); `deploy/colo-rollback.sh` is the node-side script (read its dry-run output first). Redeploys the previous digests for all images.
- Revert of the integration PR on `main` is the LAST resort: it triggers another `colo-images` and `colo-deploy` (a third restart). Do it only after a rollback by digest, to keep `main` consistent.
- The gateway and stack stay up on rollback; only the services stop sending. Data already in SigNoz stays under TTL.

## 7. Stop rules

Stop and report to geldar-93 without further changes if any of these holds:

- A second `colo-images` or `colo-deploy` run starts for the window.
- Any Body does not return Up within 5 minutes of the deploy, a Body death or Velocity denial count rises above 0 since deploy, or `body_generation` rises by more than 1 for any life.
- Paper TPS drops below 19.5 for two consecutive minutes, or Paper MSPT p95 exceeds the pre-window p95 by more than 10 ms (tolerance PROPOSED; set from the baseline).
- eventsink DLQ depth grows, eventsink lag exceeds its baseline for more than 5 minutes, or MCP health fails.
- The gateway queue fills, send-failed rises, or any container exceeds its cap.
- Any credential, token or the telemetry marker appears in agent-visible text or in a SigNoz text search.
- The prerequisite test event was not proven, or the node's effective config differs from what the window request stated.

## 8. Assumptions and open items (flagged, not settled)

- UNVERIFIED: the 5x `colo-images` cause is inferred from the workflow definitions, not from the run logs.
- UNVERIFIED: the node's compose copy and its env file; the repo's `compose/colo.yml` is known stale.
- UNVERIFIED: the gateway's real container name (`geldar-gateway` vs `otel-gateway`).
- UNVERIFIED: the quiet-life query and the safe-lives threshold: ops writes them.
- Assumed: no `sql/` change in the batch; T-06d4 may slip; Mind and Paper work are outside it.
- Owner decisions still open: the window time, whether all 19 lives restart at once or `colo-cd-players.sh` rolls them (see that script's plan-only output before choosing), and the narrow exemption outside `telemetry/`.
