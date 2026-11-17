# Cards: integration (PT-11 to PT-18)

Read [README.md](README.md) first (aliases, frozen API and names, inherited rules) and [safety-rules.md](safety-rules.md). Scratch verification rows are in [scratch-test-plan.md](scratch-test-plan.md).

---

## PT-11a: Geldar-Core gets the OpenTelemetry API and one trace-header helper

- Loader: Paper-bound (Geldar-Core). Depends on: PT-03a (version catalog pin). Size: S.
- Goal: 0351 point 11: Geldar-Core, in its own jar, can inject and extract only `traceparent` and `tracestate` on NATS headers. No other change in behaviour.
- Files: EDIT `plugin/core/build.gradle.kts` (`implementation(libs.opentelemetry.api)`; the jar task already bundles the runtime classpath); EDIT `plugin/core/gradle.lockfile` (via `--write-locks`); CREATE `plugin/core/src/main/java/dev/geldar/core/trace/TraceHeaders.java`; CREATE `plugin/core/src/test/java/dev/geldar/core/trace/TraceHeadersTest.java`.
- Steps: 1. `TraceHeaders.inject(io.nats.client.impl.Headers headers)`: if the current span context is valid, `put("traceparent", ...)` and `put("tracestate", ...)` (when non-empty) using the W3C propagator from the API (`W3CTraceContextPropagator.getInstance()`); returns the same `Headers`, creating one only when a span is current (otherwise returns `null`, so callers send what they sent before). 2. `TraceHeaders.extract(Headers)` returns an OpenTelemetry `Context` from the two keys only; every other header is ignored (no Baggage). 3. With no agent the API is no-op, so `inject` returns `null`.
- Tests (fail when reverted): with no current span `inject` returns `null` and adds nothing; extracting headers that carry `baggage` and `x-custom` yields a context with no baggage; round trip of a fixed `traceparent` string through `extract` then `inject` under a made span context (the coder builds the span context with `SpanContext.create`, no SDK) is byte-equal; only the two header names are ever written.
- Checks: `(cd plugin; ./gradlew :core:test)`; `unzip -l plugin/core/build/libs/geldar-core.jar | grep opentelemetry` shows the API classes bundled. S2, S12.
- Commit: `PT-11a Geldar-Core trace header helper (plugin)`.
- Do NOT: touch any seam yet; add the agent or SDK; add an instrument; change `plugin.yml`.

## PT-11b: block-owner seam

- Loader: Paper-bound. Depends on: PT-11a. Size: S.
- Goal: extract `traceparent` from the block-owner query and inject it on the reply. **The reply data is byte-identical** (0351 point 11).
- Files: EDIT `plugin/core/src/main/java/dev/geldar/core/blockowner/NatsBlockOwnerLink.java` (the reply path near line 73 and the `publish` at line 81: add an overload taking `Headers`); EDIT or CREATE test `plugin/core/src/test/java/dev/geldar/core/blockowner/NatsBlockOwnerLinkTraceTest.java`.
- Steps: 1. In the query handler read the incoming message headers through `TraceHeaders.extract`; run the existing owner lookup unchanged inside `Context.makeCurrent()`. 2. When replying, `nc.publish(replyTo, TraceHeaders.inject(...), bytes)` only when `inject` returned non-null; otherwise the existing `nc.publish(subject, bytes)` call. 3. The `changed` publish (line 78) is not touched.
- Tests (fail when reverted): with a current span, the reply carries `traceparent` and the body bytes equal the body produced with no span (compare arrays); with no span the call is the old two-argument publish (verify through the fake connection the existing tests use, or an interface seam the coder adds minimally); query headers with extra keys do not appear on the reply.
- Checks: `(cd plugin; ./gradlew :core:test)`. S2.
- Commit: `PT-11b Block-owner trace seam (plugin)`.
- Do NOT: put the trace id in the reply JSON; change subjects; touch other seam files.

## PT-11c: hearing seam and speech hash

