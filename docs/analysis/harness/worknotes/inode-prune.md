# Inode prune (option A), card ID not yet assigned

Branch `phase1/inode-prune`, off main c2cef18d. Inert: a repo-side script, tests and docs. Nothing is installed or run on the node.

## What changed

- `deploy/genesis/prune-deploy-work.sh`: POSIX sh, dry run by default, `--apply` deletes, `--keep N` (default 5).
- `deploy/colo-status.sh`: a trailing inode check, silent below 80% (`GELDAR_INODE_WARN_PCT`), path `GELDAR_INODE_PATH` (default `/var/lib/geldar-deploy`, else `/var`). Existing output is unchanged on a healthy node; a failed `df` never fails the status.
- `deploy/test/prune-deploy-work.test.ts` (14 tests) and two tests in `deploy/test/colo-deploy.test.ts`.
- `docs/runbooks/node-only-config.md` row 14 and `docs/analysis/worldops/RESUME.md`.

## Rules as built

Candidates are direct children of `<root>/work` that are real directories (not symlinks) named by exactly 40 lowercase hex. The newest N by modification time are kept, and the commit on the first line of `<root>/staged/release.env` (only that line is read; it must be 40 hex or nothing is removed, exit 1). The deploy channel lock `<root>/channel.lock` is taken with `flock -n` and held for the run; busy or no `flock` refuses. Output is names only. No `docker`.

## Deploy timing

`deploy/**`, `docs/**` are not in the `colo-images` push filter (`.github/workflows/colo-images.yml` `paths:` lists golem, animus, player-core, eventsink, threshold/mcp, tools/admin, glass, threshold/register, supervisor, tools/mcp-tokens, tools/players-cli, tools/migrate, sql, shards/phase0.yaml, identity-mode.ts, contract, package.json, pnpm-workspace.yaml, pnpm-lock.yaml and the workflow itself). None of this card's files match, so merging starts no image build or `colo-deploy`.

## Revert-checks (each mutation applied to the script, tests run, script restored)

| Mutation | Failing tests |
|---|---|
| no live-commit guard | `keeps the live commit even when it is old` |
| no hex-character guard | `keeps names that are not exactly 40 lowercase hex` |
| no 40-length guard | `keeps names that are not exactly 40 lowercase hex` |
| no symlink guard | `keeps a file and a symlink named like a commit` |
| no is-directory guard | `keeps a file and a symlink named like a commit` |
| no lock | `a busy deploy lock removes nothing and exits 1` |
| `apply=1` by default | `dry run lists what would go and deletes nothing`, `the default is a dry run even with no arguments` |
| unreadable live commit not fatal | four `an unreadable live commit (...) removes nothing and exits 1` cases |
| status threshold raised above 100 | `colo-status inode warning > warns when the inodes ... 80% used or more` |

The first run of the symlink case survived (the link was the newest entry and so kept as one of the N): the test now uses `--keep 0`.

## Checks and local limits

- Whole-repo `biome ci --diagnostic-level=error`, `check:repo`, `git diff --check`: see the report.
- `deploy/test/colo-deploy.test.ts` fails 21 of 21 on this desktop, on unmodified main too, because the fixture looks for `sh.exe` under Program Files and Git is installed per user. With `GELDAR_TEST_SH` set to the real `sh.exe` it runs: the status tests and the two new ones pass; 9 `colo-up` related tests fail the same way on main (environment, not this card; not re-verified on main with the override).
- `deploy/test/genesis-config-bundle.test.ts` fails 2 tests here with and without this card (baseline checked by setting the card aside). Other genesis tests and `literal-sweep` pass.
- Not run here: shellcheck (not installed), a real Linux `flock`, and the script on the node.

## Notes for the node step (not done)

- The format of `staged/release.env` was taken from the card ("the SHA in the first line"). If the real file's first line is `KEY=<sha>`, the script refuses (exit 1, nothing removed) rather than guessing: confirm on the node with a dry run.
- The entrypoint may hold its own lock besides `channel.lock`; the script takes only the channel's.
