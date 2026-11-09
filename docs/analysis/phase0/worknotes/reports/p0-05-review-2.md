# P0-05 review 2 (sql migrations)

Range: `origin/phase0/wave1..HEAD` (b2939e3, cd6b2b7). Files in scope: `sql/0001_init.sql`, `sql/test/check-schema.sql`, `sql/README.md`, `.github/workflows/ci.yml`.

Verdict: ship

## Verified

I ran the migration against a throwaway `pgvector/pgvector:pg16` container (pgvector 0.8.1) on 127.0.0.1:55433. It was the local image, not the digest pinned in CI. I removed the container afterwards.

- `0001_init.sql` applies with `ON_ERROR_STOP=1`. `check-schema.sql` then exits 0 ("18 tables, pgvector 0.8.1").
- Owner decisions, all applied:
  - `books` and `skill_library` have `edition INT` and the composite `FOREIGN KEY (skill_id, edition) REFERENCES skills (skill_id, edition)`.
  - The `skill_library` primary key is `(agent_id, skill_id, edition)`.
  - The `ci.yml` header now says the `sql` job has no local counterpart.
  - Each change carries a `differs from spec Appendix D` comment.
- Behaviour probes on the committed schema:
  - `skill_library` is rejected for a missing (skill, edition), for a duplicate key, and for a null edition.
  - `books` is rejected when it has a skill and no edition, or an edition and no skill. It is accepted with a skill and an existing edition, or with neither.
  - `receipts` accepts `prepared` and `committed` for one `action_id`, and rejects a second `prepared`.
- Mutation runs: I applied each mutated migration, then ran `check-schema.sql`.

| Mutation | Migrates | check exit |
|---|---|---|
| none | yes | 0 |
| `UNIQUE (action_id, phase)` removed | yes | 3 |
| `action_id UNIQUE` column constraint added | yes | 3 |
| `CREATE UNIQUE INDEX ... (action_id)` added | yes | 3 |
| `receipts.detail` removed | yes | 3 |
| `actions.snapshot_revision` removed | yes | 3 |
| `CREATE SCHEMA archive` removed | yes | 3 |
| `books` composite FK removed | yes | 3 |
| `skill_library` composite FK removed | yes | 3 |

Every guard fails when its change is reverted, so none is theatre. Each failure names the specific problem.

- No regressions against Appendix D: tables, columns and types are unchanged apart from the marked differences. The `sql` job is still in the gate `needs`. All four files are LF and under 700 lines. No secrets or IPs.

## Findings (minor, none blocks shipping)

1. `sql/test/check-schema.sql:73-90`: the FK guard compares only the sorted referencing column set. It does not check the `skill_library` primary key or the `books` CHECK. Dropping `edition` from the primary key, or removing the CHECK, would pass. I could not build a wrong-but-passing FK, because the TEXT/INT types force the column pairing. Optional fix: check `pg_get_constraintdef` for `skill_library_pkey` and `books_check`.
2. `sql/README.md:12`: `docs/spec.md` Appendix D (lines 1756-1763) still has the form Postgres rejects. That follows the owner's decision (spec not edited here), but the correction lives only in a README note. Add a ledger task to fix Appendix D, or the spec and migration will keep disagreeing.
3. The CI `sql` job was not run on GitHub. It relies on `psql` and `pg_isready` being on the runner PATH. The first PR run is the real test (carried over from review 1).
