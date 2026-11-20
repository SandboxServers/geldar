# CI-1: retry Maven "Could not find" resolution misses in the Gradle builds

## What changed

Three retry blocks in `.github/workflows/ci.yml` (steps `gradle build` in job `plugin`, `gradle build (neoforge)` and
`gradle build (neoforge-ledger)` in job `neoforge`). Each block now has:

1. Early exit: `grep -Eqi 'Dependency verification failed'` (was `'Dependency verification failed|lock state'`).
2. Transient regex: adds `Could not find [A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+` (Gradle's
   `Could not find group:artifact:version.`). Every existing alternative is kept.

Unchanged: `set -o pipefail`, `for attempt in 1 2`, `sleep 30`, the warning text, the exit codes, and the comment above
the neoforge job (it still says "network error"; a remote Maven miss is a network-side resolution failure, so the
comment was left as it was).

## Why `lock state` is no longer an early exit

Gradle prints "Did not resolve '...' which is part of the dependency lock state" in every failed remote resolution,
including a plain transient miss. As an early exit it turned every such miss into a non-retried failure, which is the
4-in-40 failure pattern in the card. A genuine lockfile violation ("Resolved '...' which is not part of the dependency
lock state") has no transient phrase, so it still fails without a retry through the existing regex test. Checksum and
verification failures stay non-retryable through `Dependency verification failed`.

## Tests

`tools/repo-checks/src/ci-neoforge-retry.test.ts` runs the real run-blocks against a fake `./gradlew`, for all three
step names.

- New cases: Gradle-shaped Maven miss (synthetic text) retries; Maven miss plus verification failure does not retry;
  `Could not find method ...` does not retry; `Could not find property ...` does not retry; `error: cannot find symbol`
  does not retry.
- New structural test: the early-exit and transient-retry grep lines are identical across the three blocks (log path
  normalised).
- The fixture "Gradle-shaped Maven miss (synthetic text)" is **synthetic**. The real CI log lines were not available to
  the coder. The orchestrator should replace it with verbatim lines from one of the four failing runs when they can be
  pulled. Its shape follows the card's description of Gradle's output.
- Test discovery: this machine has Git for Windows at `%LOCALAPPDATA%\Programs\Git`, not at
  `C:\Program Files\Git`, so the bash-backed cases skipped. The candidate list now includes
  `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`.

## Revert-checks (run for real; each mutation touched only ci.yml, restored from a backup afterwards)

Before the fix, the new Maven-miss case failed in all three blocks (`gradle build (neoforge)`,
`gradle build (neoforge-ledger)`, `gradle build`, case "retries once: Gradle-shaped Maven miss (synthetic text)").

- M1, `lock state` back in the early exit (all three blocks): 3 failed. "retries once: Gradle-shaped Maven miss
  (synthetic text)" in each block.
- M2, `Could not find` alternative removed (all three blocks): 3 failed. Same case in each block.
- M3, loosened to plain `Could not find ` (all three blocks): 6 failed. "does not retry: script error: Could not find
  method" and "does not retry: script error: Could not find property" in each block.
- M4, `Dependency verification failed` removed from the early exit (all three blocks): 6 failed. "does not retry: Maven
  miss plus dependency verification failure" and "does not retry: verification failure plus Could not GET" in each
  block.
- M5, the early-exit line of the plugin block only, reverted to `Dependency verification failed|lock state`: 2 failed.
  "retries once: Gradle-shaped Maven miss (synthetic text)" in the plugin block, and "have identical early-exit and
  transient-retry grep lines".

## ops

Nothing to run. The next real Maven flake is the live proof: a `Could not find` miss should now show a
`::warning::network error in the ... build; retrying once` line and a second Gradle run.
