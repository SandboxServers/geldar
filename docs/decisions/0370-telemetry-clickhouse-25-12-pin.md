# 0370. ClickHouse 25.12.5.44 pin, and Keeper required, for the Geldar stack

- Status: Accepted (owner ruling relayed by the orchestrator, geldar-93, 2026-11-16)
- Date: 2026-11-16
- Spec: section 7 (monitoring). Amends 0352 for two points only: the ClickHouse version and the Keeper rule. Builds on 0352 option B (Geldar-owned ClickHouse server and SigNoz stack).

## Context

0352 names ClickHouse 26.3 for the Geldar server and makes the Keeper container conditional ("prefer no keeper if the migrator's schema runs on one node"). Both points were marked unverified in the T-02 design (`docs/analysis/telemetry/collector-design.md`, section 3 and section 4, Keeper rule).

Research on 2026-11-16 (`docs/analysis/telemetry/t20-stack-files.md`, and the stack facts it cites):

- SigNoz v0.148.1 is the release 0352 chose. Its CI (`.github/workflows/integrationci.yaml`) tests ClickHouse 25.12.5 with schema migrator v0.144.6. Its e2e CI pulls `clickhouse-server` and `clickhouse-keeper` 25.12.5. No SigNoz release tested 26.3 that we found.
- The SigNoz schema migrator runs `CREATE DATABASE ... ON CLUSTER cluster` unconditionally. ClickHouse needs a Keeper (ZooKeeper protocol) for the distributed DDL queue. A single node with no Keeper is not a supported path, so the Keeper rule in 0352 is decided, not conditional.

## Decision

1. The Geldar ClickHouse server and the Geldar ClickHouse Keeper are pinned to `25.12.5.44`, the version SigNoz v0.148.1 tests in its CI. Not 26.3. Moving to 26.3 waits until SigNoz tests it.
2. `geldar-ch-keeper` is required. It runs at the 0352 caps: 0.5 CPU, 1g memory (memswap equal), 256 pids.
3. The SigNoz pins are `signoz/signoz` v0.148.1, and `signoz/signoz-otel-collector` and `signoz/signoz-schema-migrator` v0.144.6. v0.144.6 is the version the v0.148.1 `go.mod` pins for the collector. The exact image digests are in `deploy/telemetry/README.md`.
4. The one-shot migrator and the collector run as uid 10001 (image `User`). The ClickHouse server and Keeper start as root and drop to uid 101 (gid 101). That drop is inferred from upstream and is checked on the node before any `chown` (see the README).

## Consequences

- 0352's other decisions stand: option B, a Geldar-owned server and stack, Geldar's network only, its own retention and budget. The 100 GB budget and the 70 GB alarm are unchanged.
- The ClickHouse upgrade path is 25.12 to 26.3 once SigNoz tests 26.3. That is a new decision record, not a silent bump.
- The histogram quantile function and migrator/ClickHouse compatibility are unverified until the scratch run (the README lists them).

## Amendment scope

This record amends 0352 only for the ClickHouse version (26.3 becomes 25.12.5.44) and the Keeper rule (conditional becomes required). The Mind-host ingest decision, the SigNoz UI access path (SSH tunnel only), the retention and the budget in 0352 are not changed.
