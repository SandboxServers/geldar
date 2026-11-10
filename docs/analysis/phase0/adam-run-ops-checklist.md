# Adam run: the ops checklist (32B and 8B)

Status: draft for owner review, 2026-11-10 (W6-14). Both run protocols, [adam-run-32b.md](adam-run-32b.md) and [adam-run-8b.md](adam-run-8b.md), read this file first. The readings behind the numbers are **provisional**: [decision 0061](../../decisions/0061-phase-0-exit-criteria-readings.md). The owner's open items are in [adam-run-owner-decisions.md](adam-run-owner-decisions.md). Numbers live in `tools/adam-report/criteria.yaml` and `tools/adam-run/abort-criteria.json`, never in these documents.

**Who runs this.** The `ops` agent. It runs commands and reads outputs. It makes no code edits and no design decisions. Anything this file does not cover goes to the orchestrator.

**Commands.** From the repo root, in PowerShell: `./geldar.ps1 <args>`. Postgres and Paper commands use the compose project `geldar-phase0`:

```
docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres psql -U geldar -d geldar -c "<SQL>"
docker compose -f compose/phase0.yml -p geldar-phase0 exec -T paper rcon-cli <command>
```

Every SQL in these protocols is a `SELECT`. Nothing else is run against the database.

## 0. Rules for the whole run

1. **No code edits.** The only file that changes is `shards/phase0.yaml`, by `adam select`. Ops restores it after the run with `git checkout -- shards/phase0.yaml`. No other restore is allowed.
2. **No `adam up` by hand for a run.** `adam-run <profile> start` starts the stack. No live test case runs during a run.
3. **Clean journal per life.** The life's `thoughts`, `intents` and `agents` rows must be zero before start (P12). Each exit run has its own life, used once (decision 0064).
11. **Lives.** The 32B run is `ag_adam_03`, the 8B run is `ag_adam_04`, and the smoke run is `ag_smoke_01`. The test life `ag_adam_02` of the golem live cases is not used by any run. Each run's life is whitelisted by hand (section 3).
4. **No background monitors.** When the run ends, no watcher or loop that ops started is left running.
5. **No secrets.** Do not open `compose/secrets/`, `skins/`, or any `.env` file. Do not print a secret. Logs stay out of the repo.
6. **No IP addresses** except `127.0.0.1`.
7. **No git writes** except the restore in rule 1. No push, no stash, no commit of run data. The orchestrator commits.
8. **Nothing is deleted.** No `docker volume prune`, no `docker system prune`, no `compose down -v`, no `rm` of a volume or a run folder.
9. **Never retry** an aborted run. Only the orchestrator dispatches a second run.
10. **Backup folder.** Pick one folder outside the repo, on the same disk, before the run. Write its path into `ops-log.md`.

## 1. Before dispatch: the tier select's edit

`adam select` rewrites `shards/phase0.yaml`, which makes the tree dirty. `adam-run start` accepts that edit and no other: only `mind.run_tier`, `mind.agent.username` and `mind.agent.tier` may differ from the committed file, with the values select writes (code in `tools/adam-run/src/shard-edit.ts`). Any other changed key, any comment or layout change, and any other dirty path refuse the start. The start records the edit in `manifest.json` under `shard_edit`. So "select, then start" is the normal sequence. The owner has not ruled on this choice (owner item O-1 in [adam-run-owner-decisions.md](adam-run-owner-decisions.md)); a ruling that changes it is made before dispatch.

## 2. Preconditions (tick each one; a failed tick stops the run)

