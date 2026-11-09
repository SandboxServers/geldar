# Wave 1 fix, pass 2

Status: done. Commit on phase0/wave1-fix (see the commit message).

## Changes

1. Loopback port check (`tools/repo-checks/src/loopback-ports.ts`) is now a YAML parse. `yaml@2.9.1`, exact-pinned in `@geldar/repo-checks` only. Choice: 2.9.1 is the newest release (published 2026-09-11, more than two weeks before today, 2026-11-08); 2.9.0 is from 2026-05-11. The parser walks `services.*` after anchors, aliases and merge keys resolve.
   - Short `ports:` entries must start with `127.0.0.1:`. Ranges pass. `$` anywhere in an entry (`${VAR}`, `$VAR`) is rejected. `[::1]` fails through the prefix rule.
   - Long-form mappings pass only with `host_ip: 127.0.0.1`. Otherwise the finding names the service and the mapping.
   - `network_mode: host` fails for any service.
   - `expose:` is ignored.
   - Fail closed: an unparseable file, more than one document, parse warnings (for example an unknown tag such as `!override`), a service that is not a mapping, and a `ports:` value that is not a list all fail.
   - Findings are `{ path, service, reason }`. The old `line` field is gone, because the YAML walk has no source line. The CLI prints `error: <path> service <name>: <reason>`.
2. Tests: `loopback-ports.test.ts` (26 cases) covers each bypass from the review, long-form safe and unsafe, `${VAR}`, ranges, `network_mode: host`, `expose`, and malformed input. `cli.test.ts` runs `cli.ts` in a temp git repo with the real `compose/phase0.yml` (passes), a bare `5432:5432` (fails), and `network_mode: host` on nats (fails).
   - Revert proof: with the compose loop removed from `cli.ts`, 2 of the 3 CLI tests fail. With the pre-fix line-based scanner restored, 19 of 26 scanner tests fail. Both files were restored and the diff re-checked.
   - The long comment in `cli.ts` is re-wrapped.
3. `sql/test/check-schema.sql`: receipts and `actions.state` are checked by behaviour. A `pg_temp.receipt_probe` function runs statements and always rolls back. Probes: control (valid `actions` row accepted), `actions.state` `bogus` rejected, prepared then committed accepted, committed then aborted rejected, two committed rejected, two prepared rejected, phase `bogus` rejected, NULL `action_id` rejected. The catalog checks for receipts and `actions.state` are removed. The rest stay as catalog checks.
   - Verified on a throwaway `pgvector/pgvector:0.8.6-pg16` container (digest from `.github/workflows/ci.yml`), bound to `127.0.0.1:55432`, stopped and removed afterwards. Unmodified schema: `schema check passed: 18 tables, pgvector 0.8.6`.
   - Mutations (on scratch copies of `0001_init.sql`, each on a fresh DB), all fail with exit 3:
     - index widened to include `prepared`: rejected at the prepared-then-committed probe
     - CHECK widened with `bogus`: rejected at the phase probe
     - index removed: rejected at the committed-and-aborted probe
     - CHECK removed: rejected at the phase probe
     - NOT NULL removed (extra mutation): rejected at the NULL probe
4. `sql/0001_init.sql`: `receipts.action_id TEXT NOT NULL`, with a `-- differs from spec Appendix D:` comment. `action_id` is referenced only by `actions` (primary key) and `receipts`. No foreign key points at either, so no parent rows are needed in the probes.
5. `docs/threat-model.md`: `propose.value` added to the §4 rule 4 open-object list. The §1 port-check sentence now lists exactly what is enforced.

## Deviations

- The CRLF rule in the brief is not applied. `docs/` here is LF: `findCrlfInIndex` requires LF in the index, and the file was LF before this change.
- The "a test that scans real phase0.yml through the CLI path" check spawns the CLI in a temp git repo, because `cli.ts` runs its checks at import time. Removing the wiring fails the test (see revert proof).

## Not covered

- `extends:` and top-level `include:` are not followed, so a service imported from another file is not checked. The brief did not ask for this. It is a residual gap for review.

## Check results

- `./geldar.ps1 check`: "All checks passed." (lint, typecheck, vitest 162 passed, repo checks ok, generated up to date, `docker compose config` for phase0.yml).
- `./geldar.ps1 pnpm lint`: clean. Biome formatting was applied to `tools/repo-checks/src`.