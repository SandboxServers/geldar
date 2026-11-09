# w4f progress

Items 1 to 7 done, one commit each on phase0/w4-fix-final.

1. Live combat test: every case heals to full and verifies it (healToFull); the retreat case heals again in finally, restores the gamerule, asserts 0 < health <= 6, and failure messages carry health, position and gamerule.
2. craft-table-window.ts backticks restored; no other tab characters in golem, tools or eventsink sources.
3. executor.ts: action 0 also waits for a busy reflex. waitForReflexIdle now returns whether it timed out, so a stuck reflex is given up on once per plan (otherwise the existing timeout tests doubled to 20 s). New test in executor-reflex-idle.test.ts; revert-check (index > 0 back) fails it.
4. blocked-path.ts: no abandoned mark when ctx.signal.aborted; new blockedAbandonedIds probe. New test for the aborted signal (fails without the guard); the no-intent test now asserts no id recorded (fails without the intentId guard).
5. projection.test.ts: late generation-1 interrupt while running at generation 2; fails without the generation clause (revert-checked). The same late event added to projection.it.test.ts (not run).
6. original_bytes renamed original_event_bytes (code and test only; no contract or projection use); dropped doc reworded; intent oversize/invalid test (revert-checked via the durable flag); decision 0043 item 2 and run-shard skill updated.
7. Blank lines added. NatsKeyValueWatchSubscription import is already gone from the source.
