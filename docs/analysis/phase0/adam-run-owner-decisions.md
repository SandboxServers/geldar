# Adam runs: owner decisions and open points

Status: 2026-11-10 (W6-14). The items of [wave6-packets.md](wave6-packets.md) section 4 are answered provisionally in [decision 0061](../../decisions/0061-phase-0-exit-criteria-readings.md). The points below are what the run protocols still need from the owner or the orchestrator. Items O-1 and O-2 block the 32B run.

| # | Point | Why it matters | Current state in the code and docs |
|---|---|---|---|
| O-1 | **The dirty-tree conflict.** `adam select` rewrites `shards/phase0.yaml`, and `adam-run start` refuses a dirty tree. | As the code stands, select then start is refused. | Blocks the run. Options for the owner: commit the tier at the run's HEAD before start (the orchestrator commits), or change the clean-tree check to ignore the tier line. The protocols assume one of these; they do not choose. |
| O-2 | **Death rule.** Decision 0061 item 1 says a death in the 5-day window fails the run. The harness fires the `death` rule on any death in the run, when `deathFailsRun` is true. | A death after day 5, in the 24-hour run, aborts the run under the code and is only recorded under the decision's wording. | Owner to confirm which reading holds. If the window reading holds, the code changes before the run (not by ops). |
| O-3 | **Run id and volume.** Each run gets its own run id and a fresh volume from `prepare-volume`. | Confirms that no run reuses a volume or a life. | Protocols follow this. Owner to confirm. |
| O-4 | **Where the report files go.** `adam-run report` writes `run-report.json` and `run-report.md` into `.geldar/runs/<run-id>/`. The W6-12 packet named `docs/analysis/phase0/runs/<run-id>/`. | Decides what enters the repo. | Protocols keep the files in the run folder; the orchestrator decides what is committed. Owner to confirm. |
| O-5 | **Timing.** The Body kill at T0+2:00 (`--body-kill-after-minutes 120`), the planned restart at T0+12:00 (`--restart-at-hours 12`), the stop not before T0+24:00, and `--hours 24`. | These are set at dispatch and written to the manifest. | Protocols use these values. Owner or orchestrator may change them at dispatch. |
| O-6 | **The 8B gate.** No 8B run until the 32B verdict is ruled (section 1 of the 8B protocol). | Keeps the order of the two runs. | Owner to confirm the gate. |
| O-7 | **Readings.** Items 1 to 6 of section 4 of the packets (survival, useful minute, calls, latency, the bed-food-tools test, the run length and the floor). | The criteria file is the source of numbers. | Provisional. If one changes, `criteria.yaml` and the protocols change first. |
| O-8 | **Criteria keys still `null`.** `max_gap_seconds` and `model_floor_verdict` are `null` in `tools/adam-report/criteria.yaml`. | A null key gives UNKNOWN in the report, which is not a pass. | Owner fills them (decision 0061). Ops never fills a key. |
| O-9 | **The `death` and `body` windows and thresholds** in `tools/adam-run/abort-criteria.json`. | These stop a run. | Provisional, orchestrator's values. Owner may revise before the run. |

## Notes for the orchestrator (not owner decisions)

- The packet named the branch `phase0/w6-14-run-docs`. The work is on `phase0/w6-14`, as the dispatch note says.
- Decision 0061 is listed as provisional; the file exists on the wave 6 integration branch.
- The packet's W6-13 "assumed" forms are now checked against the code: `start`, `status`, `stop`, `report` and `prepare-volume` exist, and `adam restart-body` and `adam select` exist. No `resume` or `body-restart` adam-run command exists. The planned restart and the Body kill are harness flags.
