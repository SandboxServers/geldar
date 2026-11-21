# DR-1: deploy inode floor, work-directory prune, image retention

Branch `phase1/dr1-inode-floor`, off main c92d7451. Supersedes the draft inode-prune card (its two commits are carried here). Repo-side scripts, tests and docs; nothing is installed or run on the node.

## DR-1 additions (on top of the prune script below)

1. **Inode floor.** `deploy/common.sh` `check_prereqs` now also reads `df -Pi` for the checkout filesystem and dies below `GELDAR_MIN_FREE_INODES` (default 100000; a deploy checkout is about 4,400). A filesystem reporting no inode count is skipped. Root cause it closes: the block check (`df -Pk` against `MIN_FREE_KB`) passed while the manifest write failed 22 times. Test: `colo-deploy.test.ts` "refuses when free inodes are below the threshold, though blocks are plentiful" (df stand-in: huge free blocks, 50 free inodes). The fixture sets `GELDAR_MIN_FREE_INODES=1` so other tests do not depend on the host. Revert-check (threshold comparison replaced by `-lt 0`): that test fails.
2. **Work-directory prune** is `prune-deploy-work.sh` below (keeps the live commit, the newest N, 40-hex real directories only, dry run by default). The directories are created by the untracked root-owned entrypoint, so the cleanup is a separate tool the operator runs; the entrypoint is NOT edited. A runbook step for the operator: dry run, read the list, then `--apply` (node-only-config row 14).
3. **Image retention.** `deploy/genesis/prune-deploy-images.sh` (dry run by default, `--apply`). Keeps every reference in the current manifest (`GELDAR_RELEASE_FILE`) and the previous one (`$GELDAR_STATE_DIR/previous.env`). Removes, one named `docker image rm <repo>@<digest>` at a time, only references whose repository a kept manifest names. Never `docker system prune` or `docker image prune`; another tenant's images are never named. Takes the colo-cd lock. 8 tests in `prune-deploy-images.test.ts`.

### Image-prune revert-checks

| Mutation | Failing tests |
|---|---|
| repository filter removed | `dry run lists the old Geldar references and calls no rm`, `never touches another tenant's image, and never runs a global prune` |
| keep check removed | `dry run ...`, `--apply removes only references outside the current and previous sets`, `works with no previous manifest ...` |
| previous manifest ignored | `dry run ...`, `--apply removes only references outside ...` |
| `docker image prune` instead of `image rm` | `--apply removes only ...`, `never touches another tenant's image, and never runs a global prune` |

Not verified on the node: that the image references `docker images --digests` prints match the manifest digests (a dry run on the node first), and that the previous release is in `previous.env` there.

## Deploy timing (DR-1 file list)

`deploy/common.sh`, `deploy/genesis/*`, `deploy/test/*`, `deploy/README.md` and `docs/**` are all outside the colo-images `paths:` filter, so merging starts no image build. Caution: `colo-deploy` runs the repo's `deploy/common.sh` on the next deploy, so the inode floor takes effect then; the node has about 12% inodes used, far above the floor.

## Review fixes (second commit set)

Thresholds, defaults (SUPERSEDED for the deploy volume and Docker root by round 2 below: 1 GiB there): free blocks at least `GELDAR_MIN_FREE_KB` = 10485760 KiB (10 GiB, checkout only); free inodes at least `GELDAR_MIN_FREE_INODES` = 100000. After the operator's cleanup the node was at about 12% inode use (610,800 inodes on the volume), so roughly 540,000 free: well above the floor. A deploy checkout is about 4,400 inodes. CD is live, so this lands on the very next deploy: `deploy/common.sh` is read from the repo checkout each run.

