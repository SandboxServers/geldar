# Node request 02: scratch suffix `tm` for the scratch telemetry runs (Paper first, NeoForge later)

Status: DRAFT. Nothing has been run. The scratch host is not named in the repo; the owner names it (collector-design section 16). This is a request to use scratch capacity, not a change to the live stack. No overlay file is added by this request: see section 3.

## 0. Finding first: the repo already has a telemetry scratch project

The repo already ships the scratch telemetry run for Paper:

| Piece | File | State |
|---|---|---|
| Overlay (Ledger jar and config, agent profile, 15360m, up to 6 CPUs, throwaway OTLP receiver `otel-sink` aliased `geldar-gateway`) | `compose/opt-in/scratch-telemetry.yml` | exists, tested by `tools/repo-checks/src/scratch-telemetry.test.ts` |
| Ports | `deploy/scratch/telemetry.env` (scratch-a defaults plus 10000: PG 25432, NATS 24222, NATS monitor 28222, Minecraft 45565) | exists |
| Wiring | `deploy/scratch/scratch.sh`: overlay added only when the project is `scratch-telemetry` (suffix `telemetry`, 9 characters, the limit); `telemetry.env` required for that suffix | exists |
| Runbook, verify script | `docs/runbooks/scratch-telemetry.md`, `deploy/scratch/telemetry-verify.sh` | exist |

So the Paper run needs NO new suffix: use `sh deploy/scratch/scratch.sh up telemetry`. A suffix `tm` would duplicate that and also needs `scratch.sh` edits (the overlay and the required-port-file test are keyed on the literal project name `scratch-telemetry`). The owner asked for `tm`; this request therefore states the delta, and recommends one of:

- Option 1 (recommended): keep `telemetry` for the Paper run and use the new `tm` only for the NeoForge telemetry run (PT-N13), where an overlay is genuinely missing (below).
- Option 2: rename nothing, use `telemetry` for both, with `SCRATCH_PLATFORM=neoforge` and an additional NeoForge telemetry overlay (section 3). No new port block.

Everything below describes `tm` as asked.

## 1. Port block for `tm` (loopback only)

Existing blocks (all published as `127.0.0.1:<port>`; defaults are in `compose/opt-in/scratch.yml` and `scratch-neoforge.yml`):

| Project | PG | NATS | NATS monitor | Minecraft | RCON (NeoForge only) |
|---|---|---|---|---|---|
| scratch-a (default, no env file) | 15432 | 14222 | 18222 | 35565 | 35575 |
| scratch-telemetry (`telemetry.env`, +10000) | 25432 | 24222 | 28222 | 45565 | (not used) |
| scratch-nf (`nf.env`, +20000) | 35432 | 34222 | 38222 | 55565 | 55575 |

The scheme is "scratch-a default plus N". `+30000` fits PG, NATS and monitor but the Minecraft default plus 30000 is 65565, which is above 65535 and refused by `scratch.sh` (it rejects values over 65535). So `tm` takes `+30000` for three ports and picks the Minecraft and RCON ports by hand in the same 4xxxx band, checked against every number above:

```
SCRATCH_PG_PORT=45432
SCRATCH_NATS_PORT=44222
SCRATCH_NATS_MON_PORT=48222
SCRATCH_MC_PORT=46565
SCRATCH_RCON_PORT=46575
```