- Loader: Paper-bound. Depends on: PT-11a. Size: S.
- Goal: inject `traceparent` into the hearing notice headers; carry the speaker's life id and a speech hash into the span, never into the payload.
- Files: EDIT `plugin/core/src/main/java/dev/geldar/core/proximity/NatsHearingSink.java` (publish at line 77); CREATE `plugin/core/src/main/java/dev/geldar/core/trace/SpeechHash.java`; tests `plugin/core/src/test/java/dev/geldar/core/proximity/NatsHearingSinkTraceTest.java`, `plugin/core/src/test/java/dev/geldar/core/trace/SpeechHashTest.java`.
- Steps: 1. `SpeechHash.of(String text)`: SHA-256 of the UTF-8 text, first 8 bytes as 16 hex chars. 2. In the sink, when a span is current: `Span.current().setAttribute("geldar.life_id", lifeId)`, `setAttribute("geldar.speech_hash", hash)` (hash only; the speech text is never a span attribute here), and publish with `TraceHeaders.inject`. With no span: the old call. 3. The hearing JSON is unchanged.
- Tests (fail when reverted): payload bytes equal with and without a span; with a span the headers hold `traceparent`; span attributes hold the hash and not the text (a made-up span recorder is not available without the SDK: the coder asserts through a small `SpanAttributes` seam interface added in this file set, implemented over `Span` in production); `SpeechHash` is stable and 16 hex chars.
- Checks: `(cd plugin; ./gradlew :core:test)`. S2, S3.
- Commit: `PT-11c Hearing trace seam and speech hash (plugin)`.
- Do NOT: add the trace header to anything the Mind reads (the hearing notice reaches the Body; the Body ignores unknown headers: the coder reads `golem` code that subscribes to hearing subjects, confirms it reads only the payload, and states the file in the commit body; if it forwards headers anywhere, stop and report); add the speech text to a span.

## PT-11d: event export and maintenance seams

- Loader: Paper-bound. Depends on: PT-11a. Size: S.
- Goal: inject on event export only when a span is current; extract on the maintenance notice.
- Files: EDIT `plugin/core/src/main/java/dev/geldar/core/NatsEventPublisher.java` (`headers(event)` at line 89 stays; add the optional trace headers there); EDIT `plugin/core/src/main/java/dev/geldar/core/maintenance/NatsMaintenanceSubscriber.java` (extract in the handler near line 50); tests `plugin/core/src/test/java/dev/geldar/core/NatsEventPublisherTraceTest.java`, `plugin/core/src/test/java/dev/geldar/core/maintenance/MaintenanceTraceTest.java`.
- Steps: 1. `headers(event)` keeps `Nats-Msg-Id`; adds `traceparent`/`tracestate` only if `TraceHeaders.inject` finds a valid current span **on the publishing thread** (the worker thread has no span unless the envelope carried one; do not store spans in `EventEnvelope`; if there is none, nothing is added). 2. Maintenance subscriber wraps its existing handling in the extracted `Context`; it still publishes nothing.
- Tests (fail when reverted): with no span `headers(event)` equals what it returned before (assert the exact header map); with a made span context current, `traceparent` is added next to the msg id; envelope bytes (`toBytes`) are identical in both cases (the header is never in the body: eventsink reads `traceparent` from the header, T-08).
- Checks: `(cd plugin; ./gradlew :core:test)`. S2.
- Commit: `PT-11d Event export and maintenance trace seams (plugin)`.
- Do NOT: change `EventEnvelope` or the contract schema; change the idempotency header; add retries.

## PT-11e: Geldar-Core counters

- Loader: Paper-bound. Depends on: PT-11a. Size: M.
- Goal: Geldar-Core's own counters through the OpenTelemetry API: publisher (published, failed, queue depth, dropped), hearing (sent, dropped no-connection), block-owner (queries, cache hits, failures), Kino (messages published, dropped). **No agent, life id, viewer or player attribute** (0351 point 11; 0075, 0139).
- Files: EDIT only the counting points the coder confirms, among `plugin/core/src/main/java/dev/geldar/core/BoundedEventQueue.java`, `EventExporter.java`, `kino/NatsKinoSink.java`; CREATE `plugin/core/src/main/java/dev/geldar/core/trace/CoreMetrics.java` (static `Meter` from `GlobalOpenTelemetry.getMeter("geldar-core")`, instruments created once, names `geldar_publisher_*`, `geldar_hearing_*`, `geldar_blockowner_*`, `geldar_kino_*`); test `plugin/core/src/test/java/dev/geldar/core/trace/CoreMetricsTest.java`. Do **not** edit `NatsEventPublisher.java`, `NatsHearingSink.java`, `NatsBlockOwnerLink.java` or `NatsMaintenanceSubscriber.java` (PT-11b to 11d own them): where a counter belongs in one of those files, expose an existing accessor (for example `published()` at `NatsEventPublisher.java:73` and the failure counter at line 77) and read it through an observable gauge in `CoreMetrics` instead. If a counter cannot be taken without editing those files, the coder lists it as "deferred to PT-11e2" and does not edit.
- Steps: 1. `CoreMetrics.register(NatsEventPublisher, NatsHearingSink, ...)` creates observable gauges over the existing accessors; a hook in `GeldarCore.onEnable` is **not** added here (that file is shared); instead expose `CoreMetrics.register` and name the one-line call the orchestrator adds in a follow-up (`GeldarCore.java`, after the publishers exist); the coder states the exact line in the report. 2. Counter attribute set: none, or `result=ok|failed` only.
- Tests (fail when reverted): the instrument names match `NameRules.isMetricName`'s pattern (the coder inlines the same regex, since `ledger-core` is not a dependency); no attribute key other than `result`; calling `register` twice does not duplicate instruments; works with the API no-op.
- Checks: `(cd plugin; ./gradlew :core:test)`. S2, S7.
- Commit: `PT-11e Geldar-Core counters over the OpenTelemetry API (plugin)`.
- Do NOT: add a label with an agent id, life id, shard player or viewer; edit `GeldarCore.java`; edit the four files owned by PT-11b to 11d.

