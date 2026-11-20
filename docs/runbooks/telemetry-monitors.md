# Telemetry monitors: NATS exporter and Postgres role (G2)

Design: [collector-design.md](../analysis/telemetry/collector-design.md) sections 11 (NATS) and 12 (Postgres). This runbook is the
packet's operator guide. Nothing here restarts NATS or Postgres, and nothing here has been run on the node yet.

## Facts checked (2026-11-20)

- **NATS monitor is already on.** Inside the running NATS container it listens on `127.0.0.1:8222` (read on the node, 2026-11-20).
  The exporter needs no NATS change.
- **Same network.** NATS is on the `geldar-colo` network, as the gateway is, so the gateway scrape `nats:7777` resolves.
- **Exporter release.** `natsio/prometheus-nats-exporter` v0.20.3 was released 2026-10-21, more than two weeks before the pin.
  Source: the GitHub releases page of `nats-io/prometheus-nats-exporter` and its README, both read 2026-11-20.
- **Exporter flags.** The README (read 2026-11-20) documents `-varz` (bool), `-jsz` (a string: `all`, `consumer`, `stream`, ...) and
  `-port`. The overlay uses `-varz -jsz all -port 7777 http://127.0.0.1:8222`.

## What is in the repo

| File | What it does |
|---|---|
| `compose/opt-in/colo-nats-exporter.yml` | Opt-in overlay: `nats-exporter` (natsio/prometheus-nats-exporter 0.20.3, pinned by digest), `network_mode: service:nats`, 0.1 CPU, 64m, 64 pids, no ports. Reads `/varz` and `/jsz` only. |
| `deploy/telemetry/gateway.yaml` | Gateway scrape job `nats` (`nats:7777`, 30s) and a `postgresql` receiver on `postgres:5432` as `geldar_monitor`, password from `${file:/run/secrets/otel-pg.txt}`. |
| `deploy/telemetry/compose.gateway.yml` | Top-level secret `otel-pg` from `${GELDAR_SECRETS_DIR:-../../compose/secrets}/otel-pg.txt`, mounted read-only at `/run/secrets/otel-pg.txt` in `geldar-gateway`. |
| `deploy/telemetry/postgres-monitor.sql` | Creates the `geldar_monitor` role: LOGIN, `pg_read_all_stats`, CONNECT on `geldar`. Password is a psql variable. |

## Run order (node requests, each one needs its own approval)

1. **Exporter.** `docker compose -f compose/colo.yml -f compose/opt-in/colo-nats-exporter.yml up -d nats-exporter`.
2. **Role.** Write the password to `compose/secrets/otel-pg.txt` (gitignored, never committed), then run
   `psql -v ON_ERROR_STOP=1 -v otel_pg_password="<secret>" -d geldar -f deploy/telemetry/postgres-monitor.sql` as the migration role.
3. **Gateway restage.** `docker compose -f deploy/telemetry/compose.yml -f deploy/telemetry/compose.gateway.yml up -d geldar-gateway`.
   The `otel-pg` secret must exist at the path above. Without it the container does not start, and the collector cannot expand
   `${file:...}` for the `postgresql` receiver.

## Checks

- Series `nats` present in SigNoz; no `subsz` or connection or route series.
- Series `postgresql` present. As the monitoring role, `INSERT` into any table must fail with permission denied.

## Risks

- `pg_read_all_stats` lets the monitoring role read other sessions' query text in `pg_stat_activity`. Literal values in those
  queries reach the telemetry store. Decision 0350 allows content in telemetry, so this is recorded, not blocked. Its effect on
  this release is UNVERIFIED.
- `pg_stat_statements` is not part of G2: it needs a Postgres restart, which is its own node request.

## Rollback

- Exporter: `docker compose -f compose/colo.yml -f compose/opt-in/colo-nats-exporter.yml rm -sf nats-exporter`. NATS is untouched.
- Role: `REVOKE pg_read_all_stats FROM geldar_monitor; REVOKE CONNECT ON DATABASE geldar FROM geldar_monitor; DROP ROLE geldar_monitor;`
  (the role owns nothing).
- Gateway: remove the `nats` scrape job and the `postgresql` receiver from `deploy/telemetry/gateway.yaml`, remove the `otel-pg`
  secret from `compose.gateway.yml`, and restage.
