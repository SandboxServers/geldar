---
title: Add a migration
type: how-to
audience: contributors
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, ../reference/database-schema.md, ../reference/cli-tools.md, ../reference/deploy-scripts.md, ../reference/repo-checks.md, colo-deploy.md, account-deletion.md, ../agents/doc-update-map.md]
sources: [sql/README.md, sql/test/check-schema.sql, sql/0065_owner_export_budget.sql, tools/migrate/src/cli.ts, tools/migrate/src/migrate.ts, tools/migrate/src/ledger.test.ts, tools/repo-checks/src/ci-schema-wiring.test.ts, .github/workflows/ci.yml, geldar.ps1, compose/phase0.yml, deploy/genesis/config-bundle.list, deploy/test/genesis-config-bundle.test.ts, deploy/colo-cd.sh, deploy/colo-cd-plan.sh, CLAUDE.md, docs/decisions/0085-append-only-audit-tables.md, docs/analysis/phase1/packets/decision-number-registry.md, docs/analysis/harness/work-packets-sheet-w3-w5.md]
---

# Add a migration

Add one numbered SQL file under `sql/` that changes the shard's Postgres schema, with its ledger row, a schema check that CI runs, and the deploy list entry. A migration is forward-only: once merged it is never edited, and a fix is a new file.

Every command below is PowerShell 7, run from the repo root. Checked at 03c1f5de on 2026-11-16. No database was read for this page (plan decision D8); steps that need one are marked *untested*.

## Before you start

- Read [sql/README.md](../../sql/README.md) and the [database schema](../reference/database-schema.md) reference (tables, roles, functions, triggers and every migration so far).
- Check whether a decision already covers the change. A migration that changes an append-only table (`receipts`, `thoughts`, `suppressed_wakeups`, `mcp_journal`) needs its own decision ([0085](../decisions/0085-append-only-audit-tables.md), consequences). Write it first: [add a decision record](add-a-decision-record.md).
- If the change touches personal data, read [account deletion](account-deletion.md) (operator runbook) first; erasure functions may need to reach your new table.

## Steps

1. **Pick the number.** List the numbers in use:

   ```powershell
   git ls-files sql | ForEach-Object { if ($_ -match '^sql/(\d{4})_') { $Matches[1] } }
   ```

   On 2026-11-16 at 03c1f5de this prints 44 numbers from 0001 to 0065, with gaps (0028 to 0031, 0041 to 0049, 0053 to 0059, 0064). Gaps are normal: parallel campaigns reserve blocks of numbers so their branches do not collide. Examples in the repo: the sheet campaign's SQL block starts at 0050 (`docs/analysis/harness/work-packets-sheet-w3-w5.md` line 13), and the header of `sql/0065_owner_export_budget.sql` says 0064 is reserved for another branch. Use a number from your campaign's block, or ask the orchestrator for one; check open branches as well as `main`. Two files with the same number fail the runner (`two migration files share a version`, `tools/migrate/src/migrate.ts`).

2. **Create the file** `sql/NNNN_slug.sql`. The runner refuses any file in `sql/` that starts with a digit and is not named `NNNN_name.sql` (`listMigrations`). Files apply in name order.

3. **Write the SQL.** Conventions from `sql/README.md` and the existing files:
   - Start with a header comment: `-- Migration NNNN (<card or decision>): <what it does and why>`.
   - Where the schema differs from spec Appendix D, say so in a comment that starts `differs from spec Appendix D`.
   - The runner wraps each file in one transaction (`applyOne` in `tools/migrate/src/migrate.ts`). Do not add your own `BEGIN` or `COMMIT`.
   - Roles a migration creates are `NOLOGIN`; a login is set later with `--set-role-password`, which accepts only the roles in `PASSWORD_ROLES` (`tools/migrate/src/migrate.ts`). A new login role means a code change there.
   - Never put a password or other secret in a migration. The repo is public.

4. **End the file with its own ledger row**, exactly in this form (`sql/README.md`, "Runner"):

   ```sql
   INSERT INTO schema_migrations (version) VALUES ('NNNN') ON CONFLICT DO NOTHING;
   ```

   `tools/migrate/src/ledger.test.ts` fails when any file after 0001 lacks a live (uncommented) insert of its own version.

5. **Add a schema check.** Write `sql/test/check-schema-<topic>.sql` that raises an exception when the migration's effect is missing: a table, column, grant, function or trigger. `sql/test/check-schema-body-host.sql` is a model: a `DO` block, fixtures inside a sub-block that always rolls back, `RAISE EXCEPTION` on each failed assertion. CI applies all migrations and then runs the check files with `psql -v ON_ERROR_STOP=1`.

