# SQL migrations

The Postgres schema for a shard lives here as numbered migrations:

- Files are named `NNNN_slug.sql` (for example `0001_init.sql`) and applied in name order.
- On a fresh volume, Postgres init applies them (the official image runs every `*.sql` in `/docker-entrypoint-initdb.d` in name order).
- Never edit a migration that has been merged. Add a new one with the next number instead.
- `test/check-schema.sql` is not a migration. CI applies every `[0-9]*.sql` file with `psql -v ON_ERROR_STOP=1`, then runs it to check that every table of spec Appendix D exists and that pgvector is installed. It also checks the sovereign MCP tables, the revocation trigger and the `geldar_mcp` role (migration 0002). Migration 0008 adds `mcp_identities` and the NOLOGIN `geldar_register` role (decision 0135); the check runs as that role and asserts what it cannot read or write.

## Runner (`tools/migrate`)

A live database is migrated with `tools/migrate` (decision D-P0-11, now resolved):

- `node tools/migrate/src/cli.ts --dry-run` lists what would apply and changes nothing.
- `node tools/migrate/src/cli.ts` applies each pending `NNNN_*.sql` in name order, one transaction per file, and records it in `schema_migrations`. A second run does nothing. It takes an advisory lock, so two runners cannot race.
- A database that has `agents` but no `schema_migrations` predates the runner: it is baselined as `0001` and only the later files run.
- Each migration inserts its own row: `INSERT INTO schema_migrations (version) VALUES ('NNNN') ON CONFLICT DO NOTHING;`. The runner records it too, so the row is there either way. `0001` is the exception: it predates the ledger, and `0002` creates the table with its row. `tools/migrate/src/ledger.test.ts` fails when a later file lacks its row, and `sql/test/check-schema.sql` asserts that every migration is in the ledger.
- Connection settings come from the standard `PG*` variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`).
- `node tools/migrate/src/cli.ts --set-role-password geldar_mcp --password-file <file>` sets the password of the `geldar_mcp` role and lets it log in. The value is escaped and never logged; keep the file out of the repo.

The schema follows spec Appendix D. Where a migration differs from Appendix D, it says so in a comment that starts with `differs from spec Appendix D`.

Appendix D needs this correction (spec.md is not edited here): `books` and `skill_library` have no `REFERENCES skills` on `skill_id` alone, because `skills` is keyed by `(skill_id, edition)`. Both tables instead carry `edition INT` and a composite `FOREIGN KEY (skill_id, edition) REFERENCES skills (skill_id, edition)`, and the `skill_library` primary key is `(agent_id, skill_id, edition)`.

The `events` table is fed by `eventsink` (NATS stream `GELDAR_EVENTS` to Postgres, `INSERT ... ON CONFLICT (source_event_id) DO NOTHING`). Events it can never store are not rows: they go to the `geldar.<shard>.dlq` subject in the same stream, with the reason and a truncated body.

Phase 0 runs one database per shard, so `WorldEvent.shard` has no column in `events` and the event sink drops it. Revisit this before Phase 1 multi-shard.

## Integration test database guard

The TRUNCATE cleanups in the integration tests run only against a scratch database (`geldar_it_<hex>`) or the shared CI database `geldar`.

GELDAR_IT_ALLOW_SHARED_DB is CI-only: never set it locally.

The guard allows the shared name only when the variable is `1` and `GITHUB_ACTIONS` is `true`, and CI sets the variable on the one integration step that needs it.