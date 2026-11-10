# Wave M fix requests

## R1

- tools/mcp-tokens/secret-files.ts (CLI): refuse a pepper under 32 bytes at mint time, with the same rule as threshold/mcp `pepperBytes` (one trailing LF or CRLF removed, nothing else trimmed).
- tools/mcp-tokens `init --force`: print a loud warning that the database role password is not changed by a rewrite of postgres-mcp.txt, and document it in the README.
- tools/mcp-tokens checkOutPath: resolve the parent directory with realpath before the in-repo check, so a symlink outside the repo that points in is refused.
- tools/mcp-tokens on win32: mode 0o600 is not enforced and mkdir uses the default mode; add an icacls step or document the limitation.
- Item C (token CLI) done: the pepper golden table holds the CLI and the server to one rule; init --force prints the role-password warning; checkOutPath resolves symlinks; the win32 owner-only ACL runs icacls best effort. The README note for init --force is for the R5 docs owner.


## R2

Branch `wave-m/fix-r2`, from `2afeed2`. Scope: the sovereign MCP store, the migrations, and the
migration ledger.

### Done

- Budget lock: `pg-budget.ts` locks the budget row before accrual, so concurrent reserves cannot
  overspend. Unit test in `pg-budget.test.ts`; IT case in `test/it/pg-stores.it.test.ts`.
- Sleep mark table: migration 0003 moves the sleep mark to `mcp_sleep_marks` and grants `agents`
  by column (no UPDATE, no `last_sleep_day`). Tests in `pg-agents.test.ts`, `migrate.test.ts`
  and the IT file.
- Journal index and trim: migration 0003 adds `mcp_journal_life_id_idx`; each append keeps 1000
  lines per life; NUL bytes are dropped before insert. Tests in `pg-journal.test.ts` and the IT
  file.
- Token catch-up and epoch: after a LISTEN reconnect the store catches up revocations and stops a
  stale cache write. Test in `pg-tokens.test.ts`.
- SCRAM: `geldar_mcp` gets a SCRAM verifier, not the plain password. Tests in `scram.test.ts` and
  `role-password.test.ts`.
- Ledger rule: every migration inserts its own `schema_migrations` row (`sql/README.md`).
  `tools/migrate/src/ledger.test.ts` checks every `sql/NNNN_*.sql`; 0001 is exempt because it
  predates the ledger. `sql/test/check-schema.sql` checks that the ledger holds 0001 to 0003.

### Left or known

- Rotation expiry without revoke does not end sessions (low).
- Refund has no reservation id. This is a documented limit.
- Over-length journal lines still throw `RangeError` (over 4000 characters).
- Integration cases owed to ops: the only IT file changed in R2 is
  `threshold/mcp/test/it/pg-stores.it.test.ts`. It is skipped unless `GELDAR_IT=1` and needs the
  MCP stack and Postgres. Run it with the stack up (`./geldar.ps1 mcp up`):
  `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm --dir threshold/mcp exec vitest run test/it`.
- Request for R1 `main.ts`: none needed. `PgAgentStore` kept its constructor.
