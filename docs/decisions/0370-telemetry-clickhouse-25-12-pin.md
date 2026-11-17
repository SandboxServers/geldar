# 0370. ClickHouse 25.12.5 (build 44) pin, and Keeper required, for the Geldar stack

- Status: Accepted (owner ruling relayed by the orchestrator, geldar-93, 2026-11-16)
- Date: 2026-11-16
- Spec: section 7 (monitoring). Amends 0352 for two points only: the ClickHouse version and the Keeper rule. Builds on 0352 option B (Geldar-owned ClickHouse server and SigNoz stack).

## Context

0352 names ClickHouse 26.3 for the Geldar server and makes the Keeper container conditional ("prefer no keeper if the migrator's schema runs on one node"). Both points were marked unverified in the T-02 design (`docs/analysis/telemetry/collector-design.md`, section 3 and section 4, Keeper rule).

Research on 2026-11-16 (`docs/analysis/telemetry/t20-stack-files.md`, and the stack facts it cites):

- SigNoz v0.148.1 is the release 0352 chose. Its CI (`.github/workflows/integrationci.yaml`) tests ClickHouse 25.12.5 with schema migrator v0.144.6. Its e2e CI pulls `clickhouse-server` and `clickhouse-keeper` 25.12.5. No SigNoz release tested 26.3 that we found.
- The SigNoz schema migrator runs `CREATE DATABASE ... ON CLUSTER cluster` unconditionally. ClickHouse needs a Keeper (ZooKeeper protocol) for the distributed DDL queue. A single node with no Keeper is not a supported path, so the Keeper rule in 0352 is decided, not conditional.
- Version note: the ON CLUSTER finding was read at collector/migrator v0.144.15 (`manager.go`, facts file section 2). It is assumed to hold for v0.144.6, the version pinned here. Unverified until the scratch run.

## Decision

1. The Geldar ClickHouse server and the Geldar ClickHouse Keeper are pinned to `25.12.5 (build 44)`, the version SigNoz v0.148.1 tests in its CI. Not 26.3. Moving to 26.3 waits until SigNoz tests it. The exact registry tag is listed with its digests in deploy/telemetry/README.md.
2. `geldar-ch-keeper` is required. It runs at the 0352 caps: 0.5 CPU, 1g memory (memswap equal), 256 pids.
3. The SigNoz pins are `signoz/signoz` v0.148.1 and `signoz/signoz-otel-collector` v0.144.6. The one-shot migrator runs the `migrate` subcommands of the collector image, so `signoz/signoz-schema-migrator` is not pinned or run. v0.144.6 is the version the v0.148.1 `go.mod` pins for the collector. The exact image digests are in `deploy/telemetry/README.md`.
4. The one-shot migrator and the collector run as uid 10001 (image `User`). The ClickHouse server starts as root and its entrypoint drops to uid 101 (gid 101). The Keeper runs as uid 101 (gid 101) directly: compose sets `user: "101:101"` and overrides the entrypoint, so there is no drop. Both uid 101 facts are inferred from upstream and are checked on the node before any `chown` (see the README).

## Consequences

- 0352's other decisions stand: option B, a Geldar-owned server and stack, Geldar's network only, its own retention and budget. The 100 GB budget and the 70 GB alarm are unchanged.
- The ClickHouse upgrade path is 25.12 to 26.3 once SigNoz tests 26.3. That is a new decision record, not a silent bump.
- The histogram quantile function and migrator/ClickHouse compatibility are unverified until the scratch run (the README lists them).
- Container names map to the SigNoz image roles: `geldar-ch` = clickhouse-server; `geldar-ch-keeper` = clickhouse-keeper; `geldar-signoz` = `signoz/signoz` (query API and UI in one container, so the collector design's `geldar-signoz-query` and `geldar-signoz-ui` are one container here); `geldar-signoz-migrator` = `signoz/signoz-otel-collector` running its `migrate` subcommands; `geldar-signoz-otelcol` = `signoz/signoz-otel-collector` running as the collector.
- Keeper is on its own internal network, `geldar-telemetry-backend`, shared only with `geldar-ch`. It is not on the shared `geldar-telemetry` network (README, "Networks"). This adds one Docker network at N4.

## Owner decisions on the Geldar stack grants (2026-11-16)

Ruled by the owner on 2026-11-16, relayed by the orchestrator (geldar-93).

- D1 APPROVED: `geldar_writer` keeps `GRANT REMOTE ON *.*`, so `remote()` can reach any host from a container on the shared `geldar-telemetry` network. The migrator and the collector hold the writer password.
- D2 APPROVED: the `default` user keeps its SELECT and INSERT grants on the six `signoz_*` databases and SELECT on `system.*`. After the stack has run a day, check `SELECT initial_user, user, count() FROM system.query_log GROUP BY initial_user, user`, and remove `default`'s grants if `default` never runs a shard query.
- D3 retention user (ruled by geldar-93 on 2026-11-16 as "temporary override accepted"; status of this record stays Accepted): SigNoz sets retention through `POST /api/v1/settings/ttl`, which runs `ALTER TABLE ... ON CLUSTER ... MODIFY TTL` over SigNoz's own ClickHouse connection, and `geldar_reader` (readonly=2) cannot run DDL. The reader is not widened. A dedicated user `geldar_signoz_admin` (explicit grants: ALTER TTL, SELECT on three `signoz_*` databases and `system.*`, CLUSTER; no INSERT, CREATE, DROP, SYSTEM, REMOTE or access management) is used only during a retention window, through the compose override `deploy/telemetry/compose.retention.yml` that swaps SigNoz's DSN to it. The override is removed afterwards and `geldar-signoz` is recreated on the reader. Procedure and unverified points: README, "Retention window (N6c)" and items 36 to 39. Round 9 (local scratch, not the node) outcome: traces and metrics worked with those grants; logs use the v2 API, which needs ALTER MODIFY COLUMN on `signoz_logs` only (added, narrow, accepted as part of the temporary override). The API returns 200 even if the ALTER is refused, so the read-back is mandatory. Teardown order (the plan): remove the override, then remove the user from `users.xml` (merged to `main`, re-staged) and recreate `geldar-ch`, then delete the hash line and secret file. Round 9 phase D proved only that the reverse order fails (hash line removed while `users.xml` still defines the user: `geldar-ch` refuses to start); the forward order has not been run end to end. Network: `compose.yml` puts SigNoz on its own network `geldar-telemetry-query` shared with `geldar-ch` only, and sets pprof and the self-metrics listener off. Evidence: scratch round 10 (local Docker Desktop, not the node) found 8080 and 4320 listening, 6060 and 9090 closed, one more unidentified listener on a high port (39257), the name `geldar-signoz` not resolvable from a container on `geldar-telemetry`, and `geldar-ch:9000` reachable from there. The node check is N6a (README item 15).

## Amendment scope

This record amends 0352 only for the ClickHouse version (26.3 becomes 25.12.5 (build 44)) and the Keeper rule (conditional becomes required). The Mind-host ingest decision, the SigNoz UI access path (SSH tunnel only), the retention and the budget in 0352 are not changed.

- D3 outcome (2026-11-16, N6-C2): the retention window ran on the node (traces and metrics 365 days through the v1 API, logs 365 days through the v2 API, all as `geldar_signoz_admin`) and is closed; SigNoz is back on the reader DSN. The user and its profile were removed from `users.xml` in the T37 PR. The hash line and the secret file are deleted afterwards, in the order given in the README (`Retention window (N6c)`, Window log). A later window re-adds the user through a reviewed PR with a fresh hash.
