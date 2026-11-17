# PT-N3: OpenTelemetry agent and API under NeoForge (spike result)

Card: PT-N3 in `neoforge-telemetry.md`. Run date 2026-11-17, local only (Windows, JDK 25.0.2, NeoForge 26.1.2 build 126, OpenTelemetry Java agent 2.33.1, API 1.67.0). Throwaway game directory outside the repo, `online-mode=false`, bound to 127.0.0.1:25599, no node, no Docker, no secrets, no OTLP endpoint (agent metrics exporter set to `logging`, traces and logs `none`).

## Verdicts

| Question | Verdict |
|---|---|
| Are the jar-in-jar OTel API classes visible to the mod and ledger-core, and consistent? | YES. With only the built mod jar in `mods/` (API and ledger-core NOT on the dev classpath), FML logs the four nested jars (`ledger-core`, `opentelemetry-api/-common/-context` 1.67.0). `GlobalOpenTelemetry`, `OpenTelemetry` and `Context` are loaded by one `java.net.URLClassLoader`, in the unnamed module; LedgerBootstrap shares that loader and `loadClass` from it returns the identical `GlobalOpenTelemetry` class (same class object). The mod itself is on FML's `TransformingClassLoader`, a child that delegates to it. |
| Does `GlobalOpenTelemetry` resolve to the agent's implementation? | YES. `GlobalOpenTelemetry.get()` is `...opentelemetryapi.v1_27.ApplicationOpenTelemetry127`, meter provider `ApplicationMeterProvider`, logs bridge `ApplicationLoggerProvider`; neither is the no-op, so the `agentPresent` condition (`getMeterProvider() != noop() \|\| getLogsBridge() != noop()`) is true. The agent bootstrap class is on the boot loader (`loader=null`). Same result in the dev run (API on the app class loader) and in the jar-in-jar run. |
| Does the ledger export a metric? | YES. In the jar-in-jar run the agent's logging exporter reported `geldar_ledger_queue_depth` and `geldar_ledger_dropped_total`, scope `dev.geldar.ledger`, every 5 s (the only instruments registered today: "no collectors yet"). |
| Does LedgerMod load? | YES, under FML as `ledger` (Geldar Ledger 0.1.0) from `mods/`, server reached `Done`. |
| Does `java.util.logging` reach the server log? | NO, not the log file. `Logger.getLogger("ledger")` INFO records print on stderr through the root `ConsoleHandler` (JUL default two-line format) and are absent from `logs/latest.log` and `debug.log`. The JUL root had only that `ConsoleHandler`; the agent's own JUL instrumentation was off (`otel.instrumentation.java-util-logging.enabled=false`, as in the Paper properties). So a ledger warning ("ledger off") is visible on the console / container stderr but not in the server log file, and not in `docker logs` formatted like server lines. |

The failure mode flagged in the plan (silent no-op) did not occur; shade-and-relocate is not needed.

## What the mod must do

1. Keep `GlobalOpenTelemetry::get` as is (the agent supplies the implementation); nothing to relocate. Keep the jarJar strict ranges.
2. Logging: decide for PT-N5/N9 whether JUL on stderr is enough. If the ledger's failure messages must be in `latest.log`, log through SLF4J (NeoForge ships it) or add a JUL handler that forwards to it; this is a code change outside this card. Until then, README's "unverified" line is now answered: JUL goes to stderr only.
3. The agent must be attached with `-javaagent` on the server JVM (as for Paper, via the container's Java options); it is not loaded by the mod.
4. Without the agent the ledger is a no-op (unit-tested by `OtelLoadTest`: isolated loader over the nested jars, the global is the no-op).

## Findings and caveats (what was not proved)

- Dev `runServer` as configured does NOT exercise jar-in-jar (it puts ledger-core and the API on the app classpath via `implementation`). The jar-in-jar proof used a throwaway local variant: `build.gradle.kts` with `compileOnly` instead of `implementation` and no `mods { }` entry, the built jar copied into `<gamedir>/mods/`. That change is NOT committed; the repo build is unchanged. A later card (the first deploy card) should add such a run variant if it is wanted in the build.
- `runServer` needs a JDK 21 toolchain for MDG's `downloadAssets` task; only JDK 25 is installed here. I pointed that task at the JDK 25 `java.exe` through an init script (outside the repo) and it worked. This was the only environment issue; the EULA was pre-accepted in the throwaway directory.
- The server is not stopped by `runServer` on closed stdin; I killed the process, so the `ServerStoppingEvent` close path was NOT exercised here (it is unit-tested in `LedgerModTest`).
- Probed with a temporary probe method in `LedgerMod` (not committed). Not tested: a real OTLP exporter, a Docker/itzg server, other agent versions, the agent's behaviour with a ledger reload, and a production NeoForge install (the dev launch uses FML's dev launch target, whose loader layout may differ slightly from `run_server`).
- The agent jar was downloaded once from Maven Central (public release, 2.33.1, 26507624 bytes, sha256 `E43A270DF53C6F423E0AB157BE9C27CCC01D5DC3232E162FE54777573DB2F149`); not committed. Compare with the lock file when PT-02a lands.

## Reproduce

Throwaway dir with `eula.txt` (`eula=true`), `server.properties` (`online-mode=false`, `server-ip=127.0.0.1`), the mod jar in `mods/`; an init script that sets the `server` run's `gameDirectory` and adds `-javaagent:<jar>` and `-Dotel.javaagent.configuration-file=<props>` (props: `otel.instrumentation.common.default-enabled=false`, `otel.instrumentation.opentelemetry-api.enabled=true`, `otel.metrics.exporter=logging`, `otel.traces.exporter=none`, `otel.logs.exporter=none`, `otel.metric.export.interval=5000`); then `./gradlew --offline -I <init.gradle> runServer`.
