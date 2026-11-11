# FX-DEPLOY-TIMEOUT

Fix for three `deploy/test/colo-deploy.test.ts` tests that exceed vitest's 5000 ms default on the Windows desktop
when the full workspace suite runs. Each test starts several `sh` processes (Git for Windows' MSYS `sh`) through
`colo-up.sh` with fake `docker` and `stat` shims. Each MSYS process start is slow on Windows, and slower under load.

## Root cause

- A `colo-up.sh` run starts roughly 50 processes (estimated by reading the script, not measured): the script's
  `sh`, `dirname`, `mktemp`, `df`, `awk`, `grep` (several), `sed`, `curl`, `sha256sum`, plus the docker shim (one
  `sh` per call, about six calls) and the stat shim (one `sh`, plus `basename` and `cat`, for each of four secret
  files).
- The tests use `spawnSync`, so vitest's timer only fires after the synchronous call returns. The reported durations
  (8-12 s for timed-out tests) are the real run time, not the 5 s limit.
- Alone, the file runs in 27-30 s with its slowest test at about 3 s. In the full suite (about 31 workers on a
  32-core machine) the same tests take 8-12 s.

## Change

1. `STAT_SHIM` uses shell builtins only (`${3##*/}` and `read -r`). It no longer forks `basename` and `cat` for each
   secret file. The stat shim only answers the mode, so its output is unchanged and the assertions are unchanged.
2. `SPAWN_TEST_TIMEOUT_MS = 30_000`, applied to the file with `vi.setConfig({ testTimeout })`, with a comment giving
   the reason. No `retry`, no `.skip`, and no assertion changed.

Not changed: `colo-up.sh` and the other deploy scripts. Their process count is the real cost, but changing them is a
product change, so it is left for a separate packet.

## Run tables

All times are vitest's `Duration` line, except where marked as wall time. "Max deploy" is the slowest test in the file.

### Isolated: `pnpm vitest run deploy/test --reporter=verbose`

| Run | Before: result | Before: Duration | Before: max deploy | After: result | After: Duration | After: max deploy |
|---|---|---|---|---|---|---|
| 1 | 21/21 | 37.66 s | 3947 ms | 21/21 | 26.70 s | 2934 ms |
| 2 | 21/21 | 29.82 s | 2987 ms | 21/21 | 27.86 s | 2760 ms |
| 3 | 21/21 | 30.76 s | 3580 ms | 21/21 | 29.12 s | 2939 ms |

Wall time (including pnpm start) before: 39 s, 31 s, 31 s. After: 27 s, 29 s, 30 s.

The "before" isolated runs used the original file. Isolated runs with only the stat shim change (default timeout)
failed two of three runs (one test at 5548 ms, and a 5000 ms timeout in the other run), with the other long-lived
node processes on the machine still running. The timeout is needed even in isolation on this machine.

### Full suite: `pnpm test --reporter=verbose`

| Run | Before: deploy failures | Before: Duration | Before: max deploy | After: deploy failures | After: Duration | After: max deploy |
|---|---|---|---|---|---|---|
| 1 | 3 (deploys by pull, mode 600, mode 400) | 56.37 s | 8592 ms | 0 | 56.23 s | 8521 ms |
| 2 | 6 (dry run, deploys by pull, mode 600, mode 400, publishes 25565, docker scope) | 66.07 s | 8967 ms | 0 | 62.52 s | 11873 ms |
| 3 | 4 (dry run, deploys by pull, mode 600, docker scope) | 69.63 s | 10954 ms | 0 | 51.86 s | 8809 ms |

Full-suite totals after: `Test Files 398 passed | 17 skipped`, `Tests 4436 passed | 78 skipped`, in all three runs.
Before: `Test Files 1 failed | 397 passed`, `Tests 3, 6, 4 failed`. Wall time of run 2 before was 67 s (the loop
printed only that one wall time).

The after-run failures are 0 in all three runs. The slowest after-run test (11.9 s) is still well under the 30 s
bound, so the bound leaves about 2.5x headroom over the worst observed run.

## Justification for 30 s

The test runs real process spawning on Windows, under full-suite load. The observed slowest run was 12 s; isolated
runs are 3 s. 30 s is about 2.5x the worst observed run and 10x the isolated run. It is a bound on legitimate slow
work. A hang still fails, because `spawnSync` returns and the assertions run after it. This is not a retry, a skip
or a weakened assertion.

## Verification

- The 1 ms probe: with `SPAWN_TEST_TIMEOUT_MS = 1`, `-t "free disk"` failed with `Test timed out in 1ms`, which shows
  the file-level `vi.setConfig` takes effect. The value was restored to 30_000 before the measured runs.
- Before-state: the unchanged file fails the full suite in 3 of 3 runs, which is the failing state the change fixes.
- `pnpm typecheck` exit 0. `pnpm check:repo` ok. `biome ci` on the changed test file: no findings.

## Limits and follow-ups

- Process cost stays in `colo-up.sh` and the other deploy scripts (about 50 starts per deploy). A follow-up packet
  could replace `grep`/`awk`/`sed` in `load_release` and `check_merged_config` with shell `case` and builtins.
- The stat-shim change alone is not separately measured: run-to-run noise on this machine (14 long-lived node
  processes from before the session, not touched) is larger than the saving of about eight forks per run.
- Linux CI was not run from this worktree; the change is expected to be neutral there.
