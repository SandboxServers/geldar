# T-20: stack files for the Geldar SigNoz stack (files only)

Date: 2026-11-16. Decision: `docs/decisions/0370-telemetry-clickhouse-25-12-pin.md` (amends 0352). Operator README: `deploy/telemetry/README.md` (pins, owner uids, the full unverified list, start order).

At the time these files were written, nothing was started or pulled. The only docker call was `docker compose -f deploy/telemetry/compose.yml config --quiet` (no network, no pull), which exited 0.

## Status after the local scratch run (2026-11-16)

- The stack has now been started locally on a dev machine, in project `scratch-telemetry-local`, not on the node, with lowered memory caps.
- The final passing round is report8, on config e6a08a4b (the scratch reports are in the campaign scratchpad, not in the repo). ClickHouse starts with the restricted `default` user (explicit grants; the stock `access_management` and `named_collection_control` keys removed).
- The migrator exits 0 (4/14/6/7/66/36 tables). SigNoz health returns 200 with one non-fatal ERROR line (active-queries log directory), so it did not start fully clean. The collector had 0 error and warning lines, and one OTLP marker trace reached ClickHouse (1 row locally and through the distributed table). The reader is read-only and reads through the distributed table.
- Writer residual: through `remote()` the writer acts as `default` (SELECT and INSERT on the six `signoz_*` databases, SELECT on `system.*`), which is no more than the writer already has on those databases. `url()`, `s3()` and `file()` are refused through `remote()`; reading `system.query_log` is allowed (accepted residual). The REMOTE grant does not show as a row in `system.grants`.
- Item 33 stays open: one outbound SYN_SENT from `geldar-signoz` to a public address on port 80 right after start with analytics off, gone after 60 s, no reverse DNS, purpose unknown. It blocks unattended running, not the N4 start. The decode recipe is in the README.
- The full table of verified and open items is in `deploy/telemetry/README.md`, section "Scratch run results".
- Node-only items still open: secret owner and mode, uid check, real caps, histogram binary install (checked only on Docker Desktop with a named volume), the 4320 and 6060 listeners (item 15), the system-log TTL check after 10 minutes (item 25), and the item 22 after-a-day check. The N4 procedure is in the README section "N4 checks".

## Files added

| File | What it is | Source |
|---|---|---|
| `deploy/telemetry/compose.yml` | Project `geldar-telemetry`, external network `geldar-telemetry`, five services (keeper, ClickHouse, migrator, SigNoz, collector). Caps per collector-design 4 (ch 3.0/8g/1024, keeper 0.5/1g/256, migrator 0.5/512m/128, signoz 1.0/1g/256, otelcol 0.5/1g/256). One publish: `127.0.0.1:8095:8080`. File secrets, no inline password, no docker.sock. | [AUTH] from the facts file |
| `deploy/telemetry/README.md` | Pins table (index and amd64 digests), owner uids, host paths, the one-container deviation, the unverified list, start order | [AUTH] with [SRC]/[INF] labels |
| `deploy/telemetry/clickhouse/config.d/cluster.xml` | One shard, one replica, Keeper at `geldar-ch-keeper`, macros, `distributed_ddl` | [AUTH] from the Foundry and devenv samples [SRC] |
| `deploy/telemetry/clickhouse/config.d/system-log-ttl.xml` | System log TTL, 30 days (the packet asks for 30 days; Foundry uses 1 day) | keys [SRC] Foundry, value [AUTH] |
| `deploy/telemetry/clickhouse/users.d/users.xml` | `geldar_writer` (2 GB, 4 threads, 60 s, 2 insert threads, `::/0`). `geldar_reader` (`readonly` 2, 1 GB, 4 threads, 30 s, 100000 rows with `break`, `GRANT SELECT` on `signoz_traces`, `signoz_logs`, `signoz_metrics`, `signoz_metadata`, `::/0`, `quota default`). `default` (loopback only, kept for ON CLUSTER DDL). Password hashes are read with `from_env` from the node-only env file, not written in the file. | [AUTH]; `from_env` and grants syntax [INF] |
| `deploy/telemetry/clickhouse/histogram_function.xml` | `histogramQuantile` executable UDF, XML form of Foundry `functions.yaml`. The binary is not in the repo. | [AUTH] from [SRC] |
| `deploy/telemetry/clickhouse/keeper/keeper.yaml` | Single-node Keeper config | [SRC] Foundry, hostnames [AUTH] |
| `deploy/telemetry/signoz-otelcol-config.yaml` | Collector config without OpAMP; exporter DSNs from `${env:CLICKHOUSE_DSN_BASE}` | [SRC] devenv v0.148.1, [AUTH] changes |