1. **Where the floor looks, and when.** `space_floors` checks blocks (`df -Pk`) and inodes (`df -Pi`) on three paths: the repo checkout (`$ROOT`, on the nvme mount), the deploy volume (`GELDAR_DEPLOY_VOLUME`, default `/var/lib/geldar-deploy`) and Docker's data root (`docker info --format '{{.DockerRootDir}}'`). A missing path, or a `docker info` that fails or prints nothing, is skipped with a clear `colo: space check skipped for ...` line, never a pass for another filesystem; a filesystem that reports no inode count skips only its inode half. `colo-up.sh` and `colo-cd.sh` set `COLO_SPACE_FLOOR_FIRST=1` before sourcing `common.sh`, so the floors run BEFORE the work-directory `mktemp -d` (which now also dies with a message naming the cause). The other scripts that call `check_prereqs` get the same floors there, once per process.
2. **Workflow step.** `.github/workflows/colo-deploy.yml`, "write the release manifest into the inbox": the same check (deploy volume = the inbox's filesystem, and Docker's data root) runs before the `mktemp`, failing with `out of INODES on ...` or `out of BLOCKS on ...`. That job has no repo checkout at that point (no `uses:` at all in the file), so `common.sh` cannot be sourced; the logic is repeated inline with the same variable names and defaults. `colo-deploy.yml` is not on the colo-images `paths:` filter (the filter lists `colo-images.yml`, not this file); `deploy/**` and `docs/**` are not either.
3. **Live commit source (review item 2).** There is no evidence in the repo of `staged/release.env`. The live commit is now `$GELDAR_STATE_DIR/release.commit` (default `/var/lib/geldar-colo/release.commit`): `colo-cd.sh` reads it before a run ("the commit the node runs") and writes it on success. It must be 40 lowercase hex (a trailing CR is tolerated), or the prune refuses everything. If `<root>/staged/release.env` also exists and its first line is the workflow's manifest comment, that commit is kept as well; a missing or malformed staged file is ignored. Node step still open: confirm on the node that `release.commit` holds the full sha (a dry run prints what would go).
4. Both prune scripts: `trap 'exit 1' HUP INT TERM` (as `colo-cd.sh` does) so a dropped ssh or Ctrl-C releases `cd.lock`. `--keep` is a whole number from 2 to 1000 (so an in-flight deploy's newest checkout is never removed, and a 20-digit value refuses instead of overflowing). SC2045 removed by feeding the loop from a here-document. `prune-deploy-images.sh` reads previous manifests with CRLF, quotes and tagged references, and lists each image row once.

### Revert-check evidence for the review fixes (mutation applied, tests run, file restored)

| Mutation | Failing tests |
|---|---|
| `COLO_SPACE_FLOOR_FIRST=1` removed from `colo-up.sh` | `the floor fires before the first write: nothing calls mktemp when the deploy volume is out of inodes` |
| deploy-volume floor removed from `space_floors` | `refuses on inodes of the deploy volume ...`, `refuses on blocks of the deploy volume ...`, `a missing deploy volume or a silent docker info is skipped ...` |
| docker-root floor removed | `refuses on inodes of the docker data root ...` |
| skip message for a silent `docker info` removed | `a missing deploy volume or a silent docker info is skipped with a message ...` |
| `sf_total -gt 0` guard removed | `a filesystem that reports no inode count (total 0) is not refused on inodes` |
| workflow: inbox floor removed | `refuses an inbox volume out of inodes ...`, `... out of blocks ...` |
| workflow: docker-root floor removed | `refuses Docker's data root out of inodes, before any mktemp` (and the control, which the broken block also fails) |
| workflow: inode comparison neutered | the inbox and docker-root inode tests |
| `--keep` bounds removed | `--keep 0`, `1`, `1001`, `00005000` refuse (four cases) |
| staged-manifest second keep removed | `also keeps the commit named by an existing staged manifest` |
| CR strip removed from `release.commit` | `tolerates a CRLF release.commit` |
| image prune: `grep -x` dropped | `a repository whose name is only a substring of a kept repository is not touched` |
| image prune: CR/quote strip dropped | `reads a previous manifest with CRLF, quotes and tagged references` |
| image prune: `sort -u` dropped | `a duplicated image row is reported once` |

Not verified locally: the two `a TERM during --apply releases the colo-cd lock` tests (one per prune script) are skipped on Windows, where a child kill is a hard terminate; Linux CI is the first real run. The `trap` mutation is therefore unproven here. The 9 `colo-up` tests of `colo-deploy.test.ts` and 5 of `colo-fetch-manifest.test.ts` fail on this desktop with and without these changes (environment); Linux CI is the verdict.

## Review fixes, round 2

1. **CI red (docker allow-list).** The floor's `docker info --format '{{.DockerRootDir}}'` is logged as `info --format {{.DockerRootDir}}`, which the `unscoped docker call` regexes (`colo-deploy.test.ts` "every docker call ...", `colo-admin.test.ts`) rejected. Both regexes now accept exactly that one form (`info( --format {{.DockerRootDir}})?`), nothing wider. That test cannot run to its loop on this desktop (the fixture PATH has no curl, so `colo-up.sh` stops at `missing command: curl`, one of the known failures), so it is NOT reproduced here; the new `colo-space-floor.test.ts` "the Docker-root lookup" runs `colo-up.sh`, takes the logged `info` calls and checks them against the same regex. Also, `colo-admin.sh` and `colo-rollback.sh` no longer call `docker info` at all (item 2), so the admin test's regex is no longer exercised by them.
2. **Thresholds (the 10 GiB bug).** /var is a ~9.1 GB volume, so a 10 GiB free-blocks floor could never pass there. Separate floors now: the checkout keeps `GELDAR_MIN_FREE_KB` (10485760, as before); the deploy volume (`GELDAR_DEPLOY_VOLUME`, default /var/lib/geldar-deploy) and Docker's data root use `GELDAR_MIN_FREE_KB_DEPLOY` (default 1048576 = 1 GiB); the inode floor is `GELDAR_MIN_FREE_INODES` (100000) on all three. The workflow inbox check uses `GELDAR_MIN_FREE_KB_DEPLOY` too (it had inherited the 10 GiB default). A refusal prints the measured and the required value. **These thresholds are to be confirmed against `df -Pk` and `df -Pi` of the deploy volume and of Docker's data root on the node before merge**: I have no node values (about 12% inode use after cleanup is the only figure). Only `colo-up.sh` and `colo-cd.sh` (`COLO_SPACE_FLOOR_FIRST=1`) check the deploy volume and Docker's root; `colo-admin.sh` and `colo-rollback.sh` keep the original checkout block floor only, so a low /var cannot stop a rollback.
3. **colo-cd.sh opt-in.** `colo-space-floor.test.ts` runs `colo-cd.sh` with a mktemp shim: a deploy volume out of inodes is refused before any mktemp, and a healthy one reaches it.
4. **Docker root in the workflow.** The runner account is unprivileged (docs/runbooks/colo-deploy.md names it so; nothing documents it as able to reach docker, and the whole deploy goes through the sudo entrypoint), so `docker info` there probably fails. It is now an explicit, labelled warning, "Docker data root NOT checked here", never a pass; the node-side scripts check Docker's root as the operator account. The inbox-volume check, which needs no docker, is the real gate in the workflow.
5. **Refs and size.** Line numbers replaced by names (`colo-cd.sh` reads `release.commit` before a run and writes it on success; row 14 of node-only-config.md names the "plan" and "deploy" steps). The floor code moved to `deploy/space-floor.sh` (sourced by `common.sh`, listed in `deploy/genesis/config-bundle.list`), so `common.sh` is 486 lines, under the 500 soft cap.
6. **TERM to the images script's pid.** Its removal loop now runs in the script's own shell (a here-document, not a pipeline), so the `exit 1` trap stops it at the next step. The signal tests are still skipped on Windows; Linux CI is their first run.

### Round 2 revert-check evidence

| Mutation | Failing tests |
|---|---|
| deploy volume uses `MIN_FREE_KB` (10 GiB) again | `2 GiB free on the deploy volume is not refused by the 10 GiB checkout floor`, `refuses below the deploy floor, printing measured and required`, `GELDAR_MIN_FREE_KB_DEPLOY overrides it` |
| `colo-rollback` gets the full floors (`prereq_space` always runs `space_floors`) | `colo-rollback.sh ignores a deploy volume out of inodes and blocks` |
| `COLO_SPACE_FLOOR_FIRST=1` removed from `colo-cd.sh` | `refuses a deploy volume out of inodes without calling mktemp, and reaches mktemp when healthy` |
| (item 1) old allow-list regex | not demonstrable here: the two allow-list tests do not reach their loop on this desktop (no curl in the fixture PATH); see item 1 |

## Inode prune (option A), carried over

## What changed

- `deploy/genesis/prune-deploy-work.sh`: POSIX sh, dry run by default, `--apply` deletes, `--keep N` (default 5).
- `deploy/colo-status.sh`: a trailing inode check, silent below 80% (`GELDAR_INODE_WARN_PCT`), path `GELDAR_INODE_PATH` (default `/var/lib/geldar-deploy`, else `/var`). Existing output is unchanged on a healthy node; a failed `df` never fails the status.
- `deploy/test/prune-deploy-work.test.ts` (20 tests) and two tests in `deploy/test/colo-deploy.test.ts`.
- `docs/runbooks/node-only-config.md` row 14 and `docs/analysis/worldops/RESUME.md`.

## Rules as built

SUPERSEDED by "Review fixes" above: the live commit now comes from `release.commit`; the staged manifest line is an optional second keep.

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

- Confirm on the node with a dry run that `release.commit` in the state directory holds the full sha (an operator step).
- OPEN: the root-owned entrypoint `/usr/local/libexec/geldar-deploy/run` is untracked and may hold a lock of its own; the script takes the channel lock and the colo-cd lock only.
