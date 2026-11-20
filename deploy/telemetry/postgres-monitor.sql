-- G2 (T-10): the read-only monitoring role for the gateway's postgresql receiver. Design: docs/analysis/telemetry/collector-design.md section 12.
-- Run ONCE, as the migration role, through psql. The password is NOT in this file: psql takes it from the secret file as a variable.
--   psql -v ON_ERROR_STOP=1 -v otel_pg_password="<contents of the secret file>" -d geldar -f deploy/telemetry/postgres-monitor.sql
-- The secret file is compose/secrets/otel-pg.txt on the node; the gateway reads the same secret at /run/secrets/otel-pg.txt.
-- Grants: pg_read_all_stats and CONNECT only. Not pg_monitor (it also adds pg_read_all_settings and pg_stat_scan_tables), not superuser,
-- no CREATE, no write grant, no ownership. The role cannot INSERT.
-- RISK (listed in docs/runbooks/telemetry-monitors.md): pg_read_all_stats lets the role read other sessions' query text in
-- pg_stat_activity, which can contain literal values. That is a content path (decision 0350 allows content in telemetry). UNVERIFIED for this release.
CREATE ROLE geldar_monitor LOGIN;
ALTER ROLE geldar_monitor PASSWORD :'otel_pg_password';
GRANT pg_read_all_stats TO geldar_monitor;
GRANT CONNECT ON DATABASE geldar TO geldar_monitor;
