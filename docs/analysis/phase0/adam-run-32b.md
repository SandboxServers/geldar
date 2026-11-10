# Adam run protocol: Qwen3 32B (strong), life `ag_adam_01`

Status: draft for owner review, 2026-11-10. Written for the `ops` agent (haiku, no code edits). Read [adam-run-ops-checklist.md](adam-run-ops-checklist.md) first: its preconditions P1 to P13, its rules (section 0), its abort rules AB-1 to AB-5 (section 5), and its reading of the report (section 7) apply to this run. This file adds only what is specific to the 32B run.

**Readings relied on (provisional).** Decision 0061 (items 1 to 6) and the owner's answers in [wave6-packets.md](wave6-packets.md) section 4. The owner may revise any of them. If a reading changes, the criteria file changes before this run, and this protocol is updated first. Relied on here:

- Item 1: any death in the 5-day window fails the run.
- Item 4: thought latency is p95 under 15 s, with p50 and max reported. The 25 s deadline is the hard limit.
- Item 5: one continuous run of at least 24 real hours, containing the 5-day segment, with one planned restart and one Body restart mid-intent.
- Item 6: nothing below 8B is run.

**The 32B run is the first run.** Nothing in this protocol depends on the 8B run. The 8B run waits for the 32B verdict (see the rule at the end).

## Assumptions about W6-13 (not merged when this was written)

| Assumed form | Card says | Used for |
|---|---|---|
| `./geldar.ps1 adam-run start 32b --run-id <run-id>` | `adam-run start` (the card does not name the argument) | Starts the run and writes the manifest. |
| `./geldar.ps1 adam-run status` | `status` (per W6-13) | One line a minute in `status.log`. |
| `./geldar.ps1 adam-run stop` | `stop` (per W6-13) | Safe stop, Body last. |
| `./geldar.ps1 adam-run report` | `report` (per W6-13, calls W6-12) | The two report files. |
| `./geldar.ps1 adam-run body-restart` | **not on the card** | The mid-intent Body restart (section 3). |
| `./geldar.ps1 adam-run resume --run-id <run-id>` | **not on the card** | Restarting the stack after the planned restart (section 3). |
| `.geldar/adam/<run-id>/status.log` | the card names `status.log` but not its folder | Where ops reads it. |

If `body-restart` or `resume` is missing from the W6-13 help (precondition P13), this run does not start. Ops stops and asks the orchestrator.

## 1. Preconditions

