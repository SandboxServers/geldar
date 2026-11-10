# Adam run: the ops preamble (32B and 8B)

Status: draft for owner review, 2026-11-10. Part of wave 6 (W6-14, [wave6-packets.md](wave6-packets.md)). Both run protocols, [adam-run-32b.md](adam-run-32b.md) and [adam-run-8b.md](adam-run-8b.md), read this file first. The readings behind the numbers are **provisional**: [decision 0061](../../decisions/0061-phase-0-exit-criteria-readings.md) (the owner may revise them). The numbers themselves live in the criteria file `tools/adam-report/criteria.yaml` (W6-12), never in these documents. Where a number is quoted below it is the value written on the W6-13 card, marked as provisional.

**Who runs this.** The `ops` agent (haiku). It runs commands and reads outputs. It makes no code edits and no design decisions. Anything this file does not cover goes to the orchestrator, not to a guess.

**Commands.** Run every command from the repo root with PowerShell: `./geldar.ps1 <args>`. Compose commands for Postgres and Paper use the shard project name `geldar-phase0` (the same name `./geldar.ps1 shard` uses):

```
docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres psql -U geldar -d geldar -c "<SQL>"
docker compose -f compose/phase0.yml -p geldar-phase0 exec -T paper rcon-cli <command>
```

Every SQL in these protocols is a `SELECT`. Nothing else is run against the database.

**Assumptions about W6-13.** W6-13 (`adam-run` and `glass up`) is not merged when this file is written. Every command marked `per W6-13` is written from the W6-13 card. Where the card does not name a form, the form used here is marked `assumed`. Before a run, the precondition P13 below confirms each assumed form. If one is missing, the run does not start.

## 0. Rules that hold for the whole run

1. **No code edits.** The only file that changes is `shards/phase0.yaml`, by the `adam select` rewrite. Ops restores it after the run with `git checkout -- shards/phase0.yaml`, and no other restore is allowed.
2. **No `adam up` by hand for a run.** The harness starts the stack (`adam-run start`, per W6-13). No live test case runs during a run.
3. **Clean journal per life.** The life's `thoughts` and `intents` rows must be zero before the run starts (P12).
4. **No background monitors.** When the run ends, no watcher, loop or job that ops started is left running.
5. **No secrets.** Do not open `compose/secrets/`, `skins/`, or any `.env` file. Do not print a secret. Do not copy `.geldar/adam/*.log` into the repo. Logs stay local and go to the backup folder only if they hold no secret; when unsure, leave them out.
6. **No IP addresses** except `127.0.0.1`.
7. **No git writes** except the one restore in rule 1. No `git push`, no `git stash`, no commit of run data. The orchestrator commits.
8. **Nothing is deleted** except the fresh-volume step in the 8B protocol (one named volume, after a backup). See the list of what ops must never delete in the 8B protocol.
9. **Never retry** an aborted run. Only the orchestrator can dispatch a second run.
10. **Backup folder.** Pick one folder outside the repo before the run (a path on the same disk, not inside the worktree). Write its path into the run's `ops-log.md`. Every backup in these protocols goes there.

## 1. Preconditions (tick each one; a failed tick stops the run)

| # | Check | Command | Pass when |
|---|---|---|---|
| P1 | Clean tree at the recorded sha | `git rev-parse --short HEAD` and `git status --short` | The sha equals the sha in the dispatch note. `git status --short` prints nothing. |
| P2 | OPS-0 gate passed: 100% at 20 TPS, `--runs 10` (D-P0-18) | Read the OPS-0 record: the results file that `./geldar.ps1 bench --record` wrote | The record says 100% at 20 TPS. The 10 and 5 TPS rows may be below 100% (findings only). If the record is missing or not 100%: stop. Fix the Body, not the model. |
| P3 | Pinned digests recorded for the three models | `Select-String -Path shards\phase0.yaml -Pattern 'digest'` and `./geldar.ps1 adam models` | `model_pins` in `shards/phase0.yaml` has a digest for `qwen3:32b`, `qwen3:8b` and `nomic-embed-text`. `adam models` shows each digest matching Ollama. Do not copy the digests into any document. |
| P4 | Ollama up with the pinned models | `ollama list` | `qwen3:32b`, `qwen3:8b` and `nomic-embed-text` are listed. Nothing is pulled (rule: no `ollama pull`). |
| P5 | GPU free for this run | `ollama ps` | For the 32B run: no model listed except `nomic-embed-text` (the embedder runs on the CPU). For the 8B run: `qwen3:32b` is not listed. If it is, `ollama stop qwen3:32b` (unloads it; deletes nothing) and check again. |
| P6 | Stack up and healthy | `./geldar.ps1 shard up phase0`, then `./geldar.ps1 shard status phase0` | `shard up` exits 0. Every service in the status is running and healthy. |
| P7 | Glass up on loopback | `./geldar.ps1 glass up` (per W6-13) | The command prints a `127.0.0.1` URL. A GET to that URL returns the Thought Stream page. |
| P8 | Criteria file has no null key for this run | Open `tools/adam-report/criteria.yaml` (read only) | The keys for survival, intents, receipts, checkpoint resume, model floor and latency p95 are not `null`. If any is `null`, stop. The owner fills it (decision 0061). Ops never fills a criteria key. |
| P9 | Personality seed in place | `Select-String -Path shards\phase0.yaml -Pattern 'personality_seed'` | The line is present and not empty. It was approved by the owner on 2026-11-09 (decision 0051, item 2). Do not edit it. |
| P10 | Disk room | `(Get-PSDrive -Name C).Free / 1GB` | At least 10 GB free (W6-13 card value, provisional; the criteria file is authoritative). |
| P11 | No leftover host processes | `./geldar.ps1 adam status` | `body`, `animus` and `lantern-local` each show `stopped`. A `stale` line: run `./geldar.ps1 adam down`, then check again. |
| P12 | Clean journal for the life | Postgres `SELECT` (below) | Both counts are `0` for the life of this run. The 32B life is `ag_adam_01`; the 8B life is `ag_adam_02`. |
| P13 | W6-13 forms present | `./geldar.ps1 adam-run` (help text) | The help lists `start`, `status`, `stop` and `report` (per W6-13 card), and `body-restart` and `resume` (assumed; not on the card). If `body-restart` or `resume` is missing, the run does not start: stop and ask the orchestrator. |

