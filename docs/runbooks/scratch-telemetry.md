# Scratch telemetry stack

The scratch project `scratch-telemetry` runs Paper with the Ledger plugin and a throwaway OTLP receiver. It is for the Ledger scratch test plan (`docs/analysis/telemetry/paper-plugin/scratch-test-plan.md`) and never touches the live stack. The general scratch rules, gates and NATS auth are in [scratch-stack.md](scratch-stack.md); this page adds only what differs.

## Start

Build the jars first: `cd plugin; ./gradlew build` (needs `plugin/ledger/build/libs/ledger.jar` and `geldar-core.jar`; a missing `ledger.jar` makes Docker create a directory in its place, so check it exists). Then, from the repository root:

```
# No export for the ports: scratch.sh reads deploy/scratch/telemetry.env itself (only the SCRATCH_*_PORT lines,
# never sourced). A SCRATCH_*_PORT variable already exported wins. Do not export or source the file.
export SCRATCH_TELEMETRY_OUT="$HOME/.local/state/geldar/scratch-telemetry-out"   # absolute, outside the repo
mkdir -p "$SCRATCH_TELEMETRY_OUT"
export SCRATCH_OTEL_AGENT_JAR=<absolute path of the verified agent jar>          # optional; unset runs without an agent
export SCRATCH_NATS_AUTH_DIR=<absolute 0700 node dir with the five NATS auth files>   # required: without it up exits 2 and starts nothing
export GELDAR_ADMIN_IMAGE=geldar-admin:scratch-telemetry
sh deploy/scratch/scratch.sh up telemetry                           # generate the auth files per scratch-stack.md "NATS auth (fail closed)" steps 1-6
sh deploy/scratch/scratch.sh status telemetry
```

`SCRATCH_TELEMETRY_OUT` must also be exported for `status` and `down`, because compose reads the overlay on every call. `deploy/scratch/scratch.sh` adds `compose/opt-in/scratch-telemetry.yml` after `scratch.yml` for this project only. The sink is the service `otel-sink`; it answers as `geldar-gateway:4318` on the scratch network, publishes no port and writes `otlp.jsonl` in `SCRATCH_TELEMETRY_OUT`. The Ledger config is `deploy/scratch/ledger.properties` (`enabled=true`), mounted read-only; edit it on the host to flip the kill switch (edit in place, `cat new > file`: it is a single-file bind mount, a new inode is not seen). It sets `disk.area.world.path=/data/world`, a path inside the container; without a `disk.area.<name>.path` the disk collector does not start. `geldar-core.jar` comes from `compose/phase0.yml` and always loads. JFR is off in this profile; the JFR arm (row JFR-OH) copies `deploy/scratch/ledger-jfr.properties` over it.

## Verify

```
sh deploy/scratch/telemetry-verify.sh metric <name> [expected]   # count and the LAST data point of that metric; exit 1 when none or not equal
sh deploy/scratch/telemetry-verify.sh max <name>[@key=value] [min]           # largest data point over the exports read (a state held for a window)
sh deploy/scratch/telemetry-verify.sh histcount <name> [min_growth]   # first, last and delta of a histogram count
# SCRATCH_TELEMETRY_SINCE_LINE=<n> ignores the first n sink lines (n = cat "$SCRATCH_TELEMETRY_OUT"/*.jsonl | wc -l before the action)
sh deploy/scratch/telemetry-verify.sh event <name> [text]        # count and last record; exit 1 when none or text missing
sh deploy/scratch/telemetry-verify.sh absent <string>            # exit 1 when the string occurs (secrets, addresses)
```

Wait at least two export intervals (15 s each) after the action. The rows to check are in the scratch test plan, section 3.

## Row driver

