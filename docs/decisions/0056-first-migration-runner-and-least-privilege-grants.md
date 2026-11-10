# 0056. The first migration runner, the migration ledger rule, and the least-privilege grants for the MCP role

- Status: Accepted (owner standing instruction: decisions recorded, owner may revise)
- Date: 2026-11-10
- Spec: 5.15 (sovereign storage); Appendix D; closes D-P0-11 in the Phase 0 ledger (`docs/analysis/phase0/README.md`); decision 0054

## Context

D-P0-11 said a migration runner is needed when the first schema change hits a live database. Wave M's first change to a live database was migration 0002 (the sovereign MCP tables). The runner is `tools/migrate`, and the MCP server connects as its own role.

## Decision

1. **Runner.** `tools/migrate` applies the numbered files in `sql/` in order, and writes a row to `schema_migrations` for each one. A database with a schema and no ledger is baselined at 0001 (`needsBaseline` in `tools/migrate/src/migrate.ts`).
2. **Ledger rule.** Every migration inserts its own `schema_migrations` row. `tools/migrate/src/ledger.test.ts` checks every `sql/NNNN_*.sql`. 0001 is exempt because it predates the ledger. `sql/test/check-schema.sql` checks that the ledger holds 0001 to 0003.
3. **Applied migrations are not edited.** A change ships as a new file. 0004 narrows the grants that 0003 gave.
4. **The role `geldar_mcp`** is created `NOLOGIN` in 0002. `migrate --set-role-password geldar_mcp` sets a SCRAM-SHA-256 verifier. It never sends a plaintext `ALTER ROLE` (`tools/migrate/src/scram.ts`).
5. **Column-level grants.** `agents` is readable only as `agent_id, name, game_account, personality_seed, born_day, died_at`, so the MCP cannot read `last_sleep_day` (0003). Sleep marks live in `mcp_sleep_marks`; the MCP may `UPDATE` only `last_sleep_day`, `sleep_cursor` and `updated_at` (0004). `mcp_budget` is `SELECT, UPDATE`; `mcp_journal` is `SELECT, INSERT, DELETE`.
6. **The journal** keeps 1000 lines per life; each append trims the life's older lines (`pg-journal.ts`).

## Consequences

- A compromised MCP role cannot rewrite a sleep day or another agent's record, beyond the three columns it needs.
- Postgres grants cannot limit `DELETE` on `mcp_journal` to one life's rows. The trim runs with a `WHERE` clause, and the grant stays wider than the need (0004 comment).

## Open

- **The sleep cursor column** (`mcp_sleep_marks.sleep_cursor`) is on the owner's list. Its shape is not yet confirmed.
- **Live migration on the Phase 0 volume** has not run. The operator runs `db migrate` with a backup first (wave close step).