P12 query (replace `<life>`):

```
docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres psql -U geldar -d geldar -c "SELECT (SELECT count(*) FROM thoughts WHERE life_id='<life>') AS thoughts, (SELECT count(*) FROM intents WHERE life_id='<life>') AS intents;"
```

Expected: `thoughts | 0` and `intents | 0`.

## 2. Life, whitelist and the one permitted file rewrite

- **Select the life.** `./geldar.ps1 adam select --model strong` selects `ag_adam_01` (32B). `./geldar.ps1 adam select --model fast` selects `ag_adam_02` (8B). The command prints `selected: life <id> (<tier>)`.
- **What it changes.** It rewrites the life lines of `shards/phase0.yaml`. Nothing else. Run `git status --short` after it: only `shards/phase0.yaml` may appear.
- **Restore after the run.** `git checkout -- shards/phase0.yaml`, then `git status --short` prints nothing. This is the only restore allowed (rule 1).
- **Whitelist the life.** Paper enforces its whitelist. After `shard up`, add the selected life (read the life id from the `adam select` output):

```
docker compose -f compose/phase0.yml -p geldar-phase0 exec -T paper rcon-cli whitelist add <life>
docker compose -f compose/phase0.yml -p geldar-phase0 exec -T paper rcon-cli whitelist list
```

Expected: the second command lists `<life>`. If `rcon-cli` is missing from the pinned image, stop and ask the orchestrator. Do not install anything.

## 3. Timeline (the same shape for both runs)

Let T0 be the time `./geldar.ps1 adam-run start` returns (the manifest records it). Times are measured from T0 in real minutes. The game clock runs at 20 TPS, so 1,200 ticks pass per real minute.

| Event | When | Notes |
|---|---|---|
| The 5-day segment | 120,000 ticks from the life's first tick: about 100 real minutes at 20 TPS | The harness records the first tick in the manifest. A slower TPS makes the segment longer. AB-1 (below) stops a slow run. |
| Body restart mid-intent | At the first check at or after T0+2:00 where an intent is `running` (default; the orchestrator may set it at dispatch) | Procedure in each protocol. |
| Planned restart of the whole stack | At T0+12:00 exactly (default; set at dispatch and written to the manifest) | Procedure in each protocol. |
| End of the run | Not before T0+24:00. Then `./geldar.ps1 adam-run stop` | At least 24 real hours in total. Ends earlier only by an abort. |

## 4. Checks at fixed intervals

Every 15 minutes from T0+0:15 to T0+2:00 (8 checks), then hourly on the hour from T0+3:00 to the end. Each check runs these, in this order. Record the time and the outputs in `ops-log.md`.

| Step | Command | Expected output |
|---|---|---|
| C1 | `./geldar.ps1 adam-run status` (per W6-13) | One new line in `status.log`. Ticks rise by about 1,200 per minute. TPS 19.5 or more. Deaths 0 during the 5-day window. |
| C2 | `./geldar.ps1 adam status` | `body`, `animus` and `lantern-local` each `running (pid <n>)`. |
| C3 | `./geldar.ps1 shard status phase0` | Every service running and healthy. |
| C4 | `ollama ps` | The run's model (`qwen3:32b` or `qwen3:8b`) is listed while an intent is running. It may be unloaded after 30 minutes idle (keep_alive); that is not an abort. |
| C5 | `(Get-PSDrive -Name C).Free / 1GB` | 10 or more (AB-5). |
| C6 | `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres psql -U geldar -d geldar -c "SELECT state, count(*) FROM intents WHERE life_id='<life>' GROUP BY state;"` | Counts per state. `running` is 1 while an intent is active. |
| C7 | `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres psql -U geldar -d geldar -c "SELECT count(*) FROM thoughts WHERE life_id='<life>' AND at > now() - interval '15 minutes';"` | Non-zero is normal. Zero for one check is recorded, not an abort. |
| C8 | `./geldar.ps1 adam logs body` (last lines only) | No repeating error. A single error line is written to `ops-log.md` with its time. |