`deploy/scratch/telemetry-rows.sh` runs the rows T1, T3, T4, T5, T6, S1, V6, G1, X4, X6, D1, K1, R1, N1, N2, C1 and Q1 of the test plan in that order against a running stack, so an ops agent runs one command instead of one row at a time. Copy it and `telemetry-verify.sh` into one directory on the node, check both sha256 values, and run it once with the stack up (six containers, Paper healthy, `ledger.properties` the committed profile) and `SCRATCH_TELEMETRY_OUT` and `SCRATCH_NATS_AUTH_DIR` exported (and `SCRATCH_OTEL_AGENT_JAR` if the stack runs the agent; N1 skips without it). Set `SCRATCH_REPO_ROOT` to a checkout if the script is not run from `deploy/scratch/` of one: R1, N1 and N2 recreate Paper with `docker compose` and need `compose/`.

```
nohup sh telemetry-rows.sh >rows.out 2>&1 &
sh telemetry-rows.sh --list        # rows and dependencies
sh telemetry-rows.sh --only T1,T3  # a subset; a row whose dependency was not run is skipped with its reason
sh telemetry-rows.sh --print-compose-files   # the compose -f list it duplicates from scratch.sh
```

Stdout holds one line per row, `ROW <id> PASS|FAIL|SKIP got=<value> want=<expectation>` (a skip carries `reason=...`; T6 prints `reason=no-spark-jar` because no spark jar is in `/data/plugins`), then a `SUMMARY` block: Paper `memory.current` and its cgroup path, `nr_throttled`, `geldar_ledger_dropped_total` last and max, the `tick query` output, the node clock at start and end (UTC) and the sha256 of `ledger.properties` at start and end (they must be equal). Detail goes to `telemetry-rows-<utc>.log` in `SCRATCH_TELEMETRY_OUT`. A failed row skips only its dependents (`--list` shows them). Q1 runs idle, without bench load, and pauses (never stops) `otel-sink`; the C1 arm with the Paper `cpus` limit at 1 is not run.

The script ABORTs (prints `ABORT reason=...`) when Paper `memory.current` is above 14 GiB, cannot be found at start (exit 2) or reads 0 or goes missing later (the cgroup is looked up again after every recreate and at every row boundary), `MemAvailable` is below 30 GiB, or a container that existed at start and is not labelled `geldar.scratch=true` restarts (its `StartedAt` and restart count are compared at every row boundary; a container that merely appears or disappears is ignored). The log names only the scratch containers and counts the others; it and the saved profile are mode 0600. On any exit, error or SIGTERM it writes back the original `ledger.properties` in place (`cat >` keeps the inode; the sha256 is compared, the inode is only logged), sets tick rate 20, unfreezes, unpauses what it paused and recreates Paper in its default configuration if an R1 or N1 arm is open. It never runs `docker stop` or `docker kill`; its own removals are its temp files and, in R1, `/data/plugins/ledger.jar` inside the scratch Paper (`docker exec ... rm -f`), and `docker compose up --force-recreate` replaces the Paper container itself for R1, N1 and N2.

R1, N1 and N2 recreate Paper only when the driver would rebuild exactly what `scratch.sh up` started: `XDG_STATE_HOME` and `SCRATCH_REPO_ROOT` (or the checkout the script sits in) must equal those of the `up`, which the script checks against the compose labels of the running Paper, the NATS override file and the profile file. Otherwise the rows print `SKIP reason=env-mismatch`.

Exit codes: 0 no row failed (skips do not count), 1 a row failed, 2 environment or usage error (nothing ran), 3 ABORT, 4 the profile hash differs after the restore (the saved copy `ledger.properties.orig.<pid>` is kept and its path printed), 5 Paper is not back in its default configuration. The script prints a `RECOVERY` line with the saved-profile and log paths at start.

### After kill -9 or a lost shell

Nothing is restored when the script is killed with SIGKILL or the shell is lost. By hand, from the node:

