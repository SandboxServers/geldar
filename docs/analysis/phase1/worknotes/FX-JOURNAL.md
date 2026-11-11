# FX-JOURNAL worknote: journal review fixes

Branch `fix/c1-journal-review`. Decisions: [0085](../../../../decisions/0085-append-only-audit-tables.md) (append-only audit tables). Migration: `sql/0007_journals_append_only.sql`. Guard copies: `animus/src/memory/throwaway-db.ts`, `eventsink/test/throwaway-db.ts`.

## Commits

| Commit | What it fixed |
|---|---|
| `7ea7a54` | The throwaway guard was a denylist: it refused only `''` and `geldar`, so `geldar_colo`, `Geldar`, `geldar ` or `postgres` passed and a TRUNCATE cleanup could wipe a real database. It is now an allowlist: `geldar_it_<hex>` always, `geldar` only with the opt-in, every other name refused. Both guard copies and their unit tests changed. |
| `e9b2a15` | `GELDAR_IT_ALLOW_SHARED_DB` alone separated the CI database from a dev database only by convention. `geldar` now needs the opt-in set to `1` and `GITHUB_ACTIONS` true. The env var moved from the CI job to the single integration vitest step. `sql/README.md` warns that it is CI-only. |
| `e9e7714` | A refused guard in `afterAll` threw before `pool.end()`, so the pool stayed open. The memory cleanup now runs its assertion and TRUNCATE in try/finally; the projection test closes the pool when its guard fails. |
| `37b2141` | `FakeJournalStore.recent` returned `slice(-limit)`, so a test read could see more than the 1000-line window the pg store returns. `JOURNAL_KEEP` moved to `ports.ts` (no pg import in the fake). The fake caps the limit and refuses a limit below 1, as the pg store does. |
| `daf3e65` | The 0007 check in `sql/test/check-schema.sql` did not look at `tgenabled` or the INSERT bit. It now requires `tgenabled` in `('O', 'A')` and no INSERT bit. The `geldar_mcp` check on `mcp_journal` also refuses TRUNCATE, TRIGGER and REFERENCES. Not run against a database in this worktree. |
| `bb52876` | Wording. The triggers refuse UPDATE and DELETE statements; a superuser can still TRUNCATE, disable the trigger or change `session_replication_role`, and every service connects as the superuser. Hardening is C2. The 0007 header comment (not checksummed: `tools/migrate` records no checksum) and decision 0085 say so. |
| `a442d13` | The same wording in the 0085 index rows and in `P1-C1-05a.md`, which still said "every role". |

Reviewer findings covered: 1, 2, 3, 4 (reword), 6 and 7 of the review. The finding text was not in this worktree, so the mapping above is by commit message, not by finding number.

## Revert-check evidence

Each check mutates the change locally, runs the named test, and restores the change.

- Allowlist regex in the guard mutated to `/^geldar/`: 4 guard unit tests failed.
- `GITHUB_ACTIONS` clause removed from the shared-name check: 1 test failed.
- Fake window line mutated (the cap removed): 1 test failed.
- The other changes (pool close, `check-schema` strengthening, wording) need a database or a rendered document. They are not revert-checked here.

## What CI must prove

- Guard unit tests in `animus` and `eventsink` (the allowlist and the GITHUB_ACTIONS clause).
- Fakes and pg-journal tests in `threshold/mcp`, including the read window.
- The `check-schema` block against a real database (the 0007 trigger, its `tgenabled`, the INSERT bit and the `geldar_mcp` grants).
- The integration step with `GELDAR_IT_ALLOW_SHARED_DB` set only on that step, and nowhere else.

## Follow-ups

- The reset of the test life still logs its audit deletes instead of running them (0085 item 8). A fresh life id per live run is the fix; it needs `ADAM_LIFE_ID` in `golem/test/live/adam-stack.ts`, outside this packet.
- C2 hardening (0085 item 3): non-superuser service roles, `ENABLE ALWAYS TRIGGER`, a TRUNCATE gate.
- Owner action: add the warning "`GELDAR_IT_ALLOW_SHARED_DB` is CI-only" to `CLAUDE.md` near line 28, next to `GELDAR_IT=1`. Agents do not edit `CLAUDE.md`.

## Deviations

- The 0085 row in `docs/decisions/README.md` did not literally say "for every role"; the 0085 file's own index row and `P1-C1-05a.md` did. All three were reworded to the statement-level scope.
- Merge of `origin/main`: already contained in HEAD (`git merge` reported "Already up to date"), so no merge commit was made.
