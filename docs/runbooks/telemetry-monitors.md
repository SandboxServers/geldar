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
| `deploy/telemetry/postgres-monitor.sql` | Creates or re-keys the `geldar_monitor` role: LOGIN, `pg_read_all_stats`, CONNECT on `geldar`. psql reads the password from `$GELDAR_SECRETS_DIR/otel-pg.txt`. |

## The secret file

- **Where.** `$GELDAR_SECRETS_DIR/otel-pg.txt` on the node. Use the same directory for psql and for the gateway restage. The colo
  stack's default is `/etc/geldar-colo/secrets` (`deploy/common.sh`). The gateway compose falls back to `compose/secrets` only when
  `GELDAR_SECRETS_DIR` is unset, so always set it.
- **Owner and mode.** `10001:10001`, mode `0400`. The gateway runs as uid 10001 (`compose.gateway.yml`), so that user can read the
  file through the secret mount. Root can read it too. Nothing else on the node needs read access.
- **Not in git.** The file is never committed. The repo holds only the variable name and the path.

## Run order (node requests, each one needs its own approval)

1. **Exporter.** Use the overlay set the deploy uses (`deploy/common.sh`, `dc`: colo.yml, nats-auth.yml, compose.secrets.yml, then
   the extra overlay), with `--no-deps`:

   ```
   docker compose -p "${GELDAR_PROJECT:-geldar-colo}" -f compose/colo.yml -f compose/nats-auth.yml -f deploy/compose.secrets.yml -f compose/opt-in/colo-nats-exporter.yml up -d --no-deps nats-exporter
   ```

   `--no-deps` is required. The exporter uses `network_mode: service:nats`, so without `--no-deps` compose also converges `nats`.
   Without the auth and secrets overlays, `nats` would be recreated with open auth and no monitor. Never start the exporter with
   fewer files or without `--no-deps`.

2. **Role.** Write the password to `$GELDAR_SECRETS_DIR/otel-pg.txt` with the owner and mode above, then run as the migration role:

   ```
   GELDAR_SECRETS_DIR=<the node secrets directory> psql -v ON_ERROR_STOP=1 -d geldar -f deploy/telemetry/postgres-monitor.sql
   ```

   The script reads the file with a psql `\set` backtick, so the password is never in the psql command line. The file is `0400`
   owned by 10001, so the operator runs psql as root (or through sudo). The script is re-runnable: it creates the role only if it is
   missing, sets the password on every run and re-grants the same two privileges.

3. **Validate, then gateway restage.** Validate the staged config on the node image before the restage. The `${file:...}` in the
   `postgresql` receiver is read when the config loads, so the secret is mounted here too. The command prints nothing and exits 0 on
   success (the form in `deploy/telemetry/README.md`, N10, plus the secret mount):

   ```
   docker run --rm --network none -e GELDAR_SIGNOZ_OTLP_ENDPOINT=geldar-signoz-otelcol:4317 --entrypoint /otelcol-contrib -v /mnt/nvme/geldar-telemetry/src/deploy/telemetry/gateway.yaml:/etc/otelcol/gateway.yaml:ro -v /mnt/nvme/geldar-telemetry/queue:/var/lib/otelcol/queue -v "$GELDAR_SECRETS_DIR/otel-pg.txt:/run/secrets/otel-pg.txt:ro" otel/opentelemetry-collector-contrib@sha256:340c9ca6a36617084c6661bdc4f0fe92b7cda5a805d61673ec8db375fddc522b validate --config=/etc/otelcol/gateway.yaml
   ```

   Then restage the gateway only, with the same secrets directory:

   ```
   cd /mnt/nvme/geldar-telemetry/src && GELDAR_SECRETS_DIR=<the node secrets directory> docker compose -f deploy/telemetry/compose.yml -f deploy/telemetry/compose.gateway.yml up -d geldar-gateway
   ```

   The `otel-pg` secret must exist at the path above. Without it the container does not start, and the collector cannot expand
   `${file:...}` for the `postgresql` receiver.

## Restarts

- **After any `nats` recreate, restart the exporter.** The exporter shares NATS' network namespace, so when NATS is recreated the
  exporter is left on the old namespace. Restart it with the same overlay set as step 1:

  ```
  docker compose -p "${GELDAR_PROJECT:-geldar-colo}" -f compose/colo.yml -f compose/nats-auth.yml -f deploy/compose.secrets.yml -f compose/opt-in/colo-nats-exporter.yml restart nats-exporter
  ```

## Checks

- Series `nats` present in SigNoz; no `subsz` or connection or route series.
- Series `postgresql` present. As the monitoring role, `INSERT` into any table must fail with permission denied.

## Risks

- `pg_read_all_stats` lets the monitoring role read other sessions' query text in `pg_stat_activity`. Literal values in those
  queries reach the telemetry store. Decision 0350 allows content in telemetry, so this is recorded, not blocked. Its effect on
  this release is UNVERIFIED.
- `/jsz` series are reachable on `nats:7777` from the colo network. The exporter publishes no port, but any container on
  `geldar-colo` can read `/varz` and `/jsz` from it (stream and consumer names and counts). This is accepted for now.
- The exporter runs without `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]` or `read_only: true`. These are not in the
  overlay: nothing has shown that the exporter image needs no writes, so adding them is a later change, after that is checked.
- `pg_stat_statements` is not part of G2: it needs a Postgres restart, which is its own node request.

## Rollback

- Exporter: `docker compose -p "${GELDAR_PROJECT:-geldar-colo}" -f compose/colo.yml -f compose/nats-auth.yml -f deploy/compose.secrets.yml -f compose/opt-in/colo-nats-exporter.yml rm -sf nats-exporter`.
  NATS is untouched.
- Role: `REVOKE pg_read_all_stats FROM geldar_monitor; REVOKE CONNECT ON DATABASE geldar FROM geldar_monitor; DROP ROLE geldar_monitor;`
  (the role owns nothing).
- Gateway: remove the `nats` scrape job and the `postgresql` receiver from `deploy/telemetry/gateway.yaml`, remove the `otel-pg`
  secret from `compose.gateway.yml`, and restage.
