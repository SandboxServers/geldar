# Telemetry rollout plan (T-16)

Status: docs only, 2026-11-16. Nothing in this file is run. Each step is a separate request to the orchestrator geldar-93, with its own caps, window, rollback and verification. "Owner" means the owner at the time of the step.

Sources: `collector-design.md` (steps N1 to N15, sections 4, 9, 13, 14, 16, 17), `caddy-ingest-route.md`, decisions 0350, 0351 and 0352 (in `docs/decisions/`).

Labels: **UNVERIFIED** = not checked against the node or the repo. **PROPOSED** = a value not yet measured.

## 0. Gaps in the inputs

- **RESUME.md**: the brief names one in this folder. There is none in `docs/analysis/telemetry/`, so nothing is taken from it.
- **Held code PRs** (T-05 PR #554, T-06, T-07, T-08 with migration): not listed in any file in the repo. The list comes from the brief and is **UNVERIFIED** until the orchestrator confirms the PR numbers and the migration.
- **Gateway pids**: 128 in 0350 and 0082, 256 in the 0352 table. This plan uses 256 (F11, open for the orchestrator).
- **Single-node ClickHouse without keeper**: **UNVERIFIED** (0352 risk 4). The keeper rule in `collector-design.md` section 4 applies until it is checked.
- **Scratch shard host**: not named in the repo. **UNVERIFIED**; the owner names it.

## 1. Sequence

Order: Phase A (N1 to N13), Phase B (N14, after the gateway), Phase C (batch deploy), Phase D (Paper). Phases run one at a time. No two steps that change a shared service run in the same window.

Caps are per container: CPU, memory (memswap equal to mem_limit), pids. Caps come from the 0352 table as mirrored in `collector-design.md` section 4 and are **PROPOSED** (not measured).

"Must not touch" applies to every step: the other tenant's SigNoz stack, server, network and views; Paper's tick (except in the Phase D window, where the restart is the step); running Bodies (except in Phase C, where redeploying them is the step itself).

### Phase A: node stack

| Step | What it does | Caps | Approver and window | Verification | Exact rollback | Must not touch |
|---|---|---|---|---|---|---|
| A1 (N1) | Read-only checks: free loopback ports (`ss`), Geldar network name free, Docker data root, Caddy version and build, cgroup layout, NATS monitor port. Also reads the node's Caddy import line for B0. | read-only | none needed; any time | Results recorded in the step report. Any conflict stops the sequence. | none needed | any state; read-only verbs only |
| A2 (N2) | Create network `geldar-telemetry` with no published ports. | none | owner (new Geldar network); low load | Network exists; `docker ps` names unchanged against the list taken before | `docker network rm geldar-telemetry` once its containers are gone | the other tenant's network and containers; no container of the other tenant joins this network |
| A3 (N3) | Create `/mnt/nvme/geldar-telemetry/{clickhouse,keeper,query}` and the gateway queue (1 GiB, fixed size) with the image owner uids (**UNVERIFIED**). | queue 1 GiB; ClickHouse has no quota | owner (new data path, disk); low load | Directories exist with the expected uids; free space on `/mnt/nvme` recorded | remove the empty directories; keep any data until the owner decides | the other tenant's data under `/mnt/nvme`; root filesystem free space (small, risk 2) |
| A4 (N4) | Start `geldar-ch` with the writer and reader users and the settings profiles (0352). Start `geldar-ch-keeper` only if the keeper rule needs it. | `geldar-ch` 3.0 CPU, 8g, 1024 pids; keeper (if used) 0.5 CPU, 1g, 256 pids | owner (new server, RAM); low load, Paper not restarted | Container healthy; `docker stats` at or under caps; reader user cannot write; writer cannot read `system` tables it does not need (negative tests, `collector-design.md` section 16); keeper rule result recorded (**UNVERIFIED**) | `docker compose ... rm -s geldar-ch` (and `geldar-ch-keeper` if started); keep the data directory | the other tenant's `signoz-clickhouse` and `signoz-zookeeper-1` (not used by Geldar); Paper's memory (RAM overcommit risk 5: caps sum to 185 GB on a 128 GB node) |
| A5 (N5) | Run `geldar-signoz-migrator` once against `geldar-ch`; set the 365-day retention on the Geldar stack. | 0.5 CPU, 512m, 128 pids | owner (schema, retention); low load | Migrator exits 0; Geldar database exists; TTL present on each telemetry table after the first merge (`SHOW CREATE TABLE`, read-only) | drop the Geldar database the migrator created (checked empty first); remove the container | any database other than the Geldar one; the other tenant's ClickHouse |
| A6 (N6) | Start `geldar-signoz-query` and `geldar-signoz-ui`. The UI is on loopback only and is reached by SSH tunnel. | query 1.0 CPU, 1g, 256 pids; UI 0.25 CPU, 256m, 64 pids | owner (UI access path, 0352); low load | `ss -ltn` shows the UI port on 127.0.0.1 only; `docker port geldar-signoz-ui` shows loopback only | `docker compose ... rm -s` for both containers | no Caddy route for the UI; the other tenant's SigNoz UI and its views |
| A7 (N7) | Start `geldar-signoz-otelcol` (writer to `geldar-ch`). | 0.5 CPU, 1g, 256 pids; bounded in-memory queue | owner (new writer); low load | Container healthy; `otelcol validate` passes (section 16) | `docker compose ... rm -s geldar-signoz-otelcol` | the other tenant's collector and its pipelines |
| A8 (N8) | Start `geldar-gateway` with `GELDAR_OTEL_ENABLED` set. Geldar services stay on endpoint unset. The request should also name the `127.0.0.1` publish for B1 (F1), so B1 needs no second gateway recreate (**PROPOSED**). | 0.5 CPU, 512m, 256 pids; `GOMEMLIMIT=400MiB`; read-only root; `cap_drop: ALL`; json-file logs | owner (gateway on the Geldar network); low load, Paper not restarted | `docker inspect`: no `docker.sock` mount, `ReadonlyRootfs` true, `CapDrop` contains ALL, json-file driver; health check passes; no Geldar service restarted (endpoint still unset) | unset `GELDAR_OTEL_ENABLED` and recreate the Geldar services through CD (SDKs off, T-03); then `rm -s geldar-gateway` | Geldar services' endpoint stays unset; Paper and Bodies not restarted; the other tenant's network |
| A9 (N9) | Verify. A scratch run first (same stack shapes in a scratch compose project, no player Bodies), then one test event on the node. | read-only checks; one test event | owner's window | Section 16 checklist: `geldar-*` services carry `service.namespace=geldar`; no IP literal in logs; no RCON thread lines; no `Authorization`, token or password attribute; queue below capacity; send-failed and refused counters flat; test marker found in SigNoz through the tunnel and in `system.parts` growth; `docker stats` at caps; Paper TPS and MSPT in a baseline window and in a window with non-empty `system.merges` match (tolerance **PROPOSED**, set from the baseline) | as A8 | Paper tick during merges; the other tenant's views; the other tenant's alert rules |
| A10 (N10) | Start `nats-exporter` in the NATS namespace, with `/varz` and `/jsz` only. | 0.1 CPU, 64m, 64 pids (pid value is a **UNVERIFIED** choice) | any time; approval already given for `/varz` and `/jsz` | Series `nats` present; no `subsz`, connection or route series (`collector-design.md` section 11) | remove the service | NATS server, its config and its permissions |
| A11 (N11) | Create the monitoring role for Postgres (section 12). | none | owner (database role); low load | Role cannot `INSERT` (permission denied, checked with `psql`); `postgresql` series present | revoke grants, then `DROP ROLE` (the role owns nothing) | game database roles and data; note `pg_monitor` reads query text (risk 13) |
| A12 (N12) | SigNoz alert rules for the Geldar share, `/mnt/nvme` and the queue. | none | owner (alert channel not yet chosen); any time | Rules listed in SigNoz; firing test **UNVERIFIED** (not specified in source) | disable the rules | the other tenant's alert rules and channels |
| A13 (N13) | Install `otel-agent` on each Mind host (owner's machine, outside player containers). Needs B1 first, because posts go through the Caddy route. | agent 0.25 CPU, 256m | owner's session; the owner places the token | Data arrives through the route; the token is not in the agent's logs; the model child does not inherit the token (T-14 test) | stop and remove the agent; rotate the token if it was shown in any log | the ingest token value; Mind-host player containers |

### Phase B: Caddy ingest route (after the gateway)

| Step | What it does | Caps | Approver and window | Verification | Exact rollback | Must not touch |
|---|---|---|---|---|---|---|
| B0 (pre-check, read-only) | Read-only pre-check of the shared Caddy, done 2026-11-16 12:33Z. The shared Caddy is container `board-proxy`, Caddy v2.11.6, built locally from `caddy:2-builder` with the `caddy-dns/azure` module (unpinned tags; digest pin is a follow-up). Compose project on the node under `board-proxy`; Caddyfile bind-mounted read-only; config directory at `/config`; admin off; host network; 256 MiB limit; restart `unless-stopped`. Env from a root-only env file; the owner edits it and a recreate loads it. The only import is `import /config/geldar/*.caddy` (top-level glob). The global block has admin off, an email directive and `servers { trusted_proxies static private_ranges }`, with no timeouts. `mcp.caddy` serves long-lived SSE (`flush_interval -1`, `stream_close_delay 5s`). | read-only | none needed; done | **RESULTS (read-only, 2026-11-16 12:33Z):** the import line is as expected (`/config/geldar/*.caddy`), so `otel.caddy` goes in `config/geldar/`. No global timeouts are added, because global `write` and `idle` timeouts could cut the SSE streams of `mcp.caddy`; timeouts are per site only. Pass. `caddy validate` of the new file on the node's version is still to run at B1. | none needed | no reload, no recreate, no edit to `mcp.caddy` or the global block |
| B1 (N14) | Add `deploy/caddy/otel.caddy` (live file) with validate and reload. Owner sets `GELDAR_INGEST_TOKEN` in the Caddy environment (at least 32 random bytes, owner-generated). One recreate of the shared Caddy for the token. Then `caddy reload`. The file goes in `config/geldar/` (the only import glob). No global `servers` timeouts are added, because `mcp.caddy` serves long-lived SSE; the per-site `transport http` timeouts are inside the file. | one recreate of the shared Caddy; reloads; upstream `127.0.0.1:<port>` from A8 | owner, at the time of each change (ruling 2026-11-16); its own low-load window; each recreate and each reload approved separately | Env check by length only (token at least 32 bytes; host and upstream set); `caddy validate` passes; after reload: POST with no token gets 401 on each of the three paths; GET gets 405; POST with token does not get 401 or 404; another path gets 404; body over 8 MiB gets 413; access log has no `Authorization` value | swap `otel-off.caddy` in for `otel.caddy` (every path then answers 503), validate, reload; no global timeouts exist to remove; the `transport http` block leaves with the file; the token may stay until the next recreate | `mcp.caddy` and its traffic; the UI (no Caddy route); the shared Caddy's other sites; no Body or Mind restart; no other recreate |

Note: stock Caddy has no per-client rate limit, and the 401 path is not rate limited (`caddy-ingest-route.md`). This is accepted by the owner's ruling, not a gap this plan closes.

### Phase C: batch deploy of the held code PRs

| Step | What it does | Caps | Approver and window | Verification | Exact rollback | Must not touch |
|---|---|---|---|---|---|---|
| C1 | Batch deploy of the held PRs: T-05 (PR #554), T-06, T-07, T-08 (with migration). Every Body and every Mind goes out through `colo-images` then `colo-deploy` in one window. Telemetry endpoint stays unset, so no SDK starts. | none defined in sources (**UNVERIFIED**) | owner (batch approval at the time); one window; not in the same window as B1 or D2 | Each PR's checks; each Body and Mind comes back up; migration applied once; Geldar endpoint still unset (**UNVERIFIED** that the held PRs ship with it off) | redeploy the previous `colo-images` digest through `colo-deploy`; migration rollback **UNVERIFIED**: if T-08 has no down path, stop before its migration runs and report | the telemetry stack (A1 to A13); Caddy; Paper's process (this step redeploys Bodies by design, so Bodies are not protected here) |

### Phase D: Paper

Sequencing from 0351 (PT-01 and PT-03 in parallel, then PT-16). JEP 509 CPU-time sampling (PT-14) and JEP 520 method timing (PT-13) stay **off** through this plan; each needs its own owner yes.

| Step | What it does | Caps | Approver and window | Verification | Exact rollback | Must not touch |
|---|---|---|---|---|---|---|
| D1 (scratch shard) | Scratch-only runs: the census (PT-01) and the overhead A/B (PT-15), with the scratch jar and config. Scratch shard name **UNVERIFIED**. | scratch only; no live caps | owner (scratch window) | PT-15 results document. Targets (0351 point 9, **PROPOSED** for scratch): MSPT overhead under 2% of the tick (1 ms at 20 TPS); plugin and agent together at most 1 CPU on live Paper | stop the scratch Paper; unmount the scratch jar; remove the scratch config | the live Paper and the Colo tick; Colo Bodies |
| D2 (live window, PT-16) | One Paper restart takes the agent, the plugin and the Geldar-Core seams (PT-11) together. Paper container memory limit goes from 14 GiB to 15 GiB (15,032,385,536 to 16,106,127,360 bytes), a compose change. Check whether `shards/colo.yaml` (0082) holds this limit first (open item in 0351). `JAVA_AGENTS` set. Requires D1 to pass and C1 to be finished. | Paper 15 GiB (from 14); plugin and agent at most 1 CPU | owner: window, jar sha256 and rollback in the request | `tick query` baseline and after; TPS and MSPT within the 0351 targets; series arrive (`geldar_tps`, tick-lag histogram); no RCON thread lines; throttled ratio tracked against the 25% finding in 0351 | unmount the jar, unset `JAVA_AGENTS`, restart Paper once (0351 PT-16); revert the memory limit in the compose file if it was changed | the other tenant; the telemetry stack's configuration; JEP 509 and JEP 520 stay off; the Paper restart is the only restart in this step, and Bodies reconnect when Paper comes back (the owner approves that knowingly) |

## 2. Dependencies and stop rule

Dependencies:
- A1 is first. Its results gate A2.
- A2, A3, A4, A5, A6, A7, A8, A9 run in that order. Each needs the previous one's verification to pass.
- A10, A11 and A12 need A9 to pass (they read from the running stack). A10 may run any time as its own read-only exporter.
- B0 needs A1 only (read-only). Its results gate B1.
- B1 needs A8 (gateway with its loopback publish), A9 (verify passed) and B0 (pre-check passed).
- A13 needs B1 (posts go through the route) and a token rotation procedure, which is not written yet (risk 8).
- C1 does not depend on A or B in code, but it must not share a window with B1 or D2, and the telemetry endpoint must stay unset during it.
- D1 is independent of A to C (scratch). D2 needs D1 to pass, A9 to pass (the stack and the gateway are up), and C1 to be finished (so the Paper window does not overlap a batch; **PROPOSED** ordering).
- Caps are proposals. The node's RAM ceiling (185 GB of caps on 128 GB, risk 5) is accepted only by the owner at A4.

Stop rule: any step that fails its verification stops the sequence. The next step does not start. The failing check is reported to the owner with the step number. A step's rollback runs only when the owner's approval for that step names it, and each request must name it (`collector-design.md` section 14). The exception is a step that has already moved traffic: then the first action is the rollback named in its request, and the owner is told at once.

Changes to the shared Caddy (B1) and any Body or Paper restart (C1, D2) are never in the same window.

## 3. Asks of the owner

1. Approve the sequence as one plan, with each step still requested separately at its time.
2. Name the scratch shard host (D1 and A9 scratch run).
3. Approve the A4 RAM and CPU ceilings (185 GB sum of caps on a 128 GB node, measured use 29 GB; the caps are ceilings).
4. Approve the ClickHouse data path and the 1 GiB gateway queue (A3).
5. Choose the alert channel for A12.
6. Approve the B1 recreate and the token: owner-generated, at least 32 random bytes. Note that no global `servers` timeouts are added (MCP SSE streams); the B0 result is the basis.
7. Write the Mind-host token rotation procedure before A13.
8. Confirm the held PR list and its migration for C1 (T-05 PR #554, T-06, T-07, T-08), and the batch window.
9. Approve the D2 Paper window (jar sha256, window, rollback), the Paper memory change from 14 GiB to 15 GiB, and that JEP 509 and JEP 520 stay off.
10. Decide the gateway pid count (128 or 256, F11).
11. Decide the keeper rule once SigNoz single-node support is checked (0352 risk 4).

## 4. UNVERIFIED list

- Per-site `transport http` values `dial_timeout 5s` and `response_header_timeout 60s` (B1, PROPOSED).
- The module list of the local Caddy build beyond `caddy-dns/azure` (B0 did not inspect it).
- Single-node ClickHouse without keeper (A4).
- Image uids and directory ownership (A3).
- Exporter pid counts and the NATS exporter flags (A10).
- Firing test for the alert rules (A12).
- Migration rollback for T-08 and whether the held PRs ship with the telemetry endpoint unset (C1).
- Scratch shard name and host (D1).
- The `shards/colo.yaml` memory limit (D2).