## PT-12: gateway collector rules

- Loader: gateway (not plugin). Depends on: the T-02 gateway config exists (the coder finds it from [t20-stack-files.md](../t20-stack-files.md); the path is UNVERIFIED). Size: M. Start: in wave 1 if the config exists.
- Goal: the gateway-side layer for what Paper sends (0351 PT-12), as a second layer behind the plugin's own redaction (S4, S5): drop RCON thread log lines, sample Chunky progress lines, redact addresses, drop process command-line attributes, cap body size, map severities, keep the RCON echo audit stream.
- Files: EDIT the gateway collector config file named in `t20-stack-files.md` (processors section only); CREATE a test next to the existing gateway config tests in `tools/repo-checks/src/` (name `geldar-gateway-paper-rules.test.ts`); no other file.
- Steps: 1. Filter processor: drop log records whose body matches the vanilla RCON thread pattern `RCON Client` or `Thread RCON` **except** records with attribute `event.name=geldar.rcon.command` (the audit stream is kept). 2. Probabilistic or rate-limit sampling for lines matching Chunky progress. 3. Transform: scrub IPv4 and IPv6 in body and string attributes; delete `process.command_line`, `process.command_args`, `process.environment_variables`; delete attributes whose key matches the credential pattern of `Redactor.keyIsCredential`. 4. Cap `body` to 32 KiB for `geldar.chat|sign|book|rcon.command|console.command`, 8 KiB for the rest. 5. Severity mapping for the log4j appender levels. The coder uses only processors already present in the gateway's pinned collector build (check its component list); a missing processor is reported, not worked around.
- Tests (fail when reverted): the test parses the config and asserts each rule exists by name, the RCON audit exception is present, the credential-key deletion list contains `password`, `token`, `authorization`, no IP literal appears in the config, and the caps are 32768 and 8192.
- AMENDED (coordinator, 2026-11-17): steps 2 (Chunky sampling) and 4 (body caps) are DROPPED. Decision 0350 (full-text capture, no opt-out) and the header of `deploy/telemetry/gateway.yaml` forbid any truncation, size cap or sampling at the gateway. The plugin's own 32 KiB content cap (S3) and its Chunky line handling stay plugin-side. Step 5 (severity mapping) is not needed: `LogOut` sets valid OpenTelemetry severities. The test instead asserts that `gateway.yaml` has no truncation or sampling processor. Delivered: steps 1 and 3 (RCON drop widened with the audit exception; process attribute deletion; address masking on log attributes).
- Checks: `check:repo`; the collector's own `validate` command if the repo has a lane for it (the coder names it or says none exists). S3, S4, S5.
- Commit: `PT-12 Gateway rules for Paper logs (deploy)`.
- Do NOT: add an exporter or endpoint; touch the Caddy route; apply to the node.

## PT-13 and PT-14: not carded

JEP 520 method timing (PT-13) and JEP 509 CPU-time sampling (PT-14) stay off. They are written as cards only after PT-15 passes and the owner says yes in writing. Until then: `jfr.method_timing` and `jfr.cpu_time_sampling` are not config keys (PT-03c rejects unknown keys), and the PT-09b test forbids the JFR event names.

## PT-15: overhead A/B and the results document