1. Unpause what the script may have paused (T3 pauses Paper for 4 s, Q1 `otel-sink` for 10 min): `docker ps --filter label=com.docker.compose.project=scratch-telemetry --filter status=paused -q | xargs -r docker unpause`.
2. Undo the tick state (T4, T5): `docker exec <paper> rcon-cli 'tick unfreeze'`, then `'tick rate 20'`.
3. Restore the profile in place (G1, K1), never with `mv` or an editor: `cat "$SCRATCH_TELEMETRY_OUT"/ledger.properties.orig.<pid> > <path of deploy/scratch/ledger.properties>`, then compare `sha256sum` with the `profile_sha256` in the log.
4. Put Paper back in its default configuration if R1 or N1 was running: `sh deploy/scratch/scratch.sh up telemetry` (same environment as the first `up`), then delete `"$SCRATCH_TELEMETRY_OUT"/r1-override.yml` and the empty directory `r1-empty`.
5. Check `docker ps` shows paper healthy and `otel-sink` running.

## NeoForge row driver

`deploy/scratch/telemetry-rows-nf.sh` is the same kind of driver for the scratch NeoForge project `scratch-nf` (`SCRATCH_PLATFORM=neoforge`; the service is called `paper` in these overlays) with the ledger mod, the OpenTelemetry agent and the OTLP sink running. Output contract, abort rules, restore-on-exit trap, exit codes and `--list`/`--only` are those of the Paper driver above; every container lookup carries the label `com.docker.compose.project=scratch-nf`, and it only pauses (never stops, kills or removes) that one container. Run it once, with the stack up and healthy, from a directory that holds it and `telemetry-verify.sh`, with `SCRATCH_TELEMETRY_OUT` exported:

```
nohup sh telemetry-rows-nf.sh >rows-nf.out 2>&1 &
sh telemetry-rows-nf.sh --list
sh telemetry-rows-nf.sh --only NF0,NF1,NF2
```

