-- G2 (T-10): the read-only monitoring role for the gateway's postgresql receiver. Design: docs/analysis/telemetry/collector-design.md section 12.
-- Run through the postgres container's psql, on stdin, as the superuser geldar (the migration role). The caller supplies the password as the
-- psql variable otel_pg_password before this file: the pipeline is in docs/analysis/telemetry/node-requests/08-monitors-g2.md section 9.
-- The password is never on a command line, never in this file and never in the server log: log_min_error_statement is panic below.
-- Re-runnable: the password is reset and the grants are idempotent.
-- Grants: pg_read_all_stats and CONNECT only. Not pg_monitor (it also adds pg_read_all_settings and pg_stat_scan_tables), not superuser,
-- no CREATE, no write grant, no ownership. The role cannot INSERT.
-- RISK (listed in docs/runbooks/telemetry-monitors.md): pg_read_all_stats lets the role read other sessions' query text in
-- pg_stat_activity, which can contain literal values. That is a content path (decision 0350 allows content in telemetry). UNVERIFIED for this release.

-- A failing ALTER would otherwise log its statement text, which carries the password. panic is above every error level, so nothing is logged.
SET log_min_error_statement = panic;

-- Without the variable this stops the script before any statement runs. Under ON_ERROR_STOP=1 the DO error stops it; without that flag \quit does.
\if :{?otel_pg_password}
\else
DO $$ BEGIN RAISE EXCEPTION 'psql variable otel_pg_password is not set, pipe the password in as that variable'; END $$;
\quit
\endif

-- The role is created only when it is missing (\gexec runs the statement that format() returns, or nothing).
SELECT format('CREATE ROLE geldar_monitor LOGIN') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_monitor') \gexec
-- Re-runs set the password again, so a rotated secret takes effect on the next run.
SELECT format('ALTER ROLE geldar_monitor LOGIN PASSWORD %L', :'otel_pg_password') \gexec
GRANT pg_read_all_stats TO geldar_monitor;
GRANT CONNECT ON DATABASE geldar TO geldar_monitor;
