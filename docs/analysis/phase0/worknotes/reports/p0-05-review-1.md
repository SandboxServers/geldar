# P0-05 review 1 (sql migrations)

Range: `origin/phase0/wave1...HEAD` (b2939e3), four files: `sql/0001_init.sql`, `sql/README.md`, `sql/test/check-schema.sql`, `.github/workflows/ci.yml`. (A two-dot diff also shows `docs/analysis/phase0/*` changes; that is only the branch being behind wave1's ledger commit 6e0780f, not part of the commit.)

Verdict: decision

## Verified

- All 18 Appendix D tables, both indexes (`memories` hnsw, `events (type, world_day)`), the `archive` schema, the commented REVOKE and every comment match spec.md lines 1687-1785, apart from the changes below.
- The three required changes are present and marked `differs from spec Appendix D`: `receipts` has no `UNIQUE` on `action_id`, has `detail TEXT` and `UNIQUE (action_id, phase)`; `actions` has `snapshot_revision BIGINT`.
- CI job `sql` is in `gate` `needs`. The gate loop treats any non-`success` result as a failure, so a skipped `sql` job fails the gate.
- Image digest `sha256:ccc6e83d...` equals the index digest from `docker buildx imagetools inspect pgvector/pgvector:0.8.6-pg16` (checked here).
- Files are LF (`git ls-files --eol`), under 700 lines, with no secrets or IPs (`POSTGRES_PASSWORD: ci` is what the packet says). `sql/test/` is a subdirectory, so the official image's initdb does not run `check-schema.sql`.
- `check-schema.sql` does fail when a table is missing: the coder's negative test shows exit 3. It also fails when `vector` is not installed.

## Findings

1. Decision needed: unrequested fourth change, `sql/0001_init.sql` lines 80 and 83-84 (`skill_library.skill_id`, `books.skill_id`).
   The spec's `REFERENCES skills` cannot work against `PRIMARY KEY (skill_id, edition)`, so Postgres rejects the original. Dropping the two foreign keys is correct as the minimum to make the migration apply, and it is flagged in the code and the report. But it removes integrity that the spec intended: a book or library entry can now name a skill that does not exist. The packet allows exactly three changes, and spec.md Appendix D itself is still wrong.
   Options for the orchestrator:
   (a) Keep both foreign keys dropped and record the decision. Smallest. Add an ADR or ledger note, and fix Appendix D in spec.md to match.
   (b) Add `edition INT` to `books` and `skill_library` with a composite `FOREIGN KEY (skill_id, edition) REFERENCES skills`. The `skill_library` primary key then probably becomes `(agent_id, skill_id, edition)`. This needs a decision on whether a book pins an edition, and it changes the contract shape.
   Recommended default: (a) for Phase 0, since neither table is used before later phases. A new migration can add the keys when the semantics are settled.

2. Low, optional: `sql/test/check-schema.sql` guards table names only.
   Nothing checks the three contract changes, the `archive` schema, the indexes or the `skills` primary key. If someone reverts `UNIQUE (action_id, phase)` back to `action_id UNIQUE`, or drops `snapshot_revision`, `detail` or `CREATE SCHEMA archive`, CI stays green. That uniqueness is the no-double-credit guarantee of decision 0020. The packet asks only for tables plus pgvector, so this is not spec drift, but it leaves the "differs from spec" changes untested.
   Smallest fix: in the same DO block, RAISE EXCEPTION unless
   - `pg_constraint` has a unique constraint on `receipts` over exactly `(action_id, phase)`, and none over `action_id` alone;
   - `information_schema.columns` has `receipts.detail` and `actions.snapshot_revision`;
   - `information_schema.schemata` has `archive`.

3. Cosmetic: the `.github/workflows/ci.yml` header (line 4) still says "Mirrors `./geldar.ps1 check`". The `sql` job has no local counterpart in that script. Adjust the comment, or note the gap. The coder already reported this.

4. Note, no action: the coder did not run the `sql` job on GitHub. The job relies on `psql` and `pg_isready` being on the ubuntu-24.04 runner PATH, which is true for that image today. `psql -h localhost` may try `::1` first, but libpq falls back to IPv4, so this is low risk. The first CI run on the wave PR is the real test.

## Fix notes

Not a `fix` verdict. If the orchestrator picks option (a) in finding 1, the change is documentation only (a decision record or ledger entry, plus a spec.md Appendix D correction). If it picks option (b), send a fresh coder the schema change in `sql/0001_init.sql`. Finding 2 can ride along with either.