Rows (order as printed by `--list`; NF8 runs after NF9A-C, and NF11 before NF10 because NF10 may restart the server; NF0 failing skips the other rows, any other row skips only its listed dependents): NF0 environment (journal has a batch within 2 export intervals; `-javaagent` in the running java process, found through `/proc/1/cmdline` or else a `/proc/*/cmdline` scan, and the row reports which; the flag in `/data/user_jvm_args.txt`; the agent's startup line in the log; the ledger properties copy in `/data/config` has the sha256 of the host file that is mounted read-only under `/geldar/telemetry/`; the mod jar in `/data/mods/`; the `Geldar Ledger` log line), NF1 minimal resource attributes (`service.name=geldar-neoforge`, `geldar.shard=nf` or `SCRATCH_ROWS_SHARD`; no `host.*`, `process.*`, `os.*`, `container.id`, IPv4, IPv6 or UUID-shaped value in any batch), NF2 tick lag histogram rate 20/s +-5%, NF3 players online against `list`, `geldar_mods_loaded` >= 2 and the `geldar.server.config_snapshot` keys (none of `rcon`, `query`, address, seed, password), NF4 world gauges for `minecraft:overworld` (presence and plausibility; the server's own `neoforge tps` reply goes to the log, no command gives a loaded-chunk total, so `server_chunk_count=unavailable`), NF5 stall (pauses the server 4 s; the Paper contract: stalls +1, flag=1 at 2000-2500 ms, then flag=0 at 4000 ms +-10%), NF6 connections (runs `sh deploy/scratch/scratch.sh probe nf` with `SCRATCH_PLATFORM=neoforge`, so `SCRATCH_NATS_AUTH_DIR` must hold the six probe files; or give `SCRATCH_ROWS_PROBE_CMD`; without either the row prints `SKIP reason=no-probe-driver`; expects `geldar.player.join` with `geldar.life_id` and an ULID `geldar.mc_session`, and `geldar.player.quit` with a duration and the same session), NF7 respawn continuity (no way to make the probe die and respawn: `SKIP reason=no-respawn-driver`; it still fails if a snapshot carries a session other than the join's), NF9A chat is off (no `ledger chat export on` line in the container log or in `/data/logs/latest.log`, no `geldar.chat` record anywhere in the journal; skipped if the profile has `collector.chat.enabled=true`), NF9B commands are exported by name only (sends `say marker-argument-xyz`, `msg ag_nfprobe_01 secret-arg-abc` and `rcon hunter2 x` over RCON; expects `geldar.rcon.command` records whose `geldar.command` is `say` with `geldar.amount` 1, `msg` with 2 and `unknown` for the non-root, and `telemetry-verify.sh absent` finds none of `marker-argument-xyz`, `secret-arg-abc`, `hunter2` anywhere in the journal; skipped unless the profile has `collector.audit.enabled=true`), NF9C operator and combat (needs an agent named `ag_...` online, which is not the case after the probe has left: then `SKIP reason=no-driver`; otherwise `op`, `deop` and `kill` of that agent over RCON, expecting `geldar.operator.change` flags 1 then 0 and `geldar.combat.player_death` with the agent `geldar.life_id`; `geldar.operator.change` covers online players only, so a throwaway offline name cannot drive it; a human name is never driven), NF9D the chat name mask is idle with chat off (no row; the SUMMARY says `chat_name_mask=idle`), NF8 no IPv4, IPv6 or UUID-shaped string anywhere in the journal, run after NF9A-C so it scans everything they produced (a dotted four-number version string would be a false positive; the log has the hit count only), NF11 memory (`memory.current` at start and now, the cgroup `memory.max`, `nr_throttled`, java RSS), NF10 kill switch.

NF10 writes `enabled=false` into the host profile and, with `docker exec -i ... cat >`, into the copy in `/data/config` that the mod reads (in place), waits 30 s and counts the geldar points of the next 20 s (ledger housekeeping gauges `geldar_ledger_*` are not counted). If records stop, the mod reloaded the file live. If they continue, the row records `mode=restart` and recreates the server with `docker compose -p scratch-nf --project-directory <label> -f <labelled files> up -d --no-deps --force-recreate paper` (files and directory read from the container's compose labels; the SCRATCH_* and GELDAR_NF_* variables of the shell that ran `scratch.sh up` must be exported, compose refuses before it touches anything otherwise). Then both files are restored from the saved original, the sha256 of the copy is compared with the profile's start value and records must resume. A recreate takes the usual start time (up to 10 minutes of waiting for healthy).

The abort threshold is 90% of the container's cgroup `memory.max` (14 GiB when it is not a number), plus `MemAvailable` below 30 GiB and a restarted non-scratch container, as in the Paper driver. NF12 (shutdown flush) is not a row: stop the stack by hand afterwards and read the last export in the journal; the SUMMARY says so. Every name and path the driver assumes about the stack (service, mount and copy paths, jar and user_jvm_args paths, log marks, the tick histogram, the world) is in one variables block at the top of the script. Recovery after `kill -9`: unpause the container (`docker ps --filter label=com.docker.compose.project=scratch-nf --filter status=paused -q | xargs -r docker unpause`), restore the host profile and the container copy from `"$SCRATCH_TELEMETRY_OUT"/ledger.properties.orig.<pid>` with `cat >` (the copy through `docker exec -i <container> sh -c 'cat >/data/config/ledger.properties'`), compare the sha256 values, and check the server is healthy.

## Stop

`sh deploy/scratch/scratch.sh down telemetry` removes the containers, the world volume and the secrets directory. The output directory is yours: delete it by hand when done.

## NeoForge

The NeoForge scratch project (suffix `nf`) has the same sink: set `SCRATCH_NEOFORGE_TELEMETRY_SINK=1` and `SCRATCH_TELEMETRY_OUT`. The start sequence, the checks and the teardown are in [scratch-stack.md](scratch-stack.md), "Telemetry sink on the scratch NeoForge stack". The verify script here reads its `otlp.jsonl` unchanged.

## The 15 GiB limit

The Paper container limit is 15360m (memory and swap), `PAPER_MEMORY` defaults to 10G and the CPU cap is 6 (`SCRATCH_PAPER_CPUS` lowers it on a smaller host). This is only in `scratch-telemetry.yml`; `scratch.yml` keeps `scratch-a` at 3072m and no live compose file changes. The live Paper limit is a separate node step.
