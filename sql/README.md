# SQL migrations

The Postgres schema for a shard lives here as numbered migrations:

- Files are named `NNNN_slug.sql` (for example `0001_init.sql`) and applied in name order.
- In Phase 0, Postgres init applies them on a fresh volume (the official image runs every `*.sql` in `/docker-entrypoint-initdb.d` in name order). A live database is not migrated in place yet; a migration runner arrives with the first schema change that hits one (decision D-P0-11).
- Never edit a migration that has been merged. Add a new one with the next number instead.
- `test/check-schema.sql` is not a migration. CI applies every `[0-9]*.sql` file with `psql -v ON_ERROR_STOP=1`, then runs it to check that every table of spec Appendix D exists and that pgvector is installed.

The schema follows spec Appendix D. Where a migration differs from Appendix D, it says so in a comment that starts with `differs from spec Appendix D`.