| # | Check | Command | Pass when |
|---|---|---|---|
| P1 | Clean tree at the dispatch sha | `git rev-parse --short HEAD`, `git status --short` | The sha equals the dispatch note. Status prints nothing (see section 1). |
| P2 | Benchmark gate (OPS-0) at HEAD | Read the newest `bench-results/*.json` (newest by the timestamp in its name) | Its `meta.commit` equals `git rev-parse --short HEAD`. It has 100% at 20 TPS. It was run with `--runs 10` (D-P0-18). If it is missing, stale or not 100%: stop, re-run OPS-0 at HEAD, fix the Body, not the model. Never edit the file. |
| P3 | Model pins match Ollama | `./geldar.ps1 adam models` | Each pinned tag (`qwen3:32b`, `qwen3:8b`, `nomic-embed-text`) has a digest that matches Ollama. Do not copy digests into any document. |
| P4 | Pinned models present | `ollama list` | The tags are listed. Never `ollama pull` during a run. |
| P5 | Only allowed models loaded | `ollama ps` | Only the profile's chat model and the embedder are listed. Unload a stray with `ollama stop <tag>` (deletes nothing). |
| P6 | World volume prepared | `./geldar.ps1 adam-run <32b\|8b> prepare-volume --run-id <run-id>` (section 3) | The command prints `prepared <profile> world volume <name>`. The name is written in `ops-log.md`. |
| P7 | Life selected | `./geldar.ps1 adam select --model strong` (32B), `fast` (8B), or `smoke` (smoke run) | Prints `selected: life ag_adam_03 (strong)` (32B), `selected: life ag_adam_04 (fast)` (8B), or `selected: life ag_smoke_01 (smoke)` (smoke). `git status --short` shows only `shards/phase0.yaml` (see section 1). The adam-run gate refuses a Mind whose username or tier does not match the profile. |
| P8 | Stack healthy | `./geldar.ps1 shard up phase0`, then `./geldar.ps1 shard status phase0` | `shard up` exits 0. Every service is running and healthy. |
| P9 | Personality seed in place | `Select-String -Path shards\phase0.yaml -Pattern 'personality_seed'` | The line is present and not empty. Do not edit it. |
| P10 | Disk room | `(Get-PSDrive -Name C).Free / 1GB` | At least 10 GB free (the harness's `diskMinGb`). |
| P11 | No stale host processes | `./geldar.ps1 adam status` | `body`, `animus` and `lantern-local` each show `stopped`. If one is stale, `./geldar.ps1 adam down`, then check again. |
| P12 | Clean journal for the life, and the life is unused | Section 4, C9, with the run's life id (`ag_adam_03`, `ag_adam_04` or `ag_smoke_01`) | `thoughts`, `intents` and `agents` rows are all `0` for the run's life. The life has no rows in any table for an earlier run (decision 0064). A non-zero count stops the run. Nobody deletes rows. |
| P13 | Harness present | `./geldar.ps1` (no arguments) | The usage lists `adam-run <32b\|8b\|smoke> start\|status\|stop\|report\|prepare-volume`. |

The harness repeats P1 to P6 and the life check at `start`, and refuses on any failure. A refusal is a stop, not a retry.

## 3. Commands (every name below is in the usage or in `tools/adam-run/src/cli.ts`)

| Purpose | Command |
|---|---|
| Prepare a fresh world volume (32B and 8B only) | `./geldar.ps1 adam-run <32b\|8b> prepare-volume --run-id <run-id>` |
| Use the prepared volume | `$env:GELDAR_WORLD_VOLUME = '<name>'`, then `./geldar.ps1 adam down`, then `./geldar.ps1 adam up` (in the same shell) |
| Select the tier (or the smoke life) | `./geldar.ps1 adam select --model strong\|fast\|smoke` |
| Whitelist the run's life (by hand; nothing in the repo does it) | `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T paper rcon-cli whitelist add <life>`, then `... rcon-cli whitelist list` must show `<life>`. Run after `shard up phase0`. |
| Start the run (foreground) | `./geldar.ps1 adam-run <32b\|8b> start --run-id <run-id> --hours 24 --restart-at-hours 12 --body-kill-after-minutes <n>` |
| Run status | `./geldar.ps1 adam-run <32b\|8b> status --run-id <run-id>` |
| Safe stop | `./geldar.ps1 adam-run <32b\|8b> stop --run-id <run-id>` |
| Report | `./geldar.ps1 adam-run <32b\|8b> report --run-id <run-id>` |
| Host processes | `./geldar.ps1 adam status`, `./geldar.ps1 adam logs body` |
| Restart only the Body | `./geldar.ps1 adam restart-body` (the adam CLI's `restart-body`) |
| Stop the host processes | `./geldar.ps1 adam down` |

**The flags.** `--hours` defaults to **3** for 32b and 8b, so the 24-hour run must pass `--hours 24` explicitly. `--restart-at-hours` sets the planned whole-stack restart. `--body-kill-after-minutes` sets the harness's Body kill; the kill happens at the first minute on or after that time when an intent is active. No other flag exists.

**The run folder** is `.geldar/runs/<run-id>/`. It holds `manifest.json` (the run's record), `status.log` (one JSON line a minute), `abort.json` (only if the run aborted) and, after `report`, `run-report.json` and `run-report.md`. Ops reads these; ops does not edit them.

## 4. Timeline and checks

T0 is the time `start` is entered (the manifest records the start time). Times are real minutes from T0. At 20 TPS, 1,200 ticks pass a minute.

| Event | When | Notes |
|---|---|---|
| The 5-day segment | 120,000 ticks from the life's first tick, about 100 real minutes at 20 TPS | A slower TPS makes the segment longer. Rule AB-tps (section 5) stops a slow run. |
| Body kill and restart mid-intent | At the first minute at or after `--body-kill-after-minutes` with an intent active (planned: T0+2:00) | Done by the harness. See the protocol file. |
| Planned whole-stack restart | `--restart-at-hours 12` (T0+12:00) | Done by the harness. |
| End | Not before T0+24:00 | `adam-run stop` ends the run. An abort ends it earlier. |

**Checks.** Every 15 minutes from T0+0:15 to T0+2:00, then hourly on the hour. Record each in `ops-log.md`.

| Step | Command | Expected |
|---|---|---|
| C1 | `./geldar.ps1 adam-run <profile> status --run-id <run-id>` | Ticks rise by about 1,200 a minute. TPS at least 19.5. Deaths 0 during the 5-day window. |
| C2 | `./geldar.ps1 adam status` | `body`, `animus`, `lantern-local` each `running (pid <n>)`. |
| C3 | `./geldar.ps1 shard status phase0` | Every service running and healthy. |
| C4 | `ollama ps` | The run's chat model is listed while an intent runs. An idle unload is not an abort. |
| C5 | `(Get-PSDrive -Name C).Free / 1GB` | 10 or more. |
| C6 | `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres psql -U geldar -d geldar -c "SELECT state, count(*) FROM intents WHERE life_id='<life>' GROUP BY state;"` | Counts per state. `running` is 1 while an intent is active. |
| C7 | `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres psql -U geldar -d geldar -c "SELECT count(*) FROM thoughts WHERE life_id='<life>' AND at > now() - interval '15 minutes';"` | Non-zero is normal. Zero once is recorded, not an abort. |
| C8 | `./geldar.ps1 adam logs body` | No repeating error. A single error line goes into `ops-log.md` with its time. |
| C9 | `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres psql -U geldar -d geldar -c "SELECT (SELECT count(*) FROM thoughts WHERE life_id='<life>') AS thoughts, (SELECT count(*) FROM intents WHERE life_id='<life>') AS intents, (SELECT count(*) FROM agents WHERE agent_id='<life>') AS agents;"` | Run before start (P12) with the run's life. All three are `0`. Each is recorded in `ops-log.md`. |

Anything that is not an abort rule is written to `ops-log.md` and reported at the next check. Ops does not stop a run on its own judgement.

## 5. Abort rules (as the harness enforces them)

The harness watches these rules (`tools/adam-run/src/abort.ts`, thresholds in `tools/adam-run/abort-criteria.json`). When one fires, the harness runs its own safe stop, writes `abort.json`, and writes a partial report.

| Rule (code name) | Condition |
|---|---|
| `tps` | TPS under 19.5 for 5 minutes |
| `latency` | Thought latency p95 over 15 s, over a 30-minute window. The 25 s deadline is the hard limit for each thought. |
| `ollama`, `postgres`, `nats` | One of them down for 5 minutes |
| `body` | The Body not connected for 5 minutes |
| `no-thought` | No thought for 10 minutes |
| `disk` | Free disk under 10 GB |
| `death` | A death in the run (`deathFailsRun` is true; see owner item O-2) |
| `gpu` | The GPU is not visible to the host |
| `error` | `adam up`, the sampler, a restart or a Body kill failed |
| `operator_stop` | `adam-run stop` was run from another shell |

**What ops does on any abort.** The harness has already stopped the stack. Then:

1. Run `./geldar.ps1 adam status`. All three host processes must show `stopped`. If not, run `./geldar.ps1 adam down`.
2. Run `git checkout -- shards/phase0.yaml`, then `git status --short` (prints nothing).
3. Run `./geldar.ps1 adam-run <profile> report --run-id <run-id>`. The report is written for a partial run.
4. Write to `ops-log.md`: the time, the rule, the value measured, each step.
5. **Do not retry.** Do not start the same life again, and do not start the other model. Report to the orchestrator and wait.
6. Never delete a volume or a file to clear an abort.

## 6. What to record

| Item | Where | Kept |
|---|---|---|
| `manifest.json`, `status.log`, `abort.json` (if any) | `.geldar/runs/<run-id>/` | Copy to the backup folder. Not into the repo. |
| `run-report.json`, `run-report.md` | `.geldar/runs/<run-id>/` | The orchestrator decides what enters the repo. Ops does not copy them. |
| `ops-log.md` (times, check outputs, aborts, restarts, the backup path) | The backup folder | Yes. |
| Rows of the life | `docker compose -f compose/phase0.yml -p geldar-phase0 exec -T postgres pg_dump -U geldar -d geldar --data-only -t thoughts -t intents -t actions -t receipts > "<backup folder>\<run-id>-rows.sql"` | Yes, in the backup folder. |
| The commit the run ran on | `git rev-parse HEAD` (also in the manifest) | Yes, in `ops-log.md`. |

Never paste a log into a chat message. Quote only the status line or the rule that fired.

## 7. Reading the report

The report generator writes one verdict per criterion. Read the words it prints; the wording is set by `tools/adam-report`. Three states matter:

- **PASS**: the criterion is met on the run's data.
- **FAIL**: the data was computed and the criterion is not met. A finding, not an error.
- **UNKNOWN** (or "not computed: definition pending"): no verdict. The criteria key is `null`, or the data is missing. UNKNOWN is not a pass. The owner decides; the fix is a criteria key or a repaired data path, then `report` again on the same run. The Adam run is not repeated for an UNKNOWN.

## 8. What is not allowed

- `adam up` by hand for any Adam run or live case. The harness starts the stack.
- `ollama pull`, or any model change.
- Editing any config file, except the `adam select` rewrite that section 0 rule 1 restores.
- Stopping, removing or restarting any container outside the run.
- Printing or copying a secret, a token, or a log that holds one.
- Starting a run on a life that has an aborted predecessor.
- Retrying an aborted run.
- Committing run data, pushing, or opening a PR. The orchestrator does this.
