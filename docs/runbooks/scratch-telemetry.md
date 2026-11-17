# Scratch telemetry stack

The scratch project `scratch-telemetry` runs Paper with the Ledger plugin and a throwaway OTLP receiver. It is for the Ledger scratch test plan (`docs/analysis/telemetry/paper-plugin/scratch-test-plan.md`) and never touches the live stack. The general scratch rules, gates and NATS auth are in [scratch-stack.md](scratch-stack.md); this page adds only what differs.

## Start

Build the jars first: `cd plugin; ./gradlew build` (needs `plugin/ledger/build/libs/ledger.jar` and `geldar-core.jar`; a missing `ledger.jar` makes Docker create a directory in its place, so check it exists). Then, from the repository root:

```
export $(cat deploy/scratch/telemetry.env | xargs)                 # the project's own ports, no secrets
export SCRATCH_TELEMETRY_OUT="$HOME/.local/state/geldar/scratch-telemetry-out"   # absolute, outside the repo
mkdir -p "$SCRATCH_TELEMETRY_OUT"
export SCRATCH_OTEL_AGENT_JAR=<absolute path of the verified agent jar>          # optional; unset runs without an agent
sh deploy/scratch/scratch.sh up telemetry                           # NATS auth as in scratch-stack.md
sh deploy/scratch/scratch.sh status telemetry
```

`SCRATCH_TELEMETRY_OUT` must also be exported for `status` and `down`, because compose reads the overlay on every call. `deploy/scratch/scratch.sh` adds `compose/opt-in/scratch-telemetry.yml` after `scratch.yml` for this project only. The sink is the service `otel-sink`; it answers as `geldar-gateway:4318` on the scratch network, publishes no port and writes `otlp.jsonl` in `SCRATCH_TELEMETRY_OUT`. The Ledger config is `deploy/scratch/ledger.properties` (`enabled=true`), mounted read-only; edit it on the host to flip the kill switch.

## Verify

```
sh deploy/scratch/telemetry-verify.sh metric <name> [expected]   # count and last value; exit 1 when none or not equal
sh deploy/scratch/telemetry-verify.sh event <name> [text]        # count and last record; exit 1 when none or text missing
sh deploy/scratch/telemetry-verify.sh absent <string>            # exit 1 when the string occurs (secrets, addresses)
```

Wait at least two export intervals (15 s each) after the action. The rows to check are in the scratch test plan, section 3.

## Stop

`sh deploy/scratch/scratch.sh down telemetry` removes the containers, the world volume and the secrets directory. The output directory is yours: delete it by hand when done.

## The 15 GiB limit

The Paper container limit is 15360m (memory and swap), `PAPER_MEMORY` defaults to 10G and the CPU cap is 6 (`SCRATCH_PAPER_CPUS` lowers it on a smaller host). This is only in `scratch-telemetry.yml`; `scratch.yml` keeps `scratch-a` at 3072m and no live compose file changes. The live Paper limit is a separate node step.
