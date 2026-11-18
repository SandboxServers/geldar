# Node request 05 (scratch NeoForge telemetry and human run, file 06-...): combined scratch-nf telemetry session (machine rows, then the owner's human join, then teardown)

Numbering: geldar-93 calls this session "request 05" in chat. The file is numbered 06 because `05-tag-ruleset.md` already exists.

Status: DRAFT, revised 2026-11-17 for the owner's decisions. Nothing has been run and the node has not been contacted. Every step needs the owner's direct approval before it touches the node. Written against origin/main at abb799b3. Anything not read from a file in this tree is marked UNVERIFIED. No address, account name, player name or secret appears here: placeholders only (`<node-ssh-host>`, `<stage dir>`, `<out dir>`, `<sink-merge-sha>`).

## 1. Purpose

One scratch session on the node, in this order, one stack, one teardown:

1. Machine phase: the NeoForge row driver `deploy/scratch/telemetry-rows-nf.sh` (rows NF0 to NF11) against `scratch-nf` with the ledger jar, the OpenTelemetry agent and the throwaway OTLP sink. This is the verification path named in `docs/analysis/telemetry/nf-live-telemetry.md` section 0a before anything goes to `geldar-nf`. It also settles the open attach question (does the agent attach on NeoForge through `JVM_OPTS`: UNVERIFIED until this run).
2. Human phase: the owner joins once with a real Microsoft account through the human listener (`velocity-human`, online mode) and plays about 5 minutes, to see what telemetry a human produces (no name, UUID or IP in it) and to check the online-UUID path (`docs/runbooks/scratch-stack.md`, "Human listener on the scratch stack", checks 1 to 3).
3. Teardown: `scratch.sh down nf` with the same environment, then delete the staged files and the output directory.

The human joins AFTER the machine rows on purpose: row NF8 asserts "no human names exist in scratch" and NF6/NF9C drive agent-shaped players; a human present earlier would make those rows fail for a reason that is not a defect. The human listener is up from the one `up` (section 6) so that the paper server is created once; nobody connects to it until the owner's go-ahead in section 9.

## 2. What changes on the node

- A new compose project `scratch-nf` appears, then disappears. Containers (all label `geldar.scratch=true`, `restart: "no"`): `paper` (NeoForge), `velocity`, `postgres`, `nats`, `eventsink`, `otel-sink`, and `velocity-human`. Plus its named volumes and the secrets directory `${XDG_STATE_HOME:-$HOME/.local/state}/geldar-scratch/scratch-nf` (mode 0700).
- Every published port is `127.0.0.1` only (`deploy/scratch/nf.env`): PG 35432, NATS 34222, NATS monitor 38222, Minecraft 55565, RCON 55575, human listener 55566. `otel-sink` publishes nothing and answers as `geldar-gateway` on the project network only. Nothing public; no SRV record, no Caddy, no firewall change.
- Files on the node: a staging directory `<stage dir>` (jars, properties, scripts) and the output directory `<out dir>` (sink output `otlp.jsonl`, row-driver logs), both owned by the run account, mode 0700, outside the repo checkout.
- The human listener is loopback only. The owner reaches it only through an ssh port forward (section 9).

Does not touch: the live stack, live networks, other tenants' containers, `geldar-nf`, Caddy, `compose/secrets/`, other scratch projects, any file of the repo checkout on the node other than reading it.

## 3. Inputs, with hashes

Stage nothing from a path not listed here. Ops computes and records each hash at staging and compares it with the value below before `up`. The scratch script re-checks the jar hashes itself (`scratch-ledger.sh`) and the container checks them again.