Run every precondition in [the checklist, section 1](adam-run-ops-checklist.md#1-preconditions-tick-each-one-a-failed-tick-stops-the-run): P1 to P13, with the life `ag_adam_01`. Then:

- **Fresh volume.** This is the first run on this world, so the Paper world is fresh. Confirm the Paper world volume is empty of a previous run: `docker volume ls --format "{{.Name}}" --filter name=geldar-phase0_paper-data` lists it, and the whitelist is empty before step 2. If an old world is present and not from a run of this protocol, stop and ask the orchestrator. The 8B protocol has the full fresh-volume procedure; the 32B run does not recreate a volume.
- **Seed.** `shards/phase0.yaml` has the shard seed (`seed`, equal to `SEED` in `compose/phase0.yml`, 8675309). Record it in `ops-log.md`. The 8B run must use the same seed.

## 2. Steps, in order

1. **Select the life.** `./geldar.ps1 adam select --model strong`. Expected: `selected: life ag_adam_01 (strong)`. Then `git status --short` prints only `shards/phase0.yaml`.
2. **Start the shard (if it is not up).** `./geldar.ps1 shard up phase0`. Then check P6 again.
3. **Whitelist the life.** `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T paper rcon-cli whitelist add ag_adam_01`, then `... rcon-cli whitelist list` shows `ag_adam_01`.
4. **Start the run.** `./geldar.ps1 adam-run start 32b --run-id <run-id>` (per W6-13, assumed form). Choose the run id before the start and write it in `ops-log.md`. Record **T0**, the time the command returns. The harness writes `manifest.json` and starts the stack through the `adam up` path.
5. **Confirm the start.** `./geldar.ps1 adam status` shows `body`, `animus` and `lantern-local` running. `./geldar.ps1 adam-run status` appends its first line.
6. **Checks.** Run the checks of section 4 of the checklist at each interval in the timeline. Record each in `ops-log.md`.
7. **Body restart mid-intent, at the first check at or after T0+2:00 where an intent is running.**
   a. Confirm an intent is running: C6 in the checklist shows `running` at least `1`. Note the intent id: `SELECT intent_id, body_generation FROM intents WHERE life_id='ag_adam_01' AND state='running';`.
   b. Read the Body's pid: `./geldar.ps1 adam status` (the line reads `body: running (pid <n>)`).
   c. Kill the Body process only: `Stop-Process -Id <n>`. Do not stop `animus` or `lantern-local`. Do not run `adam down`.
   d. Restart the Body only: `./geldar.ps1 adam-run body-restart` (assumed; see the table). Wait up to 2 minutes for `adam status` to show `body: running (pid <new n>)` with a new pid.
   e. **Checks that it resumed:** the same intent id is still `running` in the SQL above, and its `body_generation` is one higher than before (the query in 7a). The intent is not reset to `accepted`. The next `status.log` line shows the Body's new generation. Record all of this in `ops-log.md`.
   f. If it did not resume (the intent is `failed`, or the generation did not change): that is a finding. Record it. It is not an abort rule. Tell the orchestrator at once and do not start another restart.
8. **Planned restart of the whole stack at T0+12:00 exactly.**
   a. `./geldar.ps1 adam-run stop` (the harness safe stop; Body last).
   b. `./geldar.ps1 shard down phase0` (keeps volumes; per the shard usage).
   c. `./geldar.ps1 shard up phase0`, then `./geldar.ps1 shard status phase0` (all healthy).
   d. `./geldar.ps1 adam-run resume --run-id <run-id>` (assumed; see the table). It must resume the same life and the same run id, and the manifest must record the restart time.
   e. **Checks that it resumed:** `adam status` shows the three processes running. The running intent, if any, is still `running` or was `completed` during the restart; no intent is `accepted` again from scratch. Record it.
   f. Whitelist again only if `rcon-cli whitelist list` no longer lists `ag_adam_01` (the volume is kept, so it normally does).
9. **Stop at the end.** Not before T0+24:00. Then `./geldar.ps1 adam-run stop`. Then `./geldar.ps1 adam status` (all `stopped`).
10. **Restore the shard file.** `git checkout -- shards/phase0.yaml`, then `git status --short` prints nothing.
11. **Report.** `./geldar.ps1 adam-run report`. Two files are written under `docs/analysis/phase0/runs/<run-id>/`: `run-report.json` and `run-report.md` (the W6-12 names). Read the verdict of each criterion (checklist section 7).
12. **Back up and record.** Copy `manifest.json` and `status.log` and `ops-log.md` to the backup folder. Export the rows (checklist section 6). Do not copy any log into the repo.

## 3. Timeline for this run

| Time (from T0) | Event | Check |
|---|---|---|
| T0 to about T0+100 min | The 5-day segment (120,000 ticks) | AB-1 and AB-4 watched at every check |
| T0+0:15 to T0+2:00 | Checks every 15 minutes | Checklist section 4 |
| T0+2:00 or after | Body restart mid-intent (step 7) | Resume checks in step 7e |
| T0+3:00 onward | Hourly checks | Checklist section 4 |
| T0+12:00 exactly | Planned restart (step 8) | Resume checks in step 8e |
| T0+24:00 or after | Stop (step 9) | `adam status` all stopped |

## 4. Aborts

Section 5 of the checklist, rules AB-1 to AB-5, with the abort procedure (steps 1 to 7 there). Do not retry. Report to the orchestrator.

## 5. What this run gives the owner

- A verdict per criterion for `ag_adam_01` in `run-report.md`: survival, continuity (24 h), intents (three completed with no model call during the intent), receipts, checkpoint resume, latency p50, p95 and max, calls per useful minute (thoughts and reflections reported separately), and the outcome histogram.
- A **candidate** for the model floor. A model passes when its verdict under the criteria file's floor key is PASS. If `qwen3:32b` passes, it is a floor candidate, and the 8B run decides whether a smaller floor exists (8B is the only smaller tier in Phase 0, decision 0061 item 6).

## 6. The rule for the 8B run

- **32B passes:** the 8B run goes ahead (its own protocol, [adam-run-8b.md](adam-run-8b.md)).
- **32B fails** (a FAIL on a criterion that decides the verdict, or an abort): by the wave 6 gate and spec section 10 (exit item 6), no 8B run starts until the owner rules. Ops writes this in `ops-log.md` and tells the orchestrator.
- A 32B result with an UNKNOWN is not a fail. It is a report gap. The owner decides (checklist section 7).
