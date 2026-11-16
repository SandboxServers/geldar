# Scratch-shard test plan, overhead A/B and live-window rollback

Scope: how every metric and event of the [frozen list](README.md) is verified on the scratch project `scratch-telemetry`, how the overhead A/B is measured, and how the live window is rolled back. Governing: decision 0351 points 9 and 14, [rollout-plan.md](../rollout-plan.md) D1 and D2. The scratch runs are carried out by the ops agent in the owner's scratch window, never by a coder. Commands are PROPOSED until PT-03j and PT-03k land; anything marked UNVERIFIED is an assumption to confirm at the first run.

## 1. The scratch project

- Project name `scratch-telemetry` (owner's rule). It must not collide with `scratch-a`: PT-03j gives it its own port block (`deploy/scratch/telemetry.env`) and raises the suffix limit of `scratch.sh` from 8 to 9 characters, because `telemetry` has 9. Every container name, network and volume derives from the compose project name, so `scratch-a` and `scratch-telemetry` can run side by side. The A/B arms run one at a time and never beside `scratch-a`'s own bench.
- The overlay `compose/opt-in/scratch-telemetry.yml` (PT-03k) sets the Paper container limit to **15 GiB (15360m)** and nothing else raises a limit. **The 15 GiB limit exists only in this overlay.** The live Paper's limit change (14 to 15 GiB) is a node step in the PT-16 window. `scratch.yml` keeps `scratch-a` at 3072m.
- Scratch has no real gateway. The overlay's throwaway receiver answers as `otel-gateway` on port 4318 (OTLP/HTTP) on the scratch network, with no published port, and writes JSON lines to the directory `SCRATCH_TELEMETRY_OUT`. The agent properties (PT-02b) point at `http://otel-gateway:4318`, the same string the live window uses on `geldar-colo`, so the properties file is tested as it will run.
- Start (ops agent):

```
export $(cat deploy/scratch/telemetry.env | xargs)           # ports, no secrets
export SCRATCH_TELEMETRY_OUT="$HOME/.local/state/geldar/scratch-telemetry-out"   # absolute, outside the repo
export SCRATCH_OTEL_AGENT_JAR=<absolute path of the verified agent jar>          # sha256 checked against deploy/otel-agent.lock.json
(cd plugin; ./gradlew build)                                  # ledger.jar and geldar-core.jar
sh deploy/scratch/scratch.sh up telemetry                     # NATS auth per the scratch runbook
sh deploy/scratch/scratch.sh status telemetry
```

  Stop: `sh deploy/scratch/scratch.sh down telemetry`. Never run `adam up` before live cases (CLAUDE.md).
- Control channel for scratch-only operator commands (tick rate, `list`, `tick query`): `docker compose -p scratch-telemetry exec paper rcon-cli "<command>"` (UNVERIFIED that the image ships `rcon-cli`; if not, PT-03k documents the replacement). The RCON password lives in the scratch secrets directory and is passed by file, never on a command line.
- Mutation warning: the bench and `test:live` change tick rate, whitelist and world. Run them one at a time (CLAUDE.md). Set `GELDAR_NATS_URL` to the scratch NATS for any Golem run (CLAUDE.md). Whether the bench targets scratch ports is UNVERIFIED (README assumption 11).

## 2. Verification helper

`sh deploy/scratch/telemetry-verify.sh metric <name> [expected]` prints the number of data points found for the name and the last value, exit 1 when none. `event <name>` prints the count and the last record. `absent <string>` exits 1 when the string occurs anywhere in the sink output (used for secrets and addresses). All read `SCRATCH_TELEMETRY_OUT`; a value is compared after at least two export intervals (15 s each).

## 3. Per-signal verification table

Every row: drive, read, expected. "Driver" names what produces the signal; B = `./geldar.ps1 bench`, C = Chunky run, R = `rcon-cli`. Times assume the metric export interval of 15 s.

| Row | Signal | Driver | Read | Expected |
|---|---|---|---|---|
| T1 | `geldar_tick_lag_ms` | none (20 TPS idle) | `metric geldar_tick_lag_ms` after 60 s | histogram count grew by 1,200 plus or minus 5%; p50 under 10 ms idle |
| T2 | `geldar_tick_overruns_total` | C (`chunky start` on a fresh area for 60 s) | `metric geldar_tick_overruns_total` | greater than 0 during C, 0 in a quiet 5 min before C |
| T3 | `geldar_tick_stalls_total`, event `geldar.server.stall` | `docker compose -p scratch-telemetry pause paper`, wait 4 s, `unpause paper` | metric and `event geldar.server.stall` | total rises by exactly 1; one stall event with `geldar.duration_ms` above 2000 |
| T4 | `geldar_tps{window}` | R `tick rate 10`, wait 3 min; then `tick rate 20` | `metric geldar_tps` | window 1m near 10 after 3 min at rate 10, near 20 again 3 min after reset; never above 20.05 |
| T5 | `geldar_tick_rate_target`, `geldar_tick_frozen` | R `tick rate 10`, `tick freeze`, `tick unfreeze` | metrics | target 10 then 20; frozen 1 then 0 (sample within 5 s after each command: sampling is every 100 ticks, 5 s at 20 TPS) |
| T6 | spark gauges | none, spark present | `metric geldar_spark_tps` | within 0.5 of `geldar_tps` 1m; run once with spark removed: no `geldar_spark_*`, plugin still loaded, no error line |
| W1 | `geldar_world_*` | start 3 Bodies | metrics | `world_players` equals R `list` count; `loaded_chunks` above 0 and equal to the Paper count within 5% (compare with `spark`'s chunk figure or the BlueMap/Chunky count; UNVERIFIED which tool prints it) |
| S1 | `geldar_players_online`, `geldar_operators_count` | R `op Tester` then `deop Tester` | metrics | online equals `list`; operators 1 then 0 within 60 s (sample period 1,200 ticks) |
| S2 | event `geldar.server.config_snapshot` | restart Paper | `event geldar.server.config_snapshot`; `absent rcon`; `absent <the RCON password value>` | one snapshot per start; version and view distance present; no `rcon*` key, no password value (S4) |
| E1 | `geldar_event_count_total` | B (breaks, places, chests, bed) | `metric geldar_event_count_total` | series for `BlockBreakEvent`, `BlockPlaceEvent`, `InventoryOpenEvent`, `PlayerBedEnterEvent` with count above 0 and about equal to bench action counts; `cancelled=true` series exist for a denied bed |
| E2 | census exclusions and duty | B | `absent PlayerLoginEvent`; `absent AsyncPlayerChatEvent`; `absent BlockPhysicsEvent`; `metric geldar_event_duty_ratio` | excluded classes never appear as a `geldar.event.class` value; `PlayerMoveEvent` has duty ratio 0.25 (5/20 default) and a count of about 0.25 of the true moves (compare with the PT-01 table) |
| V1 | `geldar.block.break|place` | B (wood) | `event geldar.block.break` | one record per break up to 20/s per class; fields x y z match the bench log; `geldar.life_id` is the Body name |
| V2 | `geldar.item.consume|craft` | B (food, craft) | events | records present |
| V3 | token bucket | B with a Body breaking blocks faster than 20 per second (the bench's break step, or a config `rate.geldar.block.break=2` to make the limit easy to hit) | `event geldar.block.break` per second vs `geldar_ledger_dropped_total{geldar.queue}` | the sink never receives more than the configured rate per second for that class; the excess shows in the drop counter |
| V4 | `geldar.container.*`, `geldar.sleep.*` | B (chest, bed) | events | open and close pairs; sleep enter with result name; a refused bed (daytime) records its result |
| V5 | `geldar.combat.*`, `geldar.movement.*` | R `summon zombie` next to a Body; R `tp Body 0 80 0` | events | damage with cause; teleport with cause COMMAND and the operator flag 1; **no** record for a mob hitting a mob |
| V6 | misc | restart Paper | events | `geldar.server.plugin_enabled` for each plugin; tab completion has length and no text |
| X1 | `geldar.chat` | a Body says `ledger-check-1` (bench chat step, or a one-off Golem script; UNVERIFIED which) | `event geldar.chat` | text exactly `ledger-check-1`, `geldar.life_id` the Body; **the Body receives no extra message** (check the Body's chat log: only what it would get without Ledger) |
| X2 | `geldar.sign` | a Body writes a sign (UNVERIFIED which bench step; else a one-off mineflayer script, not committed) | event | text equals the lines |
| X3 | `geldar.book` | as X2 with a writable book | event | pages joined; a 40 KB book arrives capped to 32,768 bytes with the `[truncated:` marker |
| X4 | `geldar.rcon.command` | R `say ledger-rcon-1` | event | text `say ledger-rcon-1`; sender kind `rcon`; `absent` the loopback sender string and any address |
| X5 | `geldar.console.command` | `docker compose -p scratch-telemetry exec paper mc-send-to-console list` (UNVERIFIED helper) | event | one record, not also an `rcon` record |
| X6 | secrets and addresses | any run | `absent <RCON password>`; `absent 127.0.0.1`; `absent ::1`; grep for an IPv4 pattern across the whole output | none found; fail the run on a hit (S4, S5) |
| P1 | `geldar.player.join|quit` | start and stop a Body | events | join with a session id, quit with the same id and a duration; no address field |
| P2 | `geldar.player.prelogin` | a whitelisted join; a non-whitelisted join | events | result names ALLOWED and KICK_WHITELIST; no address |
| P3 | `geldar.player.kick` | R `kick Body test` | event | reason text up to 200 characters |
| P4 | `geldar.player.snapshot` | 5 Bodies for 3 min | events | each Body about once per 60 s; at most 2 per tick (inspect `geldar.server_tick`) |
| P5 | `geldar.player.advancement|stats` | B (first advancement); wait 5 min | events | advancement key present; stats limited to the allow-list |
| P6 | `geldar.player.client_tick`, `command_tree` | any Body | events | tree hash and size per join and **no command names**; client tick counts near 1,200 per minute, or 0 and the card reports whether mineflayer sends the packet (0351 unverified item) |
| J1 | JFR stream start | start | log line count and `metric geldar_jfr_*` | one `ledger-jfr` thread (`jcmd <pid> Thread.print`), no `.jfr` file on disk (`find` in the container) |
| J2 | `geldar_jfr_thread_group_cpu_ratio` | B | metric | `group=server` above 0.2 under load; `group=ledger` below 0.02 |
| J3 | `geldar_jfr_safepoint_ms` | `jcmd <pid> GC.run` | metric | a safepoint sample |
| J4 | `geldar_jfr_monitor_contention_total`, J5 `geldar_jfr_file_io_ms` | C | metrics | present during C |
| C1 | container metrics | run an arm with the Paper `cpus` limit lowered to 1 | `metric geldar_container_cpu_throttled_periods_total`; compare to `docker compose -p scratch-telemetry exec paper cat /sys/fs/cgroup/cpu.stat` | gauge equals the file within one export interval; rises when throttled; `memory_limit_bytes` is 16,106,127,360 |
| D1 | `geldar_disk_bytes` | wait one cycle (10 min; the test config may set 60 s) | metric vs `du -sb` of the world folder | within 1% |
| B1 | Chunky, BlueMap, CoreProtect gauges | C | metrics | `chunky_running` 1 during C and 0 after; absent plugin gives 0 and no error |
| K1 | kill switch | edit the scratch `ledger.properties`: `enabled=false` | events and `geldar_event_count_total` | no new points within 10 s (5 s reload plus one export); `enabled=true` resumes without restart; listener check: R `plugins` still lists Ledger, and `geldar_event_count_total` stops growing (PT-03h unit test holds the `HandlerList` assertion) |
| G1 | guard | set `collector.census.budget_max_us=1` and `budget_avg_us=1` (a deliberately tiny budget) | metric `geldar_paper_collector_disabled{collector=census}`, log | becomes 1 within 30 s; one log line, not repeated; TPS unaffected; re-enabled only by the config flip |
| Q1 | non-blocking | `docker compose -p scratch-telemetry stop otel-sink`, wait 10 min under B, start it | `tick query` before, during, after; drops | MSPT p95 during the outage within 0.5 ms of before; TPS 20; no growth of RSS above the arm bound; series resume after the sink returns with a gap, no crash |
| N1 | no agent | run an arm with `SCRATCH_OTEL_AGENT_JAR` unset | log, sink | plugin loads, logs `agentPresent=false` once, the ring stays empty, no `geldar_*` points, MSPT equals the off arm within noise (S12) |
| R1 | jar absent | start with the `ledger.jar` bind removed | startup | Paper starts, no error, no Ledger in `plugins` |

Rows are pass or fail. A failed row stops the sequence and goes to the orchestrator with the row number (rollout plan stop rule).

## 4. Load for PT-01 and PT-15

The load is the one 0351 point 14 names: 19 scripted Bodies (no Minds) plus `./geldar.ps1 bench`, plus one Chunky run, in a quiet window, at 20, 10 and 5 TPS (tick rate through `rcon-cli`). The command that starts 19 Bodies without Minds on the scratch project is UNVERIFIED; the ops agent states it in the results document. The 10 and 5 TPS rows are findings only (decision 0038).

## 5. Overhead A/B method (PT-15)

Targets (0351 point 9). Live ceiling: MSPT overhead under 2% of the 50 ms tick (1 ms at 20 TPS); plugin and agent together at most 1 CPU; throttled-period ratio not above baseline; RSS at most 90% of the limit in force. Scratch acceptance (stricter, PROPOSED): MSPT p50 up by 0.2 ms or less, p95 by 0.5 ms or less, p99 by 1.0 ms or less; TPS unchanged; CPU up by 0.2 CPU or less and throttled time not up; heap after GC up by 300 MiB or less; RSS up by 400 MiB or less; startup up by 10 s or less; the bench 20 TPS gate at 100% and action latency p95 within plus or minus 5% or the bench noise; no drops at steady state; the guard never trips.

Arms. **OFF**: no agent, no `ledger.jar`. **ON**: agent with the PT-02b properties, `ledger.jar`, `geldar-core.jar` with PT-11 seams, all collectors at default config, sink running. An optional third arm **AGENT-ONLY** (agent, no `ledger.jar`) separates the two costs. Same world snapshot: before each arm the world volume is restored from one copy; the same seed, the same Bodies, the same bench script.

Procedure (per arm, scripted in `deploy/scratch/telemetry-ab.sh`):

1. Start the arm, record the `Done (Ns)!` startup time from the log.
2. Warm-up: 5 minutes from the first Body join, no measurement.
3. Measure for 15 minutes under the bench load at 20 TPS (then the 10 and 5 TPS rows as findings, 10 minutes each). Every 10 s: `rcon-cli "tick query"` (average, P50, P95, P99 of the last 100 ticks; UNVERIFIED output format in 26.1.2, the script parses and stores raw text too), `cpu.stat` and `memory.current` from the container's cgroup, and `jcmd <pid> GC.heap_info` once a minute after a `GC.run` at the end for heap after GC.
4. Pairs: OFF, ON, OFF, ON, OFF, ON (three pairs, alternating, to cancel drift). Between arms: `down`, restore volume, `up`.
5. Aggregate: per arm the median across its pairs of the per-sample p50, p95, p99 MSPT; CPU as the delta of `usage_usec` over the measuring window divided by wall time; throttle ratio as delta `nr_throttled` over delta `nr_periods`; RSS peak; startup. Report ON minus OFF with the min and max across pairs, and the bench's success and latency tables.
6. The measurement source is Paper's own `tick query` and the kernel's cgroup files, **not** Ledger's metrics (circularity). Ledger's metrics are cross-checked afterwards against these (T1 and C1 rows).
7. Pass: every scratch bound above. A result between the scratch bound and the live ceiling is reported to the owner as a judgement call, not auto-passed. The results go to `pt15-results.md` with UTC times, jar sha256s, config file hashes and the compose project name.

Scratch is not Colo: the overlay builds on `phase0.yml` and the host is a dev machine (assumption 7). The results document says so; the live window's baseline and after-window `tick query` (below) are the real confirmation.

## 6. Live window (PT-16) and rollback

Request to the owner (through the orchestrator), all fields mandatory: window start and end in UTC; sha256 of `ledger.jar`, `geldar-core.jar` and the agent jar; the exact node steps; the rollback below; the expected series; the stop criteria. Preconditions: PT-15 passed; A9 passed (stack and gateway up, rollout plan); C1 finished (no batch running); no Caddy window the same day (rollout plan: Paper and Caddy changes never share a window); the owner's Paper 15 GiB and bStats-off approvals.

Sequence (all on the node, one Paper restart):

1. Baseline: `tick query` three times over 5 minutes; read the cgroup `cpu.stat` (`nr_periods`, `nr_throttled`) and `memory.current`; record the 0351 context figures (throttle ratio, memory 12.7 of 14 GiB).
2. Place the three jars read-only at the paths the compose file mounts; set `GELDAR_STATE_DIR`-relative agent path; set the Paper memory limit to 16,106,127,360 bytes; set `plugins/bStats/config.yml` `enabled: false`; set `JAVA_AGENTS` and flip `otel.sdk.disabled` to false by environment (`OTEL_SDK_DISABLED=false`).
3. Restart Paper once. Wait for `Done`.
4. Verify within 15 minutes: `geldar_tps` and `geldar_tick_lag_ms` series arrive in SigNoz through the tunnel; `tick query` within the live ceiling versus baseline; throttle ratio not above baseline; RSS at most 90% of the new limit; no RCON thread lines in logs; no secrets or addresses (`absent` check on the gateway's ClickHouse text with the operator query); all 19 Bodies reconnect and no Body restarts; no Velocity denials; Paper `latest.log` has no Ledger error line.

Rollback levels (use the lowest that fixes the problem; each is named in the request):

- **L0, no restart (seconds):** in `plugins/Ledger/ledger.properties` set `enabled=false`. The plugin unregisters its listeners and stops samplers within about 5 s. The agent keeps running (its runtime metrics) but adds no Ledger cost.
- **L1, restart without Ledger:** remove the Ledger bind (`ledger.jar`), restart Paper once. Geldar-Core and agent stay.
- **L2, full rollback (the 0351 rollback):** unmount `ledger.jar`, unset `JAVA_AGENTS`, restore the previous `geldar-core.jar` (its sha256 is in the request), restart Paper once. The memory limit stays 15 GiB unless the owner says otherwise (raising it is harmless; lowering it back is a separate request). bStats stays off.

Stop rule (any one triggers L0 first, then L2 if not resolved in 10 minutes): TPS 1m under 19.5 for 2 minutes with no pregeneration running; MSPT p95 more than 1 ms above baseline for 5 minutes; throttle ratio above baseline; RSS above 90% of the limit; any Body restart or Velocity denial attributable to the window; a secret or address found in the sink output; `geldar_ledger_dropped_total` rising at steady state.

After the window: a short note in `docs/analysis/telemetry/RESUME.md` with UTC times and the result (the orchestrator, not a coder).
