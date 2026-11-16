# 0352. Telemetry on a dedicated ClickHouse database for Geldar

- Status: Proposed
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
| Cost (CPU, RAM, disk) | Near zero extra RAM and CPU (shared server); data disk about 37 to 55 GB a year (estimate); DDL and migrator work on our side | About 1 to 2 GB RAM for ClickHouse, keeper, query service and migrator (brief's estimate, unverified); CPU unmeasured; data disk the same estimate; its own system-log TTL needed | Same as A |
| Read path for Claude (0350 item 6) | ClickHouse SQL only; the SigNoz MCP route in T-18 would have to change | SigNoz MCP and UI, as 0350 item 6 says | SigNoz MCP and UI |
| Verdict | Fallback if the node cannot carry B | **Recommended** | Rejected: workspace-wide |

## Decision (proposed)

Geldar telemetry goes to a dedicated ClickHouse database with its own TTL. The recommended form is **option B**: a Geldar-owned ClickHouse server and SigNoz stack on a Geldar-owned Docker network, with its own retention and its own budget measure. The Geldar collector gateway (T-02) writes only to that stack. Option A is the fallback if the owner does not approve the extra containers. Option C is rejected.

Why B:

1. It is the only option that removes F7, F8 and F9 together. The budget becomes an exact measure of one server, and the one-year retention applies to one workspace that Geldar owns.
2. It keeps the SigNoz UI and the SigNoz MCP path that 0350 item 6 and T-18 rely on, so Claude's diagnosis path does not change.
3. Option A does not remove F9 by itself. The Geldar collector would still need a route to the other tenant's ClickHouse: either joining its network, or using a published port that the other tenant publishes on all interfaces without a key. Changing that tenant's ports to loopback is not allowed (0350 item 4).

The cost of B is the extra RAM and the extra containers. Both are unmeasured on this node. Free RAM is read in step N1 (T-02 section 14) before the owner decides.

## Budget and alarms (B; A uses the same query filtered to its database)

Measure, on the Geldar server, once a day:

```sql
SELECT database, sum(bytes_on_disk) AS bytes
FROM system.parts
WHERE active AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
GROUP BY database
ORDER BY bytes DESC;
```

- **Geldar 70 GB alarm**: the sum of `bytes` is at or above 70 x 10^9. The channel is operators only (0350 item 8).
- **Budget stop**: if the sum passes 100 x 10^9, or the estimate passes 100 GB, the operator stops and tells the owner. The budget is not raised by an agent (0350 item 5).
- **Node alarm**: `/mnt/nvme` above 60% used, node-wide, as 0350 item 5 says. It covers the other tenant's data too.
- **System-log TTL**: the new server's `system` database must have a TTL on its log tables (`query_log`, `part_log` and the rest), set in the server config. Exact keys are unverified on ClickHouse 26.3.

## Retention

- One year (365 days) for every Geldar table, by two settings: the Geldar stack's own SigNoz retention for traces, logs and metrics, and a ClickHouse TTL check on each table after the first merge.
- The table names, the TTL column and the migrator's behaviour on upgrade are unverified. The migrator is run by the SigNoz stack, so the TTL must be checked again after each upgrade.
- Hard TTL is a ClickHouse TTL on each table. Per-life erasure is still a KNOWN GAP (0350 item 3). With B, a per-life erase is a ClickHouse mutation on one server. It is still heavy and still operator-run.

## Amendments to 0350

- **Item 4 (shared tenant).** Unchanged for the other tenant. Geldar data no longer lives in that tenant's stack under B. Mind hosts still reach Geldar through the Caddy route (T-15), which still needs owner approval (0350 item 4).
- **Item 5 (budget and retention).** The 100 GB budget, the 70 GB and 60% alarms, and the one-year retention stay. What changes: the budget is measured per server under B, not per shared database, and the retention is set on the Geldar stack, not on the shared workspace. The phrase "the Geldar database" means the Geldar server's Geldar databases.
- **Item 6 (readers).** Unchanged under B: the SigNoz MCP server and the viewer-role key point at the Geldar stack. Under A the readers are ClickHouse SQL only, and T-18 changes.

## Costs (estimates, unverified unless stated)

| Item | Option B | Option A |
|---|---|---|
| RAM | 1 to 2 GB brief estimate. Proposed caps: ClickHouse 2 GiB, keeper 256 MiB, query service 512 MiB, migrator one-shot | Little extra (shared server); the server's memory cap is unchanged |
| CPU | Unmeasured. Proposed caps: ClickHouse 1.0, keeper 0.25, query service 0.5 | Little extra; merges compete with the other tenant |
| Disk | Data about 37 to 55 GB a year (0350 survey estimate), plus keeper and metadata (small) | Data about the same, on the shared disk |
| Operator time | A new node stack and a new SigNoz version pin; one owner approval | DDL, TTL and reader changes; one owner approval for retention |

Owner-side budget: the node's `/mnt/nvme` data disk had 1.2 TB free at the survey. That was a sample, not a budget.

## Risks

1. Extra containers on a shared host. Mitigation: the caps above, `restart: unless-stopped`, and the 0082 log limits. Each container gets a cgroup limit, as the Geldar services do.
2. A second SigNoz version to keep in step with the Geldar gateway and T-17 dashboards. Mitigation: pin the new stack to a release at or above 0.135 if V2 dashboards are wanted (unverified that 0.135 is enough).
3. Option A: the other tenant's ClickHouse still shares the disk and merges, and the F9 route is still needed.
4. Option B: two keepers or ClickHouse sets on one host could collide on ports. Mitigation: loopback-only publish of any port, checked free by `ss` in N1.
5. The estimate could be wrong; the 70 GB alarm is the early warning.
6. The migrator could overwrite a manual TTL. Mitigation: check TTL after each upgrade.

## Rollback

- **B**: unset the gateway's endpoint variable in the overlay so the SDK goes off (T-03), stop and remove the Geldar SigNoz stack and its keeper, and keep the Geldar data volume until the owner decides. The other tenant is not touched.
- **A**: revert the exporter to the previous target; drop the Geldar database only with owner approval (its data is lost).

Neither rollback changes the other tenant's stack.

## Who decides

- The owner decides: option B or A (the node RAM and the extra containers), the 100 GB budget and the one-year retention (0350 owner ruling), and every node step that changes the stack (T-02 section 14, N3 and N7).
- The orchestrator decides which T-cards change and when (below).
- Nothing in this record changes the other tenant's retention or budget. That is an owner or orchestrator ruling and is not proposed here.

## T-cards that change

- **T-02 (collector)**: the gateway's exporter endpoint and network change under B (the Geldar network instead of the SigNoz network, so F9 goes away). Section 4 network row and the N3 step change with it. The loopback port rule for Caddy is unchanged.
- **T-17 (dashboards and alerts)**: the rules and dashboards target the Geldar stack. The "shared SigNoz at 0.135 or later" condition becomes a condition on the Geldar stack's own version.
- **T-18 (Claude access)**: the SigNoz MCP server is pinned to the Geldar stack's version, with a viewer-role key for it. Under A, T-18 is replaced by a ClickHouse read path.
- **New card (number for the orchestrator to assign)**: the Geldar SigNoz stack and its ClickHouse server, with its caps, network and node steps. Owner approval.
- **Unchanged**: T-03, T-06, T-07, T-08 and T-20 (they send to the gateway's endpoint variable and do not care which stack is behind it). T-15 (Caddy route) is unchanged.

## Unverified

- Free RAM and CPU on the node, and the actual cost of the second stack.
- Current SigNoz retention and TTL values on the other tenant's stack (the metadata directory is root-only, survey section 1.2).
- Table names, TTL column and migrator behaviour on upgrade for the SigNoz schema in ClickHouse 26.3.
- The `system` log-table TTL keys in the ClickHouse server config.
- Whether option A's collector can reach the other tenant's ClickHouse without joining its network.
- The 70 GB and 100 GB figures are the 0350 owner ruling; the 37 to 55 GB a year is the survey estimate.
