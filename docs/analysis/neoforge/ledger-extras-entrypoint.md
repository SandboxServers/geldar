# Ledger jar and OTel agent on the scratch NeoForge stack: design and open items

Status: part 1 (the entrypoint, the scratch overlay and the scratch wiring). The nf-live wiring and the network join are later.

## Design

- `compose/neoforge/neoforge-entrypoint.sh` takes two optional extras, switched by one variable, `GELDAR_NF_TELEMETRY=on|off` (unset changes nothing):
  - `on`: the ledger jar is mounted read-only at `/geldar/mods/geldar-neoforge-ledger.jar` and copied to `$data/mods/geldar-neoforge-ledger.jar` only after its sha256 matches `GELDAR_NF_LEDGER_SHA256`. The ledger properties are mounted read-only at `/geldar/telemetry/ledger.properties` and copied to `$data/config/ledger.properties` at every start (atomic: written to `.part`, mode 644, renamed into place; a symlink source is refused).
  - `on`: the OpenTelemetry Java agent is mounted read-only at `/geldar/telemetry/opentelemetry-javaagent.jar` (never copied) with its properties at `/geldar/telemetry/otel-agent.properties`. Its sha256 must match `GELDAR_NF_OTEL_AGENT_PIN`, a repo constant set in the overlay, not an operator value. The entrypoint appends `-javaagent:/geldar/telemetry/opentelemetry-javaagent.jar -Dotel.javaagent.configuration-file=/geldar/telemetry/otel-agent.properties` to `JVM_OPTS`.
  - `off`: a mounted ledger jar is refused. Our own stale copy (exact name, never followed) is removed, and a directory or other non-file at that path is refused with exit 1. No agent flag is added, `OTEL_SDK_DISABLED=true` is exported, and `JAVA_AGENTS` and `OTEL_JAVAAGENT_CONFIGURATION_FILE` are unset, so the shared script's own agent and SDK settings are inert. The server then starts without the extras.
  - unset: a mounted ledger jar, a stale copy or a pin with no jar stops the start, as before. Any other value stops the start.
- The agent pin is `GELDAR_NF_OTEL_AGENT_PIN=e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149` in `compose/opt-in/scratch-neoforge-ledger.yml`. A repo test checks that the overlay and this document carry the same value.
- `compose/opt-in/scratch-neoforge-ledger.yml` mounts four files read-only under `/geldar/telemetry/` and `/geldar/mods/` with `create_host_path: false`. It declares no network. `compose/opt-in/scratch-neoforge-ledger-off.yml` sets only `GELDAR_NF_TELEMETRY=off` on `paper`, with no mount.
- `deploy/scratch/scratch-ledger.sh` (sourced by `scratch.sh` only when a ledger or telemetry variable is set) validates on `up`, exit 2 before any docker call, and sets the host variables the overlay reads.

## Renamed from the first draft

The first draft of this part used other names. None of them remain in the code, the overlays or the runbook.

| Old | New |
|---|---|
| `SCRATCH_OTEL_AGENT_JAR`, `SCRATCH_OTEL_AGENT_PROPS` (in the draft) | `SCRATCH_NEOFORGE_OTEL_AGENT_JAR`, `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS` |
| `SCRATCH_OTEL_AGENT_SHA256` | removed: the agent pin is the repo constant `GELDAR_NF_OTEL_AGENT_PIN` |
| `GELDAR_NF_OTEL_AGENT=0\|1` | `GELDAR_NF_TELEMETRY=on\|off` |
| literal `GELDAR_NF_LEDGER_SHA256=off` (the soft kill) | `GELDAR_NF_TELEMETRY=off` in the container, and host `SCRATCH_NEOFORGE_TELEMETRY=off` |
| `/opt/otel/*` | `/geldar/telemetry/*` |
| a nested bind of the ledger config at `/data/config` | a mount at `/geldar/telemetry/ledger.properties`, copied to `/data/config/ledger.properties` at every start |
| `geldar-ledger.jar` | `geldar-neoforge-ledger.jar` (mount and copy) |

## Host variables

`SCRATCH_NEOFORGE_TELEMETRY=off` alone is the soft kill: it sets `GELDAR_NF_TELEMETRY=off` and renders the env-only overlay. It refuses with any of the five variables below.

Otherwise all five or none. All five set `GELDAR_NF_TELEMETRY=on` for the container:

- `SCRATCH_NEOFORGE_LEDGER_JAR` and `SCRATCH_NEOFORGE_LEDGER_SHA256` (the ledger jar and its pin, 64 lowercase hex digits);
- `SCRATCH_LEDGER_PROPS` (the ledger config; copied into the container's `config/` at every start);
- `SCRATCH_NEOFORGE_OTEL_AGENT_JAR` and `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS` (the agent jar and its properties).

The agent has no host hash variable: its pin is the repo constant above.

## How the agent reaches the JVM

`JVM_OPTS` is the mechanism, not `JAVA_AGENTS`. On the pinned itzg image, `start-finalExec` (lines 634-635 of its start script) writes `$JVM_XX_OPTS $JVM_OPTS $expandedDOpts` to `user_jvm_args.txt` on every start for NeoForge, so `JVM_OPTS` reaches that file. `JAVA_AGENTS` is not used: on that image it goes through `addAgents` and `mc-image-helper mcopy`, which is a download list, and the agent is not downloaded here.

## Unverified items

1. The agent attach. UNVERIFIED: that the agent is in `ps` and in the logs. Settle it by the scratch run (agent in `ps` and the logs). Also UNVERIFIED: that NeoForge's `run.sh` reads `user_jvm_args.txt` for this version (`start-deployNeoForge` is not confirmed). A read-only probe of the java command line on a host with the agent on settles both.
2. Whether Docker creates `/data/config` for the nested bind of `ledger.properties` inside the `paper-data` volume. The overlay mounts the host file under `/geldar/telemetry/`, and the entrypoint copies it, so no nested bind is needed. Still unverified on a host, because the copy target directory is created by the entrypoint.
3. The soft kill works in scratch. `SCRATCH_NEOFORGE_TELEMETRY=off` alone renders `compose/opt-in/scratch-neoforge-ledger-off.yml`, so the entrypoint's `off` branch removes a stale ledger copy in the data volume and starts without the extras. The nf-live wiring of the same kill is still to decide.
4. The OTLP endpoint is whatever the agent properties file says. Nothing in this repo sets or checks it.
5. The agent jar's pinned sha256 is the owner's to record. Nothing here downloads it.
6. The ledger jar comes from `deploy/build-neoforge-ledger.sh` (in this tree), which writes `neoforge-ledger-0.1.0.jar`; the host path to that jar is what `SCRATCH_NEOFORGE_LEDGER_JAR` takes.
7. The properties files (`SCRATCH_LEDGER_PROPS`, `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS`) are neither pinned nor checked. They control the export endpoint, and an `OTEL_*` environment variable set on the container overrides the agent file. Nothing validates either.

## nf-live wiring (later)

When `docs/runbooks/nf-live-project.md` takes this on, the variables become `NF_LEDGER_JAR_HOST`, `NF_LEDGER_SHA256`, `NF_OTEL_AGENT_JAR_HOST`, `NF_OTEL_AGENT_PROPS_HOST`, `NF_LEDGER_PROPS_HOST` and `NF_TELEMETRY` (`on` or `off`). The network join is a separate PR, after part 1b merges: only the `neoforge` service joins the external `geldar-telemetry` network, which the lead has approved. This PR adds no network.
