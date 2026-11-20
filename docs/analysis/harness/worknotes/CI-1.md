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

- New cases: Maven miss from CI run 44701279418 retries; Maven miss plus verification failure does not retry;
  `Could not find method ...` does not retry; `Could not find property ...` does not retry; `error: cannot find symbol`
  does not retry.
- New structural test: the early-exit and transient-retry grep lines are identical across the three blocks (log path
  normalised).
- The fixture `Maven miss from CI run 44701279418` is lifted verbatim from the failing plugin job of that run (supplied by the orchestrator; runner timestamps and the `Searched in` URL lines dropped). Six `Did not resolve ... lock state` lines plus `Could not find io.nats:jnats:2.26.4.` and `Could not find io.opentelemetry:opentelemetry-api:1.67.0.` (trailing period): the regex matches the trailing-period form.
- Test discovery: this machine has Git for Windows at `%LOCALAPPDATA%\Programs\Git`, not at
  `C:\Program Files\Git`, so the bash-backed cases skipped. The candidate list now includes
  `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`.

## Revert-checks (run for real; each mutation touched only ci.yml, restored from a backup afterwards)

Before the fix, the new Maven-miss case failed in all three blocks (`gradle build (neoforge)`,
`gradle build (neoforge-ledger)`, `gradle build`, case "retries once: Maven miss from CI run 44701279418").

- M1, `lock state` back in the early exit (all three blocks): 3 failed. "retries once: Gradle-shaped Maven miss
 " in each block.
- M2, `Could not find` alternative removed (all three blocks): 3 failed. Same case in each block.
- M3, loosened to plain `Could not find ` (all three blocks): 6 failed. "does not retry: script error: Could not find
  method" and "does not retry: script error: Could not find property" in each block.
- M4, `Dependency verification failed` removed from the early exit (all three blocks): 6 failed. "does not retry: Maven
  miss plus dependency verification failure" and "does not retry: verification failure plus Could not GET" in each
  block.
- M5, the early-exit line of the plugin block only, reverted to `Dependency verification failed|lock state`: 2 failed.
  "retries once: Maven miss from CI run 44701279418" in the plugin block, and "have identical early-exit and
  transient-retry grep lines".

## ops

Nothing to run. The next real Maven flake is the live proof: a `Could not find` miss should now show a
`::warning::network error in the ... build; retrying once` line and a second Gradle run.

## Re-run on the verbatim fixture

With the fixture lifted from run 44701279418, M1 (lock state back, 3 blocks): 3 failed, M2 (alternative removed): 3 failed, M3 (plain Could not find): 6 failed (method and property cases in each block), M4 (verification exit removed): 6 failed, M5 (plugin block only reverted): 2 failed (the Maven miss case in the plugin block and the identical-grep-lines test). Each mutation touched only ci.yml and was restored.