| Input | Name and size | sha256 |
|---|---|---|
| Ledger jar (built from main 3e7a9076) | `geldar-neoforge-ledger-0.1.0.jar`, 465527 bytes | `969fd8be89a95f1d7b73f6ebe6516730c46f62ad2ebf76d0213f51544494abbd` |
| Ledger config | `ledger.properties` | `407e4759cb1bafa417ecd8eb75d03fd964578e5b89dc2586b41eff6047865f44` |
| Agent config | `otel-agent.properties` | `4a6ff9bcb4e0c890f7929f63dde39ceafb842683b8f914d8ab20c1cee7c0ab8f` |
| OpenTelemetry Java agent 2.33.1 | `opentelemetry-javaagent.jar`, 26507624 bytes | `e43a270df53c6f423e0ab157be9c27ccc01d5dc3232e162fe54777573db2f149` (the repo constant `GELDAR_NF_OTEL_AGENT_SHA256`; `up` checks the host file against it) |
| Geldar mod jar (the NeoForge mod the stack mounts through `SCRATCH_NEOFORGE_MOD_JAR`) | name and size: TO BE PROVIDED by geldar-93's ops | TO BE PROVIDED by geldar-93's ops. Do not start without it. |
| Row driver | `deploy/scratch/telemetry-rows-nf.sh` | `E25202CB4B9B57B1F5148DF2301DC56B7DEBF49B5C5A93B2547D39DC770747D6` (checked against the file in this tree at abb799b3; re-check against `git show <sink-merge-sha>:deploy/scratch/telemetry-rows-nf.sh` at the staged sha) |
| Scripts and overlays at the merge sha `<sink-merge-sha>` | `deploy/scratch/scratch.sh`, `scratch-ledger.sh`, `scratch-human.sh`, `telemetry-verify.sh`, `nf.env`; `compose/opt-in/scratch.yml`, `scratch-neoforge.yml`, `scratch-neoforge-mod.yml`, `scratch-neoforge-ledger.yml`, `scratch-neoforge-ledger-off.yml`, `scratch-neoforge-telemetry.yml` (the sink overlay, from PR #709), `scratch-human.yml`; `compose/velocity/velocity-human.toml`; `compose/neoforge/neoforge-entrypoint.sh` | Hashes: to be computed by ops at staging and listed in the run note. `<sink-merge-sha>` is the merge commit of PR #709 (the sink overlay) and must also contain the whitelist-off change (section 9, step 3). If PR #709 is not in it, this request is not ready. |

Where the geldar-neoforge entrypoint, the ledger jar and the properties differ from the above (a rebuild, a new sha), stop: this request is for exactly these bytes.

## 4. Caps and headroom

| Service | Memory | CPU | Source |
|---|---|---|---|
| paper (NeoForge) | 3072m | 1.5 | `compose/opt-in/scratch.yml`, `docs/runbooks/scratch-stack.md` "Resource caps" |
| velocity, postgres, nats, eventsink | 768m, 768m, 256m, 384m | 0.5, 0.5, 0.25, 0.25 | same |
| otel-sink | 512m | 0.5 | the sink overlay (PR #709) |
| velocity-human | 768m, no swap, 256 pids | 0.5 | `docs/runbooks/scratch-stack.md` "Human listener" |

Total: about 6.5 GiB and about 4.0 CPUs at most (5248 MiB plus 512 plus 768 for the stack, sink and human listener). The task framing says "about 3 GB / 1.5 CPU for the nf scratch plus the sink 512m/0.5": that is the game server alone plus the sink; the figure above is the whole project. Headroom at the owner's check (geldar-93, 2026-11-17): the node has about 96 GiB available and about 0.7 of one core in use. The owner has said the whole-project caps above (about 6.5 GiB, 4 CPUs) are OK. `geldar-nf` (16.25 GiB, 5.75 CPUs) is also running and is not touched. The run never lowers a cap and asks for no raise; if the NeoForge server needs more, that is a new request. The baseline in section 5 re-measures the headroom before `up`.

## 5. Baseline before (read-only; paste into the run note)

```
docker ps -a --format '{{.Names}} {{.Status}}'
docker compose ls
free -g ; nproc ; uptime
df -h <docker data root> <stage dir parent>
ss -ltn | grep -E ':(35432|34222|38222|55565|55575|55566)\b'     # must print nothing
docker volume ls | grep scratch-nf                              # must print nothing
docker ps --filter label=geldar.scratch=true --format '{{.Names}}'   # nothing running unless the owner names a kept stack
```

Hard rule: `scratch-nf` runs alone among scratch stacks (no Paper A/B arm, no other scratch NeoForge run at the same time). `geldar-nf` keeps running throughout; it is not a scratch stack and it is not touched.

## 6. Start sequence (machine phase)

The operator is the non-root run account; the repo checkout on the node is at `<sink-merge-sha>` and clean. All variables exported in the one shell that runs `up`, `status`, the row driver and `down` (the overlays are selected from them; `down` needs the same values). `up` is run once and includes every overlay: the scratch stack, the NeoForge ledger and mod overlays, the OTel sink and the human listener (`SCRATCH_HUMAN_LANE=1`). The paper server is created by that one `up`: there is no second `up` and no restart for the human lane.

```
export SCRATCH_PLATFORM=neoforge
export SCRATCH_NATS_AUTH_DIR=<auth dir>              # five up files, absolute, from a clean export (as the runbook "Before up")
export SCRATCH_NEOFORGE_LEDGER_JAR=<stage dir>/geldar-neoforge-ledger-0.1.0.jar
export SCRATCH_NEOFORGE_LEDGER_SHA256=969fd8be89a95f1d7b73f6ebe6516730c46f62ad2ebf76d0213f51544494abbd
export SCRATCH_LEDGER_PROPS=<stage dir>/ledger.properties
export SCRATCH_NEOFORGE_OTEL_AGENT_JAR=<stage dir>/opentelemetry-javaagent.jar     # no whitespace in the path
export SCRATCH_NEOFORGE_OTEL_AGENT_PROPS=<stage dir>/otel-agent.properties
export SCRATCH_NEOFORGE_MOD_JAR=<stage dir>/<geldar mod jar>                       # name TO BE PROVIDED
export SCRATCH_NEOFORGE_MOD_SHA256=<provided sha256>
export SCRATCH_NEOFORGE_TELEMETRY_SINK=1
export SCRATCH_HUMAN_LANE=1                          # human listener is part of the one up; nobody joins until section 9
export SCRATCH_TELEMETRY_OUT=<out dir>                # absolute, existing, writable, not a symlink, mode 0700
```

Note on the variable count: the runbook ("Ledger jar and OTel agent on the scratch NeoForge stack") and `nf-live-telemetry.md` section 0a name exactly five variables that are set together or not at all: `SCRATCH_NEOFORGE_LEDGER_JAR`, `SCRATCH_NEOFORGE_LEDGER_SHA256`, `SCRATCH_LEDGER_PROPS`, `SCRATCH_NEOFORGE_OTEL_AGENT_JAR` and `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS` (only four carry the `SCRATCH_NEOFORGE_` prefix; `SCRATCH_LEDGER_PROPS` does not). The mod jar pair `SCRATCH_NEOFORGE_MOD_JAR` and `SCRATCH_NEOFORGE_MOD_SHA256` is a separate overlay (`scratch-neoforge-mod.yml`, both or neither). The block above sets all seven, plus the sink and human-lane switches. `SCRATCH_NEOFORGE_TELEMETRY` is NOT set (it is the soft kill and is refused together with the five).

Then:

1. Verify every staged hash against section 3 (`sha256sum`), and `ss` is clean.
2. `sh deploy/scratch/scratch.sh up nf` (uses `deploy/scratch/nf.env`), one invocation with every variable above. Exit 2 means nothing started (a bad variable); read the message, fix, rerun. Any other failure: run exactly the "clean up with: ... down" line it prints.
3. Wait until `status nf` shows postgres, nats, velocity, paper, otel-sink and velocity-human healthy. First NeoForge start downloads nothing if the bundle is offline (runbook "Offline bundle"); whether the node needs the Maven/Modrinth route is UNVERIFIED (open fact).
4. Check the attach by eye before the rows: `docker top <paper container>` shows `-javaagent:/geldar/telemetry/opentelemetry-javaagent.jar`; the container log shows the agent's startup line and `Geldar Ledger`; `<out dir>/otlp.jsonl` has grown after about two 15 s export intervals. If the agent did not attach, stop and report (it is the UNVERIFIED point the run exists to settle).
5. Copy `deploy/scratch/telemetry-rows-nf.sh` and `telemetry-verify.sh` into one directory (`<stage dir>/rows`), check the driver sha256 equals the section 3 value, then:

```
cd <stage dir>/rows
sh telemetry-rows-nf.sh --list                  # prints the rows and their dependencies; read-only
SCRATCH_TELEMETRY_OUT=<out dir> SCRATCH_REPO_ROOT=<repo checkout on the node> \
  SCRATCH_ROWS_PROBE_CMD='sh <repo checkout on the node>/deploy/scratch/scratch.sh probe nf' \
  nohup sh telemetry-rows-nf.sh >rows-nf.out 2>&1 &
```

Export list the row driver needs (names only). NF10 runs `docker compose config -q` against the labelled compose files of the running paper container, and compose refuses a missing required variable before it touches anything, so the driver's shell must export every one of these (it skips NF10 as `env-not-exported`, and names the first missing variable in `got=... missing=NAME`):

- The section 6 exports (the block above): `SCRATCH_PLATFORM`, `SCRATCH_NATS_AUTH_DIR`, `SCRATCH_NEOFORGE_LEDGER_JAR`, `SCRATCH_NEOFORGE_LEDGER_SHA256`, `SCRATCH_LEDGER_PROPS`, `SCRATCH_NEOFORGE_OTEL_AGENT_JAR`, `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS`, `SCRATCH_NEOFORGE_MOD_JAR`, `SCRATCH_NEOFORGE_MOD_SHA256`, `SCRATCH_NEOFORGE_TELEMETRY_SINK`, `SCRATCH_HUMAN_LANE`, `SCRATCH_TELEMETRY_OUT`.
- Set by `scratch.sh` itself inside its own process, so a separate shell does not have them and must export them with the same values `up` used: `SCRATCH_SECRETS_DIR`, `GELDAR_WORLD_VOLUME` (`<project>_paper-data`), and `SCRATCH_RUN_UID`, `SCRATCH_RUN_GID` (`id -u`, `id -g` of the account that ran `up`). The ports (`SCRATCH_*_PORT`) come from `nf.env` and have defaults in the compose files.
- Set by `scratch.sh` and `scratch-ledger.sh` (compose requires them, with no default): `GELDAR_NF_MOD_JAR_HOST`, `GELDAR_NF_MOD_SHA256` (from the two `SCRATCH_NEOFORGE_MOD_*` values), `GELDAR_NF_LEDGER_JAR_HOST`, `GELDAR_NF_LEDGER_PROPS_HOST`, `GELDAR_NF_LEDGER_SHA256`, `GELDAR_NF_OTEL_AGENT_JAR_HOST`, `GELDAR_NF_OTEL_AGENT_PROPS_HOST` (from the matching `SCRATCH_NEOFORGE_*` and `SCRATCH_LEDGER_PROPS` values). Also exported there and used by `scratch.sh` to pick the overlays: `GELDAR_NF_TELEMETRY`, `GELDAR_NF_LEDGER_OFF`.

Simplest way to get all of them: run the driver from the same shell that sourced the environment of `up`, or use the driver in a shell where `scratch.sh`'s `set_env` has been run. No value is ever printed by the driver.

The driver is started from the same shell as `up`, so the probe inherits the same environment (`SCRATCH_PLATFORM`, `SCRATCH_NATS_AUTH_DIR` and the rest). NF6 and NF7 use the scratch probe, `scratch.sh probe nf`; do not use the geldar-nf probe verb. The scratch probe works on scratch (golem on main accepts scratch-nf). Its whitelist add and remove are harmless with the whitelist off (geldar-neoforge is checking this).

Optional per its header: `SCRATCH_ROWS_PROFILE`, `SCRATCH_ROWS_CGROUP_DIR`/`_ROOT`, `SCRATCH_ROWS_MEMINFO`, `SCRATCH_ROWS_SHARD` (default `nf`), `SCRATCH_ROWS_RCON_CMD` (default `rcon-cli` inside the container). A subset runs with `--only NF0,NF2`.

The driver's rows, in its order: NF0 attach and mod loaded, NF1 resource attributes (no host, process, container id, address or UUID), NF2 tick lag 20/s, NF3 players_online, mods_loaded and config snapshot keys, NF4 world gauges, NF5 stall detection (pauses the server), NF6 join/quit with session id, NF7 session stays across a respawn, NF9A chat off, NF9B commands name-only, NF9C operator and combat events, NF8 identity scan of the whole journal, NF11 memory, NF10 collector switch off and back (may recreate the server once, with `compose up --force-recreate`, and rewrites the one mounted ledger profile in place, restoring it). Expected duration: UNVERIFIED (the driver states none; plan for 30 to 60 minutes and say so in the note).

Output contract (from its header): stdout lines `ROW <id> PASS|FAIL|SKIP got=<v> want=<w>`, `RECOVERY`, `ABORT`, `SUMMARY`; detail in `<out dir>/telemetry-rows-nf-<utc>.log`. Exit: 0 no row failed, 1 a row failed, 2 usage or environment, 3 ABORT, 4 profile not restored (saved copy `ledger.properties.orig.<pid>` kept), 5 the server not back in its default configuration. The `RECOVERY` line is the first line; keep it.

## 7. Stop rules (any one: stop, `down` only if the scratch stack is the cause, report)

- The paper container's `memory.current` reaches 90% of its limit (the driver aborts at this itself, exit 3), or `MemAvailable` on the node drops below 30 GiB (driver abort threshold as well).
- A container NOT labelled `geldar.scratch=true` restarts or is recreated (the driver compares StartedAt at row boundaries and aborts; ops also watches `docker ps` by eye).
- A port collision at `up` (the script fails; do not retry on other ports without a new request).
- The profile is not restored (exit 4) or the server not back (exit 5): do the restore from the saved copy the `RECOVERY` line names, then `down`.
- Anything touches a path or container that is not `scratch-nf`'s. Never stop, kill, remove or inspect other tenants beyond the read-only `docker ps`.

## 8. Machine phase: what to record

The `ROW` lines and the `SUMMARY`; exit code; the tail of `rows-nf.out`; for each FAIL or SKIP the log lines of that row (summaries, not raw journal). Findings are reported as findings, never "fixed" by editing a row or fixture. `otlp.jsonl` stays on the node (section 10).

## 9. Human phase (owner, about 5 minutes of play, after the rows have finished or been stopped)

Preconditions: the row driver has exited and its `RECOVERY` state is clean (exit 0 or 1, not 4 or 5); the owner confirms in writing they are ready; the whitelist-off change is merged and included in the staged sha (step 3); the owner's Minecraft client version matches the server (UNVERIFIED which version; the NeoForge version is 26.1.2 build 126 per `nf-live-telemetry.md`).

1. Turn the sink output over: note the line count of `otlp.jsonl` (`wc -l`), so the human window is the lines after it. Do not delete the file yet.
2. The human listener is already up: the one `up` in section 6 included `velocity-human`. There is no second `up` and no restart for the human lane. Confirm with read-only checks: `status nf` shows velocity-human healthy, and paper's start time is the one from the machine phase (`docker inspect -f '{{.State.StartedAt}}'` on the paper container). `SCRATCH_HUMAN_PORT` is 55566 from `nf.env`, bound to 127.0.0.1 only. Until the owner's go-ahead, nobody connects to that port.
3. No whitelist step. geldar-neoforge is making the scratch and live overlays whitelist-off in a small PR, and this run waits on that merge. `<sink-merge-sha>` must therefore contain that merge as well as PR #709 (ops checks with `git merge-base --is-ancestor`). The listener is loopback only, so "anyone can join" means anyone who can reach that loopback port. The owner reaches it only through the forward in step 4.
4. The owner opens the forward on their own machine: `ssh -N -L <local port>:127.0.0.1:55566 <node-ssh-host>` (the owner's own ssh route; ops does not open it). The vanilla client connects to `localhost:<local port>` and signs in through Mojang's normal sign-in.
5. The owner, for 5 minutes: join; walk around (forces chunk loading); break one block and place one; open a chest; take a little damage (a fall of a few blocks, with respawn if killed: this also produces the combat event and a respawn); quit by the menu. No chat is needed and chat export is OFF; do not type chat.
6. Human-listener checks (runbook checks 1 to 3, UNVERIFIED until run): the join succeeds and shows in the Paper list; an agent-shaped name is refused by the identity plugin's human lane (needs a second, agent-shaped test name: optional, owner decides, not recorded in the report); the UUID Paper logs is the online UUID, not the offline one. Record only that each is true or false; redact account names, addresses and tokens in any line that leaves the host.

What the telemetry should show for the human (all UNVERIFIED expectations from the collector design; the run shows whether they hold):

- Join and quit as aggregate counts (a join/quit with duration and a session id, no name, UUID or IP); `players_online` going 0 to 1 to 0.
- Tick lag and world gauges (chunks, entities, players per dimension) moving while the owner walks.
- Curated and combat events for the damage or death, carrying no human id (an agent's life id exists only for agents).
- Nothing from chat (off), and command lines, if any, name-only.

Checks, by ops over `<out dir>/otlp.jsonl` after the human window, using `deploy/scratch/telemetry-verify.sh`:

- `telemetry-verify.sh absent` for the generic patterns the driver's NF8 uses, IPv4, IPv6 and UUID shapes, over the human window (lines after the count in step 1). Expected: no match.
- No human-shaped name in any attribute: ops reads the distinct attribute keys and the distinct string values of the human window by hand (not raw lines) and confirms that no value is a player name. The report records counts and the verdict only, no player names.
- Optional, only if the owner gives the name to ops privately: `telemetry-verify.sh absent <name>` with the name as the argument, not saved to any file in the repo, not echoed into the run note; record only "absent: pass/fail". Expected: pass. Without the name, this check is not run.
- `metric` verifies for `players_online` and the join/quit event; wait two export intervals (30 s) after each action before verifying. The exact verify arguments are in `telemetry-verify.sh`'s header (read it at staging; not reproduced here).
- If the NeoForge server's own log (`latest.log`) contains a player name, that is expected (the log is not exported); no player name may appear in `otlp.jsonl`.

At the end: the owner quits and closes the forward; ops runs `rcon-cli list` and confirms no player is shown.

## 10. Data handling

- `otlp.jsonl` and the driver logs hold the full-text capture of this run. Only the owner's own session is human content; chat is OFF; scratch has no other real player. Everything stays on the node, mode 0700/0600, readable only by the run account.
- Read it on the node. Copy out summaries (counts, PASS/FAIL lines, the verify exit codes, sizes), not raw lines. If a raw line must leave the host, redact names, addresses and tokens first.
- Delete after reading: section 11.
- Never print `compose/secrets/` or the scratch secrets directory.

## 11. Teardown

1. Stop the row driver if still running (it is not a container; ask before killing the process; it is ours, `pgrep -f telemetry-rows-nf.sh`).
2. `sh deploy/scratch/scratch.sh down nf` with the SAME exported variables as `up` (`SCRATCH_HUMAN_LANE=1` included; `down` always includes the human overlay). It removes containers, volumes (`down -v --rmi local --remove-orphans`), the scratch secrets directory; it exits 1 if any volume is left: then list and report `docker volume ls | grep scratch-nf`, do not force-remove anything else.
3. Delete by hand, after the owner has read what they want: `<stage dir>` (jars, properties, the copied scripts), `<out dir>` (including `otlp.jsonl`, logs, any `ledger.properties.orig.*`). The NATS auth dir is the operator's: delete it if it was made for this run.
4. Confirm: `docker ps -a` equals the section 5 baseline; `ss -ltn` for the six ports prints nothing; `docker volume ls | grep scratch-nf` prints nothing; no `scratch-nf` process.

## 12. Verify (after teardown)

The node is back at the baseline: same containers, same ports, same free RAM within noise, no `scratch-nf` objects, no staged files. No non-scratch container's StartedAt changed during the run (the driver logged the start list; ops compares `docker ps` before and after).

## 13. Rollback

- A failed `up`: run the "clean up with: ... down" line it prints.
- Driver abort (exit 3), exit 4 or 5: restore the profile from the saved copy named by `RECOVERY` (copy over the mounted host file in place, never replace the file), rerun nothing, `down`.
- Any doubt about the stack: `down nf` with the same variables is always the rollback; it only touches `scratch-nf`.
- Telemetry soft kill (the NeoForge ledger and agent only, the stack keeps running): set `SCRATCH_NEOFORGE_TELEMETRY=off` as an
  explicit value and run `up` again. The switch is refused together with the five `SCRATCH_NEOFORGE_*` and `SCRATCH_LEDGER_PROPS`
  variables, so remove those five in the same shell. Do not roll back by unsetting the switch: a stale ledger copy in `mods/`
  then refuses to start. After it, run the four checks in `nf-live-telemetry.md`, section 3, "Kill switch and rollback": ledger jar
  absent from `mods/`, no `-javaagent` in `user_jvm_args.txt`, not in `geldar-telemetry`, container healthy. The first live attempt
  (2026-11-18) is recorded there as the "Rollback lesson".
- No repo change is made by the run, so there is nothing to revert in the repo.

## 14. Report back

1. Baseline (section 5) and the final state (section 11 step 4).
2. Staged hashes against section 3 (match or not), the geldar mod jar name, size and sha256, the merge sha (`<sink-merge-sha>`).
3. `up` result (one invocation), time to healthy, whether the agent attached (`docker top`, the log line), `otlp.jsonl` growth.
4. The row driver's `ROW` and `SUMMARY` lines, its exit code, and the duration.
5. Memory: container limit, peak `memory.current` and java RSS from NF11, `nr_throttled`, node `MemAvailable` minimum.
6. Human phase: paper's start time against the machine phase (no restart, no second up), the three listener checks (true or false), the identity scans, the generic `absent` results, the optional name check (pass or fail only, if run), the telemetry seen for the human (counts only).
7. Teardown result and any leftover.
8. Findings and anything unexpected, never smoothed over.

## 15. Open facts

- Whether the agent attaches on NeoForge through `JVM_OPTS` (the run exists to settle it).
- Whether NeoForge's `run.sh` reads `user_jvm_args.txt` (runbook marks it UNVERIFIED).
- The row driver's and `telemetry-verify.sh`'s parsers have not been checked against real output.
- The geldar mod jar name, size and sha256: TO BE PROVIDED by geldar-93's ops.
