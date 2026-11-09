# w3-fix3 progress
- Items 1, 4, 6a (unused import) committed together (shared files). Revert-checks: swapped order back -> aDisconnectDuringTheReplayStart... fails; emptied resetBackoff -> theBackoffIsResetOnce... fails. LifeRegistry de-finalled for the test subclass.

- Item 2 done: summary scheduled before URL check, cancelled on shutdown; test fails when scheduling is moved back after the early return.
- Item 3 done: README reworded as unverified edge; no code change (proxy source unavailable).
