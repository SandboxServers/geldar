# 0352. Telemetry on a dedicated ClickHouse database for Geldar

- Status: Accepted, chosen option B (Geldar-owned ClickHouse server and SigNoz stack). The owner's ruling was relayed by the orchestrator on 2026-11-16. An earlier relay chose option A; the owner changed the answer before this record was committed, so option A is not the decision.
- Date: 2026-11-15
- Spec: section 7 (monitoring). Amends 0350 items 4, 5 and 6 (shared SigNoz, budget and retention, readers). Builds on 0130 (SigNoz on the node). Does not edit 0350 (it stays Accepted), `docs/spec.md` (0073), or the other tenant's configuration.

## Context

0350 item 5 says "the Geldar database holds only Geldar's data" and sets a 100 GB budget with one-year retention. The T-02 design (`docs/analysis/telemetry/collector-design.md` on branch `phase1/telemetry-t02-collector-design`, findings F7 to F9 in sections 13, 18 and 19) found that no such database exists:

- **F7.** SigNoz writes traces, logs and metrics into one ClickHouse server (container `signoz-clickhouse`, ClickHouse 26.3) that also holds another tenant's data. Geldar's share is identifiable only by resource attributes, not by database. A 70 GB alarm on a shared server would measure the wrong thing.
- **F8.** SigNoz retention is one setting per signal for the whole workspace. A one-year setting changes the other tenant's retention too.
- **F9.** Any Geldar writer on the SigNoz side has to join the other tenant's Docker network.

Survey of the node on 2026-11-15 (read-only; active parts from `system.parts`): `signoz_traces` 19.5 GB, `signoz_logs` 1.3 GB, `signoz_metrics` 0.15 GB, `signoz_metadata` 0.24 GB, `system` 38.6 GB. The current trace TTL is 15 days (`ttl_only_drop_parts=1`). Logs use a per-row `_retention_days`, default 15. The `system` database is larger than all SigNoz data and is not covered by any TTL we know of. Those values are the survey's and are not re-verified here.

Constraints that stay: no change to the other tenant's retention or budget (0350 item 4; this record proposes none); the 100 GB budget with alarms at 70 GB and at 60% of `/mnt/nvme` (0350 item 5); readers are operators only (0350 item 6); a telemetry erasure gap stays open (0350 item 3).

## Options

| | (A) Separate database, stock schema, on the shared server | (B) Separate ClickHouse server and a second SigNoz stack, Geldar-owned | (C) Shared tenant tables with a TTL per row |
|---|---|---|---|
| Isolation of data | Logical only: same server, same disk, same merges and same memory | Full: own server, own disk path, own keeper and query service | Logical only, and the budget is still workspace-wide |
| Retention | One TTL per table, set by us with `ALTER ... MODIFY TTL`; the migrator may overwrite it on upgrade (unverified) | The Geldar stack's own SigNoz retention setting, plus the schema TTL; the other tenant is not touched | Per-row TTL on shared tables |
| SigNoz UI | Cannot see the database (the UI reads the fixed `signoz_*` names) | Works: the Geldar stack is a normal SigNoz | Works, but shares the other tenant's tables |
| Budget measure | `system.parts` grouped by database: exact for Geldar's database | `system.parts` on its own server: exact | Not exact (F7) |
| Joins the other tenant's network (F9) | Yes, unless the Geldar collector reaches ClickHouse some other way (unverified) | No: Geldar's own network only | Yes |
| Cost (CPU, RAM, disk) | Near zero extra RAM and CPU (shared server); data disk about 37 to 55 GB a year (estimate); DDL and migrator work on our side | About 11.5 GiB RAM and 5.5 CPU at the caps of the long-running containers (ceilings; measured fit on 2026-11-15 below); data disk the same estimate | Same as A |
| Read path for Claude (0350 item 6) | ClickHouse SQL only; the SigNoz MCP route in T-18 would have to change | SigNoz MCP and UI, as 0350 item 6 says | SigNoz MCP and UI |
| Verdict | Fallback if the node cannot carry B | **Accepted (owner ruling)** | Rejected: workspace-wide |

## Decision (accepted)

Geldar telemetry goes to a Geldar-owned ClickHouse server and a Geldar-owned SigNoz stack on a Geldar-owned Docker network, with its own retention and its own budget measure. The Geldar collector gateway (T-02) writes only to that stack. The other tenant's stack, server, network and configuration are not changed. Option A is the fallback if the node cannot carry option B (the fit check below). Option C is rejected.

Why B:

1. It is the only option that removes F7, F8 and F9 together. The budget becomes an exact measure of one server, and the one-year retention applies to one workspace that Geldar owns.
2. It keeps the SigNoz UI and the SigNoz MCP path that 0350 item 6 and T-18 rely on, so Claude's diagnosis path does not change.
3. No Geldar container joins the other tenant's network, and no port of the other tenant is opened or changed.

