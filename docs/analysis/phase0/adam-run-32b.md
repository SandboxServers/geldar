# Adam run protocol: Qwen3 32B (strong), exit run life `ag_adam_03`

Deferred by [decision 0066](../../decisions/0066-phase0-closed-as-proof-of-life.md): this run is not performed in Phase 0. Its harness paths are unexercised.

Status: draft for owner review, 2026-11-10 (W6-14). Read [adam-run-ops-checklist.md](adam-run-ops-checklist.md) first: its preconditions P1 to P13, its commands (section 3), its checks (section 4), its abort rules (section 5) and its reading of the report (section 7) all apply. This file adds only what is specific to the 32B run. Readings are provisional (decision 0061; owner items in [adam-run-owner-decisions.md](adam-run-owner-decisions.md)).

**Readings relied on (provisional).**

- Any death in the 5-day window fails the run (decision 0061 item 1). The harness fails on any death in the run; see owner item O-2.
- Thought latency: p95 under 15 s, with p50 and max reported; 25 s is the hard limit (item 4).
- One continuous run of at least 24 real hours, containing the 5-day segment, with one planned restart and one Body restart mid-intent (item 5).
- Nothing below 8B is run (item 6).

**This is the first run.** Nothing here depends on the 8B run. The 8B run waits for this verdict (section 6).

## 1. Before start

1. Work through the preconditions in the checklist, section 2 (P1 to P13), with life `ag_adam_03`. This life is new for the exit runs (decision 0064): it is used by this run only, and never by a rerun. P12 must show it unused in the dev database. Section 1 of the checklist covers the tier select's edit of the shard file (owner item O-1, now implemented; see step 4).
2. **Fresh world volume.** Run `./geldar.ps1 adam-run 32b prepare-volume --run-id <run-id>`. Pick the run id now and write it in `ops-log.md`. The command creates a new, empty, labelled volume and records it in `.geldar/runs/<run-id>/manifest.json`. It deletes and reuses nothing. Note the printed volume name.
3. Set the volume for this shell and recreate the compose stack on it:
   `$env:GELDAR_WORLD_VOLUME = '<name from step 2>'`, then `docker compose -f compose/phase0.yml -p geldar-phase0 up -d --wait`. Do not use `adam down` and `adam up` for this: they do not recreate Paper, so Paper would keep the old volume. The harness refuses to start unless the running Paper mounts exactly the recorded volume at `/data`.
4. **Select the tier.** `./geldar.ps1 adam select --model strong`. Expected output: `selected: life ag_adam_03 (strong)`. Then `git status --short` prints only `shards/phase0.yaml`. The select's edit is the only change start accepts: it may change only `mind.run_tier`, `mind.agent.username` and `mind.agent.tier`, with the values select writes. Any other change to that file, or any other dirty path, refuses the start. Do not edit the file by hand.
5. **Benchmark gate.** The gate is the newest `bench-results/*.json`. Its `meta.commit` must equal `git rev-parse --short HEAD`, and it must show 100% at 20 TPS. Written by OPS-0 at this HEAD (`--runs 10`, D-P0-18). Otherwise the start is refused.
6. **Seed.** `shards/phase0.yaml` holds the shard seed (8675309, equal to `SEED` in `compose/phase0.yml`). Record it in `ops-log.md`. The 8B run uses the same seed.
7. **Whitelist the life (by hand).** Nothing in the repo whitelists `ag_adam_03`; ops does it. After `shard up phase0`, run
   `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T paper rcon-cli whitelist add ag_adam_03`, then `... rcon-cli whitelist list` must show `ag_adam_03`.

## 2. Steps, in order

1. **Start the run** (T0 is when this returns):

   ```
   ./geldar.ps1 adam-run 32b start --run-id <run-id> --hours 24 --restart-at-hours 12 --body-kill-after-minutes 120
   ```

   The command runs in the foreground and starts the stack itself. Do not run `adam up` by hand. `--hours 24` is required; the default is 3. A second shell is needed for the checks.
