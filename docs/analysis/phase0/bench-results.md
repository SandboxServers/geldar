# Body benchmark results

The floor everything stands on (spec section 10, Phase 0). Rows are appended by `./geldar.ps1 bench --record` (see the [body-bench skill](../../../.claude/skills/body-bench/SKILL.md); do not append by hand), newest last, with a note on what changed since the previous run. Failures are findings: record them, don't rerun until green.

| Date | Commit | Minecraft | Paper build | Mineflayer | TPS | Scenario | Runs | Success | p50 ms | p95 ms | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-09 | 5aa8a83 | 26.1.2 | 74 | 4.39.0 | 20 | wood-to-stone-tools | 10 | 10/10 (100%) | 400 | 23082 | wave 2 first recorded run, 20 TPS, shared desktop RTX 4090 host; actions 80/80; bench-runs/20261109T130949Z-5aa8a83.json |
| 2026-11-09 | 5aa8a83 | 26.1.2 | 74 | 4.39.0 | 20 | food | 10 | 10/10 (100%) | 1620 | 2629 | wave 2 first recorded run, 20 TPS, shared desktop RTX 4090 host; actions 20/20; bench-runs/20261109T130949Z-5aa8a83.json |
| 2026-11-09 | 5aa8a83 | 26.1.2 | 74 | 4.39.0 | 20 | shelter | 10 | 10/10 (100%) | 561 | 1062 | wave 2 first recorded run, 20 TPS, shared desktop RTX 4090 host; actions 100/100; bench-runs/20261109T130949Z-5aa8a83.json |
| 2026-11-09 | 5aa8a83 | 26.1.2 | 74 | 4.39.0 | 20 | bed | 10 | 10/10 (100%) | 310 | 1106 | wave 2 first recorded run, 20 TPS, shared desktop RTX 4090 host; actions 30/30; bench-runs/20261109T130949Z-5aa8a83.json |
| 2026-11-09 | 5aa8a83 | 26.1.2 | 74 | 4.39.0 | 20 | chest | 10 | 10/10 (100%) | 20 | 447 | wave 2 first recorded run, 20 TPS, shared desktop RTX 4090 host; actions 30/30; bench-runs/20261109T130949Z-5aa8a83.json |
| 2026-11-09 | 5aa8a83 | 26.1.2 | 74 | 4.39.0 | 20 | blocked-path | 10 | 10/10 (100%) | 6253 | 6380 | wave 2 first recorded run, 20 TPS, shared desktop RTX 4090 host; actions 5/10; bench-runs/20261109T130949Z-5aa8a83.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 10 | wood-to-stone-tools | 5 | 5/5 (100%) | 372 | 19149 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 40/40; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 5 | wood-to-stone-tools | 5 | 5/5 (100%) | 375 | 24958 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 40/40; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 10 | food | 5 | 5/5 (100%) | 1724 | 3010 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 10/10; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 5 | food | 5 | 5/5 (100%) | 1814 | 3969 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 10/10; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 10 | shelter | 5 | 5/5 (100%) | 557 | 1094 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 50/50; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 5 | shelter | 5 | 5/5 (100%) | 562 | 1097 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 50/50; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 10 | bed | 5 | 5/5 (100%) | 312 | 1133 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 15/15; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 5 | bed | 5 | 5/5 (100%) | 312 | 1227 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 15/15; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 10 | chest | 5 | 5/5 (100%) | 14 | 410 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 15/15; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 5 | chest | 5 | 5/5 (100%) | 10 | 438 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 15/15; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 10 | blocked-path | 5 | 5/5 (100%) | 6214 | 6288 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 3/5; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 8934be9 | 26.1.2 | 74 | 4.39.0 | 5 | blocked-path | 5 | 5/5 (100%) | 6267 | 6439 | wave 2 first recorded run, 10 and 5 TPS findings rows, unslowed client (decision 0038), shared desktop RTX 4090 host; actions 3/5; bench-runs/20261109T133512Z-8934be9.json |
| 2026-11-09 | 93d6640 | 26.1.2 | 74 | 4.39.0 | 20 | wood-to-stone-tools | 10 | 10/10 (100%) | 500 | 22665 | wave 4 gate run, 20 TPS, Body reflexes and executor merged, shared desktop RTX 4090 host; actions 80/80; bench-runs/20261109T181829Z-93d6640.json |
| 2026-11-09 | 93d6640 | 26.1.2 | 74 | 4.39.0 | 20 | food | 10 | 10/10 (100%) | 1643 | 2670 | wave 4 gate run, 20 TPS, Body reflexes and executor merged, shared desktop RTX 4090 host; actions 20/20; bench-runs/20261109T181829Z-93d6640.json |
| 2026-11-09 | 93d6640 | 26.1.2 | 74 | 4.39.0 | 20 | shelter | 10 | 10/10 (100%) | 561 | 1061 | wave 4 gate run, 20 TPS, Body reflexes and executor merged, shared desktop RTX 4090 host; actions 100/100; bench-runs/20261109T181829Z-93d6640.json |
| 2026-11-09 | 93d6640 | 26.1.2 | 74 | 4.39.0 | 20 | bed | 10 | 10/10 (100%) | 312 | 1106 | wave 4 gate run, 20 TPS, Body reflexes and executor merged, shared desktop RTX 4090 host; actions 30/30; bench-runs/20261109T181829Z-93d6640.json |
| 2026-11-09 | 93d6640 | 26.1.2 | 74 | 4.39.0 | 20 | chest | 10 | 10/10 (100%) | 9 | 454 | wave 4 gate run, 20 TPS, Body reflexes and executor merged, shared desktop RTX 4090 host; actions 30/30; bench-runs/20261109T181829Z-93d6640.json |
| 2026-11-09 | 93d6640 | 26.1.2 | 74 | 4.39.0 | 20 | blocked-path | 10 | 10/10 (100%) | 6247 | 6343 | wave 4 gate run, 20 TPS, Body reflexes and executor merged, shared desktop RTX 4090 host; actions 5/10; bench-runs/20261109T181829Z-93d6640.json |

## How to read the rows

- p50 and p95 are over **completed** actions only, in milliseconds of wall time.
- Receipts are not built yet (wave 4): the `chest` scenario does not check one.
- Swimming, combat and cancellation scenarios are outside Phase 0.
- Pass bar (owner ruling): 100% of runs at 20 TPS before wave 4. The 10 and 5 TPS rows are findings only.
- Decision [0038](../../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md), in plain words: at 10 and 5 TPS the benchmark client is not slowed, only the server is, so those rows measure an unslowed client against a slowed server. World ticks (`world_ticks`) have a resolution of 20 ticks.
- Each recorded run's JSON is in `bench-runs/<name>.json`, named in the row's note (the directory appears with the first recorded run).