The cost of B is the extra RAM and the extra containers. Both are unmeasured on this node.

## Fit check: read-only node measurement (2026-11-15)

Read-only node measurement, 2026-11-15 23:49 UTC:

- CPU: 16 CPUs; load average 1.16 / 1.12 / 0.94; about 95% idle.
- RAM: 128 GB total; 29 GB used; 98 GB available (99 GB page cache); swap under 1 GB.
- Disk: `/mnt/nvme` is 1.8 TB with 1.2 TB free (35% used); root has 20 GB free.
- Existing residents: Paper 12.7 of 14 GiB; the other tenant's `signoz-clickhouse` 4.7 GiB; its `zookeeper` 1.0 GiB; CI runners about 1 GiB each.
- Sum of set container memory limits on the node: 185 GB. That is overcommitted on paper; real use is 29 GB.

Verdict: option B fits. The Geldar stack at caps is 11.5 GiB, about 9% of 128 GB total RAM or about 12% of the 98 GB available, and about 5% of CPU at typical load (roughly 0.8 of 16 CPUs). The Geldar stack at caps plus the UI and the one-shot migrator is 12.25 GiB and 6.25 CPU.

Caution: the Paper tick must be watched during ClickHouse merges, because merges use CPU and disk on the same host as Paper. The sizing above is a proposal until a scratch run measures peak use under merges and load.

## Containers and caps (proposed; all on the Geldar network)

Every container gets the same log limits as decision 0082 (the `json-file` `max-size` and `max-file` values in the Geldar compose files; not re-read here). Every container has `restart: unless-stopped`, except the one-shot migrator. `memswap` equals `mem_limit`, so no swap is used.

| Container | Role | cpus | mem_limit | memswap | pids_limit | Disk path (host) |
|---|---|---|---|---|---|---|
| `geldar-ch` | ClickHouse 26.3, Geldar server | 3.0 | 8g | 8g | 1024 | `/mnt/nvme/geldar-telemetry/clickhouse` (data, logs, config) |
| `geldar-ch-keeper` | ClickHouse Keeper, only if the migrator needs it (see below) | 0.5 | 1g | 1g | 256 | `/mnt/nvme/geldar-telemetry/keeper` |
| `geldar-signoz-migrator` | SigNoz schema migrator, one-shot | 0.5 | 512m | 512m | 128 | none |
| `geldar-signoz-query` | SigNoz query service (MCP and UI back end) | 1.0 | 1g | 1g | 256 | `/mnt/nvme/geldar-telemetry/query` (metadata) |
| `geldar-signoz-otelcol` | SigNoz OTel collector, schema-aware writer to `geldar-ch` | 0.5 | 1g | 1g | 256 | none (its queue is in memory, bounded; see the exporter rules) |
| `geldar-signoz-ui` | SigNoz frontend | 0.25 | 256m | 256m | 64 | none |
| `geldar-gateway` | Geldar collector gateway (T-02) | 0.5 | 512m | 512m | 256 | `/mnt/nvme/geldar-telemetry/gateway-queue` (fixed-size queue volume, F2) |

Totals at the caps. The long-running containers (ClickHouse 3 CPUs and 8 GiB, keeper 0.5 CPU and 1 GiB if used, query service 1 CPU and 1 GiB, SigNoz-side collector 0.5 CPU and 1 GiB, Geldar gateway 0.5 CPU and 512 MiB) total 5.5 CPUs peak and 11.5 GiB. Adding the UI (0.25 CPU, 256 MiB) and the one-shot migrator (0.5 CPU, 512 MiB) gives 6.25 CPUs and 12.25 GiB at the most. These are ceilings, not usage; the fit check above compares them with the node.

Keeper: SigNoz's standard setup uses ZooKeeper for replicated tables, and this node runs `signoz-zookeeper-1` for the other tenant. Whether the Geldar stack can run a single-node ClickHouse without keeper (non-replicated tables) on SigNoz 0.135 or later, or needs embedded ClickHouse Keeper, is **unverified**. The plan is: prefer no keeper if the migrator's schema runs on a single node; otherwise use embedded ClickHouse Keeper inside `geldar-ch` if it is supported; use the separate `geldar-ch-keeper` container only if neither works. Verify from the SigNoz and ClickHouse docs at the pinned versions before N3.

## Budget and alarms (B)

The Geldar ClickHouse holds only Geldar's data, so the budget measure is exact. Measure on `geldar-ch`, once a day, by the operator's cron or the query service:

```sql
SELECT database, sum(bytes_on_disk) AS bytes
FROM system.parts
WHERE active AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
GROUP BY database
ORDER BY bytes DESC;
```

