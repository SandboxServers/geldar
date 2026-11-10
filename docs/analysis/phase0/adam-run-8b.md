# Adam run protocol: Qwen3 8B (fast), exit run life `ag_adam_04`

Status: draft for owner review, 2026-11-10 (W6-14). Read [adam-run-ops-checklist.md](adam-run-ops-checklist.md) first: its preconditions, commands, checks, abort rules and report reading apply to this run. This file adds only what is specific to the 8B run. Readings are provisional (decision 0061; [owner items](adam-run-owner-decisions.md)).

**This run starts only when the 32B verdict says so.** Section 1 is the gate. Do not start this run on your own judgement.

## 1. Gate: the 32B verdict

- The 32B run ([adam-run-32b.md](adam-run-32b.md)) has a `run-report.md` with a verdict for every criterion, and the owner has ruled.
- The 32B run did not abort, and its verdict is not FAIL on a criterion that decides the verdict (checklist section 7).
- No open owner item says "hold the 8B run".

If any of these is not true, the 8B run does not start. Ops writes this in `ops-log.md` and tells the orchestrator.

## 2. Differences from the 32B run

- **Profile and life:** `8b` and `ag_adam_04` (decision 0064). The 8B run is a separate life on a fresh world volume. `ag_adam_04` is used by this run only. The 8B test life `ag_adam_02` (golem live cases) is never used for a run, and its journal is not reset or deleted for one.
- **Model:** `qwen3:8b` (fast). Select it with `./geldar.ps1 adam select --model fast`, which prints `selected: life ag_adam_04 (fast)`.
- **Seed:** the same shard seed as the 32B run (8675309). Record it.
- **Preconditions:** the checklist's P1 to P13 with `ag_adam_04`. P5 differs: the 8B run needs `qwen3:32b` unloaded (`ollama ps` must not list it; if it does, `ollama stop qwen3:32b`).
- **Clean journal:** the life `ag_adam_04` must have zero `thoughts`, zero `intents` and zero `agents` rows in the dev database (P12). P12 confirms the id is unused before the run. A non-zero count stops the run; nobody deletes rows to make it zero.

## 3. Fresh volume

The 8B run writes to its own volume, made by the harness, never the 32B volume.

1. Pick the run id, and write it in `ops-log.md`.
2. `./geldar.ps1 adam-run 8b prepare-volume --run-id <run-id>`. It creates a new, empty, labelled volume and records it in `.geldar/runs/<run-id>/manifest.json`. It deletes and reuses nothing.
3. Write the printed volume name in `ops-log.md`. Set `$env:GELDAR_WORLD_VOLUME = '<name>'` in the shell, then `docker compose -f compose/phase0.yml -p geldar-phase0 up -d --wait`. Do not use `adam down` and `adam up` for this: they do not recreate Paper, so Paper would keep the old volume. Start refuses unless the running Paper mounts exactly that volume at `/data`.
4. Whitelist the life by hand (nothing in the repo does it): `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T paper rcon-cli whitelist add ag_adam_04`, then `... rcon-cli whitelist list` must show it.

**Never delete the 32B volume** to make room. If disk is short, that is abort rule `disk` (checklist section 5), and the orchestrator decides.

## 4. Steps, in order

1. **Select the tier:** `./geldar.ps1 adam select --model fast`. Then `git status --short` prints only `shards/phase0.yaml`. The start in step 3 accepts that edit and no other: only `mind.run_tier`, `mind.agent.username` and `mind.agent.tier` may differ from the committed file, with the values select writes. The start records the edit in `manifest.json` under `shard_edit`.
2. **Benchmark gate:** the newest `bench-results/*.json` must have `meta.commit` equal to `git rev-parse --short HEAD` and 100% at 20 TPS (checklist P2).
3. **Start the run** (T0 is when this returns):

   ```
   ./geldar.ps1 adam-run 8b start --run-id <run-id> --hours 24 --restart-at-hours 12 --body-kill-after-minutes 120
   ```

   Do not run `adam up` by hand. `--hours 24` is required; the default is 3.
4. **Confirm:** `./geldar.ps1 adam status`, then `./geldar.ps1 adam-run 8b status --run-id <run-id>`.
5. **Checks** at the intervals in the timeline below, using the checklist's C1 to C8.
6. **Body kill and restart mid-intent** (planned by `--body-kill-after-minutes 120`). The harness ends the Body and starts a fresh one, then waits up to 4 minutes for it to reconnect. Resume check, with the life id changed:
   `SELECT intent_id, body_generation, state FROM intents WHERE life_id='ag_adam_04' AND state IN ('accepted','running');`
   The intent that was `running` is still `running`, and its `body_generation` is one higher. Record the times and the generation before and after in `ops-log.md`. If it did not resume, record it and tell the orchestrator at once. A Body that dies on its own is not restarted automatically: run `./geldar.ps1 adam restart-body`, then check again.
7. **Planned whole-stack restart** (`--restart-at-hours 12`). The harness restarts the stack and keeps the volumes. Ops checks `adam status` (three processes running), that no intent is `accepted` again from scratch, and that the whitelist still lists `ag_adam_04`. Records the restart time.
8. **End:** not before T0+24:00. `./geldar.ps1 adam-run 8b stop --run-id <run-id>`, then `./geldar.ps1 adam status` (all `stopped`).
9. **Restore the shard file:** after the stop, `git checkout -- shards/phase0.yaml` (this drops the select's edit; the manifest keeps the record in `shard_edit`), then `git status --short` prints nothing.
10. **Report:** `./geldar.ps1 adam-run 8b report --run-id <run-id>`. It writes `run-report.json` and `run-report.md` into `.geldar/runs/<run-id>/`.
11. **Back up:** `manifest.json`, `status.log`, any `abort.json`, `ops-log.md`, and the life's rows, into the backup folder. Copy no log into the repo.

## 5. Timeline

| Time (from T0) | Event | Check |
|---|---|---|
| T0 to about T0+100 min | The 5-day segment | Rules `death`, `tps` and `latency` at every check |
| T0+0:15 to T0+2:00 | Checks every 15 minutes | Checklist section 4 |
| T0+2:00 or after | Body kill and restart mid-intent (step 6) | Resume check in step 6 |
| T0+3:00 onward | Hourly checks | Checklist section 4 |
| T0+12:00 | Planned whole-stack restart (step 7) | Checks in step 7 |
| T0+24:00 or after | Stop (step 8) | `adam status`: all stopped |

## 6. What this run gives the owner

- A verdict per criterion for `ag_adam_04` in `run-report.md`: the same criteria as the 32B run.
- The model floor input. The floor is the smallest model that passed: 8B if `qwen3:8b` passes, otherwise 32B. Nothing below 8B is run (decision 0061 item 6). The owner records the floor (`model_floor_verdict` in `criteria.yaml` stays `null` until the owner fills it).

## 7. Aborts

As in the 32B protocol: the checklist, section 5. A run that aborts is not retried. Ops reports to the orchestrator.
