# P0-05 coder report: sql/ migrations from Appendix D

Branch `phase0/p0-05-sql`, worktree `p0-05`.

## Files

- `sql/0001_init.sql` (new): Appendix D with the three contract changes (receipts: no UNIQUE on action_id, `detail TEXT`, `UNIQUE (action_id, phase)`; actions: `snapshot_revision BIGINT`), plus one further change, below.
- `sql/README.md` (new): naming, fresh-volume init, never edit a merged migration.
- `sql/test/check-schema.sql` (new): RAISE EXCEPTION unless the 18 Appendix D tables exist in `public` and pgvector is installed.
- `.github/workflows/ci.yml`: new job `sql` (service `pgvector/pgvector:0.8.6-pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`, `POSTGRES_PASSWORD: ci`, pg_isready wait, migrations in name order with `psql -v ON_ERROR_STOP=1`, then check-schema.sql); `sql` added to the `gate` job's `needs`.

## Deviation from the spec (one change beyond the packet)

Appendix D declares `skill_library.skill_id` and `books.skill_id` as `REFERENCES skills`, but `skills` has `PRIMARY KEY (skill_id, edition)`. Postgres rejects that foreign key ("number of referencing and referenced columns for foreign key disagree"), so the migration failed partway. Fix: the two `REFERENCES skills` clauses are dropped, each line marked `differs from spec Appendix D`. Integrity to a skill edition needs either a composite key on those tables or a decision on which edition a book or library entry points at. The orchestrator should decide that; it is not settled by the packet.

## Checks

- Local run against `pgvector/pgvector:0.8.6-pg16` (container on `127.0.0.1:55432`, stopped afterwards). Migration applied: exit 0. `check-schema.sql`: `NOTICE: schema check passed: 18 tables, pgvector 0.8.6`, exit 0. The psql steps ran through `docker exec psql` inside the container, not a host psql client.
- Negative test (the guarded change): a scratch copy of `0001_init.sql` with the `CREATE TABLE votes` statement removed, applied to a separate database, then `check-schema.sql`: `ERROR: schema check: missing tables in public: {votes}`, exit 3. Repo files were not modified.
- `./geldar.ps1 check`: `All checks passed.` (exit 0). Note this does not run the new `sql` CI job; geldar.ps1 has no sql step. The ci.yml header still says it mirrors `./geldar.ps1 check`, which is now slightly out of date.
- The GitHub `sql` job itself has not run (no remote run from here). It relies on `psql` and `pg_isready` being on the ubuntu-24.04 runner PATH.

## Notes

- The image digest is the multi-arch index digest from `docker buildx imagetools inspect`.
- `detail` is plain `TEXT` as the packet specifies; the 256-character limit from decision 0020 is only in a comment, not enforced.
- The packet ledger row (`docs/analysis/phase0/README.md`) was not changed, as it is not a packet file.
- Commit trailer: the brief specified `Co-Authored-By: Claude Sonnet 5.5`; this agent runs as Haiku 5.5. The message was used verbatim as the brief gave it.
