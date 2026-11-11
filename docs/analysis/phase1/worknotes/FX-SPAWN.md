# FX-SPAWN: three spawn-heavy tests made cheap

Pattern as in C1-01c: put the logic behind an in-process function or port, assert on it directly, keep one end-to-end spawn.

## tools/repo-checks/src/cli.test.ts (16 spawn cases of git and node, about 1.2 s each, to 14 cases and 1 spawn case)

- New `run-checks.ts`: `runRepoChecks(port, now)` holds every check; `RepoPort` is the git and file-system boundary (index entries, untracked paths, CRLF paths, index blobs, working-tree text and bytes). `cli.ts` is now only the git-backed port plus printing and the exit code.
- Tests run `runRepoChecks` over an in-memory port with the real clock. All assertions are unchanged (status becomes `failed`, output becomes the joined lines), including the "git cannot read an index blob" message, which comes from the real `parseCatFileBatch` fed git's `missing` reply.
- The one spawn case runs the real binary in one real git repo with `core.autocrlf=true`: the index, not the CRLF working tree, is judged (exit 0); a ignored file with a control byte is ignored (`--exclude-standard`); then a staged lone CR, run from a subdirectory, exits 1 and names the file. It carries what only real git and a real process can show: autocrlf, ignore rules, repo-root discovery from a subdirectory, exit codes.
- Removed spawn-only cases and where their assertions went: subdirectory run and the autocrlf judgement are folded into the spawn case; the ignored-file case moved to the spawn case (the fake cannot model `.gitignore`).
- Gap, stated: `findCrlfInIndex`'s parsing of `git ls-files --eol` text is covered by its own unit test and the spawn case only on a clean repo; the in-process CRLF case derives the CRLF list in the fake.

## tools/repo-checks/src/colo-config.test.ts

`Read-ColoConfig` is PowerShell with no TypeScript equivalent, so the cases stay under pwsh, grouped: one harness takes a manifest of 15 config files, prints one outcome per file, and `beforeAll` spawns pwsh once. The 12 `it` blocks keep their assertions and read their own outcome (21 tests in the file, same as before). geldar.ps1 is not touched.

## threshold/mcp-mock/src/cli.test.ts

The "applies the timing overrides ... suppressed wakeups as JSONL without text" case moved in-process: `scenario-world.ts` (`createScenarioWorld`, extracted unchanged from `cli.ts`) plus `createApp` and the MCP client on port 0 in `scenario-world.test.ts`; every assertion carried over. The spawn cases that stay in `cli.test.ts` are the other CLI cases.

Gap, stated: that case also proved the flags `--day-length-seconds`, `--min-wake-spacing-seconds` and `--suppressed-log` reach `applyOverrides` through argv. Now the spawn tests cover only `--intent-run-too-long-seconds` (plumbing) and `--suppressed-log` open behaviour. If the mapping table in `cli.ts` matters, add a spawn-free test by extracting the flag table.

## What a revert-check proves for this change

A refactor-only change has no behaviour to revert. The proof is "same assertions, fewer spawns" (lists above), plus a mutation showing the in-process tests still have teeth: dropping the `crlfPaths` guard in `run-checks.ts` fails "reports a CRLF file once, as CRLF" (restored from a backup, diff empty).

## Timings (this machine)

- cli.test.ts: before about 19 s of spawns (16 cases); after 1.5 to 3.3 s over five runs.
- colo-config.test.ts: 12 pwsh spawns before; after 0.94 to 1.03 s over five runs (one spawn).
- mcp-mock: scenario-world + cli.test.ts about 12 to 14 s (the intent timing case still waits real seconds).
- Concurrent with a full `./geldar.ps1 check`: the three files passed together in 5.9 s.