2. **Confirm the start.** `./geldar.ps1 adam status` shows `body`, `animus` and `lantern-local` running. `./geldar.ps1 adam-run 32b status --run-id <run-id>` shows the first line.
3. **Checks** at the intervals in section 3, using the checklist's C1 to C8.
4. **Body kill and restart mid-intent** (planned by `--body-kill-after-minutes 120`). The harness does this itself: at the first minute at or after T0+2:00 with an intent active, it ends the Body process and starts a fresh one (`adam restart-body`), then waits up to 4 minutes for the Body to reconnect. Ops does not kill anything by hand.
   - **Check that it resumed.** Before the kill (or at the next check), run
     `SELECT intent_id, body_generation, state FROM intents WHERE life_id='ag_adam_03' AND state IN ('accepted','running');`
     The intent that was `running` is still `running` after the restart, and its `body_generation` is one higher. It is not reset to `accepted`.
   - **Record** the times, the generation before and after, and the `status.log` line that shows the new generation, in `ops-log.md`.
   - **If it did not resume** (the intent is `failed`, or the generation did not change): that is a finding. Record it. Tell the orchestrator at once. Do not restart anything again.
   - **Body that dies on its own** (not the harness kill): nothing restarts it automatically. Ops runs `./geldar.ps1 adam restart-body` and then runs the same check. If the Body dies again, stop and tell the orchestrator.
5. **Planned whole-stack restart** (`--restart-at-hours 12`, T0+12:00). The harness restarts the stack (`docker compose restart` of the run's services; the volumes are kept) and waits up to 10 minutes. Ops checks:
   - `./geldar.ps1 adam status` shows the three host processes running.
   - A running intent is still `running`, or was `completed` during the restart. No intent is `accepted` again from scratch.
   - `rcon-cli whitelist list` still lists `ag_adam_03` (the volume is kept, so it normally does). If it does not, whitelist it again, and record that.
   - Record the restart time in `ops-log.md` and check that `manifest.json` records the restart.
6. **End.** Not before T0+24:00. Then `./geldar.ps1 adam-run 32b stop --run-id <run-id>`, then `./geldar.ps1 adam status` (all `stopped`).
7. **Restore the shard file.** After the stop, `git checkout -- shards/phase0.yaml` (this drops the select's edit; the manifest keeps the record in `shard_edit`), then `git status --short` prints nothing.
8. **Report.** `./geldar.ps1 adam-run 32b report --run-id <run-id>`. It writes `run-report.json` and `run-report.md` into `.geldar/runs/<run-id>/`. Read the verdict of each criterion (checklist section 7).
9. **Back up.** Copy `manifest.json`, `status.log`, any `abort.json`, and `ops-log.md` to the backup folder. Export the rows (checklist section 6). Copy no log into the repo.

## 3. Timeline for this run

| Time (from T0) | Event | Check |
|---|---|---|
| T0 to about T0+100 min | The 5-day segment (120,000 ticks) | Rules `death`, `tps` and `latency` watched at every check |
| T0+0:15 to T0+2:00 | Checks every 15 minutes | Checklist section 4, C1 to C8 |
| T0+2:00 or after | Body kill and restart mid-intent (step 4) | The resume checks in step 4 |
| T0+3:00 onward | Hourly checks | Checklist section 4 |
| T0+12:00 | Planned whole-stack restart (step 5) | The checks in step 5 |
| T0+24:00 or after | Stop (step 6) | `adam status`: all stopped |

## 4. Aborts

Section 5 of the checklist. The harness stops the stack and writes `abort.json`. Ops runs the abort procedure there, does not retry, and reports to the orchestrator.

## 5. What this run gives the owner

- A verdict per criterion for `ag_adam_03` in `run-report.md`: survival, continuity (24 h), intents (three completed with no model call during the intent), receipts, checkpoint resume, latency p50, p95 and max, calls per useful minute (thoughts and reflections reported separately), and the outcome histogram.
- A **candidate** for the model floor. A model passes when its verdict under the floor key in `criteria.yaml` is PASS. If `qwen3:32b` passes, it is a floor candidate. The 8B run decides whether a smaller floor exists; 8B is the only smaller tier in Phase 0 (decision 0061 item 6).

## 6. The rule for the 8B run

- **32B passes:** the 8B run goes ahead, under [adam-run-8b.md](adam-run-8b.md).
- **32B fails** (a FAIL on a criterion that decides the verdict, or an abort): by the wave 6 gate and spec section 10 (exit item 6), no 8B run starts until the owner rules. Ops writes this in `ops-log.md` and tells the orchestrator.
- **A 32B result with UNKNOWN is not a fail.** It is a report gap. The owner decides (checklist section 7).
