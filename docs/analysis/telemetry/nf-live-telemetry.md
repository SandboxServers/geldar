# Telemetry for the live NeoForge shard (geldar-nf): minimal design

Status: DESIGN, docs only. No node contact, no Docker, nothing started. Written 2026-11-17 against origin/main at 2f7625ce.
Every file named below was read; claims that no file settles are marked UNVERIFIED.
Updated 2026-11-17: section 0a records geldar-neoforge's answers and the owner's decisions and **supersedes** the sections
below where they differ (Option A is the default, not Option B; the build script is `deploy/build-neoforge-ledger.sh`).

Goal: the live shard (compose project `geldar-nf`, `compose/nf-live.yml`, operated with `deploy/nf-deploy.sh`, runbook
`docs/runbooks/nf-live-project.md`, owned by the geldar-neoforge session) ships telemetry from the `neoforge` service
(NeoForge 26.1.2 (build 126)) to the telemetry gateway (`geldar-gateway`, OTLP/HTTP 4318), with a bring-up that takes
minutes, no soak, and the smallest possible edit to the geldar-neoforge files.

## 0a. Answers and decisions of 2026-11-17 (they supersede the sections below where they differ)

Recorded from geldar-neoforge's answers, the node audit and the owner's direct decisions. Where this section and a later
one disagree (Option B as "recommended", `deploy/scratch/` as the script's place, the open questions), this section wins.

**Network: Option A is the default now; the relay (Option B) is later hardening.**
- Only the `neoforge` service joins the external network `geldar-telemetry` (endpoint `http://geldar-gateway:4318`). No relay
  service is added; the six-service list stays six. `nf-live-compose.test.ts` carries an allow-list for exactly that service
  and that network name (geldar-neoforge's file). `nf-deploy.sh up` refuses if the network is missing; `nf-deploy.sh down`
  never removes it (it is external).
- Exposure, from the node audit: `geldar-telemetry` is a bridge, local, labelled `geldar.purpose=telemetry`, and is **not** an
  internal network. Its members are `geldar-signoz-otelcol`, `geldar-ch` and `geldar-gateway` only; ClickHouse is reachable
  from it, the keeper is not. Only `geldar-gateway` is also on `geldar-colo`. The gateway's OTLP ingest is unauthenticated on
  this network, so the `neoforge` container (which runs third-party mods) could write telemetry under any `service.name`. That
  is the accepted cost of Option A until the relay exists.
- The gateway upserts `deployment.environment.name=colo` on every signal, so that tag is **misleading** for nf data. nf data
  is told apart by `service.name=geldar-neoforge` and `geldar.shard=nf`. A gateway change that tags nf correctly is a later
  restage (geldar-93's), not part of the first bring-up.
- Gateway headroom at the audit: 0.33% of 0.5 CPU and 61 MiB of 1 GiB. Re-check after the first nf hour.

**Entrypoint and compose switches (geldar-neoforge's files; their branch `phase1/nf-entrypoint-ledger` is in progress).**
- The telemetry block is default **off** in the shared entrypoint (scratch is unchanged); `compose/nf-live.yml` sets it on.
- Env names: `GELDAR_NF_LEDGER_SHA256` (the value `off` is an explicit soft kill that also removes our own previous ledger
  copy from `mods/`), `GELDAR_NF_OTEL_AGENT` (0 or 1), `GELDAR_NF_OTEL_AGENT_SHA256`. `NF_TELEMETRY=off` maps to both.
- Memory: the cap decision (`12288m` limit, 9G heap, trigger at 11 GiB container memory, heap 8G first) is geldar-neoforge's.
- The first live stage needs no player. The live probe needs a `body` NATS user limited to the nf registry bucket, an rcon
  secret, `nf-deploy.sh probe`, an opt-in p0-probe overlay and a `golem/**` isolation-check change (geldar-93's window): that
  is geldar-neoforge's packet, not ours.

**Owner decisions.**
- "Enable all functionality once fully coded and deployed": owner direct, 2026-11-17 (decision record 0374, Proposed).
- D-F, updated today by the owner directly: human chat is exported **with a name mask**: the verbatim text with human names
  masked, agent names allow-listed, the mask applied before export and failing closed, tested with fake names, **no speaker
  id**. Stated weaknesses: emails, coordinates, nicknames and misspellings, names not yet seen can still pass. Record 0375
  (Proposed) holds it; 0387 item 8 ("nothing human-written is exported until answered") is answered by it.
- Chat export stays **off** on geldar-nf (`collector.chat.enabled=false`, default false) until the mask is built and tested.
  Branch `telemetry/nf-chat-switch` builds the switch, the command-name-only change and the mask. **Do not stage a ledger jar
  built before that branch has merged**: without the switch, `collector.audit.enabled=true` exports chat text.
- geldar-neoforge found that their own event export wrote the human's name in `player` to NATS and Postgres and is fixing it in
  `neoforge/` only (not our files).

**Artifacts.**
- Build script: `deploy/build-neoforge-ledger.sh` (not under `deploy/scratch/`). It refuses unless the jar is exactly
  `geldar-neoforge-ledger-0.1.0.jar` (the real name the build produces), has `META-INF/neoforge.mods.toml` with modId `ledger`
  and nests exactly four jars (`geldar-plugin.ledger-core-0.1.0.jar` and `opentelemetry-api`, `-common`, `-context` 1.67.0),
  with no jnats. It records the exact commit, never weakens dependency verification and adds no `--offline`.
- **Reproducibility (answers question 14): yes.** Two builds from two clean `git archive` exports of the same commit, in two
  different directories, gave byte-identical jars (same sha256, 448749 bytes) with no change to `build.gradle.kts`: the Gradle
  jar task there already writes a stable entry order and times. Observed on one machine (Windows, one JDK 25 and one Gradle
  cache); a build on another OS or JDK is not proven identical. The pin is still the hash of the one jar that is staged and
  compared over a second channel.
- Staging: the ledger jar goes in the same 0700 directory as the geldar mod jar, under the ops account's home on the node,
  never in a repo; its sha256 comes from `build-neoforge-ledger.sh` on a clean export, with the commit recorded.
- Agent profile `compose/neoforge/otel-agent.properties` (minimum, from geldar-neoforge's privacy check): every
  auto-instrumentation off, then only the OpenTelemetry API bridge and the JVM runtime metrics on; the log4j, logback and
  java-util-logging appenders off; metrics and logs exporters `otlp`, traces `none`, `http/protobuf`, endpoint the gateway
  service name; the identity resource providers (host, host id, OS, process with command line and owner, process runtime,
  container) disabled, so the resource holds `service.name`, `service.namespace` and `geldar.shard=nf`. UNVERIFIED against agent
  2.33.1: the provider class names (`otel.java.disabled.resource.providers`) and the key `otel.experimental.resource.disabled.keys`.
  The first live run settles them: the first exported batch must hold no `host.name`, `process.*` or `os.*`.
- Ledger profile `compose/neoforge/ledger.properties`: all neoforge collectors on, `collector.chat.enabled=false`. Both
  profiles are checked by `tools/repo-checks/src/nf-live-telemetry-config.test.ts`.

### SigNoz import (ops runbook, part 1: NeoForge; part 2: Paper)
Done by ops with a **limited SigNoz login created by the owner** (decision 0376); the login is never in the repo or in chat.
1. Part 1: in the SigNoz UI, Dashboards, New dashboard, Import JSON: `deploy/signoz/neoforge-dashboard.json`. Then Alerts,
   New alert rule, import: `deploy/signoz/neoforge-alerts-server.json` and `deploy/signoz/neoforge-alerts-capacity.json`.
2. Via the API instead (SigNoz v0.148.1): `POST /api/v1/dashboards` for the dashboard JSON and `POST /api/v1/rules` for each
   alert rule, with the login's token in an `Authorization` header from the operator's shell. These two endpoints are the ones
   known from the SigNoz source; the exact request envelope (whether the file body is posted as is) and the auth scheme are
   UNVERIFIED until tried once from the operator's machine. Every other endpoint is UNVERIFIED.
3. Verify: the dashboard panels show data for `service.name=geldar-neoforge` within 3 minutes of the first server start (the
   checklist rows of section 3); the alert rules list as enabled and none fires at idle.
4. Part 2 (Paper): the same with `deploy/signoz/paper-dashboard.json`, `paper-alerts-server.json` and `paper-alerts-capacity.json`,
   filtered on `service.name=geldar-paper`.
5. Rollback: delete the imported dashboard and alert rules in the UI (or the matching `DELETE` calls, UNVERIFIED). Nothing else
   changes; telemetry data stays.

## 0. Findings that shape the design

1. **Nothing is deployed yet on the nf side** (runbook status line: "Nothing here is deployed"; section 7 item 9). If that
   is still true, telemetry should be merged before the first `up`, so it costs no extra restart. Section 3 covers both cases.
2. **The ledger needs the agent.** `neoforge-ledger` obtains its instruments from `GlobalOpenTelemetry`; without the
   OpenTelemetry Java agent it is a no-op (neoforge-otel-spike.md, "What the mod must do" 3 and 4). So two artifacts are
   mounted, not one: the mod jar and the agent jar. The mod nests ledger-core and the OTel API (jar-in-jar), so it is one
   file; nothing else goes into `mods/`.
3. **No build script exists for the ledger jar.** `deploy/scratch/build-neoforge-mod.sh` is hard-wired to `neoforge/`
   (`nf="$root/neoforge"`, one jar in `neoforge/build/libs`). `grep neoforge-ledger deploy/` finds nothing.
4. **The shared entrypoint is also the scratch entrypoint.** `compose/neoforge/neoforge-entrypoint.sh` is used by
   `compose/opt-in/scratch-neoforge.yml` and tested by `scratch-neoforge-entrypoint.test.ts`. Any edit must leave scratch
   behaviour unchanged: the new telemetry switch defaults to **off** in the script and the live compose file sets it **on**.
5. **Bundle mode checks `mods/` exactly.** Before the bundle check the entrypoint removes the earlier copy of the geldar jar
   so `mods/` matches the bundle list, then copies the jar again after the check. A second copied jar needs the same
   treatment, or the second start fails with "mods/ holds files the offline bundle does not list".
6. **The entrypoint runs `umask 077`.** A `config/` directory or file it creates would be mode 700/600 and unreadable by the
   server uid unless chowned. The new block chowns what it creates (as the existing PCF block does for its first write).
7. **The gateway's `resource` processor upserts `deployment.environment.name=colo`** on every signal (gateway.yaml). The
   nf shard's data will be labelled `colo` in SigNoz. The producer cannot override an upsert. `service.name=geldar-neoforge`
   is what separates it (the dashboard filters on that). This is the gateway owner's call (question 9); no change is
   needed for the first bring-up.
8. **Shipping the server log would defeat D-F.** The Paper profile enables the `log4j-appender`. On NeoForge that ships
   the console log, which carries `<HumanName> text` chat lines, join lines and commands, so human names would reach
   SigNoz even though the ledger records humans without id. The nf profile below turns the appender **off** (question 11).
   The ledger's own events do not use it: they go through the API's log bridge.

## 1. The minimal set of changes

Option B (the recommended network design, 1d) is assumed in the snippets; the Option A differences are marked.

### 1a. The second mod jar (the ledger)

- **Artifact:** `neoforge-ledger/` (`rootProject.name = "geldar-neoforge-ledger"`, version 0.1.0), built by
  `./gradlew build` there. The jar name is expected to be `geldar-neoforge-ledger-0.1.0.jar` (UNVERIFIED: read it from the
  first build). The build is a sibling Gradle build with its own `verification-metadata.xml` and lockfiles, Java 25 toolchain,
  ledger-core by composite build, OTel API 1.67.0 nested by jarJar.
- **Reproducible build (new file, ours):** `deploy/scratch/build-neoforge-ledger.sh`, a copy of `build-neoforge-mod.sh` with
  three changes: `nf="$root/neoforge-ledger"`, `jar_name=geldar-neoforge-ledger.jar`, and an extra check that the jar
  lists `META-INF/jarjar/` entries for ledger-core and the three `opentelemetry-*` jars (so a build that lost the nesting
  is refused; without them the mod fails at load on the server, which has neither). Same rules as the original: clean
  export of main, `GELDAR_MOD_BUILD_COMMIT`, wrapper checksum pin, dependency verification on, ambient Gradle/JAVA options
  cleared, output = jar, `.sha256`, `.build-info`. It is a new file in `deploy/scratch/`; no existing file changes.
  Byte-for-byte reproducibility across two builds is UNVERIFIED (it needs `reproducibleFileOrder` and
  `preserveFileTimestamps=false` on the jar task). Until proven, the pin is the hash of the one jar that was built and
  compared over a second channel, exactly as for the geldar jar; a bring-up pre-step builds twice and records whether the
  hashes agree.
- **Where it lives on the node:** beside the geldar mod jar, in the directory the ops account owns, outside the export.
  Variables: `NF_LEDGER_JAR_HOST` (host path), `NF_LEDGER_SHA256` (64 lowercase hex).
- **Compose (neoforge service), fail-closed like the geldar jar:**

```yaml
      - type: bind
        source: ${NF_LEDGER_JAR_HOST:-./nf-live-unset/geldar-neoforge-ledger.jar}
        target: /geldar/mods/geldar-neoforge-ledger.jar
        read_only: true
        bind:
          create_host_path: false
```
  and in `environment`: `GELDAR_NF_LEDGER_SHA256: "${NF_LEDGER_SHA256:-}"`.
- **Entrypoint (what it must do):** with telemetry on, refuse a symlink or non-regular file, refuse an `NF_LEDGER_SHA256`
  that is not 64 lowercase hex, hash the mounted jar, refuse a mismatch, copy to `$data/mods/geldar-neoforge-ledger.jar`
  (mode 644, owner of `$data`), hash the copy again, delete it and refuse on a mismatch. Always remove an earlier copy
  before the bundle check (finding 5). Exact diff in 2.

### 1b. The OpenTelemetry Java agent 2.33.1

- **Artifact:** `opentelemetry-javaagent` 2.33.1 from Maven Central, 26507624 bytes, sha256
  `e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149` (neoforge-otel-spike.md; the spike notes that the lock
  file of PT-02a is to be compared). The pin is a constant in the entrypoint (as the installer pins are): it is a public
  artifact, not something we build. Host side: `NF_OTEL_AGENT_HOST` (path), read-only mount at
  `/geldar/telemetry/opentelemetry-javaagent.jar`, `nf-deploy.sh` gate checks the same sha256 before anything starts.
- **JVM flag:** the pattern already used by `compose/opt-in/scratch-telemetry.yml` (PT-03k): the itzg `JAVA_AGENTS`
  variable (a bare `-javaagent`) plus the profile by environment variable, because `JAVA_AGENTS` takes no options:

```yaml
      JAVA_AGENTS: /geldar/telemetry/opentelemetry-javaagent.jar
      OTEL_JAVAAGENT_CONFIGURATION_FILE: /geldar/telemetry/otel-agent.properties
      OTEL_SDK_DISABLED: "false"
```
  UNVERIFIED: that the pinned itzg image (2026.10.1-java25) applies `JAVA_AGENTS` on the NeoForge start path (the scratch
  overlay proves it for Paper only). Checked in the first minute of bring-up with `docker top` (4a). Fallback if absent:
  `JVM_OPTS: "-javaagent:/geldar/telemetry/opentelemetry-javaagent.jar -Dotel.javaagent.configuration-file=/geldar/telemetry/otel-agent.properties"`.
  The entrypoint ends in `exec .../start "$@"`, so it needs no change to pass either variable; it only unsets them when
  telemetry is off.
- **Agent properties: new file `compose/neoforge/otel-agent.properties`** (read-only mount; no address, token or header;
  derived from `compose/paper/otel-agent.properties`, the same 2.33.1 key names):

```properties
otel.instrumentation.common.default-enabled=false
otel.instrumentation.opentelemetry-api.enabled=true
otel.instrumentation.runtime-telemetry.enabled=true
# Off on purpose (finding 8): the server log carries human names and chat lines.
otel.instrumentation.log4j-appender.enabled=false
otel.instrumentation.java-util-logging.enabled=false
otel.propagators=tracecontext
otel.exporter.otlp.protocol=http/protobuf
otel.exporter.otlp.endpoint=http://telemetry-relay:4318
otel.service.name=geldar-neoforge
otel.resource.attributes=service.namespace=geldar,geldar.shard=nf
otel.sdk.disabled=false
otel.metrics.exporter=otlp
otel.logs.exporter=otlp
otel.traces.exporter=none
otel.metric.export.interval=15000
otel.blrp.max.queue.size=2048
```
  Exporters: metrics and logs (ledger events are log records) over OTLP/HTTP; traces `none` (no auto-instrumentation is
  on, so no spans exist; this saves a queue; the Paper file leaves it at the default, a deliberate difference).
  `otel.service.name=geldar-neoforge` is the value the SigNoz dashboard filters on. `geldar.shard=nf` is an extra resource
  attribute that no existing query needs; drop it if the gateway owner objects. With Option A the endpoint is
  `http://geldar-gateway:4318`; with Option B it is the relay's name (it must **not** be `geldar-gateway`: see 1d).
- **Heap and RAM headroom:** `MEMORY` (heap 9G) is unchanged. The agent adds its own jar, the OTel SDK, batch queues and a
  few threads: on the order of 100 to 200 MiB of non-heap (a rough figure, UNVERIFIED; measured in 3). The cap is 12 GiB.
  Section 3, "Memory", says whether it needs a bump.

### 1c. The ledger config (all collectors on)

New file `compose/neoforge/ledger.properties`, mounted read-only at `/geldar/telemetry/ledger.properties`, copied by the
entrypoint to `/data/config/ledger.properties` at every start (copy, not a nested bind into the named volume: a bind inside
`/data` makes Docker create a root-owned `config/` and the server could not write its own config files there). Keys are the
README's; collector ids are NeoForge's (they differ from Paper's):

```properties
# geldar-nf live shard: every NeoForge ledger collector on, owner-approved (see section 3, privacy).
enabled=true
collector.tick.enabled=true
collector.world.enabled=true
collector.server.enabled=true
collector.connections.enabled=true
collector.snapshot.enabled=true
collector.progress.enabled=true
collector.curated.enabled=true
collector.audit.enabled=true
collector.combat.enabled=true
collector.operator.enabled=true
```
Rate limits and budgets stay at their defaults (`rate.geldar.chat` 20/s, curated 20/s per event, and so on). The Paper-only
ids in `deploy/scratch/ledger.properties` (`spark`, `census`, `cadence`, `bridge`, `container`, `disk`, `jfr.*`) do not exist
in `neoforge-ledger` and are not copied. **Kill switch:** `enabled=false` here (the master stops every collector), or
`NF_TELEMETRY=off` (below). Both take effect at the next start: the NeoForge README documents no reload (UNVERIFIED; Paper
reloads), so plan on one server restart (question 13).

### 1d. Network

Facts: the gateway container `geldar-gateway` is on `geldar-colo` and `geldar-telemetry` (both external), listens on
OTLP/HTTP 4318 and gRPC 4317 with **no ingest authentication** (internal network only), and publishes only a loopback port
for Caddy. `compose/nf-live.yml` has one network, `nf` (`geldar-nf_nf`), and no external one, by design; the test
`nf-live-compose.test.ts` states it ("declares no external network or volume", which also greps the file for `external:`),
and the file header promises a compose action here cannot reach any other project's containers. The `geldar-telemetry`
network also carries `geldar-ch` (ClickHouse) and the SigNoz collector. `geldar-colo` carries the autonomous shard: it is
never to be joined.

**Option A: join only `neoforge` to the external network `geldar-telemetry`.** Edit: `networks: [nf, telemetry]` on neoforge,
a `telemetry:` network block with `external: true, name: geldar-telemetry`; endpoint `http://geldar-gateway:4318`.
Smallest diff (about 6 lines, no new service, no `MEM_CAPS_MIB` change). Consequences: the container that runs third-party
mods (Proxy Compatible Forge, ours, anything added later) and holds the NeoForge NATS credential can reach ClickHouse and the
SigNoz collector as well as the gateway; the gateway accepts unauthenticated writes, so anything on that network can inject
telemetry under any `service.name`; the "cannot reach any other project's containers" property of the nf file is gone for the
most exposed container; a down of the telemetry network makes `up` fail at network resolution for the whole nf stack.
Tests that change: "declares no external network or volume" (it also greps `external:`) and "uses its own project network"
stays true; the project header comment must be reworded.

**Option B (recommended): a small relay service in the nf project, the only one on the external network.**
`telemetry-relay` is the pinned collector image (the same digest as the gateway, 0.164.0), no shell, read-only, `cap_drop ALL`,
no ports, no volumes, config inline through `configs:`. It receives OTLP/HTTP on the `nf` network and forwards to
`geldar-gateway:4318` on `geldar-telemetry`. `neoforge` stays on `nf` only. Consequences: the mod-running container keeps its
isolation; the relay holds no secret, no mod code and no volume; the only cross-project link is one hardened, config-fixed
process; the gateway still redacts, because the relay does no filtering of its own. Costs: one more service (about 40 lines,
0.25 CPU, 192 MiB), `MEM_CAPS_MIB` 16640 to 16832, the six-services test becomes seven, the `external:` test becomes "exactly one
external network, `geldar-telemetry`, attached only to `telemetry-relay`, and `neoforge` networks equal `[nf]`". Two hazards,
both designed out below: (1) the relay must NOT carry the alias `geldar-gateway` on any network (on `nf` it would make the
relay resolve the gateway name to itself and loop; on `geldar-telemetry` it would collide with the real container name), so
the agent endpoint is `telemetry-relay:4318`; (2) neoforge must not `depends_on` the relay, so telemetry never gates the game.

```yaml
  telemetry-relay:
    # OTLP/HTTP relay: nf network in, geldar-telemetry out. The only service on the external network. No shell, no secrets.
    image: otel/opentelemetry-collector-contrib@sha256:340c9ca6a36617084c6661bdc4f0fe92b7cda5a805d61673ec8db375fddc522b # 0.164.0
    command: ["--config=/etc/otelcol/relay.yaml"]
    user: "10001:10001"
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    configs:
      - source: telemetry-relay
        target: /etc/otelcol/relay.yaml
    deploy:
      resources:
        limits: {cpus: "0.25", memory: 192m, pids: 256}
    memswap_limit: 192m
    cpu_shares: 256
    pids_limit: 256
    logging: *logging
    labels: *nf-labels
    networks: [nf, telemetry]          # no aliases anywhere
    restart: unless-stopped

# top level
networks:
  nf: {}
  telemetry:
    external: true
    name: geldar-telemetry
configs:
  telemetry-relay:
    content: |
      receivers:
        otlp:
          protocols:
            http:
              endpoint: 0.0.0.0:4318
              max_request_body_size: 16777216
      processors:
        memory_limiter: {check_interval: 1s, limit_mib: 128, spike_limit_mib: 32}
      exporters:
        otlp_http:
          endpoint: http://geldar-gateway:4318
          compression: gzip
          timeout: 5s
          retry_on_failure: {enabled: true, max_elapsed_time: 60s}
          sending_queue: {enabled: true, queue_size: 256}
      service:
        telemetry:
          logs: {level: warn}
          metrics: {level: none}
        pipelines:
          metrics: {receivers: [otlp], processors: [memory_limiter], exporters: [otlp_http]}
          logs:    {receivers: [otlp], processors: [memory_limiter], exporters: [otlp_http]}
```
The relay config is UNVERIFIED against 0.164.0: validate it on the desktop before the node step
(`otelcol validate --config=...` in a throwaway container of the pinned digest; that is a desktop action, not the node).
A relay outage or a gateway outage costs telemetry only: the agent and the relay drop on full queues; the game is untouched.

**Recommendation: Option B.** Option A is the fallback if geldar-neoforge prefers the smaller diff; the choice is theirs
(they own the isolation promise) with geldar-93's agreement on the gateway side. In both options the gateway side needs
**no change**: it already listens on 4318 for any client on `geldar-telemetry`. Not recommended: attaching `geldar-gateway`
to `geldar-nf_nf` (the telemetry compose would then depend on an nf network that exists only while nf is up, `nf-deploy.sh
down` would fail on "active endpoints", and it bridges NATS/Postgres to the telemetry network); and the host loopback port
`4320` is unreachable from a container (it is bound to the host's loopback).

## 2. Who owns which edit

geldar-neoforge's files (they apply the diffs, or consent to us making them on a branch): `compose/nf-live.yml`,
`compose/neoforge/neoforge-entrypoint.sh`, `deploy/nf-deploy.sh`, `docs/runbooks/nf-live-project.md`,
`tools/repo-checks/src/nf-live-compose.test.ts`, `deploy/test/nf-deploy.test.ts`,
`tools/repo-checks/src/scratch-neoforge-entrypoint.test.ts` (entrypoint cases).
New files, ours, no conflict (telemetry session writes them; geldar-neoforge reviews because they are mounted into their service):
`compose/neoforge/otel-agent.properties`, `compose/neoforge/ledger.properties`, `deploy/scratch/build-neoforge-ledger.sh`
(plus its test, modelled on `scratch-neoforge-mod.test.ts`). The gateway, SigNoz and dashboard are geldar-93's; none changes.

Proposed diffs (inline; Option B):

**compose/nf-live.yml, neoforge service**
```yaml
     environment:
       ...
       GELDAR_NF_MOD_SHA256: "${NF_MOD_SHA256:-}"
+      GELDAR_NF_TELEMETRY: "${NF_TELEMETRY:-on}"      # on|off; the entrypoint's own default is off (scratch)
+      GELDAR_NF_LEDGER_SHA256: "${NF_LEDGER_SHA256:-}"
+      JAVA_AGENTS: /geldar/telemetry/opentelemetry-javaagent.jar
+      OTEL_JAVAAGENT_CONFIGURATION_FILE: /geldar/telemetry/otel-agent.properties
+      OTEL_SDK_DISABLED: "false"
     volumes:
       ...
+      - type: bind
+        source: ${NF_LEDGER_JAR_HOST:-./nf-live-unset/geldar-neoforge-ledger.jar}
+        target: /geldar/mods/geldar-neoforge-ledger.jar
+        read_only: true
+        bind: {create_host_path: false}
+      - type: bind
+        source: ${NF_OTEL_AGENT_HOST:-./nf-live-unset/opentelemetry-javaagent.jar}
+        target: /geldar/telemetry/opentelemetry-javaagent.jar
+        read_only: true
+        bind: {create_host_path: false}
+      - ./neoforge/otel-agent.properties:/geldar/telemetry/otel-agent.properties:ro
+      - ./neoforge/ledger.properties:/geldar/telemetry/ledger.properties:ro
```
plus the `telemetry-relay` service, the `telemetry` network and the `configs` block of 1d, and the header comment lines
for the new variables (`NF_LEDGER_JAR_HOST`, `NF_LEDGER_SHA256`, `NF_OTEL_AGENT_HOST`, `NF_TELEMETRY`).

**compose/neoforge/neoforge-entrypoint.sh** (default off keeps scratch identical)
```sh
# after mod_copy=...
telemetry=${GELDAR_NF_TELEMETRY:-off}
ledger_mounted=${GELDAR_NF_LEDGER_JAR:-/geldar/mods/geldar-neoforge-ledger.jar}
ledger_copy=$data/mods/geldar-neoforge-ledger.jar
agent_mounted=${GELDAR_NF_OTEL_AGENT:-/geldar/telemetry/opentelemetry-javaagent.jar}
# OpenTelemetry Java agent 2.33.1, Maven Central, 26507624 bytes
AGENT_SHA256=${GELDAR_NF_OTEL_AGENT_SHA256:-e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149}
ledger_cfg_mounted=${GELDAR_NF_LEDGER_CONFIG:-/geldar/telemetry/ledger.properties}
ledger_cfg=${GELDAR_NF_LEDGER_CFG_DEST:-$data/config/ledger.properties}

# BEFORE the bundle check, next to the mod_copy removal: an earlier copy is removed always (bundle mode lists mods/ exactly;
# the copy is made again after the check, only when telemetry is on).
rm -f "$ledger_copy"

# AFTER the geldar mod jar copy block, BEFORE the PCF config block:
case "$telemetry" in
  on | off) ;;
  *) echo "neoforge-entrypoint: GELDAR_NF_TELEMETRY must be on or off; refusing to start" >&2; exit 1 ;;
esac
if [ "$telemetry" = on ]; then
  for f in "$ledger_mounted" "$agent_mounted" "$ledger_cfg_mounted"; do
    if [ -L "$f" ] || [ ! -f "$f" ]; then
      echo "neoforge-entrypoint: $f is missing, a symlink or not a regular file; refusing to start with telemetry on" >&2
      exit 1
    fi
  done
  ledger_sha=${GELDAR_NF_LEDGER_SHA256:-}
  is_sha256_hex "$ledger_sha" || { echo "neoforge-entrypoint: GELDAR_NF_LEDGER_SHA256 is not 64 lowercase hex digits; refusing to start" >&2; exit 1; }
  actual=$(sha256sum "$ledger_mounted" 2>/dev/null || true); actual=${actual%% *}
  [ "$actual" = "$ledger_sha" ] || { echo "neoforge-entrypoint: the mounted ledger jar does not match GELDAR_NF_LEDGER_SHA256; not copied; refusing to start" >&2; exit 1; }
  actual=$(sha256sum "$agent_mounted" 2>/dev/null || true); actual=${actual%% *}
  [ "$actual" = "$AGENT_SHA256" ] || { echo "neoforge-entrypoint: the mounted OpenTelemetry agent does not match its pinned sha256; refusing to start" >&2; exit 1; }
  cp "$ledger_mounted" "$ledger_copy"; chmod 644 "$ledger_copy"; chown --reference="$data" "$ledger_copy"
  copied=$(sha256sum "$ledger_copy" 2>/dev/null || true)
  [ "${copied%% *}" = "$ledger_sha" ] || { rm -f "$ledger_copy"; echo "neoforge-entrypoint: the copy of the ledger jar in mods/ does not match; removed it; refusing to start" >&2; exit 1; }
  cfgd=$(dirname "$ledger_cfg")
  if [ ! -d "$cfgd" ]; then mkdir -p "$cfgd"; chown --reference="$data" "$cfgd"; fi
  cp "$ledger_cfg_mounted" "$ledger_cfg"; chmod 644 "$ledger_cfg"; chown --reference="$data" "$ledger_cfg"
else
  unset JAVA_AGENTS OTEL_JAVAAGENT_CONFIGURATION_FILE
  export OTEL_SDK_DISABLED=true
fi
```
`is_sha256_hex` is defined above that block in the current script, so it is available. Entrypoint tests to add (same seams as
the existing ones): off leaves no copy and unsets `JAVA_AGENTS`; on copies jar and config with the data dir's owner; a
mismatching ledger hash, a mismatching agent hash, a symlinked jar, a bad hash format and a bad `GELDAR_NF_TELEMETRY` each
refuse and copy nothing; a stale ledger copy is removed in bundle mode (second start passes the exact-`mods/` check); off after
on removes the copy.

**deploy/nf-deploy.sh**: generalize `check_mod_jar` to take (host variable, sha variable, label) and call it for the geldar jar,
the ledger jar (`NF_LEDGER_JAR_HOST`, `NF_LEDGER_SHA256`) and the agent (`NF_OTEL_AGENT_HOST`, sha256 equal to the pinned
constant, or `NF_OTEL_AGENT_SHA256` set to it); add `telemetry-relay` to `SERVICES`; `MEM_CAPS_MIB=16832` (+192) and the comment
list; plan step 3 becomes `up -d --wait eventsink neoforge telemetry-relay` and `cmd_up` the same. Tests: add the three inputs
to the `NF_*` fixture env, a case per new refusal, and move the RAM edge case from 24832/24831 to 25024/25023.

**docs/runbooks/nf-live-project.md**: sections 1 and 3 (seventh service, relay row, total about 6 CPUs and 16.4 GiB), 5
(four variables), 6 (inputs, refusals) and the checklist item for staging two more files. Add the telemetry bring-up of
section 3 below as a short subsection.

**tools/repo-checks/src/nf-live-compose.test.ts**: the seven-service list; the isolation test per 1d; a test that neoforge has
no `depends_on` on the relay, that the relay has no network aliases, that the two new jar mounts and the properties mounts are
read-only, and that no file under `compose/neoforge/` holds an address or a secret-looking key.

## 3. Deploy plan: shortest safe path, no soak

Two cases. **Case 1 (nf not yet started, runbook status):** merge the diffs, then do the normal first bring-up
(runbook section 8) with the extra staging below; telemetry costs no extra restart. **Case 2 (nf already running):**
after merge and staging, recreate only the two changed services (the runbook allows hand compose with the two flags):
`docker compose -p geldar-nf -f compose/nf-live.yml up -d --no-deps neoforge telemetry-relay`. Outage = one neoforge
restart (the same as a rollback). Whether compose also recreates `velocity` because its dependency was recreated is UNVERIFIED;
no human can join yet (loopback ingress only), so the impact is nil either way.

### Staging (desktop, then node), 30 minutes at most
1. Clean export of the reviewed commit; build the ledger jar with `build-neoforge-ledger.sh`; build it a second time and note
   whether the hashes agree. Download the agent 2.33.1 and check its sha256 against the pin above.
2. Compare both sha256 values over a second channel (as the runbook does for the geldar jar). Copy both jars to the ops-owned
   directory on the node. `export NF_LEDGER_JAR_HOST NF_LEDGER_SHA256 NF_OTEL_AGENT_HOST`.
3. Validate the relay config on the desktop. Confirm the external network `geldar-telemetry` exists on the node and the
   gateway is up (`docker network ls`, `docker ps` are read-only; the telemetry README's health check for `:13133`).
4. `nf-deploy.sh plan`: every gate passes (jars hashed, free RAM, port, config renders).

### Bring-up verification checklist (every box time-limited; stop at the first failure and use the rollback)
| T+ | Check (read-only verbs) | Pass |
|----|-------------------------|------|
| 0 to 2 min | `nf-deploy.sh up` (or the Case 2 command); no `refusing to start` line in `nf-deploy.sh logs neoforge` | jars verified, container running |
| 2 to 8 min | `nf-deploy.sh logs neoforge` shows `Done`; `docker top geldar-nf-neoforge-1` shows `-javaagent:/geldar/telemetry/opentelemetry-javaagent.jar` and `-Xmx9G` | server up, agent flag present (if the flag is absent: `JAVA_AGENTS` is not honoured, use the `JVM_OPTS` fallback, one restart) |
| Done+1 | log shows `ledger` / "Geldar Ledger" loaded and the agent banner (version 2.33.1). Ledger warnings go to **stderr**, not `latest.log` (spike finding): read them through `nf-deploy.sh logs`, not the log file | mod loaded, no "ledger off" warning |
| Done+60 s (2 export intervals of 15 s plus up to 5+5 s of gateway batching) | in SigNoz (service `geldar-neoforge`, resource `service.namespace=geldar`, `geldar.shard=nf`): metrics `geldar_ledger_queue_depth`, `geldar_ledger_dropped_total` (the only ones the spike proved) | the gateway receives; if absent at 3 min, check in this order: relay logs (`docker compose ... logs telemetry-relay`, level warn), the gateway's own metrics `otelcol_receiver_refused_*` / `otelcol_exporter_send_failed_*`, the agent's export errors on stderr |
| Done+3 min | metrics: tick (names per `deploy/signoz/neoforge-dashboard.json`; `geldar_world_tick_ms` is a proposed name and its panel may be empty), `geldar_world_loaded_chunks` / `geldar_world_entities` / `geldar_world_players` (attribute `world`, a dimension id such as `minecraft:overworld`), `geldar_players_online`, `geldar_operators_count`, `geldar_mods_loaded`; JVM runtime metrics from the agent. Log record `geldar.server.config_snapshot` (once, 5 s after start; carries `jvm_xmx`, `view_distance`, `max_players`; no rcon, query, address or seed key) | server, world and tick rows present |
| Done+3 min | `docker stats --no-stream geldar-nf-neoforge-1` (memory vs the 12 GiB cap) | see Memory |
| Done+5 min | no data on the dashboard that cannot be explained (counts are approximate by design, README PT-N4b); `deployment.environment.name` reads `colo` (finding 7) | accept |

ClickHouse/SigNoz rows are read through the SigNoz UI; if direct queries are wanted, `SELECT` only against the SigNoz tables
(`signoz_metrics`, `signoz_logs`; table names UNVERIFIED here), filtered on resource `service.name = 'geldar-neoforge'`.

### The activity driver (optional second stage; do not build it just for this)
Stage 1 above passes the go-live with no player: tick, world, server, snapshot and ledger self-metrics cover the pipeline, and
the connection, curated and audit collectors are unit-tested and were exercised on the Paper scratch run. Connection events
(`geldar.player.join` with `amount`, `geldar.player.quit` with `duration_ms`, a per-connection `geldar.mc_session`, the player
snapshot every 60 s for an agent) need a joined player. What is needed, and what only geldar-93 / geldar-neoforge can provide:
- A probe against the **live** shard. The scratch probe (`golem/src/p0/probe.ts` through `scratch.sh probe`) refuses unless its
  project is `scratch-<suffix>` and uses a `body` NATS user that the nf auth set does not have (its users are neoforge, sink,
  deploy, velocity, seed). So the driver needs: a probe NATS user in the nf auth set, a way to run the probe container on
  `geldar-nf_nf` (a profiled service or a one-shot `docker run --network`), a registry and whitelist entry that the probe removes
  afterwards (the P0 run 8b cleanup), and Velocity's `127.0.0.1:46565` as the ingress.
- The actions: join, a goto and a mine (as in P0 run 6). In the ledger these give `join`, `snapshot` (60 s), `geldar.block.break`
  (curated), and `quit` on exit. A chat line (`geldar.chat`, audit) needs a Body chat action: `/say` does not fire
  `ServerChatEvent` (README), so ask whether the probe can send one real chat message (question 7).
- Short time box: join+actions+quit under 5 minutes, rows in SigNoz within 2 export intervals each. Run it piggybacked on the
  first live P0 join that geldar-neoforge plans anyway.

### Kill switch and rollback
- **Soft (no file edit):** `export NF_TELEMETRY=off` and `nf-deploy.sh up` (or the Case 2 command for `neoforge`): the entrypoint
  removes the ledger copy, unsets `JAVA_AGENTS`, sets `OTEL_SDK_DISABLED=true`; the server runs with no agent and no mod. One
  neoforge restart. The mounts must still exist (they are fail-closed).
- **Ledger only:** `enabled=false` in `compose/neoforge/ledger.properties`, new export, one restart.
- **Hard rollback:** redeploy the previous export (no relay, no mounts, no flags) and recreate `neoforge` only; `docker compose ...
  rm -sf telemetry-relay` for the relay. The external network is not removed by compose. Outage = one server restart.
- The relay or the gateway being down never blocks the game: neoforge has no dependency on the relay and every queue drops.

### Memory
Heap 9 GiB (`MEMORY`) in a 12 GiB cap leaves 3 GiB for metaspace, code cache, thread stacks, direct buffers and the agent
(about 0.1 to 0.2 GiB, estimate). A modded NeoForge server commonly uses 1 to 1.5 GiB outside the heap, so the expected total is
about 10.3 to 10.7 GiB: enough, not generous. **Recommendation: no bump before measuring**; read `docker stats` at Done+3 min
and again after the driver. Trigger: container memory above 11 GiB (90% of the cap) at idle, or an OOM kill in `docker inspect`.
Then, in order: lower `NF_NEOFORGE_HEAP` to 8G (an environment value, no file edit), else raise the cap to 13 GiB
(`nf-live.yml` neoforge limit and memswap, `MEM_CAPS_MIB` +1024, both tests, runbook table). **geldar-neoforge decides the cap**
(they own the caps and the sums); the owner decides node capacity, which has room (about 100 GiB available at the lead's
measurement). The relay adds 192 MiB; the gateway's own 1 GiB cap is unchanged.

### Privacy: what telemetry is and is not
- **Telemetry never reaches an agent.** The agents' world is the Body over NATS and the game; telemetry flows
  agent JVM, relay, gateway, SigNoz/ClickHouse, a human dashboard. The nf NATS has no telemetry subject, the relay is not on
  NATS, and no nf service reads SigNoz or ClickHouse. The relay joins `geldar-telemetry` only, never `geldar-colo` or any NATS.
- **What "everything on" captures on a human-directed shard**, key by key (the owner approved enabling everything after
  deployment; D-F, human chat verbatim with no speaker id, stands):
  - `collector.audit.enabled=true`: `geldar.chat` (raw typed text of **human and agent** chat, scrubbed and capped by the core;
    speaker only as a life id, so a human speaker has none; cancelled chat not captured, D-I), `geldar.console.command` and
    `geldar.rcon.command` (the server console and RCON only; RCON is disabled on this shard; player and command-block commands are
    not exported), `geldar.combat.damage` / `player_death` / `kill` (with `collector.combat.enabled`), `geldar.operator.change`
    (with `collector.operator.enabled`, online players only). `/say`, `/msg`, `/me` are not captured.
  - `collector.curated.enabled=true`: block break/place (and the cancelled variants), item craft/smelt, container open/close,
    with the block position for blocks (container events none). Humans appear without an id.
  - `collector.progress.enabled=true`: advancements and the 300 s stats read, agents only (life ids, allow-listed stat keys).
  - `collector.snapshot.enabled=true`: `geldar.player.snapshot` per online **agent** every 60 s (life id, world, block
    position, health, food, xp level, game mode).
  - `collector.connections.enabled=true`: join/quit; an agent gets life id and `mc_session`; a human gets neither, and no name,
    UUID or address is read or exported (D4: the offline UUID is reversible, so none is used).
  - `tick`, `world`, `server`: server health and counts only (`geldar_mods_loaded` is a count; no names or versions).
  - Not enabled: the server log shipping (finding 8). The gateway additionally masks IPv4/IPv6 literals, drops
    credential-looking keys, and keeps metrics free of life ids.
- A human who plays here has their chat text recorded verbatim. Today the ingress is bot-only on loopback, so until the later
  online-mode listener exists the only chat is the agents' and the operator's. The retention and the consent text for humans
  belong to the owner's decision records; this design does not decide them.

## 4. Open questions

For geldar-neoforge (owner of the nf files):
1. Are you content with Option B (a `telemetry-relay` service as the only member of the external network `geldar-telemetry`),
   changing the "six services" and "no external network" tests? (If no: is Option A acceptable instead?)
2. May the shared entrypoint get the telemetry block of section 2, with the script's own default **off** so the scratch path and
   its tests are unchanged?
3. Is the nf shard still un-started (so telemetry is merged before the first `up`, Case 1)?
4. Do you accept fail-closed mounts (the two jars) with `NF_TELEMETRY=off` as the soft switch, instead of an optional overlay
   (which the single-`-f` rule forbids)?
5. Do you keep the 12 GiB cap and 9G heap until `docker stats` is read at bring-up, with the 90% trigger and the 8G-first order
   of section 3?
6. May we add `deploy/scratch/build-neoforge-ledger.sh` (new file) and the two properties files under `compose/neoforge/`, and
   will you apply the diffs of section 2 (or consent to us doing it on a branch)?
7. Will the live P0 probe exist with an nf-scoped NATS user and the ability to send one real chat message, so stage 2 can
   piggyback on it?
8. Does the bundle-mode check stay as it is, so a ledger jar copied after the check (and removed before it on the next start)
   is acceptable to you?

For geldar-93 (telemetry and gateway):
9. Is it acceptable that nf data carries `deployment.environment.name=colo` (the gateway upserts it) and is told apart by
   `service.name=geldar-neoforge` and `geldar.shard=nf`, or do you want a gateway change?
10. Which decision record do we cite for "owner approved enabling everything after deployment" (and does D-F in RESUME cover
    the NeoForge chat, `geldar.chat`, as is)?
11. Do you agree the nf agent profile has `log4j-appender` off (the Paper profile has it on), because the console log carries
    human names and chat?
12. Is `geldar-telemetry` the exact external network name on the node and is the gateway (1 GiB, 256 MiB queues) sized for one
    more producer; do you want the NeoForge dashboard (`neoforge-dashboard.json`) imported for this bring-up?
13. Can you confirm for `neoforge-ledger`: the config is read from `config/ledger.properties` under the server directory
    (`/data/config/ledger.properties`), only at start (no reload), and the jar name is `geldar-neoforge-ledger-0.1.0.jar`?
14. Do the two Gradle builds produce identical jars (`reproducibleFileOrder`, `preserveFileTimestamps=false`), or is the pin
    the hash of the single built jar?
