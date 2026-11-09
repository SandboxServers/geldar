# w4flaky

Target: `velocity-identity:test FAILED` once in a full check, green on rerun.

## Cause
`RegistryClientTest` waited on `gate.admits(...)` and then asserted state set by the
`watching` hook (`theWatchLoopBeginsAReplayAndSyncsFromTheWatch`: `watching == 1`;
`theBackoffIsResetOnceTheWatchHasStarted`: `backoffMs == 500`). The gate opens inside
`bucket.watchAll` (endOfData -> markSynced), but the hook runs after `watchAll` returns,
so the test thread could see the open gate before the hook ran. Test-side race; the
production order is fine.

## Fix
Both tests now count down a `CountDownLatch` from the hook and await it before asserting
(the latch also publishes the non-volatile `backoffMs`).

## Evidence
- Revert-check: with a forced 100 ms delay in `FakeBucket.watchAll` after `endOfData`,
  the old tests fail both (RegistryClientTest lines 89 and 151). With the fix and the same
  delay: BUILD SUCCESSFUL. Delay removed afterwards.
- 15 runs of `:velocity-identity:test --rerun-tasks --no-daemon`: 15 pass, 0 fail (the race
  is rare without the delay, so the loop alone could not show it).
- Clean GRADLE_USER_HOME `./gradlew build`: BUILD SUCCESSFUL (dependency verification on).
- Vitest in threshold/mcp-mock and the transient plugin Gradle failure: not investigated, no
  evidence they are related.