- **Geldar 70 GB alarm (70% of the 100 GB budget)**: the sum of `bytes` is at or above 70 x 10^9. The channel is operators only (0350 item 8).
- **Budget stop**: if the sum passes 100 x 10^9, or the estimate passes 100 GB, the operator stops and tells the owner. The budget is not raised by an agent (0350 item 5).
- **Node alarm**: `/mnt/nvme` above 60% used, node-wide, as 0350 item 5 says. It covers the other tenant's data too; it is the only alarm that does.
- **System-log TTL (our server)**: the `system` log tables of `geldar-ch` (`query_log`, `part_log` and the rest) get a TTL in our own server config, so they do not grow without limit. Proposed 30 days. Exact config keys are **unverified** on ClickHouse 26.3.

## Retention

- **Hard TTL: 1 year (365 days) on every telemetry table in the Geldar ClickHouse.** Set in two places: the Geldar stack's SigNoz retention setting for traces, logs and metrics, and a ClickHouse TTL on each table, checked after the first merge. The SigNoz retention setting is per workspace, which is fine here because the workspace is Geldar's own.
- The table names, the TTL column and the migrator's behaviour on upgrade are unverified. The migrator is run by the SigNoz stack, so the TTL is checked again after each upgrade.
- Per-life erasure is still a KNOWN GAP (0350 item 3). Under B a per-life erase is a ClickHouse mutation on one server. It is still heavy and still operator-run.

## Write path and limits (B)

- **Writer user**: `geldar_writer` on `geldar-ch`, with a settings profile: `max_memory_usage` 2 GB per query, `max_threads` 4, `max_execution_time` 60 s, `max_insert_threads` 2.
- **Async insert**: off, or bounded. If on: `async_insert` 1 with `wait_for_async_insert` 1, `async_insert_max_data_size` 10 MB and `async_insert_busy_timeout_ms` 1000 (proposed; unverified against 26.3).
- **Quota**: a per-hour quota on rows inserted and on execution time for `geldar_writer` (values set after the fit check).
- **Batch limits**: the batch processor in the Geldar gateway and in `geldar-signoz-otelcol` sets a maximum batch size and a timeout (proposed values set after the fit check).
- **Exporter queue**: bounded on the gateway, by the fixed-size volume and the item or byte cap in `collector-options.md` F2. A full queue drops, as 0350 item 7 requires.
- **Other tenant**: unaffected. Geldar's limits apply to Geldar's own server, and no profile or quota is created on the other tenant's server.

## Read path (B)

- **Operator UI**: the Geldar SigNoz frontend behind an authenticated Caddy host. This publishes a web route, so it **needs owner approval** and an amendment to 0350 item 6 ("no public route serves SigNoz"). The route is authenticated (the owner chooses the scheme). The alternative with no public route is an SSH tunnel from the operator workstation to a loopback port on the node (`127.0.0.1`) that forwards to `geldar-signoz-ui`.
- **SQL read-only user**: `geldar_reader` on `geldar-ch`, `GRANT SELECT` on the Geldar databases only, `readonly` 2 in its settings profile, `max_memory_usage` 1 GB, `max_execution_time` 30 s, `max_result_rows` 100000 with `result_overflow_mode` `break`, and a per-hour read quota. Reached from the operator workstation through the existing SSH access to the node: `ssh <node> docker exec -i geldar-ch clickhouse-client --user geldar_reader --query ...`. No ClickHouse port is published to any interface.
- **Claude**: the SigNoz MCP server pinned to the version of the Geldar stack, with a viewer-role key held on the owner's workstation only (0350 item 6). The key is not in the repo, on the Colo or on any Mind host. Optionally, a read-only SQL wrapper on the workstation for the cookbook below.
- **Open question for the owner**: 0350 item 7 says "Agents never see or infer telemetry". A Claude session that queries telemetry through MCP or SQL is a change to what agents may do. This record does not resolve that; it is for the owner's ruling before the Claude path is built.

### Query cookbook (outline; table and attribute names unverified until the exporter schema is checked)

Attribute keys follow 0350 item 1: `life_id`, `player_id`, `thought_id`, `intent_id`, `action_id`, `run_id`, `turn_id`, `trace_id` as a column. Use query parameters, not string pasting:

- **By life**: `WHERE SpanAttributes['life_id'] = {life_id:String}` on the traces table, and the same on `LogAttributes` for logs.
- **By thought or action**: the same with `thought_id` or `action_id`.
- **By run**: `run_id`.
- **By trace**: `WHERE TraceId = {trace_id:String}` ordered by `Timestamp`.
- **Latest errors**: logs where `SeverityText` is `ERROR` or `FATAL`, ordered by `Timestamp` descending, `LIMIT 50`.
- **Slow spans**: traces ordered by `Duration` descending, filtered to a service name; `Duration` units are unverified.

