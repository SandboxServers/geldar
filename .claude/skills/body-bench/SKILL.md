---
name: body-bench
description: Run Geldar's scripted body benchmark (spec section 10, Phase 0) against a running shard - wood to stone tools, food, shelter, bed, chest deposit and withdraw, blocked-path recovery, at 20, 10 and 5 TPS - and record action success rates and p50/p95 latency. Use when asked to "run the body benchmark", "bench the body", "what's the action success rate", or after any change to golem/ actions or reflexes.
---

# Body benchmark

The spec runs this before any model is attached: it is "the floor everything stands on". It is also Geldar's equivalent of a lab: scripted test agents with fixed goals, no model, repeatable. Usable once packet P0-10 has added the harness to `golem/`.

## Before you run

1. The shard is up and every health row passes (`run-shard` skill).
2. Nothing else is connected to the shard: no Adam run, no second benchmark.
3. The tree is clean and committed, so the result can name the commit it measured.

## Run

```powershell
./geldar.ps1 bench                         # every scenario at 20, 10 and 5 TPS
./geldar.ps1 bench --scenario chest --tps 20 --runs 10
```

The harness sets the tick rate itself through RCON (`/tick rate <n>`), resets the test area between runs, and restores 20 TPS when it finishes, including on failure. It writes one JSON file per run set to `bench-results/` (gitignored).

## Scenarios (spec section 10)

| Scenario | Passes when |
|---|---|
| `wood-to-stone-tools` | starting empty, the bot ends holding a stone pickaxe |
| `food` | hunger rises after the bot obtains and eats food |
| `shelter` | the bot is enclosed (no open side) before the timeout |
| `bed` | the bot sleeps in a bed it crafted and placed |
| `chest` | deposit then withdraw leaves the inventory and the chest exactly as expected, with a receipt for each |
| `blocked-path` | with its path walled off, the bot reaches the goal by another route or abandons with `blocked` |

## Record the numbers

Each result row names: date, commit, Paper build, Minecraft version, Mineflayer version, TPS, scenario, runs, success rate, p50 and p95 action latency. Append the rows to the table in `docs/analysis/phase0/bench-results.md` and commit them with a one-line note on what changed since the last run. Report failures as numbers, not as reasons to rerun until it passes: a flaky scenario is a finding.
