---
name: body-bench
description: Run Geldar's scripted body benchmark (spec section 10, Phase 0) against a running shard - wood to stone tools, food, shelter, bed, chest deposit and withdraw, blocked-path recovery, at 20, 10 and 5 TPS - and record action success rates and p50/p95 latency. Use when asked to "run the body benchmark", "bench the body", "what's the action success rate", or after any change to golem/ actions or reflexes.
---

# Body benchmark

The spec runs this before any model is attached: it is "the floor everything stands on". It is also Geldar's equivalent of a lab: scripted test agents with fixed goals, no model, repeatable. The harness lives in `golem/src/bench/`; the CLI is `golem/src/bench/cli.ts`.

## Before you run

1. The shard is up and every health row passes (`run-shard` skill).
2. Nothing else is connected to the shard: no Adam run, no second benchmark, no live test run and no other agent.
3. The tree is clean and committed, so the result can name the commit it measured (`--record` refuses a dirty tree unless you pass `--allow-dirty`, which adds a `+dirty` suffix to the commit).

## Run

```powershell
./geldar.ps1 bench                         # every scenario at 20, 10 and 5 TPS
./geldar.ps1 bench --scenario chest --tps 20 --runs 10
```

The harness sets the tick rate itself through RCON (`/tick rate <n>`), resets the test area between runs, and restores 20 TPS when it finishes, including on failure. It writes one JSON file per run set to `<repo root>/bench-results/YYYYMMDDTHHmmssZ-<commit>.json` (gitignored).

## Flags

| Flag | Meaning |
|---|---|
| `--scenario <name\|all>` | one scenario, or `all` (default; hidden scenarios are not part of `all`) |
| `--tps <n>` | repeatable, integer 1 to 20; default 20, 10 and 5 |
| `--runs <n>` | runs per cell, 1 to 100; default 5 (the recorded run uses 10) |
| `--max-minutes <n>` | stop starting new runs after n minutes (1 or more), write what exists, mark it truncated |
| `--record` | copy the JSON to `docs/analysis/phase0/bench-runs/` and append rows to `bench-results.md`; do not append rows by hand |
| `--allow-dirty` | let `--record` run on a dirty tree |
| `--note <text>` | note on the rows; must match `^[A-Za-z0-9 ,.:_()/+-]{0,200}$` |
| `--dry-run` | parse and print the resolved options as one JSON line; no RCON |
| `--list` | print the scenario names |
| `--restore` | restore 20 TPS and the world after a killed run |

Exit codes: 0 on a finished run (even when a scenario failed: a failed scenario is a finding, and `bench` is not a CI gate), 1 for a harness error (shard not up, another player online), 2 for a usage error. After a killed run, run `./geldar.ps1 bench --restore`.

## Gate and the TPS rows

The run prints one gate line over the 20 TPS cells: `GATE: PASS`, `GATE: FAIL (<scenarios>)` or `GATE: INCOMPLETE (truncated)` (a cell played fewer runs than requested), or `GATE: n/a (no 20 TPS cell ran)`. The pass bar (owner ruling) is 100% of runs at 20 TPS before wave 4. The 10 and 5 TPS rows are findings only. Decision 0038: those rows measure an unslowed client against a slowed server, and `world_ticks` has a 20-tick resolution, so read them with that in mind.

## Scenarios (spec section 10)

| Scenario | Passes when |
|---|---|
| `wood-to-stone-tools` | starting empty, the bot ends holding a stone pickaxe |
| `food` | hunger rises after the bot obtains and eats food |
| `shelter` | the bot is enclosed (no open side) before the timeout |
| `bed` | the bot sleeps in a bed it crafted and placed |
| `chest` | deposit then withdraw leaves the inventory and the chest exactly as expected; note: `receipts: not built yet (wave 4)` |
| `blocked-path` | with its path walled off, the bot reaches the goal by another route or abandons with `blocked` |

Two hidden scenarios exist, `goto-smoke` and `bed-clear` (a control for `bed` with the bed away from the crafting table). They are never part of `all` and never recorded.

## Record the numbers

Each result row names: date, commit, Paper build, Minecraft version, Mineflayer version, TPS, scenario, runs, success rate, p50 and p95 action latency. `--record` appends the rows to the table in `docs/analysis/phase0/bench-results.md` and copies the JSON to `docs/analysis/phase0/bench-runs/`; commit both with a one-line note on what changed since the last run. Report failures as numbers, not as reasons to rerun until it passes: a flaky scenario is a finding.
