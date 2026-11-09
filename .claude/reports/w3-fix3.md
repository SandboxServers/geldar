# w3-fix3 progress
- Items 1, 4, 6a (unused import) committed together (shared files). Revert-checks: swapped order back -> aDisconnectDuringTheReplayStart... fails; emptied resetBackoff -> theBackoffIsResetOnce... fails. LifeRegistry de-finalled for the test subclass.

- Item 2 done: summary scheduled before URL check, cancelled on shutdown; test fails when scheduling is moved back after the early return.
- Item 3 done: README reworded as unverified edge; no code change (proxy source unavailable).
- Item 3 README: first edit silently did not apply, redone and committed. Item 5: @Timeout(30); with the throw threshold made unreachable the test fails with TimeoutException after ~30 s (was a hang). Item 6: import in first commit; TS blank line below.