6. **Wire the check into CI.** Add `-f sql/test/check-schema-<topic>.sql` to the end of the psql line in the "check schema (Appendix D tables and pgvector)" step of `.github/workflows/ci.yml` (line 178 at 03c1f5de). `tools/repo-checks/src/ci-schema-wiring.test.ts` fails when a `sql/test/check-schema*.sql` file is not named outside a comment in `ci.yml`.

7. **Add the file to the deploy bundle list.** Add `sql/NNNN_slug.sql` to `deploy/genesis/config-bundle.list`, in order with the other `sql/` lines. The list's header says "adding a file means adding its line here in the same change", and names "the SQL migrations colo-cd refreshes" as one of its groups. The list's test (`deploy/test/genesis-config-bundle.test.ts`) checks that the archive matches the list, not that every migration is listed; see [conflicts](#conflicts-recorded).

8. **Update the documents** in the same change, from the [doc-update map](../agents/doc-update-map.md) row "A new migration under `sql/`": [sql/README.md](../../sql/README.md) when a convention changes, the [database schema](../reference/database-schema.md) reference (its migrations table and the tables, roles or functions you added), and [account deletion](account-deletion.md) when personal data moves.

## Verify

1. Run the repo-side tests. Both ran on 2026-11-16 at 03c1f5de and passed (2 files, 9 tests; re-run at 09:22 UTC in the W3 fix pass):

   ```powershell
   ./geldar.ps1 pnpm exec vitest run tools/migrate/src/ledger.test.ts tools/repo-checks/src/ci-schema-wiring.test.ts
   ```

2. *Untested.* Against a local Phase 0 shard that is already running, list what would apply, then apply:

   ```powershell
   ./geldar.ps1 db migrate --dry-run
   ./geldar.ps1 db migrate
   ```

   `./geldar.ps1 db migrate` passes its arguments to `tools/migrate/src/cli.ts` and fills in the local `PG*` defaults (`Invoke-PgNode` in `geldar.ps1`; Postgres on `127.0.0.1:5432` in `compose/phase0.yml`). The dry run prints `would apply <file>` per pending file or `nothing to apply`; the real run prints `applied <file>`. A second run prints `nothing to apply`. A fresh volume needs neither: Postgres applies every file in `sql/` at first boot (`compose/phase0.yml` line 25).

3. Open the PR. The CI `sql` job applies every `sql/[0-9]*.sql` in name order to an empty pgvector Postgres, then runs every wired check file (`.github/workflows/ci.yml` lines 136 to 178). The `integration` job applies them again for the integration tests.

## What happens after merge

A merged migration reaches the Colo node on the next deploy. `deploy/colo-cd-plan.sh` marks `sql yes` when any `sql/*.sql` file changed (line 82). `deploy/colo-cd.sh` then writes a `pg_dump` to the operator backups folder and runs `colo-admin.sh migrate`; a failed dump or migration aborts the deploy before any service restarts (lines 389 to 397). The [colo deploy](colo-deploy.md) runbook covers the pipeline. Whether a given migration is applied on the node is not visible from the repo (D8).

## Roll back

- **Before merge:** delete the file and its check, and remove the `ci.yml` and bundle-list lines.
- **After merge:** migrations are forward-only. `deploy/colo-cd.sh` says so (comment above `rollback()`, line 232), and a release rollback does not reverse them. Write a new migration that undoes the change, with its own number and check. Never edit or delete the merged file (`sql/README.md`). Restoring the pre-deploy dump is a node operation outside this runbook; see [backup and restore](backup-and-restore.md) (written in the same wave, W3).

## Conflicts recorded

1. **The bundle list lags the migrations.** `deploy/genesis/config-bundle.list` lists `sql/0001` to `sql/0051` but not 0040, 0052, 0060, 0061, 0062, 0063 or 0065 (checked 2026-11-16 at 03c1f5de by comparing `git ls-files 'sql/[0-9]*.sql'` with the list's `sql/` lines). The list's header says it carries the migrations colo-cd refreshes. `deploy/colo-cd-plan.sh` reads changed files from the release export, not from this list, so the gap affects the genesis bundle, not the delta deploy (inferred from `colo-cd-plan.sh` lines 64 to 89). Unresolved; a code-owner fix.
2. **What check-schema.sql asserts about the ledger.** `sql/README.md` says `sql/test/check-schema.sql` "asserts that every migration is in the ledger". The check asserts only that the ledger contains 0001 to 0022 (`sql/test/check-schema.sql` lines 224 to 227). For later files the guard is `tools/migrate/src/ledger.test.ts`, which reads the files, not a database.

## Related

- Reference: [database schema](../reference/database-schema.md), [CLI tools: migrate](../reference/cli-tools.md#migrate), [deploy scripts](../reference/deploy-scripts.md), [repo checks](../reference/repo-checks.md).
- How-to: [add a contract schema](add-a-contract-schema.md) when the new table stores a contract message; [colo deploy](colo-deploy.md).
