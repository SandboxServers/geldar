# Ledger jar and OTel agent on the scratch NeoForge stack: design and open items

Status: part 1 (the entrypoint, the scratch overlay and the scratch wiring). The nf-live wiring and the network join are later.

## Design

- `compose/neoforge/neoforge-entrypoint.sh` takes two optional extras, both off unless set:
  - the ledger jar at `/geldar/mods/geldar-ledger.jar` (read-only mount). It is copied into `mods/` only after its sha256 matches `GELDAR_NF_LEDGER_SHA256`. `off` is the soft kill: our own earlier copy is removed (a regular file or a symlink, unlinked without following it); a directory at that path is refused with exit 1; the server then starts without the ledger.
  - the OpenTelemetry Java agent (`GELDAR_NF_OTEL_AGENT=1`) at `/opt/otel/opentelemetry-javaagent.jar`, used in place (never copied), sha256-checked against `GELDAR_NF_OTEL_AGENT_SHA256`, with `-javaagent` and `-Dotel.javaagent.configuration-file` appended to `JVM_OPTS`. The properties file is `/opt/otel/otel-agent.properties`. The agent paths may not contain whitespace, because `JVM_OPTS` is split on it.
- `compose/opt-in/scratch-neoforge-ledger.yml` mounts four files read-only with `create_host_path: false`: the ledger jar, the agent jar, the agent properties and the ledger config at `/data/config/ledger.properties`. It declares no network.
- `deploy/scratch/scratch-ledger.sh` (sourced by `scratch.sh` only when a ledger or agent variable is set) validates on `up`, exit 2 before any docker call, and sets the host variables the overlay reads. The agent mounts point at the ledger files when the agent is off, so the placeholders are never read by the entrypoint.
- Host variables: `SCRATCH_NEOFORGE_LEDGER_JAR` and `SCRATCH_NEOFORGE_LEDGER_SHA256` (both or neither; `off` alone is the soft kill), `SCRATCH_LEDGER_PROPS`, and `SCRATCH_NEOFORGE_OTEL_AGENT_JAR`, `SCRATCH_NEOFORGE_OTEL_AGENT_SHA256`, `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS` (all three or none, only with the jar pair). They are not `SCRATCH_OTEL_AGENT_JAR`, the Paper telemetry variable; this feature never reads that one.

## Unverified items

1. The JVM variable on the `run.sh` branch. UNVERIFIED on the pinned image: that `JVM_OPTS` reaches the `java` command. No command has run it and no check covers it. The image's start script is said to write `user_jvm_args.txt` on the `run.sh` branch; that is not checked either, and NeoForge's own `run.sh` reading `user_jvm_args.txt` on this version is also not checked. Check on a host with the agent on and read the java command line (a read-only probe) before relying on it.
2. Whether Docker creates `/data/config` for the nested bind of `ledger.properties` inside the `paper-data` volume. The overlay sets `create_host_path: false` for the host file only; the target directory is expected to be created by the container runtime. Unverified on a host.
3. The soft kill works in scratch. With `SCRATCH_NEOFORGE_LEDGER_SHA256=off` alone, scratch.sh renders the env-only overlay `compose/opt-in/scratch-neoforge-ledger-off.yml` (two environment keys on `paper`, no mount, no network), so the entrypoint's `off` branch sees `GELDAR_NF_LEDGER_SHA256=off` and removes a stale ledger copy in the data volume. The nf-live wiring of the same kill is still to decide.
4. The OTLP endpoint is whatever the agent properties file says. Nothing in this repo sets or checks it.
5. The agent jar's pinned sha256 is the owner's to record. Nothing here downloads it.
6. The ledger jar comes from `deploy/build-neoforge-ledger.sh` (in this tree), which writes `neoforge-ledger-0.1.0.jar`; the host path to that jar is what `SCRATCH_NEOFORGE_LEDGER_JAR` takes.
7. The properties files (`SCRATCH_LEDGER_PROPS`, `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS`) are neither pinned nor checked. They control the export endpoint, and an `OTEL_*` environment variable set on the container overrides the agent file. Nothing validates either.

## nf-live wiring (later)

When `docs/runbooks/nf-live-project.md` takes this on, the variables become `NF_LEDGER_JAR_HOST`, `NF_LEDGER_SHA256`, `NF_OTEL_AGENT_JAR_HOST`, `NF_OTEL_AGENT_SHA256`, `NF_OTEL_AGENT_PROPS_HOST`, `NF_LEDGER_PROPS_HOST` and `NF_TELEMETRY` (`on` or `off`). The network join is a separate PR, after part 1b merges: only the `neoforge` service joins the external `geldar-telemetry` network, which the lead has approved. This PR adds no network.