- Loader: scratch run. Depends on: PT-03k and the collector cards to be tested (at least PT-03g, PT-03h, PT-04b, PT-06c, PT-07a, PT-08a to 08d, PT-09b, PT-09c, PT-11 jar optional, PT-02b). Size: M. Gate: the owner's scratch window; the scratch Paper only.
- Goal: the gate for the Colo (0351 point 9). Method and acceptance are in [scratch-test-plan.md](scratch-test-plan.md) section 5.
- Files: CREATE `deploy/scratch/telemetry-ab.sh` (runs one arm: start, warm-up, sample `tick query` every 10 s over RCON for N minutes, sample `cpu.stat` and `memory.current`, capture heap-after-GC, write a JSON summary, stop; never both arms at once); CREATE `docs/analysis/telemetry/paper-plugin/pt15-results.md` (written after the run: tables, UTC times, jar sha256s, config hashes, pass or fail per bound).
- Steps: see the plan. The script is shell and only runs `docker compose -p scratch-telemetry ...`, never any other project (it refuses to run when the project name differs).
- Tests: a repo-check test that the script refuses a project other than `scratch-telemetry` (stub docker as `scratch-overlay.test.ts` does) and that it never prints the RCON password (the password comes from the scratch secrets directory and is passed by file, not on the command line; S4).
- Checks: `check:repo`. The run itself is the ops agent's job, not the coder's.
- Commit: `PT-15 Overhead A/B script and results (deploy)`.
- Do NOT: run on the live Paper or the live node; run the bench and `test:live` concurrently; use the plugin's own metrics as the measurement (circular); change any live limit.

## PT-16: Colo enablement window (HELD, owner)

- Loader: deploy. Depends on: PT-15 passes, PT-02a, PT-02b, PT-03l, PT-12 merged, and A9 passed (rollout plan). Size: S (a request document plus node steps). Owner approval required: window, jar sha256 and rollback.
- Goal: one Paper restart takes the agent, `ledger.jar` and Geldar-Core together, with the Paper memory limit 15 GiB and bStats off (0351 points 13 and 14). The request and the rollback are in [scratch-test-plan.md](scratch-test-plan.md) section 6.
- Files: CREATE `docs/analysis/telemetry/paper-plugin/pt16-window-request.md` (filled from the template in section 6: sha256s of `ledger.jar`, `geldar-core.jar`, the agent jar; the window; the exact rollback commands; the expected series list; the stop rule).
- Tests: none (docs). The orchestrator hands the request to the owner; the ops agent executes only what the approved request names.
- Checks: `check:repo`.
- Commit: `PT-16 Colo enablement window request (docs)`.
- Do NOT: run any node command; set `JAVA_AGENTS`; edit the live compose file; schedule the window.

## PT-17a: Paper dashboard

- Loader: SigNoz import (not plugin). Depends on: frozen names (README). Size: M. Start: immediately.
- Goal: the Paper dashboard JSON for the SigNoz import, in the repo with a test that every panel's metric name exists in the frozen list.
- Files: CREATE the dashboard JSON under the path the T-17 card names (found from `docs/analysis/telemetry/`; UNVERIFIED, the coder follows the T-17 card and does not invent a directory); CREATE `tools/repo-checks/src/paper-dashboard.test.ts`.
- Steps: panels: tick lag histogram p50/p95/p99, TPS (3 windows), overruns and stalls per hour, container throttled-period ratio (Gauge panels: `throttled_periods_total` over `periods_total`; both are monotonic gauges, so use a rate or delta over the window, not a counter-rate function), memory against limit, loaded chunks and entities per world, players online, census top 20 by rate, drops per queue, collectors disabled, JFR thread-group CPU stacked by group, disk bytes per area.
- Tests (fail when reverted): every `metric_name` in the JSON is in the frozen list parsed from `Names` constants copied into the test; no panel groups by `geldar.life_id` (S7); JSON parses.
- Checks: `check:repo`.
- Commit: `PT-17a Paper dashboard (docs)`.
- Do NOT: import into SigNoz; expose a route.

## PT-17b: Paper alerts

