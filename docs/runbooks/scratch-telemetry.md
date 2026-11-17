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

The script ABORTs (prints `ABORT reason=...`) when Paper `memory.current` is above 14 GiB, `MemAvailable` is below 30 GiB, or a container without the label `geldar.scratch=true` restarts (its `StartedAt` is compared at every row boundary). On any exit, error or SIGTERM it writes back the original `ledger.properties` in place (same inode, checked by sha256), sets tick rate 20, unfreezes, unpauses what it paused and recreates Paper in its default configuration if an R1 or N1 arm is open. It never runs `docker stop`, `kill` or `rm`.

Exit codes: 0 no row failed (skips do not count), 1 a row failed, 2 environment or usage error (nothing ran), 3 ABORT, 4 the profile hash differs after the restore.

## Stop

`sh deploy/scratch/scratch.sh down telemetry` removes the containers, the world volume and the secrets directory. The output directory is yours: delete it by hand when done.

## The 15 GiB limit

The Paper container limit is 15360m (memory and swap), `PAPER_MEMORY` defaults to 10G and the CPU cap is 6 (`SCRATCH_PAPER_CPUS` lowers it on a smaller host). This is only in `scratch-telemetry.yml`; `scratch.yml` keeps `scratch-a` at 3072m and no live compose file changes. The live Paper limit is a separate node step.