The histogram binary is vendored by the operator, not fetched by compose. There is no init service, so no network download at start.

## Unverified items and what each blocks

The full list with numbers is in the README (section "Unverified, check in the scratch run"). The items that block a start:

- **Keeper user and command (README item 8).** Keeper runs as 101:101 with the entrypoint overridden. Blocks `geldar-ch-keeper` until the `id` check on the node and the chown are done.
- **ClickHouse uid drop (README "Owner uids").** The server image starts as root and its entrypoint drops to 101 [INF]; the Keeper runs as 101:101 directly (compose `user:`, entrypoint overridden) [INF]. Blocks any chown of `/mnt/nvme/geldar-telemetry/clickhouse` or `/keeper`. Stop on any `id` output other than `uid=101(clickhouse) gid=101(clickhouse)`.
- **Histogram binary (item 6).** Blocks SigNoz metrics queries that use `histogramQuantile`.
- **Migrator with ClickHouse 25.12.5 (build 44) (item 7).** Verified in the scratch run (exit 0). On the node, run the migrator once and check its exit code before the collector starts.
- **Collector and migrator shell wrapper (items 13, 14).** The wrapper ran in the scratch run (migrator exit 0, collector started), so both images have `/bin/sh`. The secret mode and uid still need checking on the node. Blocks both until then.
- **Collector config (item 16).** The collector started with this config in the scratch run. Validate it again on the node, before the collector starts there.
- **SQLite env names (item 1).** Blocks `geldar-signoz` start.
- **Collector healthcheck (item 3).** The collector image has no `wget`: observed once (exit 127), not repeated (see README item 3). The healthcheck stays off, so it blocks only that healthcheck.
- **ON CLUSTER with the `default` user (item 9).** Blocks the decision to remove `default`. The current plan keeps `default` on loopback.
- **Reader and retention (item 4).** Blocks retention changes made from the SigNoz UI. Does not block start.
- Items 2, 5, 12, 15 do not block start (JWT names not needed with the opaque provider; async insert is tuning; the SigNoz health check blocks nothing because no service depends on it).
- Items 10 and 11 (ClickHouse and Keeper health checks) block the start of `geldar-ch` and every service behind it: a failing check stops the dependent from starting, and nothing is restarted for it (README, "Healthchecks and restarts").

## Checks to run

1. `docker compose -f deploy/telemetry/compose.yml config --quiet`, exit 0 (done here).
2. Collector config validation on the node (README item 16; the scratch run started the collector with this config).
3. The uid check on the node: `docker run --rm --entrypoint id <server digest> clickhouse` and the same for keeper. Expect 101 and 101.
4. Migrator run once against `geldar-ch`, exit 0, before the collector starts.
5. `docker manifest inspect` for each index digest, compared against the README table, before the first pull.

## Guesses

- Reader threads (4) are not in 0352. The other reader limits follow 0352's read path (readonly 2, 1 GB, 30 s, 100000 rows with break, SELECT grants on the signoz_* databases). The per-hour read quota is not set: 0352 gives no value.
- The 30-day system log TTL: the packet says 30 days; the facts file shows one day.
- `default` user kept on loopback, not removed.
- Cap exceptions for `geldar-ch`: `cap_add` CHOWN, DAC_OVERRIDE, SETUID, SETGID. Other services use `cap_drop: ALL` with no add.
- The migrator runs the collector image's `migrate ready`, `migrate bootstrap`, `migrate sync up`, `migrate async up` sequence. The DSN is exported in the shell from the secret file, and `SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_REPLICATION=true` is set as an env var (the collector default, matching the macros). No `--replication` flag remains.
- `low_cardinal_exception_grouping` is literal `false`, not an env var.
- The wrapper that builds the DSN from the secret file.
