-- G2 (T-10): the read-only monitoring role for the gateway's postgresql receiver. Design: docs/analysis/telemetry/collector-design.md section 12.
-- Run as the migration role, through psql. Re-runnable: the password is reset and the grants are idempotent.
--   GELDAR_SECRETS_DIR=<the node secrets directory> psql -v ON_ERROR_STOP=1 -d geldar -f deploy/telemetry/postgres-monitor.sql
-- The password is NOT in this file and NOT in the psql command line. The \set line below makes psql run cat on the secret file
-- (the same file the gateway reads as /run/secrets/otel-pg.txt), so the password stays inside psql. psql must see GELDAR_SECRETS_DIR.
-- Grants: pg_read_all_stats and CONNECT only. Not pg_monitor (it also adds pg_read_all_settings and pg_stat_scan_tables), not superuser,
-- no CREATE, no write grant, no ownership. The role cannot INSERT.
-- RISK (listed in docs/runbooks/telemetry-monitors.md): pg_read_all_stats lets the role read other sessions' query text in
-- pg_stat_activity, which can contain literal values. That is a content path (decision 0350 allows content in telemetry). UNVERIFIED for this release.

\set otel_pg_password `cat "$GELDAR_SECRETS_DIR/otel-pg.txt"`

-- The role is created only when it is missing (\gexec runs the statement that format() returns, or nothing).
SELECT format('CREATE ROLE geldar_monitor LOGIN') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_monitor') \gexec
-- Re-runs set the password again, so a rotated secret takes effect on the next run.
SELECT format('ALTER ROLE geldar_monitor LOGIN PASSWORD %L', :'otel_pg_password') \gexec
GRANT pg_read_all_stats TO geldar_monitor;
GRANT CONNECT ON DATABASE geldar TO geldar_monitor;