## Amendments to 0350

- **Item 4 (shared tenant).** Unchanged. Geldar data does not live in that tenant's stack under B, and nothing on that tenant changes. Mind hosts still reach Geldar through the Caddy route (T-15), which still needs owner approval (0350 item 4).
- **Item 5 (budget and retention).** The 100 GB budget, the 70 GB and 60% alarms, and the one-year retention stay. The budget is measured per server under B, and the retention is set on the Geldar stack. "The Geldar database" means the Geldar server's Geldar databases.
- **Item 6 (readers).** The SigNoz MCP server and the viewer-role key point at the Geldar stack. The Geldar UI is a new authenticated route and needs owner approval, which amends "no public route serves SigNoz" for this stack only (see Read path).

## Costs (estimates, unverified unless stated)

| Item | Option B |
|---|---|
| RAM | 11.5 GiB long-running at caps (12.25 GiB with UI and migrator); node measured 29 GB used of 128 GB (fit check) |
| CPU | 5.5 CPUs long-running at caps (6.25 with UI and migrator); about 5% typical use of 16 CPUs (fit check) |
| Disk | Data about 37 to 55 GB a year (0350 survey estimate), plus keeper and metadata (small) |
| Operator time | A new node stack and a new SigNoz version pin; one owner approval for the stack, one for the UI route |

Owner-side budget: the node's `/mnt/nvme` data disk had 1.2 TB free at the survey. That was a sample, not a budget.

## Risks

1. Extra containers on a shared host. Mitigation: the caps above, `restart: unless-stopped`, and the 0082 log limits.
2. A second SigNoz version to keep in step with the Geldar gateway and T-17 dashboards. Mitigation: pin the new stack to a release at or above 0.135 if V2 dashboards are wanted (unverified that 0.135 is enough).
3. Two ClickHouse or keeper sets on one host could collide on ports. Mitigation: no port published except loopback, checked free by `ss` in N1.
4. The estimate could be wrong; the 70 GB alarm is the early warning.
5. The migrator could overwrite a manual TTL. Mitigation: check TTL after each upgrade.
6. The UI route widens the public surface. Mitigation: owner approval, authentication on the route, and the loopback alternative.

## Rollback

- Unset the gateway's endpoint variable in the overlay so the SDK goes off (T-03), stop and remove the Geldar SigNoz stack and its keeper if any, and keep the Geldar data volume until the owner decides. The other tenant is not touched.

## Who decides

- The owner decides: the node RAM and the extra containers, the 100 GB budget and the one-year retention (0350 owner ruling), the UI route, and every node step that changes the stack (T-02 section 14, N3 and N7).
- The orchestrator decides which T-cards change and when (below).
- Nothing in this record changes the other tenant's retention, budget, configuration or network.

## T-cards that change

- **T-02 (collector)**: the gateway's exporter endpoint points at the Geldar SigNoz collector on the Geldar network. F9 goes away. Section 4 network row and the N3 step change with it. The loopback port rule for Caddy is unchanged.
- **T-17 (dashboards and alerts)**: the rules and dashboards target the Geldar stack. The "shared SigNoz at 0.135 or later" condition becomes a condition on the Geldar stack's own version.
- **T-18 (Claude access)**: the SigNoz MCP server is pinned to the Geldar stack's version, with a viewer-role key for it.
- **New card (number for the orchestrator to assign)**: the Geldar SigNoz stack and its ClickHouse server, with its caps, network, disk paths and node steps. Owner approval.
- **Unchanged**: T-03, T-06, T-07, T-08 and T-20 (they send to the gateway's endpoint variable and do not care which stack is behind it). T-15 (Caddy route) is unchanged apart from the UI route, which needs its own owner approval.

## Unverified

- Peak RAM and CPU of the Geldar stack under ClickHouse merges and under Paper load. The node's free RAM and CPU are measured (fit check, 2026-11-15); the caps are proposals until a scratch run measures them.
- Whether SigNoz 0.135 or later runs without ZooKeeper or keeper on one node, and the keeper choice above.
- Current SigNoz retention and TTL values on the other tenant's stack (the metadata directory is root-only, survey section 1.2). Not changed by this record.
- Table names, TTL column and migrator behaviour on upgrade for the SigNoz schema in ClickHouse 26.3.
- The `system` log-table TTL keys in the ClickHouse server config, and the async insert keys on 26.3.
- The `json-file` log values of decision 0082, copied at implementation.
- The 70 GB and 100 GB figures are the 0350 owner ruling; the 37 to 55 GB a year is the survey estimate.