- Loader: SigNoz import. Depends on: PT-17a. Size: S.
- Goal: the alert rules of 0351 PT-17, operator-only (0350 point 8).
- Files: CREATE the alert rule JSON next to the dashboard; CREATE `tools/repo-checks/src/paper-alerts.test.ts`.
- Steps: rules: TPS under 12 for 5 minutes (spec 7); MSPT p95 over 50 ms; throttled ratio over 5% (**PROPOSED**; open item in 0351); heap after GC over 85% (agent metric); RSS over 90% of `geldar_container_memory_limit_bytes`; watchdog warning log; exception event rate; `geldar_operators_count` above 0; commands blocked above 0 (the Geldar-Core counter if PT-11e provides one, else skip and report); `geldar_ledger_dropped_total` rate above 0 for 10 minutes; any `geldar_paper_collector_disabled` equal to 1; data absence for `geldar_tps` 5 minutes. No channel is configured here (the owner chooses it, rollout plan ask 5).
- Tests (fail when reverted): thresholds equal the numbers above; every rule has a name in the frozen list; no channel secret or webhook URL in the file.
- Checks: `check:repo`.
- Commit: `PT-17b Paper alert rules (docs)`.
- Do NOT: set a notification channel; include a token or URL.

## PT-18a: forbidden-API and `plugin.yml` scan

- Loader: repo check (Paper list plus neutral list). Depends on: PT-03a. Size: M. Start: after PT-03a.
- Goal: Principle 1 (S1, S9, S11) as a failing test, with the lists in one data file so a port edits the data, not the code.
- Files: CREATE `tools/repo-checks/src/plugin-ledger-forbidden-api.ts` (scanner), `tools/repo-checks/src/plugin-ledger-forbidden-api.test.ts`, `tools/repo-checks/src/plugin-ledger-forbidden-api.json` (the lists; exempt-listed per the repo rule if it nears the cap; it will not).
- Steps: 1. Scan every `.java` under `plugin/ledger/src/main` and `plugin/ledger-core/src/main` (and `ledger-velocity` when present). 2. Forbidden substrings (word-boundary regexes): `sendMessage`, `sendActionBar`, `sendTitle`, `showTitle`, `broadcast`, `broadcastMessage`, `dispatchCommand`, `Scoreboard`, `BossBar`, `sendPluginMessage`, `registerOutgoingPluginChannel`, `setPlayerListName`, `getChunkAt`, `loadChunk`, `setBlock`, `setType(`, `spawn(`, `teleport(`, `setCancelled`, `setMessage`, `setLine`, `shutdown(`, `saveWorld`, `setTickRate`, `setFrozen`, `getRemoteAddress`, `getAddress`, `getHostAddress`, and the Chunky/BlueMap mutators (`startTask`, `pauseTask`, `cancelTask`, `renderMap`, `purge`). 3. `plugin.yml` of `plugin/ledger/src/main/resources`: no `commands:`, no `permissions:`, no `loadbefore:`, name has no `telemetry|trace|otel|metric|monitor` word. 4. Allow-list with reasons for the rare legitimate hit (`shutdown(` inside `Emitter.close` thread code uses a different name; the list is empty on day one and a hit is reported to the orchestrator).
- Tests (fail when reverted): a fixture directory with a file containing `player.sendMessage(` fails; a clean fixture passes; the real tree passes; a fixture `plugin.yml` with `commands:` fails.
- Checks: `check:repo`; the new test runs inside the repo-checks vitest project. S1, S9, S11.
- Commit: `PT-18a Forbidden-API and plugin.yml scan for Ledger (deploy)`.
- Do NOT: weaken a pattern to make the tree pass (report the hit); scan `plugin/core`.

## PT-18b: neutral-core purity and agent-text scan

- Loader: repo check. Depends on: PT-03a. Size: S.
- Goal: S2 and the 0350 point 7 rule: no telemetry word in anything an agent can read, and the core's boundary also checked at the repo level (not only inside Gradle).
- Files: EDIT `contract/src/agent-text.ts` **only if** the marker list there is a plain array the coder can extend by one entry per new telemetry-visible string (the coder reads it first and reports the shape; if extending needs design, stop); CREATE `tools/repo-checks/src/ledger-core-purity.test.ts`.
- Steps: 1. The purity test scans `plugin/ledger-core/src` for imports of the loader packages (same list as `NoLoaderImportsTest`, duplicated deliberately so CI fails even if the Gradle test is skipped). 2. Marker scan: the strings `Ledger`, `ledger`, `traceparent`, `trace_id` must not appear in any file under `golem/src/prompts`, `prompts/`, or the skill and tool-description sources the existing agent-text scan covers (the coder reuses the scan's own file list).
- Tests (fail when reverted): a fixture with a Bukkit import in a core-like path fails; a fixture agent-text file containing `traceparent` fails; the real tree passes.
- Checks: `check:repo`. S2.
- Commit: `PT-18b Core purity and agent-text scans (deploy)`.
- Do NOT: add words to prompts; change prompt templates (prompt changes need a version bump, CLAUDE.md).
