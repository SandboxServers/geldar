# Body benchmark results

The floor everything stands on (spec section 10, Phase 0). Rows are appended by `./geldar.ps1 bench --record` (see the [body-bench skill](../../../.claude/skills/body-bench/SKILL.md); do not append by hand), newest last, with a note on what changed since the previous run. Failures are findings: record them, don't rerun until green.

| Date | Commit | Minecraft | Paper build | Mineflayer | TPS | Scenario | Runs | Success | p50 ms | p95 ms | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|

## How to read the rows

- p50 and p95 are over **completed** actions only, in milliseconds of wall time.
- Receipts are not built yet (wave 4): the `chest` scenario does not check one.
- Swimming, combat and cancellation scenarios are outside Phase 0.
- Pass bar (owner ruling): 100% of runs at 20 TPS before wave 4. The 10 and 5 TPS rows are findings only.
- Decision [0038](../../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md), in plain words: at 10 and 5 TPS the benchmark client is not slowed, only the server is, so those rows measure an unslowed client against a slowed server. World ticks (`world_ticks`) have a resolution of 20 ticks.
- Each recorded run's JSON is in `bench-runs/<name>.json`, named in the row's note (the directory appears with the first recorded run).