None equals any port in the table (45432 versus telemetry's 45565, 46565 and 46575 are new; 44222 and 48222 are new). They lie inside the Linux default ephemeral range (32768 to 60999), as every existing block does; a collision with an outgoing connection is possible but unchanged in kind, and `scratch.sh` fails the `up` if the bind fails. File: `deploy/scratch/tm.env` (only these five `SCRATCH_*_PORT` keys, no secrets; `scratch.sh` accepts only those keys). Before the run, read-only on the scratch host: `ss -ltn | grep -E ':(45432|44222|48222|46565|46575)\b'` must print nothing.

## 2. Caps

| Run | Game server | Others | Source |
|---|---|---|---|
| Paper telemetry | 15 GiB (15360m, swap equal), up to 6 CPUs (`SCRATCH_PAPER_CPUS`), `PAPER_MEMORY` 10G heap | `otel-sink` 512m / 0.5 CPU; Postgres, NATS, Velocity, eventsink as `scratch.yml` | the plan, `scratch-telemetry.yml` |
| NeoForge telemetry | 3072m (`scratch.yml`), 1.5 CPU, as for the P0 run | `otel-sink` 512m / 0.5 CPU, others as above | the P0 NeoForge scratch (`scratch-neoforge.yml` changes the image, not the limit; confirm in the file before the run) |

The plan raises nothing for NeoForge. If the NeoForge telemetry run shows a need for more, that is a new request. Host capacity: the Paper run alone reserves 15.5 GiB plus about 2 GiB for the rest and 6.5 CPUs; the scratch host's free RAM and CPU are an open fact (section 7).

Hard rule: a `tm` run NEVER overlaps a NeoForge P0 run (`scratch-nf`), and never overlaps the Paper A/B arms of the plan ("one at a time", test plan section 1). Different ports would allow it; memory and the NeoForge timing comparison do not. Before `up`: `docker ps --filter label=geldar.scratch=true --format '{{.Names}}'` must list nothing running except an intentionally kept stack that the owner names.

## 3. Overlay: reference, then delta

- Paper: reuse `compose/opt-in/scratch-telemetry.yml` unchanged.
- NeoForge (the delta, a spec only, because no file for it exists and `scratch.sh` would need a branch to add it):
  - Name: `compose/opt-in/scratch-tm-neoforge.yml`, layered after `scratch.yml` and `scratch-neoforge.yml` (the `paper` service name is shared by both platforms).
  - Content: the `otel-sink` service and `otel-sink` config copied from `scratch-telemetry.yml` (same image digest `otel/opentelemetry-collector-contrib@sha256:340c9ca6a36617084c6661bdc4f0fe92b7cda5a805d61673ec8db375fddc522b`, `user` from `SCRATCH_RUN_UID` and `SCRATCH_RUN_GID`, alias `geldar-gateway`, no ports, 512m, 0.5 CPU, `memswap_limit` 512m, label `geldar.scratch: "true"`, `restart: "no"`, output directory from `SCRATCH_TELEMETRY_OUT`); on `paper`: the NeoForge telemetry mod jar bind (read-only, path from the PT-N13 card, UNKNOWN today), its config file (the NeoForge equivalent of `ledger.properties`), the agent profile for `geldar-neoforge` and `OTEL_SDK_DISABLED=false`; `depends_on: otel-sink`; NO memory or CPU override (keeps 3072m and 1.5); no ports.
  - `scratch.sh` change (separate packet): add the overlay when the project is `scratch-tm` and `SCRATCH_PLATFORM=neoforge`; require `tm.env` for suffix `tm`. A test case in `tools/repo-checks/src/scratch-telemetry.test.ts` would need the same revert-check as the existing ones.
  - Why not added now: the PT-N13 mod jar path and agent profile are not on main, the existing test file validates one overlay by name, not "such overlays", so an overlay without its jar has nothing to check against. It stays a spec.

## 4. What the run does and records

Receiver (PT-03k): the throwaway collector `otel-sink` answers as `geldar-gateway:4318` on the scratch network only (no published port) and writes one JSON object per OTLP export request to `otlp.jsonl` under `SCRATCH_TELEMETRY_OUT` (an absolute directory outside the repo, owner-only mode, exported for `up`, `status` and `down`).

Paper run (20 to 40 minutes, after the NeoForge scratch re-run):
1. Build the jars (`cd plugin; ./gradlew build`), check `plugin/ledger/build/libs/ledger.jar` is a file; record the sha256 of `ledger.jar`, `geldar-core.jar` and the agent jar (`SCRATCH_OTEL_AGENT_JAR`, absolute path of the verified jar).
2. `up`, warm up, then the rows of the scratch test plan section 3 (T1 to T4, P1 to P4 and the collector rows): each with `deploy/scratch/telemetry-verify.sh metric|event|absent`; wait at least two 15 s export intervals after each action.
3. Record: the verify exit codes per row; the duty-cycle numbers PT-06d needs (rates per collector, per minute); `geldar_ledger_dropped_total`; Paper container `memory.current`, `cpu.stat` (`nr_throttled`); `tick query` as the plan says; the `absent` scans for addresses and secrets over `otlp.jsonl`; `latest.log` Ledger lines. Findings go to a results note by the orchestrator; no repo file is written by the run.
4. Tear down: `sh deploy/scratch/scratch.sh down telemetry`; the output directory is deleted by hand after the owner reads it (it holds full-text capture of scratch content only; scratch has no real player).

NeoForge run (later, PT-N13): same shape with the NeoForge rows of `neoforge-telemetry.md` (PT-N13 card), NeoForge caps from section 2.

## 5. Baseline, verify, rollback

Baseline before (read-only on the scratch host): `docker ps -a --format '{{.Names}} {{.Status}}'`; `docker compose ls`; `free -g`, `nproc`, `df -h` of the Docker data root; `ss -ltn` of the five `tm` ports (empty); `docker volume ls | grep scratch-tm` (empty). Record into the run note.

Verify after: the stack is the expected set (`status tm` or `status telemetry`), the sink file grows, the rows above pass or are reported as findings, no container of another project changed (`docker ps` list equals the baseline plus the scratch containers).

Rollback: `sh deploy/scratch/scratch.sh down <suffix>` removes containers, the world volume and the secrets directory of that project only; delete `SCRATCH_TELEMETRY_OUT` by hand; delete `deploy/scratch/tm.env` only through a repo change. A failed `up`: `scratch.sh` prints "clean up with: ... down"; run exactly that. Never touch the live compose project or `board-proxy`.

## 6. Does not touch

The live stack, live networks, the node, Caddy, any secret, `compose/phase0.yml` and the other compose files, other scratch projects.

## 7. Open facts

- Which host runs it, its free RAM (15.5 GiB plus others) and CPU, and whether Docker and a Compose with `configs.content` are present there.
- Whether the NeoForge P0 re-run is finished (sequencing).
- The NeoForge mod jar path, config file and agent profile of PT-N13.
- `scratch-neoforge.yml` limits (not read in this request; the 3072m / 1.5 figures come from `scratch.yml` and the brief).
- Whether `tm` is wanted at all given section 0.
