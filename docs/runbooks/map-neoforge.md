---
title: "BlueMap on the NeoForge shard: manual steps"
type: how-to
audience: agents-never
status: draft
last_verified: 2026-11-18 against the NF-BM design note and its addendum (2026-11-18), and origin/main a8063b0a (PR #750, #755, #757, #759 merged)
companions: [map-chat-panel.md, scratch-stack.md, nf-live-project.md, nf-extra-mods.md, nf-bluemap-web.md, README.md]
sources: [docs/analysis/bluemap/neoforge-map-design.md (tracked, the NF-BM design note), compose/nf-live.yml, deploy/nf-deploy.sh, deploy/scratch/scratch.sh, deploy/scratch/scratch-extra-mods.sh, compose/neoforge/neoforge-entrypoint.sh, compose/neoforge/extra-mods-bluemap-config.sh, plugins/bluemap/neoforge/ (config bundle), deploy/caddy/README.md, deploy/caddy/validate.sh, deploy/caddy/map.caddy, deploy/caddy/map-neoforge.caddy (NF-BM-4), compose/bluemap-web-nf/ (NF-BM-3), compose/nf-live-bluemap-web.yml]
---

# BlueMap on the NeoForge shard: manual steps

This runbook puts the owner's BlueMap map on the NeoForge shard. BlueMap renders inside the NeoForge server, a second
Caddy-fronted web container serves the output read only, and the host edge Caddy publishes it on its own name. Players
are hidden on this map: no markers, no names, no positions.

The steps run in this order, and each step is a gate for the next one: preconditions, scratch test, live jar, edge,
DNS, privacy check, and only then is the map public. Section 8 is a warning that applies to every section. Nothing here
edits `deploy/nf-deploy.sh` or `compose/nf-live.yml`. Those belong to geldar-neoforge.

Placeholders: `<zone>` is the owner's DNS zone, `<edge-target>` the target of the Paper map's record, `<nf-web-upstream>` the loopback address
of the NeoForge web container (NF-BM-3's compose snippet sets the port), `<neoforge-container>`, `<nf-web-container>`,
`<project>`, `<host Caddyfile>`, `<host config dir>`, `<env-file>`, `<node-checkout>` and `<backup dir>`. Never paste real
values into this file or into a ticket.

## 1. Preconditions

Do not start section 2 until every line is true. Ops records the date and who confirmed each one.

- [ ] NF-BM-1 (lock file `plugins/bluemap/neoforge.lock.json` and its test), NF-BM-2 (NeoForge configs and the
      players-hidden test), NF-BM-3 (`compose/bluemap-web-nf/` and its real-Caddy tests) and NF-BM-4
      (`deploy/caddy/map-neoforge.caddy`, `map-neoforge-off.caddy`, README rows, `validate.sh` entry) are merged to `main`.
      PR numbers: `<PR for NF-BM-1>` to `<PR for NF-BM-4>`.
- [ ] The owner approved every BlueMap decision on 2026-11-18 (the design note's section 1 to section 5, and the
      addendum). The approval is in the orchestrator's record; this runbook does not restate it.
- [ ] The jar is the one the lock file names: BlueMap 5.29 NeoForge, sha256 `8938f4453af4b53970c86e43d0bd26b4a88980e4e6639f818fa770d0f61c43df`,
      size as recorded in the lock file. Check the lock file, not this line, if they differ.
- [ ] The NeoForge image is the digest in `compose/nf-live.yml` on `main`:
      `itzg/minecraft-server:2026.10.1-java25@sha256:d12aed7e35981dfe259b60fbfee77d23a19b5898a7a31dca298d18b47b7b5776`.
      Java must be 25: `docker exec <neoforge-container> java -version` prints `openjdk version "25`. BlueMap 5.17 and
      later need Java 25, and a lower Java means the mod does not load.
- [ ] geldar-neoforge confirmed heap headroom under the 9G heap (`-Xmx` unchanged) for one render thread and bounded maps.
- [x] RESOLVED (was a BLOCKER owned by geldar-neoforge): the second-jar mount is merged (PR #750). Live: `NF_EXTRA_MODS=bluemap`
      and `NF_EXTRA_BLUEMAP_JAR_HOST=<absolute host path>` (see `docs/runbooks/nf-extra-mods.md`). Scratch: the hook of PR #757,
      `SCRATCH_EXTRA_MODS=1` with `SCRATCH_EXTRA_BLUEMAP_JAR_HOST` and `SCRATCH_EXTRA_CHUNKY_JAR_HOST`. Both scratch host
      variables are always required, because the overlay mounts both jars. Sections 2 and 3 may start when the other lines
      are ticked.
- [x] RESOLVED (OI-1, PR #759): BlueMap's config is seeded by the entrypoint, not by hand. On every start it installs the
      committed bundle `plugins/bluemap/neoforge` (checked against `MANIFEST.sha256`), and it refuses to start without that
      bundle. No manual seed is needed on scratch or live. Ops confirms the first start's log line.
- [ ] The data volume is `neoforge-data`, mounted at `/data` in the NeoForge service. The web container mounts only its
      `bluemap/web` subpath, read only, at `/srv`. It never mounts `/data` itself.
- [ ] The owner has approved a window for the NeoForge recreate (section 3) and a separate window for the edge (section 4).
      Players disconnect during a NeoForge recreate, and every site on the edge drops during a `board-proxy` restart.
- [ ] Section 2 passed on the scratch stack, with the result written in the report of that run.

## 2. Scratch compatibility test (before any live step)

Purpose: prove that BlueMap loads next to the geldar mod on the same image, that it writes web files, and that it
renders, before the live shard is touched. The scratch stack is a separate project with no players and no live data.

Bring-up uses the scratch hook (`deploy/scratch/scratch-extra-mods.sh`, PR #757; see `docs/runbooks/scratch-stack.md`,
section "Extra mods (BlueMap, Chunky) on scratch"). The hook adds the overlay `compose/opt-in/scratch-neoforge-extra-mods.yml`
when `SCRATCH_EXTRA_MODS=1`. The manual overlay route and the hand seed of BlueMap's config are retired: the entrypoint seeds
the config (OI-1). Do not run this section unless the tree you run it from contains `compose/neoforge/extra-mods-bluemap-config.sh`
(`scratch.sh up` refuses without it).

The overlay mounts BOTH jars, so both host variables must name real files, even for a test that only needs BlueMap:
`SCRATCH_EXTRA_BLUEMAP_JAR_HOST` (`bluemap-5.29-neoforge.jar`) and `SCRATCH_EXTRA_CHUNKY_JAR_HOST` (`Chunky-NeoForge-1.5.66.jar`).
The NeoForge service in scratch is `paper`. The scratch project is `scratch-nf` (suffix `nf`) and its world volume is
`scratch-nf_paper-data` (`${PROJECT}_paper-data` in `deploy/scratch/scratch.sh`). Run everything below from a clean
`git archive` export of `main` with no `.git`, as `docs/runbooks/scratch-stack.md` requires. Steps 0 and 1 run on the
operator's desktop (PowerShell) or the build host; steps 2 to 6 run on the scratch host (sh). Never touch the live project `geldar-nf`.

### 2.0 Command list, in order

Step 0, build host, sh. Build both plugin jars before scratch up: `(cd plugin; ./gradlew build)` produces
`plugin/core/build/libs/geldar-core.jar` and `plugin/velocity-identity/build/libs/geldar-velocity-identity.jar`. The NeoForge
scratch export run lost time because geldar-core.jar was missing. `scratch.sh up` refuses (exit 1) if either jar is missing
(`docs/runbooks/scratch-stack.md`, "Before up").

Step 1, desktop, PowerShell. Download from the GitHub release only, into a new empty folder outside the repository:

```
Invoke-WebRequest -Uri 'https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v5.29/bluemap-5.29-neoforge.jar' -OutFile '<empty download dir>\bluemap-5.29-neoforge.jar'
(Get-Item '<empty download dir>\bluemap-5.29-neoforge.jar').Length
(Get-FileHash -Algorithm SHA256 '<empty download dir>\bluemap-5.29-neoforge.jar').Hash.ToLower()
Select-String -Path compose\neoforge\extra-mods.pins -Pattern '^bluemap '
```

Expect the length `7060044` (`size_bytes` in `plugins/bluemap/neoforge.lock.json`) and the hash
`8938f4453af4b53970c86e43d0bd26b4a88980e4e6639f818fa770d0f61c43df` (the `bluemap` line of the pins file). A hash mismatch
is a STOP: delete the download, change no pin, and report. A length that differs from the lock file is also a STOP.
Record the length and the hash in the report.

Step 2, desktop, PowerShell. Chunky, which the same overlay mounts. Stage it in the same folder and compare by hand:

```
(Get-FileHash -Algorithm SHA256 '<empty download dir>\Chunky-NeoForge-1.5.66.jar').Hash.ToLower()
```

Expect `9f9303da0185fa0ae0e1d3f10a0f07b8d9e5a21e77931d4fc162dcc718a0ab4f` (the `chunky` line of the pins file). Its download
source is not in the repository (UNVERIFIED here). Same stop rule. Both jars must be regular files, not symlinks, at absolute
paths that the Docker host can read. The hook reads the host paths on the machine that runs `scratch.sh`: if that is not
this desktop, copy both files to the scratch host first (ops confirms the host path).

Step 2a, scratch host, sh, only if the node cannot reach `maven.neoforged.net` or the Modrinth CDN. Pre-seed the NeoForge
installer and the Proxy Compatible Forge mod into the scratch data volume before `up`, with the steps of
`docs/runbooks/scratch-stack.md`, section "If the node cannot reach the NeoForge Maven or the Modrinth CDN" (NeoForge variant).
Ops confirms the node's reachability before choosing this step.

Step 3, scratch host, sh. Run the hook and bring the project up. There is no dry run here yet: a dry run that prints the
resolved compose config with no containers (`scratch.sh config nf`) is once geldar-neoforge's PR merges (this tree's
`scratch.sh` has no `config` verb; its usage is `up|status|down|probe|mind-up|mind-token`).

```
export SCRATCH_PLATFORM=neoforge
export SCRATCH_EXTRA_MODS=1
export SCRATCH_EXTRA_CHUNKY_JAR_HOST=<absolute host path of Chunky-NeoForge-1.5.66.jar>
export SCRATCH_EXTRA_BLUEMAP_JAR_HOST=<absolute host path of bluemap-5.29-neoforge.jar>
export SCRATCH_NATS_AUTH_DIR=<absolute NATS auth dir, made by the scratch runbook>
sh deploy/scratch/scratch.sh up nf
```

`up` checks both jars on the host (readable, regular file, not a symlink, sha256 equal to the pin) and refuses with exit 2
before any docker call. The scratch stack starts the project when `up` passes its checks: there is no create-only mode
(`docs/runbooks/scratch-stack.md`). The entrypoint then installs BlueMap's config bundle on the first start.

Step 4, scratch host, sh. Check the seeded config (no seed by hand). The entrypoint installs `plugins/bluemap/neoforge` into
`/data/config/bluemap/` (PR #759). Read only:

```
P=$(docker ps -q --filter label=com.docker.compose.project=scratch-nf --filter label=com.docker.compose.service=paper)
docker exec "$P" ls /data/config/bluemap /data/config/bluemap/maps
docker exec "$P" ls -l /data/config/bluemap/.geldar-config.sha256
```

The `ls` must list `core.conf`, `plugin.conf`, `webapp.conf`, `webserver.conf` and `maps/` holding `end.conf`, `nether.conf`
and `overworld.conf`, and `.geldar-config.sha256` must exist. If any of these is missing, the start is a failure: stop and report.

Step 5, scratch host, sh. Observation, in order. Record each result with `date -u`. `$P` is set in step 4:

a. BlueMap lines: `docker logs "$P" 2>&1 | grep -i bluemap | head -n 40`. Expect the mod to name itself at load time, with
   no exception attached.
b. Failure shapes (section 2.1): `docker logs "$P" 2>&1 | grep -E -i 'incompatible|requires|missing dependency|Mod loading has failed|loading error|de\.bluecolored|geldar' | head -n 40`.
   Any line is a failure until it is explained.
c. Start: `docker logs "$P" 2>&1 | grep -c 'Server started'` prints at least `1`, within 10 minutes. `grep -c 'Done ('` is the
   vanilla start line; its wording on this NeoForge build is UNVERIFIED, so record what the log prints.
d. Mods: `docker exec "$P" ls -l /data/mods` lists `bluemap.jar` and `chunky.jar` (the entrypoint copies each as `<name>.jar`),
   and `docker exec "$P" sha256sum /data/mods/bluemap.jar` prints the pin of step 1.
e. Web files: `docker exec "$P" ls -l /data/bluemap/web/index.html` lists the file, and
   `docker exec "$P" ls /data/bluemap/web/maps` lists `overworld`, `nether` and `end`.
f. Status, read only, no render: `docker exec "$P" rcon-cli bluemap`. It must answer with BlueMap's status or help. An
   `Unknown command` answer means BlueMap did not load: failure shape 3. The `rcon-cli` form follows the repository's
   convention (`deploy/scratch/telemetry-rows.sh`); the reply wording is UNVERIFIED until captured.
g. Players: `docker exec "$P" rcon-cli list` must print `There are 0 of a max of`. If a player is online, stop; do not render.
h. Bounded render: the render subcommand and its exact syntax come from the help that step f printed (OI-3); this runbook
   does not guess them. Use one map and the bounds from NF-BM-2. Stamp `date -u` at the start, and stamp the end when the
   log shows the render finished (`docker logs "$P" 2>&1 | tail -n 20`).
i. Memory, before step h and after it: `docker stats --no-stream "$P"`, and the RSS of the JVM:
   `docker exec "$P" sh -c 'for p in /proc/[0-9]*; do case "$(tr "\0" " " < $p/cmdline)" in *java*) grep -H -E "VmRSS|VmHWM" $p/status;; esac; done'`.
j. One tile: `docker exec "$P" find /data/bluemap/web/maps/overworld -type f | head -n 5` lists paths; copy one of them out
   with `docker cp "$P:<path from that list>" "<sample dir>/"`. Never guess the tile name.
k. No live files: `docker exec "$P" sh -c 'ls -d /data/bluemap/web/maps/*/live 2>/dev/null'` prints nothing, and
   `docker exec "$P" find /data/bluemap -name players.json` and `... -name markers.json` each print nothing.
l. Web checks (section 2.2): the scratch web overlay is not on `main`, and `docs/runbooks/scratch-stack.md` says it belongs to
   the BlueMap team. No command is given until it exists. When it exists, follow the order rule in section 3.2: the web service
   starts only AFTER step 5e shows `bluemap/web` (the first render), with `up -d --no-deps <web service>`.

Step 6, scratch host, sh. Tear down with the scratch runbook's verb, after the report is written. Check the live project
before and after (read only), and expect no change:

```
docker ps -a --filter label=com.docker.compose.project=geldar-nf --format '{{.Names}} {{.Status}}'
cd <clean export dir> && SCRATCH_PLATFORM=neoforge SCRATCH_NATS_AUTH_DIR=<same NATS auth dir> sh deploy/scratch/scratch.sh down nf
docker volume ls --filter name=scratch-nf
```

`down` runs `down -v --rmi local`: it removes the scratch containers, the `scratch-nf_paper-data` volume (and the seeded
config and the pre-seeded installer with it), the eventsink image and the secrets directory. The build cache stays. Record the leftover-volume list
that `down` prints.

### 2.1 The three failure shapes

These come from the design addendum. Each one stops the test.

| Shape | What the log and the stack show | Players | Action |
| --- | --- | --- | --- |
| 1. Mod skipped | An incompatible-mod, "requires NeoForge", or missing-dependency line. The server starts. No `bluemap` directory, no web files. | Not affected | Stop. Report the line. Do not go live. |
| 2. Crash | Loading error screen text, "Mod loading has failed", the server exits. The compose restart loop shows in `docker ps`. | Affected only on a live server | Stop the scratch project. Report the text. Live must wait for a clean scratch run. |
| 3. Loads, no render | An exception stack with `de.bluecolored` classes. `/bluemap` answers `Unknown command` or no status. | Not affected | Stop. Report the stack. Do not go live. |

### 2.2 Pass criteria

All of these, and only these:

- no exception in the log from `de.bluecolored` or from the geldar classes (step 5b is empty, or every hit is a
  line that the report explains);
- the server reaches `Server started` (step 5c);
- `bluemap/web/index.html` exists in the scratch volume (step 5e), and at least one tile file is written by the bounded
  render (step 5j);
- `rcon-cli bluemap` status answers (step 5f);
- the scratch web container serves a tile with `200` and the live path with `404` (section 2.0 step 5l, pending the scratch
  web overlay);
- RSS is recorded, with the render start and end stamps (steps 5h and 5i).

The scratch project is torn down by its own verb after the report is written (section 2.0 step 6). Its volume is never
copied to the live shard.

### 2.3 Open items

- OI-1, config seeding: RESOLVED by PR #759. The entrypoint installs the committed bundle `plugins/bluemap/neoforge` (with
  `MANIFEST.sha256`) on every start, and refuses to start without it. The hand seed of the earlier draft is retired. Ops
  confirms the first scratch start against `.geldar-config.sha256` (step 4).
- OI-2, the environment of the scratch bring-up: the hook (PR #757) sets the variables that `scratch.sh up` needs for the
  overlay. Ops confirms that nothing else is needed for the first run (the variables `up` reads are in `deploy/scratch/scratch.sh`).
- OI-3, the render command and its bounds. The `rcon-cli bluemap` help output decides the syntax (step 5h). Not guessed.
- OI-4, the start line. `Server started` is the grep this runbook has used since the design note. `Done (` is the vanilla line;
  its wording on this NeoForge build is UNVERIFIED.

## 3. Live jar step: NeoForge recreate and the first bounded render

Owner window, short restart. Players disconnect when the container is recreated, so announce it first.

### 3.1 Before the recreate

1. Confirm section 2.2 passed, and that the live `compose/nf-live.yml` on the node is the `main` file (its image digest
   matches section 1). Do not run compose with any file except the NeoForge live compose file.
2. Confirm that geldar-neoforge placed the BlueMap jar through its mod mount, and that the entrypoint's sha256 check
   accepted it. The log line for the check is in the NeoForge log (the entrypoint's `copy_pinned_jar` message).
3. Confirm that the BlueMap config is the committed bundle (the entrypoint installs it on every start; PR #759). After the
   first start, `/data/config/bluemap/.geldar-config.sha256` holds the manifest's sha256 (read only), and the render bounds
   are set (no full-world render is configured, see section 6).

### 3.2 Recreate

Enable BlueMap on the node through its environment, never in the repository (`docs/runbooks/nf-extra-mods.md`, "Enabling a
mod on a node" and "Keep NF_EXTRA_MODS in the ops env file"). Ops adds these to a NEW revision of the ops env file, and sources it
before every plan and up:

- `NF_EXTRA_MODS=bluemap`
- `NF_EXTRA_BLUEMAP_JAR_HOST=<absolute host path of bluemap-5.29-neoforge.jar>`

Enabling recreates the `neoforge` container. That is a restart of the game server: players disconnect. Announce it first.

Run the recreate through the operator script, not through compose. The script holds the project (`geldar-nf`) and the
compose file as constants. Run it from an exported `main` tree on the node (a git checkout is refused without `--local`),
as the operator account and never as root. Inputs come from the environment only:

```
NF_EXTRA_MODS=bluemap NF_EXTRA_BLUEMAP_JAR_HOST=<absolute host path of bluemap-5.29-neoforge.jar> NF_SERVICE_UID=1001 NF_MOD_JAR_HOST=<absolute path to the geldar NeoForge jar> NF_MOD_SHA256=<its sha256> deploy/nf-deploy.sh plan
NF_EXTRA_MODS=bluemap NF_EXTRA_BLUEMAP_JAR_HOST=<absolute host path of bluemap-5.29-neoforge.jar> NF_SERVICE_UID=1001 NF_MOD_JAR_HOST=<absolute path to the geldar NeoForge jar> NF_MOD_SHA256=<its sha256> deploy/nf-deploy.sh up
```

(Or source the ops env file that holds them, and run the same two commands with only `NF_SERVICE_UID`, `NF_MOD_JAR_HOST` and `NF_MOD_SHA256` set in the shell.)

`plan` prints the gates and the steps and changes nothing; read it first, and read its extra-mod lines (the BlueMap line with its
pin). `up` runs the gates (it refuses an unseeded `neoforge-data` volume, and a jar whose sha256 differs from `NF_MOD_SHA256`), then starts `nats`, `postgres`,
`identity-seed` (one shot), `eventsink`, `neoforge` and `velocity` in that order, each with `--wait`. It does not pass
`--force-recreate`. Compose recreates `neoforge` when its config changes, which a new jar, a new sha or the BlueMap overlay does;
services already running with the same config are not touched. If `neoforge` must be recreated with no config change, the script
has no verb for it: ask geldar-neoforge, and do not run compose directly.

The NF_* values must match the running shard. `NF_SERVICE_UID` is 1001 on this node (the script default 1000 is not this
node's ops account). `NF_MOD_JAR_HOST` and `NF_MOD_SHA256` must name the geldar jar that the shard runs now, and a
different pair recreates `neoforge` with that jar. `NF_TELEMETRY` and `NF_HUMAN` must be set as the shard runs now (both
default off). Compare with the running container, read only (`docker inspect <neoforge-container>`, reading the mounts and
the `GELDAR_NF_MOD_SHA256` entry only). A mismatch is a stop.

`up` waits for each service's healthcheck (`--wait`). If it fails, the rollback is
section 7, row "BlueMap off on the NeoForge server". Do not retry in a loop.

The web container is NOT started here. It starts after the first render in section 3.3 (order rule below).

> **ORDER RULE (scratch and live): `bluemap-web-nf` starts only AFTER BlueMap has produced `/data/bluemap/web`, its first
> render.** Docker refuses a missing volume subpath, so the web container cannot start before that directory exists.
> `docs/runbooks/nf-bluemap-web.md` ("Precondition") states the rule; Docker's behaviour on a missing subpath is UNVERIFIED
> there, so the rule stands until a run proves otherwise. Start the web service with `up -d --no-deps bluemap-web-nf` only,
> never a full project `up`, and never before section 3.3 step 7.

### 3.3 Bounded first render at 0 players

No player may be online for this step. Check first: `list` prints `There are 0 of a max of ...`. If a player is online,
stop and wait; do not start the render.

1. Time the server start: `docker logs <neoforge-container> 2>&1 | grep -c 'Server started'` prints `1` after the recreate.
2. Stamp the render start with `date -u`, then start one bounded render of the overworld with the NF-BM-2 bounds (the same
   command as section 2.0 step 5h, once OI-3 has its syntax). Stamp the end when the log says it has finished.
3. Memory sampling, every 60 seconds until the render ends and for 5 minutes after:
   - host view: `docker stats --no-stream <neoforge-container>` (memory and CPU columns);
   - process view, read from `/proc` in the container (no `ps` needed, nothing is written):
     `docker exec <neoforge-container> sh -c 'for p in /proc/[0-9]*; do case "$(tr "\0" " " < $p/cmdline)" in *java*) grep -H -E "VmRSS|VmHWM" $p/status;; esac; done'`
   - GC: `docker exec <neoforge-container> sh -c 'for p in /proc/[0-9]*; do case "$(tr "\0" " " < $p/cmdline)" in *java*) echo $p;; esac; done'`
     gives the JVM pid; then `docker exec <neoforge-container> jcmd <pid> GC.heap_info` (a read-only snapshot). If geldar-neoforge
     enabled the GC log, its path is in the JVM options (`JVM_OPTS`); copy the last 50 lines of it into the report.
4. Record in the report: render start and end stamps (UTC), wall time, peak `VmHWM`, last `VmRSS`, the `GC.heap_info`
   output, and the container's `docker stats` memory column.
5. Stop rule: if RSS plus 1.5 GiB reaches 11 GiB (against the 12 GiB, 12288m, container limit), stop the render, report,
   and lower the bounds (the design's fallback). Do not raise `-Xmx`.
6. A second measurement with players online is a separate window. It is not part of this step.
7. Only now, after the render ended and `bluemap/web/index.html` exists (`docker exec <neoforge-container> ls -l /data/bluemap/web/index.html`),
   start the web container, with the overlay and no dependencies (`docs/runbooks/nf-bluemap-web.md`, "Bring-up"; the
   `NF_SERVICE_UID` and `NF_SERVICE_GID` that the deploy run exports; ops confirms the GID):

   ```
   sudo docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-bluemap-web.yml up -d --no-deps bluemap-web-nf
   ```

   Check it on loopback with the section 6 404 checks before the edge (section 4) is touched.

Pass for section 3: the NeoForge service is healthy, `bluemap/web/index.html` exists on the `neoforge-data` volume, the
render ended with no exception from `de.bluecolored`, the stop rule was not hit, the web container was started after the
render (step 7), and the numbers are in the report.

## 4. Edge window: publish the map through the shared Caddy

The edge is the host Caddy on the node (`board-proxy`). Its admin API is off (owner ruling R39), so `caddy reload` does not
work there. The rules are the ones in `deploy/caddy/README.md` (section "Reload procedure", and the OTLP steps 3 to 5):

- a change to a live file (`map-neoforge.caddy`, the off file swapped in) is one `docker restart board-proxy`;
- a new environment value (`GELDAR_MAP_NF_UPSTREAM` is new) needs one recreate, because a running Caddy cannot see a new
  variable and `docker restart` keeps the old environment.

This section uses one recreate that loads the env value and the site file together, as in README step 3. Its cost is an
outage on every site on the node (estimate 5 to 15 seconds; measure it and write it into the report). Batch it.

The edge goes after section 3 passed. The order is: web container and mod first, edge last, DNS after. The edge certificate
pre-step (section 4.1a) remains, and runs before staging (4.2); this update does not change it.

### 4.1 Backup the running configuration

Run from `<node-checkout>` on the node, in a directory only the operator can read.

```
umask 077
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p <backup dir>/edge-$STAMP
sudo cp -p <host Caddyfile> <backup dir>/edge-$STAMP/Caddyfile
sudo cp -a <host config dir>/geldar <backup dir>/edge-$STAMP/geldar
sudo stat -c '%U:%G %a %n' <host config dir>/geldar/map.caddy <env-file> > <backup dir>/edge-$STAMP/modes.txt
sudo cp -p <env-file> <env-file>.bak-$STAMP
test -s <backup dir>/edge-$STAMP/Caddyfile
```

The env file holds other credentials. Never print it, and never `cat` it into a log. The backup is the rollback for both
the file and the environment. Also run the baseline probe from `deploy/caddy/README.md` (step 3, "Baseline"): one request
per existing site, status and TLS result only. A site failing in the baseline is reported and cannot be compared.

### 4.1a Pre-step: the edge certificate must cover the host

Run before staging (4.2). Read only: nothing on the node is changed, reloaded or restarted. The host is
`map.neoforge.geldar.<zone>`, which has three labels before the zone. A wildcard for `*.<zone>` or `*.geldar.<zone>`
does NOT cover it, because a wildcard matches exactly one label. Only `*.neoforge.geldar.<zone>` covers it. Ops confirms
each name below before running it; the storage path is Caddy's default in its official image, and the repo does not set it.

1. List the certificate files Caddy has stored (paths only, no key files):
   `docker exec board-proxy sh -c 'find /data/caddy/certificates -name "*.crt" -not -name "*.key"'`
2. For each path from step 1, print its names. The `.crt` is public; the `.key` next to it is never opened:
   `docker exec board-proxy cat <path from step 1> | openssl x509 -noout -ext subjectAltName`
3. Decision rule:
   - A stored certificate lists `*.neoforge.geldar.<zone>` or the exact host: the edge covers the name. Section 4 runs as
     written; the DNS order in section 5 is unchanged.
   - No stored certificate covers the name (the normal case before the first site load): Caddy issues a certificate for
     the new host when the site is loaded (ops confirms this in the first window). The repo's `deploy/caddy/README.md`
     says the certificate comes through the DNS plugin (DNS-01: a TXT record in the zone, which needs the provider
     credentials on the host, not a CNAME). Under DNS-01 the CNAME is not needed for issuance and the DNS order stays
     last. Ops confirms the challenge type from the global options of the host Caddyfile (read the option names only;
     never print values).
   - If the challenge is HTTP-01 or TLS-ALPN-01 instead, the name must resolve to the node before the reload, so the
     CNAME goes before section 4.4 step 2. That changes when the name becomes public. It is an owner and geldar-93
     decision, to be taken before the window. Do not change the order on ops' own judgement.
4. After section 4.4 step 2 (the site is live), confirm the served certificate on loopback (the host network shares
   port 443 with the node). This is a read-only handshake:
   `openssl s_client -connect 127.0.0.1:443 -servername map.neoforge.geldar.<zone> </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`
   The output must name the host. Before the site is live this command shows another site's certificate, so do not run it earlier.

### 4.2 Stage

Place the site file outside the live directory, with the owner and mode of `map.caddy`:

```
sudo stat -c '%U:%G %a' <host config dir>/geldar/map.caddy
sudo install -m <mode> -o <owner> -g <group> <node-checkout>/deploy/caddy/map-neoforge.caddy <backup dir>/edge-$STAMP/staged/map-neoforge.caddy
```

Do not place it in `<host config dir>/geldar/` yet. The live directory is imported at start, and a bad file there breaks
the next start of every site.

### 4.3 Validate

1. In the repo: `bash deploy/caddy/validate.sh` (pinned Caddy image, `docker run --rm` only). It must print `Valid configuration`
   for the NeoForge set. The NF-BM-4 entry supplies the placeholder value for `GELDAR_MAP_NF_UPSTREAM`.
2. On the node, in a throwaway container of the running image, with the new env file and the staged file, exactly as
   README step 3 (pre-validation) describes. Stop on any error. Do not recreate anything until this passes.

Note: `GELDAR_MAP_NF_UPSTREAM` goes into `<env-file>` as `GELDAR_MAP_NF_UPSTREAM=<nf-web-upstream>` (the value only, read
by docker and never printed). Append it with the guarded append that README step 2 uses.

### 4.4 Load

1. Copy the staged file into the live directory with the same owner and mode (`sudo install -m <mode> -o <owner> -g <group> ...`).
2. Recreate `board-proxy` once, from the compose project directory that the labels precheck of README step 3 reports:
   `sudo docker compose -p <project> up -d --force-recreate board-proxy`.
   Do not use `docker restart` here: the new environment value is not loaded by a restart.
3. Immediately after: `docker inspect -f '{{.State.Running}}' board-proxy` prints `true`;
   `docker exec board-proxy caddy validate --config /etc/caddy/Caddyfile` passes; the baseline comparison prints nothing.

If any of these fails: remove the live file (`sudo rm -f <host config dir>/geldar/map-neoforge.caddy`), restore the env
file from `<env-file>.bak-$STAMP` (`sudo cp -p`), recreate once more, check again, and report. This is the failure path
of README step 4. It is a second outage.

### 4.5 Verify the edge (before DNS)

Use `--resolve` so that nothing depends on DNS yet. `<edge-ip>` is the node's public address (never written here).

```
curl -s -o /dev/null -w '%{http_code}\n' --resolve map.neoforge.geldar.<zone>:443:<edge-ip> https://map.neoforge.geldar.<zone>/
curl -s -o /dev/null -w '%{http_code}\n' -X POST --resolve map.neoforge.geldar.<zone>:443:<edge-ip> https://map.neoforge.geldar.<zone>/
curl -s -o /dev/null -w '%{http_code}\n' --resolve map.neoforge.geldar.<zone>:443:<edge-ip> https://map.neoforge.geldar.<zone>/maps/overworld/live/players.json
curl -sI --resolve map.neoforge.geldar.<zone>:443:<edge-ip> https://map.neoforge.geldar.<zone>/ | grep -i -E 'x-content-type-options|referrer-policy|content-security-policy|^server'
```

Expected: `200`, `405`, `404`. The header grep shows `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Content-Security-Policy: frame-ancestors 'none'`, and no `Server:` line.

The public host is `map.neoforge.geldar.<zone>`: the design's `map.neoforge.geldar` under the owner's zone. The Caddy
site address is `map.neoforge.{$GELDAR_DOMAIN}`, so the owner confirms that `GELDAR_DOMAIN` is `geldar.<zone>` before
the first recreate. A mismatch is a stop: fix the value first.

The TLS certificate is issued by the same DNS-challenge path as the other sites. Wait for the `certificate obtained`
log line for the host before the first request; without it these requests fail on TLS.

### 4.6 Rollback for the edge

Pick the row that matches the failure. Both rows are outages on every site: the restart or recreate drops connections
on the whole node.

- Swap to the off file (the normal kill switch): stage `map-neoforge-off.caddy` into the live directory under the same
  name `map-neoforge.caddy` (the two files never coexist; they name the same host), then `docker restart board-proxy`
  (file-only change, R39). The env value stays. Re-run the baseline comparison.
- Restore the backup: `sudo rm -f <host config dir>/geldar/map-neoforge.caddy`, then copy the `geldar` backup over
  the live directory (`sudo cp -a <backup dir>/edge-$STAMP/geldar/. <host config dir>/geldar/`), restore the env file
  from `<env-file>.bak-$STAMP` if `GELDAR_MAP_NF_UPSTREAM` was added, and run one recreate if the env file changed or one
  `docker restart board-proxy` if only files changed. Check the baseline comparison after it.

## 5. DNS: the name goes last

Created only after section 4.5 passed, with the owner's OK, and never before. The record is a CNAME:

- Name: `map.neoforge.geldar` in zone `<zone>`.
- Value: `<edge-target>`, the same target the Paper map's record uses. Look up the Paper record's value at packet time
  (the owner's DNS panel); do not copy it from this file or from a ticket.
- TTL: the zone default.

Verify, from the operator workstation, after the record is published:

```
nslookup -type=CNAME map.neoforge.geldar.<zone>
curl -s -o /dev/null -w '%{http_code}\n' https://map.neoforge.geldar.<zone>/
```

The CNAME prints `<edge-target>`, and the request prints `200`. A failed answer is a rollback, not a retry.

Rollback: delete the CNAME. Resolvers keep the old answer until its TTL runs out, so the kill switch in section 4.6 is the
fast one. Deleting the record does not stop an open browser tab; the edge row is what stops content.

## 6. Privacy checklist

The owner's map shows every build, including private ones. Players are real people. Every box must be ticked before the
map is announced. Ops writes the result of each check into the report.

> **HARD RULE (owner accepted): ops must NEVER run `/bluemap reload` and NEVER delete BlueMap config files on a running shard.**
> A deleted file plus a reload makes BlueMap write its DEFAULTS in their place: web server on (port 8100), live players shown.
> RCON can run every `/bluemap` command, so the rule covers RCON too. The only repair is a restart, which reinstalls the bundle
> (`docs/runbooks/nf-extra-mods.md`, "BlueMap config seeding"). No `/bluemap` subcommand lists other players' positions (v5.29;
> ops confirms against the command's help output).

- [ ] Players are hidden in the NeoForge BlueMap configs (NF-BM-2). Read the deployed copy and confirm the player-marker
      and hide options are the values NF-BM-2's test asserts. Ops reads it from `/data/config/bluemap` (the installed bundle,
      checked against `.geldar-config.sha256`), not from memory.
- [ ] The web container returns `404` for the live paths on loopback (scratch and live) and through the edge (section 4.5):
      `/maps/overworld/live/players.json`, `/maps/overworld/live/markers.json`, and the variants: case changes
      (`/MAPS/x/LIVE/players.json`), `//`, and `..` segments. The variant cases are the web container's tests (PR #760;
      not on this tree: ops confirms they are on `main` before the check). Two layers, both checked.
- [ ] BlueMap's own webserver stays off: `ss -ltn` shows nothing on port 8100 (`docs/runbooks/nf-extra-mods.md`, read-only checks).
- [ ] No markers exist in any map. `markers.json` for each map is absent or empty, and none is configured. Markers wait
      for the owner's word: builds can reveal player homes.
- [ ] No custom scripts or styles are served. `curl -s https://map.neoforge.geldar.<zone>/settings.json` has no entry in
      `scripts` or `styles`, and the page source (`curl -s https://map.neoforge.geldar.<zone>/`) names no `geldar-` asset.
- [ ] No chat panel, follow feature or dial files are on the `bluemap/web` subpath (`ls` of that directory shows no `geldar-*` file).
- [ ] No live data is published: the live path returns `404` (the check above, on loopback and through the edge), and
      `players.json` is absent from the volume: `docker exec <neoforge-container> find /data/bluemap -name players.json`
      prints nothing. Read only, on the live volume.
- [ ] Render bounds are set by render-mask box masks (branch nfbm-a). `remove-caves-below-y` is left at its default, so
      underground builds are rendered. This is an owner decision: the owner was told the map shows every build, including
      private ones.
- [ ] Abuse is handled by the edge cap (1 KiB body, GET and HEAD only, the 405 handle) and the container CPU cap. If abuse
      appears, the fix is a Cloudflare rate rule at the zone (an owner action), not code.

## 7. Kill switch and rollback summary

> **HARD RULE (owner accepted): never run `/bluemap reload` and never delete BlueMap config files on a running shard.**
> A deleted file plus a reload makes BlueMap write its DEFAULTS (web server on, live players shown). RCON can run every
> `/bluemap` command. No rollback row below deletes a config file: the mod is removed by its environment and a recreate,
> and the config bundle stays.

| Need | Action | Cost and scope |
| --- | --- | --- |
| Take the public page down now | Swap `map-neoforge-off.caddy` in as `map-neoforge.caddy` (section 4.6), `docker restart board-proxy` | Outage of every site on the node, 5 to 15 s estimate |
| Stop only the NeoForge web container | `docker stop <nf-web-container>` | The NeoForge name answers 502. Other sites are not affected |
| Stop rendering and remove BlueMap from the NeoForge server | Set `NF_EXTRA_MODS=none` (or unset it) for the run, `plan`, then the section 3.2 recreate through `deploy/nf-deploy.sh up` (`docs/runbooks/nf-extra-mods.md`) | Players disconnect during the recreate; geldar jar unaffected; the config bundle stays on the volume |
| Remove the name | Delete the CNAME (section 5) | Ends at the record's TTL |
| Roll back the edge in full | Restore the backup (section 4.6) | Outage of every site, one restart or recreate |
| Roll back the mod on a failed recreate | Section 3.2 failure path: geldar-neoforge removes the BlueMap jar, recreate once | Players disconnect |

Order of rollback when in doubt: DNS first (it stops new visitors), then the edge (it stops the content), then the NeoForge
web container and the mod.

## 8. Warning

> **WARNING: never run `docker compose` against the node's drifted `compose/colo.yml`.** The node's file differs from
> `main` (literal project and network names, a different Paper cap, literal ports and a missing gamerule). Compose recreates
> the shared `colo` network, and on 2026-11-17 that failed with "active endpoints". The drift is described in
> `docs/runbooks/map-chat-panel.md`, section 2a. Until it is reconciled in the repo, every node change in this runbook is
> either a file change, a `docker restart`, or a run of `deploy/nf-deploy.sh` for the NeoForge project (section 3.2)
> or the edge compose project (section 4.4), never a compose run against `colo.yml`.

> **WARNING: this runbook never edits `deploy/nf-deploy.sh` or `compose/nf-live.yml`.** Those files belong to
> geldar-neoforge. If the mod mount or a service name in them is wrong for this map, ask geldar-neoforge to change them.
> Do not patch them on the node.

> **WARNING: never `systemctl restart caddy`, never `caddy reload` on the node (the admin API is off, R39), and never
> recreate `board-proxy` outside an approved window.** Every restart or recreate of the shared Caddy is an outage of every
> site on the node, not only the NeoForge map.
