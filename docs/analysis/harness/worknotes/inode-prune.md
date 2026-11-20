# Inode prune (option A), card ID not yet assigned

Branch `phase1/inode-prune`, off main c2cef18d. Inert: a repo-side script, tests and docs. Nothing is installed or run on the node.

## What changed

- `deploy/genesis/prune-deploy-work.sh`: POSIX sh, dry run by default, `--apply` deletes, `--keep N` (default 5).
- `deploy/colo-status.sh`: a trailing inode check, silent below 80% (`GELDAR_INODE_WARN_PCT`), path `GELDAR_INODE_PATH` (default `/var/lib/geldar-deploy`, else `/var`). Existing output is unchanged on a healthy node; a failed `df` never fails the status.
- `deploy/test/prune-deploy-work.test.ts` (20 tests) and two tests in `deploy/test/colo-deploy.test.ts`.
- `docs/runbooks/node-only-config.md` row 14 and `docs/analysis/worldops/RESUME.md`.

## Rules as built

The live commit is read from the first line of `staged/release.env`, which the colo-images workflow writes as `# Release manifest for the Colo node (decision 0084). Commit <40 hex>.` (`.github/workflows/colo-images.yml`, the release.env step). A strict match on that shape; a bare sha, a short or uppercase sha, two commits on the line, a missing final period, or no file all refuse with nothing removed.

Candidates are direct children of `<root>/work` that are real directories (not symlinks) named by exactly 40 lowercase hex. The newest N by modification time are kept, and the commit on the first line of `<root>/staged/release.env` (only that line is read; it must be 40 hex or nothing is removed, exit 1). Two locks, both held for the run: the deploy channel's `<root>/channel.lock` (`flock -n`; busy or no `flock` refuses) and the directory lock `deploy/colo-cd.sh` uses, `$GELDAR_STATE_DIR/cd.lock` (default `/var/lib/geldar-colo`, taken with the same atomic `mkdir`, released on exit; a held lock, a missing state directory or a failed mkdir refuses). Output is names only. No `docker`.

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
| no colo-cd lock directory | `a held colo-cd lock directory removes nothing and exits 1` |
| colo-cd lock never released | `takes the colo-cd lock during the run and releases it after, even when it refuses` |
| any first line accepted as the commit | `an unreadable live commit (a bare commit with no manifest line)`, `(no trailing period)` |
| trailing period not stripped | 7 tests (every run that needs the live commit) |
| status threshold raised above 100 | `colo-status inode warning > warns when the inodes ... 80% used or more` |

The first run of the symlink case survived (the link was the newest entry and so kept as one of the N): the test now uses `--keep 0`.

## Checks and local limits

- Whole-repo `biome ci --diagnostic-level=error`, `check:repo`, `git diff --check`: see the report.
- Pre-existing failures on unmodified main on this desktop (not caused by this card): `deploy/test/colo-deploy.test.ts` fails 21 of 21 on this desktop, on unmodified main too, because the fixture looks for `sh.exe` under Program Files and Git is installed per user. With `GELDAR_TEST_SH` set to the real `sh.exe` it runs: the status tests and the two new ones pass; 9 `colo-up` related tests fail the same way on main (environment, not this card; not re-verified on main with the override).
- `deploy/test/genesis-config-bundle.test.ts` fails 2 tests here with and without this card (baseline checked by setting the card aside). Other genesis tests and `literal-sweep` pass.
- Not run here: shellcheck (not installed), a real Linux `flock`, and the script on the node.

Equivalent survivor: removing the `[ -d "$STATE_DIR" ]` check changes only the message, because `mkdir` of the lock then fails anyway and refuses.

## Open items for the node step (not done)

- Confirm on the node with a dry run that `staged/release.env` has the workflow's first line (an operator step).
- OPEN: the root-owned entrypoint `/usr/local/libexec/geldar-deploy/run` is untracked and may hold a lock of its own; the script takes the channel lock and the colo-cd lock only.