Anything in a check that is not one of the abort rules is written to `ops-log.md` and reported at the next check. Ops does not stop a run on its own judgement.

## 5. ABORT rules (exact)

The harness watches these rules (W6-13). When one fires, the harness stops the stack and writes the reason. Ops checks the same numbers at each check (section 4).

| Rule | Condition | Source |
|---|---|---|
| AB-1 | TPS under 19.5 for 5 minutes | W6-13 card (provisional) |
| AB-2 | Thought latency p95 over the limit for 30 minutes | The limit is in `criteria.yaml`. It is not typed here. Decision 0061 item 4: p95 under 15 s is the criterion, and 25 s is the hard deadline for each thought. |
| AB-3 | Ollama, Postgres or NATS down for 5 minutes | W6-13 card |
| AB-4 | A death inside the 5-day window, when the criteria say a death fails the run | Decision 0061 item 1 (provisional): any death in the window fails the run. A death after the window is recorded, not an abort. |
| AB-5 | Disk under 10 GB free | W6-13 card (provisional) |

**What ops does on any abort:**

1. Run `./geldar.ps1 adam-run stop` (the harness's safe stop: Body last, the reason written). Do not use `shard down` or `docker` commands to stop things.
2. Run `./geldar.ps1 adam status`. All three host processes must show `stopped`.
3. Run `git checkout -- shards/phase0.yaml`, then `git status --short` (must print nothing).
4. Run `./geldar.ps1 adam-run report` for the partial run. The report is written even when the run stopped early.
5. Write to `ops-log.md`: the time, the rule (AB-n), the value measured, and each step taken.
6. **Do not retry.** Do not start the same life again, and do not start the other model. Report to the orchestrator and wait.
7. Never delete a volume or a file to clear the abort.

## 6. What to record

| Item | Where | Kept |
|---|---|---|
| `manifest.json` (git sha, model tags and digests, shard config hash, life id, seed, T0, planned restart and Body restart times) | `.geldar/adam/<run-id>/` (harness, per W6-13) | Copy to the backup folder. Not into the repo. |
| `status.log` (one line a minute) | `.geldar/adam/<run-id>/` (per W6-13) | Copy to the backup folder. |
| `ops-log.md` (ops's own notes: times, check outputs, every abort, every restart) | Ops writes it in the backup folder | Yes. |
| `run-report.json` and `run-report.md` (W6-12 names) | `docs/analysis/phase0/runs/<run-id>/` | Yes. These two files only go into the repo. |
| Database rows of the life | Backup folder: `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres pg_dump -U geldar -d geldar --data-only -t thoughts -t intents -t actions -t receipts > "<backup folder>\<run-id>-rows.sql"` | Yes. |
| The commit the run ran on | `git rev-parse HEAD` (also in the manifest) | Yes, in `ops-log.md`. |

Never copy a log into the repo. Never paste a log into a chat message. Quote only the status line or the rule that fired.

## 7. How to read the report

The report generator (W6-12) gives each criterion one verdict: **PASS**, **FAIL** or **UNKNOWN**. The W6-12 card does not name UNKNOWN; the words are taken from the brief. Check the words once the generator is merged, and read the key the generator prints.

- **PASS**: the criterion is met on this run's data.
- **FAIL**: the data was computed and the criterion is not met. This is a finding, not an error.
- **UNKNOWN**: no verdict. Either the criteria key is `null` ("not computed: definition pending"), or the data needed is missing. UNKNOWN is not a pass. The owner decides what to fill in. The fix is a criteria key or a repaired data path, then `./geldar.ps1 adam-run report` again on the same run. The Adam run is not repeated for an UNKNOWN.

## 8. What is not allowed

- `adam up` by hand for any Adam run or any live case. The harness starts the stack.
- Pulling any model (`ollama pull`), or any other model change.
- Editing a config file, except the `adam select` rewrite that rule 1 restores.
- Stopping, removing or restarting any container that is not part of the run (no `docker system prune`, no `docker volume prune`, no `compose down -v`).
- Printing or copying a secret, a token or a log that holds one.
- Starting a run that has an aborted predecessor on the same life.
- Retrying an aborted run.
- Committing run data, pushing, or opening a PR. The orchestrator does this.
