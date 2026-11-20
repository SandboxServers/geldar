# Telemetry monitors: NATS exporter and Postgres role (G2)

Design: [collector-design.md](../analysis/telemetry/collector-design.md) sections 11 (NATS) and 12 (Postgres). This runbook is the
packet's operator guide. Nothing here restarts NATS or Postgres, and nothing here has been run on the node yet.

## What is in the repo

| File | What it does |
|---|---|
| `compose/opt-in/colo-nats-exporter.yml` | Opt-in overlay: `nats-exporter` (natsio/prometheus-nats-exporter 0.20.3, pinned by digest), `network_mode: service:nats`, 0.1 CPU, 64m, 64 pids, no ports. Reads `/varz` and `/jsz` only. |
| `deploy/telemetry/gateway.yaml` | Gateway scrape job `nats` (`nats:7777`, 30s) and a `postgresql` receiver on `postgres:5432` as `geldar_monitor`, password from `${file:/run/secrets/otel-pg.txt}`. |
| `deploy/telemetry/postgres-monitor.sql` | Creates the `geldar_monitor` role: LOGIN, `pg_read_all_stats`, CONNECT on `geldar`. Password is a psql variable. |

## Run order (node requests, each one needs its own approval)

1. **NATS monitor on loopback.** colo.yml has no monitor port. Add `http: 127.0.0.1:8222` to the NATS config and restart NATS
   in its own request. The exporter cannot scrape until this is done.
2. **Exporter.** `docker compose -f compose/colo.yml -f compose/opt-in/colo-nats-exporter.yml up -d nats-exporter`.
   Check the flags first with `docker run --rm natsio/prometheus-nats-exporter@sha256:4b8ddc1c86fec360b5cd3d5e1fbc6fb52bdafd5805bba3901cc52926538af255 --help`.
3. **Role.** Write the password to `compose/secrets/otel-pg.txt` (gitignored, never committed), then run
   `psql -v ON_ERROR_STOP=1 -v otel_pg_password="<secret>" -d geldar -f deploy/telemetry/postgres-monitor.sql` as the migration role.
4. **Gateway restage.** The gateway container must mount the same secret at `/run/secrets/otel-pg.txt` before the `postgresql`
   receiver starts. Without that mount the collector cannot expand `${file:...}` and will not start.

## Checks

- Series `nats` present in SigNoz; no `subsz` or connection or route series.
- Series `postgresql` present. As the monitoring role, `INSERT` into any table must fail with permission denied.

## Risks

- `pg_read_all_stats` lets the monitoring role read other sessions' query text in `pg_stat_activity`. Literal values in those
  queries reach the telemetry store. Decision 0350 allows content in telemetry, so this is recorded, not blocked. Its effect on
  this release is UNVERIFIED.
- The exporter flag names for 0.20.3 are UNVERIFIED until `--help` is checked in the pinned image.
- `pg_stat_statements` is not part of G2: it needs a Postgres restart, which is its own node request.

## Rollback

- Exporter: `docker compose -f compose/colo.yml -f compose/opt-in/colo-nats-exporter.yml rm -sf nats-exporter`. NATS is untouched.
- Role: `REVOKE pg_read_all_stats FROM geldar_monitor; REVOKE CONNECT ON DATABASE geldar FROM geldar_monitor; DROP ROLE geldar_monitor;`
  (the role owns nothing).
- Gateway: remove the `nats` scrape job and the `postgresql` receiver from `deploy/telemetry/gateway.yaml` and restage.
