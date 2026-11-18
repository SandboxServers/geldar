# World pregeneration and the extra-mods mechanism (NeoForge shard, Chunky 1.5.66)

- Status: design note, docs only. The owner's decisions of 2026-11-18 are recorded below. Nothing here is built, deployed or in force. The open items are in section 8.
- Base: origin/main 565668af (checked). The brief cited 58c2ddfc; the line numbers below were checked on 565668af.
- Stack: branch `phase1/nf-pregen-design2`, stacked on `phase1/nf-pregen-design` (PR #743, head 1e5f80dc). PR #743 is not changed by this note.
- Date: 2026-11-18. No code, no node contact, no push.
- Reading rule: **UNVERIFIED** marks a claim not proven in code, config, docs or on a server. Paths are relative to the repo root. Facts are tagged with their source. **Research** means the 2026-11-18 research recorded in the brief (Modrinth API, the Chunky wiki, the minecraft.wiki server.properties page, and the itzg image docs at tag 2026.10.1); this note did not re-fetch those sources. **Estimate** marks a number calculated from assumptions and not measured. **Read** marks a claim checked in code on origin/main.

## Owner decisions (2026-11-18)

Relayed by the lead on 2026-11-18, direct from the owner.

1. **Radius and border.** The pregen radius is 2000 blocks. The world border is set to match: border radius 2000, which is diameter 4000 for `worldborder set`, square. The pregen centre and the border centre are both the world spawn. The border centre defaults to 0,0 unless set; `worldborder center` is a separate vanilla command, and the pregen centre (`chunky center`) must equal it. The spawn coordinates are read from the live server first (step 1 of section 5h). If the spawn is not 0,0, `worldborder center <x> <z>` and `chunky center <x> <z>` use the same numbers.
2. **Scope.** Overworld only. No Nether, no End.
3. **No backup. OWNER DECISION: "No backup".** The owner chose no backup of the NeoForge world before the pregen run. This note adds no backup step.
   - **Risk, recorded:** no backup exists for the NeoForge world today (`docs/runbooks/backup-and-restore.md` line 13). Pregen adds data to a volume that is not backed up. If the volume is corrupted or lost during or after the run, the world is gone, including the pregenerated area.
4. **Pause-when-empty.** Off (`-1`) during the pregen window only. The value is restored afterwards (section 5d and step 8 of section 5h).

## 0. Summary for the decider

- Pregenerate the NeoForge shard's overworld with Chunky 1.5.66 (NeoForge build, GPL-3.0-only), mounted through a generic extra-mods mechanism that a separate branch is building (`phase1/nf-extra-mods`, not on main).
- The area is a 4000-block square (radius 2000) centred on the spawn. The border is set to the same area before any pregen (section 5a). Estimated size: about 64 to 81 regions, about 0.3 to 1.6 GB (section 5b, ESTIMATE).
- `pause-when-empty-seconds` is set to `-1` for the window through a compose overlay that takes its value from a required env var, and is restored to 60 afterwards (section 5d, packet P-E).
- Pregen uses the CPU the public game server needs. Measure with a small radius first in a quiet window, then run the full radius (section 5c, step list 5h).
- Enabling and disabling Chunky, and the pause changes, each recreate the `neoforge` container, which restarts the public game server. Players must be warned before each one.
- No backup of the NeoForge world exists, by owner decision (section 6). Pregen adds data to an unbacked-up volume.

## 1. Purpose and the owner's ask

- The owner asks for the NeoForge shard's world to be pregenerated "something like Chunky". Source: the brief's ask; there is no written owner text in the repo for it.
- BlueMap on the same shard shares the mod-mount mechanism (section 3). BlueMap's own lock and template files belong to the geldar-bluemap work (`plugins/bluemap/neoforge.lock.json`, `plugins/bluemap/neoforge/`, per the brief; UNVERIFIED that these paths exist on main).
- Why pregen matters here: each agent or human that walks into new ground causes chunk generation on the game thread. Pregen moves that cost into a planned window. Estimate only; no measurement of the shard's generation cost exists in the repo.

## 2. The mod: Chunky

Research 2026-11-18 (Modrinth API and the project wiki):

| Field | Value | Source |
|---|---|---|
| Project | Chunky, loader NeoForge | Research (Modrinth project `chunky`) |
| Version | 1.5.66 | Research |
| Published | 2026-11-04T03:01:43Z | Research (Modrinth version record) |
| Declared Minecraft | 26.1 to 26.3 | Research |
| File | `Chunky-NeoForge-1.5.66.jar`, 441998 bytes | Research |
| sha256 | `9f9303da0185fa0ae0e1d3f10a0f07b8d9e5a21e77931d4fc162dcc718a0ab4f` | Computed by us from the downloaded file |
| sha1 | `d961dd43479967e343461c044546887a5193c0ef` | Modrinth-published; matched our download |
| sha512 | `1ec3a20a1338fb3dbfb4c637e2369138e9c5de01e638198c8051c71c86cfdc64ad993cc6e8268beab774969700829efafc8894a6a7656ae4a833e60e05190542` | Modrinth-published; matched our download |
| Download URL | `https://cdn.modrinth.com/data/fALzjamp/versions/sDFaDSkE/Chunky-NeoForge-1.5.66.jar` | Research |
| License | GPL-3.0-only | Research |
| mods.toml | modId `chunky`; `javafml` `[3,)`; requires `neoforge` (a 26.1 beta range) and `minecraft` `[26.1,)`; side BOTH; no other required mods | Research |
| Changelog | none for 1.5.66 | Research |

Points that follow:

- **Two-week rule.** Published 14 days and about 15 hours before the research date. The margin is about 15 hours on the research day. The pin date is 2026-11-18; **if the PR merges later, re-check the age of 1.5.66 at merge time** and re-pin or choose 1.5.4 if it no longer clears the rule. The research did not record the exact time of day, so the margin is an estimate.
- **Server-only install.** Modrinth marks both sides optional, and the mods.toml side is BOTH. The project has no registry or payload classes, per the research. A server-only install is probably fine. **UNVERIFIED by docs**: test once with a plain client joining the shard (P-C).
- **Fallback.** Chunky 1.5.4 (published 2026-07-23, sha1 `eec0049466be9dca966a7446df116c97ce000410`, about four months old, far more downloads). Choose it if the owner prefers an older build. It must be pinned with its own sha256, which this note does not have (UNVERIFIED: compute it at pin time).
- **Commands and config** (research, wiki Commands, Configuration and FAQ pages): see section 5e.

Alternatives, not researched in depth (labelled):

- Vanilla `/forceload`: capped at 256 chunks per call, and it keeps chunks loaded. Not a pregen tool; it would need scripting over many calls. UNVERIFIED for generation speed.
- A headless bot teleporting around the area: slow and it needs scripting. The agent lane (offline-mode, unpublished) could do it, but that is not a designed path.
- Other pregen mods: unchecked.

## 3. How the mod is mounted

The generic mechanism is in a separate, unmerged branch (`phase1/nf-extra-mods`, the P-A packet). Its design, as the brief records it:

- A committed pins file `compose/neoforge/extra-mods.pins` with one line per mod: name, sha256, file, version.
- Enabling is an env var `NF_EXTRA_MODS` (a comma list of names).
- One overlay per mod, `compose/nf-live-mod-<name>.yml`, a read-only bind of the host jar into the container, with `create_host_path` false and the pin as a constant.
- A host path env per mod, `NF_EXTRA_<NAME>_JAR_HOST`.
- A helper `deploy/nf-extra-mods-lib.sh` that refuses before any `docker` call if a pin, a file or a hash is wrong.
- The entrypoint copies the jar into `/data/mods` only through `copy_pinned_jar`, after the existing bundle check, and removes stale copies of mods that are no longer enabled.
- Enabling or disabling a mod recreates the `neoforge` container: a restart of the public game server (section 6).

Comparison with the existing patterns (all on main):

- The geldar mod is baked into the entrypoint's bundle flow: `compose/neoforge/neoforge-entrypoint.sh` lines 91-172 and 239-292 (the bundle check and the mod copy, per the brief), with `GELDAR_NF_MOD_SHA256` in `compose/nf-live.yml` line 295.
- The ledger has its own overlay, `compose/nf-live-telemetry.yml`.
- The deploy script's pattern is `deploy/nf-deploy.sh` lines 251-260 (per the brief).
- The new mechanism reuses the pin-and-hash idea but adds per-mod overlays so that an extra mod is opt-in and cannot ride in on a stale file.

Open points (UNVERIFIED): whether the itzg image can take an extra jar through its own `MODS` or `MODRINTH_*` variables (the brief's design avoids both; the reason is not recorded); how the bundle check treats `/data/mods` contents.

## 4. The world today

From the repo on origin/main 565668af:

- **No world border, seed, level type or spawn setting is set for the NeoForge shard anywhere in the repo.** `compose/nf-live.yml` neoforge env (lines 270-295) sets `MAX_PLAYERS` 100, `VIEW_DISTANCE` 8, `SIMULATION_DISTANCE` 6, `ONLINE_MODE` FALSE, the whitelist flags off, RCON, and the NATS items. Nothing else about the world.
- So the border is the vanilla default (effectively unbounded), the seed is random unless the owner set it by hand, and the spawn is the vanilla one. **UNVERIFIED**: the live values are read in step 1 of section 5h (`worldborder get`, `seed`, the spawn).
- The world path is presumably `/data/world` on the volume `geldar-nf_neoforge-data` (the compose project is `geldar-nf`, per `nf-live.yml`; UNVERIFIED that the itzg image uses `/data/world`).
- Comparison, the autonomous shard: border radius 9500 (diameter 19000), set by `RCON_CMDS_STARTUP` in `compose/colo.yml` lines 137-138 (`worldborder set 19000`, a diameter), and the seed 8675309 at `compose/colo.yml` line 119 (per the brief). The phase 0 compose file uses a 3000 diameter (`compose/phase0.yml` line 85). These are not the NeoForge shard's values and are shown only as reference points.
- Shard limits: `MAX_PLAYERS` 100 is the shard's one shared limit for humans and agents (owner decision 2026-11-18, `compose/nf-live.yml` lines 276-279).

## 5. The plan

### 5a. Set the border first

- Chunky's `worldborder` command copies the vanilla border (research). The border is the place where Chunky stops.
- Mobs do not spawn outside the world border (vanilla behaviour, UNVERIFIED on 26.1.2 here). The border must therefore cover the whole pregen area, and the players' play area too.
- **Decided (owner):** border radius 2000 (`worldborder set 4000`, a diameter), square, centred on the spawn.
- `worldborder center` is a separate vanilla command. The default centre is 0,0. The pregen centre (`chunky center`) must equal the border centre. Both are at the spawn. Read the spawn first (step 1 of section 5h). If the spawn is not 0,0, run `worldborder center <x> <z>` and `chunky center <x> <z>` with the same numbers.
- How the border is set is still open (section 8): an itzg env var that does it at startup, like `RCON_CMDS_STARTUP` on the colo shard, or RCON by hand. The env var keeps the value in git; RCON keeps it out of the git history but is lost on recreate unless re-run. The repo holds no NeoForge value for either. The step list in 5h uses RCON.

### 5b. Pregen size at radius 2000 (ESTIMATES)

Formulas: a radius R in blocks is R/16 chunks. A region file holds 32 by 32 chunks = 1024 chunks, which is 512 by 512 blocks.

- **Area.** The pregen area is the square of side 4000 blocks: 250 by 250 chunks = **62,500 chunks** (exact area). Chunky's inclusion rule at the edge is UNVERIFIED. If the chunk indices run from -125 to +125 inclusive, the count is (2 x 125 + 1)^2 = **63,001 chunks**. This note uses 62,500 for the time estimates; the difference is about 0.8 percent.
- **Regions.** 4000 / 512 = 7.8, so the square spans 8 region widths at most when it is aligned to region boundaries, and 9 when it is offset. That gives **64 to 81 regions** (8 by 8 or 9 by 9). Only regions that already exist on the volume are not new; how many exist is UNVERIFIED.

Time at an assumed generation speed. **The speed is UNMEASURED** and depends on single-thread CPU and SSD speed. The NeoForge container has 3 CPUs (`nf-live.yml` lines 256-263); the speed is unknown for it.

| Speed (chunks/s, assumed) | Time for 62,500 chunks (ESTIMATE) |
|---|---|
| 50 | about 21 min |
| 100 | about 10.5 min |
| 200 | about 5 min |

Disk at an assumed 5, 10 and 20 MB per region file (**UNMEASURED**; the docs give no figures). Decimal GB:

| Regions | 5 MB/region | 10 MB/region | 20 MB/region |
|---|---|---|---|
| 64 | about 0.32 GB | about 0.64 GB | about 1.28 GB |
| 81 | about 0.41 GB | about 0.81 GB | about 1.62 GB |

So the whole pregen is about 0.3 to 1.6 GB (ESTIMATE, UNMEASURED).

**Against the autonomous shard's 9500.** The owner's radius is small. The square is 4000 of the autonomous shard's 19000 side (about 21 percent of the side, about 4.4 percent of the area), and 62,500 chunks against about 1.41 million (ESTIMATE). The 9500 figures are not a plan for this shard.

Free space: about 1.1 TiB free on `/mnt/nvme`, measured 2026-11-17 (comment at `deploy/nf-deploy.sh` line 49; per-shard-storage design section 7). The deploy script's own floor is 50 GiB free. The 1.6 GB estimate fits by a wide margin.

**Start small.** Step 5 of section 5h measures the real chunks per second with a radius-200 run inside the 2000 area, and only then runs the full radius. Do not plan the full run from these estimates.

### 5c. CPU and RAM

- The NeoForge container is capped at 3 CPUs and 12 GiB, with a 9 GiB heap (`MEMORY` from `NF_NEOFORGE_HEAP`, default 9G) and `cpu_shares` 256, so it yields to the autonomous shard under contention (`compose/nf-live.yml` lines 256-263, 275). The budget is a proposal, to be re-measured at deploy (comment at line 255).
- Chunky is single-purpose and fast by default (research). Expect it to take the CPUs and to lower the tick rate for players on the public lane while it runs. **This is an expectation, not a measurement.**
- Chunky has no documented throttle option (research: the Configuration page; **UNVERIFIED** that none exists). `silent` and `quiet` only change messages; `quiet <seconds>` is a message interval (research).
- Mitigations: a quiet window with few or no players; a small radius first; `chunky pause` if the tick rate or the players suffer; `chunky continue` when the window is clear.
- RAM: Chunky's own overhead inside the 9 GiB heap is UNVERIFIED. Watch the heap in the ledger's JVM metrics during the first run.

### 5d. Pause-when-empty (decided: off during the window)

Facts:

- The vanilla property `pause-when-empty-seconds` exists since MC 1.21.2 (24w33a). Its default is 60. A negative value means the server never pauses (research: minecraft.wiki Server.properties).
- It is **not changeable at runtime**: no command or gamerule was found (research). `/setidletimeout` is unrelated: it kicks AFK players.
- The itzg image has a dedicated env var, `PAUSE_WHEN_EMPTY_SECONDS` (research: the image's docs at tag 2026.10.1, the mapping table). The doc says an **unset** variable is ignored and the existing server property is left unchanged. So removing the variable does **not** restore 60. The restore is to set the variable explicitly (`60`, or the previously recorded value) and recreate.
- The image's own `ENABLE_AUTOPAUSE` is a different feature: it freezes the Java process. It is off unless set, the docs say to avoid it on 1.21.2 and later, and our compose does not set it (research).
- Our server's current value is the default 60 (nothing in compose or the entrypoint sets it). **UNVERIFIED until `/data/server.properties` is read** (step 1 of section 5h).
- The Chunky FAQ says to set `pause-when-empty-seconds` to -1 on multiplayer servers (research). The FAQ does not say outright that a paused server stops a Chunky task; the research inferred it. **UNVERIFIED.**

Ledger impact, read from code on origin/main 565668af (`neoforge-ledger/src/main/java/dev/geldar/ledger/neoforge/tick/TickCollector.java`, Javadoc lines 38-41, `checkStall` lines 106-117):

- The watchdog's `checkStall` first asks `idle` (true when no player is online). When idle it calls `stall.heartbeat()` and returns (line 116). **No stall is reported with zero players, whether or not the server is paused.**
- So setting -1 does **not** make stalls visible to the ledger while the server is empty. The code in the idle branch decides this, not the pause state. A stalled pregen with zero players is invisible to stall events in either setting.
- Whether the tick listener's per-tick slow-tick events fire with zero players is **UNVERIFIED** (the listener's tick path was not read in this session).
- Consequence: check pregen progress with `chunky progress` directly (step 6 of section 5h), and use `tick query` (read-only).
- An earlier draft of this note said that with -1 the server keeps ticking, so stalls would be real. That is not what the code does: the idle branch skips stall detection either way.

Decided route (owner decision 4): `-1` for the pregen window only, then `60`.

- **Route A (chosen):** an optional compose overlay sets `PAUSE_WHEN_EMPTY_SECONDS` from a required node env var (packet P-E, section 7). Used for the window only. Enabling and restoring each recreate `neoforge`.
- Route C (keep a bot or player connected) is fragile: a drop restarts the 60-second countdown. Not chosen.
- Costs of -1 for a long run (general knowledge, **UNVERIFIED**): the server ticks while empty, so CPU and resident chunks stay in use while nobody is online.
- Verification: record the value before (step 1), confirm -1 after the first recreate (step 2), and confirm 60 after the second (step 8).

### 5e. Commands (ops, through `rcon-cli`)

The exact `rcon-cli` form is **UNVERIFIED** here (runbook section 4c in `docs/runbooks/nf-live-project.md`, per the brief). Chunky commands are from research (wiki Commands page):

- `chunky worldborder`: copies the vanilla border into Chunky's area.
- `chunky shape square`.
- `chunky world <world>`: the overworld. The world-name form is **UNVERIFIED**; list the worlds with the form the Commands page or the in-game help gives before typing one. Expected name `minecraft:overworld` (UNVERIFIED).
- `chunky center <x> <z>` and `chunky radius <blocks>`: the names are from the brief; the wiki's Commands page was not re-checked for them (UNVERIFIED).
- `chunky start`, `chunky progress`, `chunky pause`, `chunky continue`.
- `chunky cancel`: stops the task. It keeps the chunks generated so far. The task is **not resumable** after a cancel: `chunky start` starts over, and already generated chunks pass quickly (research).
- `chunky quiet <seconds>`: the interval of progress messages (research).
- Config `continue-on-restart`, default false (research): a restart stops a running task and, with the default, it does not resume. The reboots on the node (unattended upgrades, the automatic reboot window per `docs/spec.md`, section on the host OS) would stop a running pregen. **UNVERIFIED**: the 04:30 reboot time the brief gives is not found in the repo; check the host's timer before any window. The config file's location in the container is **UNVERIFIED**.

### 5f. Verify

- `chunky progress` during the run (generated, total, speed; research for the output format, UNVERIFIED for the exact text).
- The region file count and size on the volume, by a read-only `ls` or `du` on the node by ops (no write, no delete).
- The ledger's `geldar_world_loaded_chunks` gauge for the overworld (`neoforge-ledger/README.md` line 49; the gauge comes from `ChunkEvent.Load` and `Unload`, `WorldWiring.java` lines 51-52). The README says the counts are approximate and drift (README lines 49-53), so do not use it as the exact pregen count.
- TPS: the ledger's tick events and `/tick query` (read-only).
- No BlueMap render or fly-through is needed for this design; that is a separate check.

### 5g. Scope: overworld only (decided)

- Pregenerate the overworld only. No Nether, no End (owner decision 2).

### 5h. Concrete step list

Conventions:

- **[OWNER-OK]** marks a step that changes the node. Ops runs them one at a time, each with the owner's OK.
- **[RECREATE]** marks a step that recreates the `neoforge` container, which restarts the public game server. Warn the players before it, in a quiet window.
- Commands are shown with placeholders: `<SPAWN_X>`, `<SPAWN_Z>`, `<PREV_PAUSE>`, `<WORLD>`, `<STAGED_JAR>`. The `rcon-cli` form is **UNVERIFIED** (runbook 4c). Do not run a command whose form is not confirmed.
- Read-only steps use only read verbs and file reads on the volume.

0. **[OWNER-OK] [RECREATE]** Stage the Chunky jar and enable it through the extra-mods mechanism. Needs packets P-A and P-B merged and their pin tests green. Set `NF_EXTRA_MODS=chunky` and `NF_EXTRA_CHUNKY_JAR_HOST=<STAGED_JAR>` (the host path to the staged, pinned jar). Run the helper's plan, then `up`. Check after the recreate: the jar is in `/data/mods` (read-only `ls`), and the server log shows no mod-load error (read-only). The jar must not be added by any other route.

1. **Read-only, no node change.** Record the current values:
   - `pause-when-empty-seconds` from `/data/server.properties` (a read-only `grep` on the volume). Record it as `<PREV_PAUSE>`. Expected 60; UNVERIFIED.
   - The spawn, as `<SPAWN_X> <SPAWN_Z>`: read from the world's `level.dat` with an NBT reader (no write). The key names are **UNVERIFIED**. A read-only RCON form, if one exists, is also UNVERIFIED.
   - `worldborder get` (read-only). Record the current border; expected the vanilla default, UNVERIFIED.
   - `seed` (read-only). Record it.
   - Do not start Chunky, and do not change the border, in this step.

2. **[OWNER-OK] [RECREATE]** Pause-off for the window. Set `NF_PAUSE_WHEN_EMPTY_SECONDS=-1` and run the pause-window overlay (P-E) with `up`. This recreates `neoforge`. Confirm after the recreate: `/data/server.properties` shows `pause-when-empty-seconds=-1` (read-only). If `<PREV_PAUSE>` was not 60, keep it for step 8.

3. **[OWNER-OK]** Border. `worldborder center <SPAWN_X> <SPAWN_Z>`, then `worldborder set 4000` (diameter; radius 2000). Confirm with `worldborder get` (read-only). If the spawn is 0,0, the centre command is still run; it is harmless. This is not a recreate.

4. **[OWNER-OK]** Chunky settings, no start. `chunky world <WORLD>` (the form is UNVERIFIED, see 5e), `chunky shape square`, `chunky center <SPAWN_X> <SPAWN_Z>`. The radius is set in steps 5 and 6, not here. (The brief listed `chunky radius 2000` in this step; it is moved to step 6 so that the measuring run cannot be started at the full radius by mistake.)

5. **[OWNER-OK]** Measure first. `chunky radius 200` (25 chunks, a 51 by 51 chunk square, about 2,600 chunk positions; inside the 2000 area, so no work is wasted). `chunky start`. Run `chunky progress` a few times, for example every 2 minutes, and work out chunks per second from the reported counts and times. Run `tick query` (read-only) during it. Then either let it finish or `chunky cancel`. A cancel keeps the chunks generated so far. Compute the full-run time for 62,500 chunks at the measured rate. Record the rate.

6. **[OWNER-OK]** Full run. `chunky radius 2000`, `chunky start`. Run `chunky progress` about every 10 minutes. Watch TPS (`tick query`, the ledger's tick events) and the JVM heap (the ledger's gauges). If players complain, `chunky pause`, and `chunky continue` when the window is clear. **Restart note:** `continue-on-restart` is false by default (research), so a reboot, for example the 04:30 unattended-upgrades reboot (time UNVERIFIED, see section 5e), stops the task. Restart it by hand. The exact command after a restart is UNVERIFIED: the brief gives `chunky continue`, and the research says a cancelled task is not resumable, so check the Commands page first. Because the ledger's stall events cannot see zero-player stalls (section 5d), `chunky progress` is the only progress check while empty.

7. **[OWNER-OK]** Verify. `chunky progress` reports complete (100 percent). Read-only: count and size the overworld region files on the volume (`ls` or `du` by ops; no write, no delete). Spot-check by a join (a player action, a quiet window). The ledger's loaded-chunks gauge is approximate only (section 5f).

8. **[OWNER-OK] [RECREATE]** Restore the pause. Set `NF_PAUSE_WHEN_EMPTY_SECONDS=<PREV_PAUSE>` (expected `60`) and run the overlay with `up`. This recreates `neoforge`. Confirm after the recreate: `/data/server.properties` shows the restored value (read-only). Only after the confirmation, drop the overlay from later `up` command lines. Dropping it needs no further recreate, because an unset variable is ignored and the restored value stays (research; UNVERIFIED on our tag). Re-read the value after the next recreate.

9. **[OWNER-OK] [RECREATE]** Decide whether Chunky stays. Keeping it enabled needs no action. Disabling it: unset `NF_EXTRA_MODS` and run `up`. This recreates `neoforge`, and the stale-copy removal in P-A removes the jar copy from `/data/mods`. Warn the players first.

Every step marked RECREATE (0, 2, 8, 9) needs the player warning and a quiet window.

## 6. What else changes

- **server.properties and config.** The entrypoint writes no pregen setting today. For Chunky itself, nothing is written. The border is set by step 3 of section 5h. `pause-when-empty-seconds` is set by the P-E overlay during the window (section 5d).
- **Backups: none, by owner decision.** The owner chose no backup of the NeoForge world. The repo has none: `docs/runbooks/backup-and-restore.md` line 13 says there is no backup procedure and no restore procedure in the repo. Pregen adds data to the volume without a backup. **Risk, recorded:** a corrupted or lost volume means the world is gone, including the pregenerated area. No backup step is in this plan. The owner may revisit this; the backup build and destination are a separate decision (decision 0076 and 0130 per that runbook).
- **Telemetry.** The geldar mod registers no chunk listener. The ledger counts `ChunkEvent.Load` and `Unload` into the OpenTelemetry gauge `geldar_world_loaded_chunks` (`neoforge-ledger/src/main/java/dev/geldar/ledger/neoforge/world/WorldWiring.java` lines 51-52; `WorldCollector` lines 47-49). It is a gauge, **not a NATS event**: no per-chunk NATS event exists, so pregen cannot flood the event sink. The sink's stream cap is 2 GiB or 30 days per NATS server (`eventsink/src/config.ts` lines 14-20, per the per-shard storage design).
- **Tick events.** The tick collector may emit slow-tick, overrun and stall events during the run. `TickCollector.java` line 27 caps the slow-tick events at 5 per second. Stall events are not reported with zero players (section 5d).
- **Recreate.** Enabling or disabling Chunky through the extra-mods mechanism recreates `neoforge`, and so does each pause change (steps 2 and 8). Each is a restart of the public game server. Warn the players, and do it when the window is quiet.
- **Colo images.** The extra-mods mechanism needs no change to `.github/workflows/colo-images.yml`: `compose/**`, `deploy/**` and `docs/**` are outside its trigger paths (per the brief; UNVERIFIED against the workflow's current `paths:` list).
- **The mod's entry in CI.** The P-A packet adds pin tests under `tools/repo-checks/src/`. Their names are not decided here.

## 7. Packets and order

| Packet | What | Where | Gate |
|---|---|---|---|
| P-A | The extra-mods mechanism: compose overlays, `deploy/nf-extra-mods-lib.sh`, the entrypoint's `copy_pinned_jar` and stale-copy removal, the pins file, tests. | Branch `phase1/nf-extra-mods`. No node actions. | Checks and the revert-check per packet rules. |
| P-B | The jar entries: Chunky 1.5.66 pin (and BlueMap's pin). BlueMap's lock and template files are geldar-bluemap's. | Pins file in P-A; BlueMap files as the BlueMap packet defines them. | Pin tests; the 2-week rule re-checked at merge. |
| P-C | A scratch-stack compatibility run: the mod loads with the NeoForge build, and a plain client joins. | Owner or ops; scratch first, then live. | The owner's OK. |
| P-D | The pregen runbook: a section in `docs/runbooks/nf-extra-mods.md` (the mechanics; the file is not on main yet, per the brief) with the steps of section 5h. | Docs. | Written after the owner's decisions (now recorded) and the open items in section 8. |
| P-E | A small optional overlay `compose/nf-live-pause-window.yml` that sets `PAUSE_WHEN_EMPTY_SECONDS` on the `neoforge` service from the node env var `NF_PAUSE_WHEN_EMPTY_SECONDS`. The value has **no default**. A small validation step refuses before any `docker` call if the variable is unset, empty, or not an integer from -1 to 3600. The validation lives in `deploy/nf-extra-mods-lib.sh` if P-A has landed, otherwise in a small lib of the same kind. | Branch to be named at build. Not yet built. No node actions in the packet itself. | Tests: refuse on unset, empty, `-2`, `3601`, `60.5`, `abc`; accept `-1`, `0`, `60`, `3600`; the plan prints the value; the revert-check per packet rules. Needs P-A. |

**Why P-E uses one overlay with a required env var (design choice).** Three shapes were considered:

- A node env var with a default of 60 in the **base** compose file. This changes the base file, and a default of 60 hides the window: a run that forgot to set -1 looks normal.
- Two overlays with fixed constants, one with -1 and one with 60. This is explicit, but it is two files, and a leftover overlay can be applied by mistake.
- **Recommended: one overlay that takes its value from a required env var.** The base file is not changed. The operator must state -1 or 60 each time, so a missing value cannot silently mean never-pause or 60. The validation refuses a bad value before any docker call. Compose's `${VAR}` interpolation with an unset variable gives an empty string with a warning; the helper stops that path.

Node steps are in section 5h. Their order is fixed: 0 (stage and enable Chunky), 1 (read-only), 2 (pause off), 3 (border), 4 (Chunky settings), 5 (measure), 6 (full run), 7 (verify), 8 (pause restored), 9 (decide on Chunky).

## 8. Open decisions

Left open by the owner's relay on 2026-11-18:

1. Chunky 1.5.66 (the pin in this note) or 1.5.4 (the fallback). The 2-week rule is re-checked at merge; if 1.5.66 no longer clears it, 1.5.4 becomes the pin.
2. The time window for the run.
3. Whether to run with players online during the run (section 5c).

Also open, not in the relay, and not decided here:

4. How the border is set: an itzg env var (in git) or RCON (not in git, lost on recreate). Section 5a.

Decided on 2026-11-18 (see the section at the top): radius and border, overworld only, no backup, pause-when-empty off during the window.

## 9. UNVERIFIED list

1. Chunky's own claims (the commands, the config keys, `continue-on-restart`, the lack of a throttle, the FAQ's `pause-when-empty` advice): from research on 2026-11-18, not re-fetched here.
2. Chunky 1.5.66 runs on the NeoForge server side only (a plain client test is needed, P-C).
3. Chunky's generation speed on the shard (chunks per second). Unmeasured.
4. Region file size (5, 10 and 20 MB per region are assumptions). Unmeasured. The number of regions that already exist in the area is also unknown.
5. The node's live world values: the border, the seed, the spawn, and the world path `/data/world` on `geldar-nf_neoforge-data`. Read in step 1 of section 5h.
6. **Researched route, documented, unverified on our server:** the itzg image's `PAUSE_WHEN_EMPTY_SECONDS` env var (research, the image's docs at tag 2026.10.1), the rule that an unset variable is ignored and leaves the property unchanged, and the vanilla default of 60. Our server's current value is not read yet (step 1 of section 5h).
7. The exact `rcon-cli` invocation (runbook 4c), and the form of the read-only spawn and border reads.
8. The 04:30 reboot time: the brief gives it, the repo does not show it; check the host timer.
9. Whether the autonomous shard's region generation and the vanilla border behave as described for mobs (section 5a).
10. The 2-week margin: the research date and time are not recorded precisely, so the margin of about 15 hours is an estimate.
11. Whether Modrinth's optional flags and the mods.toml side BOTH mean the same thing for a server-only install.
12. The sha256 of Chunky 1.5.4 (not computed).
13. Whether `copy_pinned_jar`, the stale-copy removal and the helper exist as described. They are in an unmerged branch.
14. The `colo-images.yml` trigger list (checked only as the brief describes it).
15. Whether the Chunky config file path in the container is as the research states.
16. The `chunky world`, `chunky center`, `chunky radius` and `chunky shape` syntax on the wiki's Commands page (the names are from the brief; the world-name form is not known).
17. The behaviour of the tick listener's per-tick slow-tick events with zero players. Read in this session: the watchdog's idle branch (`TickCollector.java` lines 115-117) reports no stall with zero players. Not read: the tick listener's path.
18. Whether a paused server stops a Chunky task (the FAQ does not say outright; the research inferred it).
19. Whether `chunky continue` is the right command after a restart, when `continue-on-restart` is false.
20. Whether the itzg image treats an empty `PAUSE_WHEN_EMPTY_SECONDS` as unset (P-E's validation avoids the case; the image's behaviour is not known).
21. The cost of -1 while empty (CPU and resident chunks): general knowledge, not measured.

## 10. Sources

- Modrinth API (research 2026-11-18): `https://api.modrinth.com/v2/project/chunky/version?loaders=["neoforge"]&game_versions=["26.1.2"]`.
- Chunky wiki (research 2026-11-18): `https://github.com/pop4959/Chunky/wiki/Commands`, `.../Configuration`, `.../FAQ`.
- Pause research (2026-11-18): `https://minecraft.wiki/w/Server.properties`; `https://raw.githubusercontent.com/itzg/docker-minecraft-server/2026.10.1/docs/configuration/server-properties.md`; `https://docker-minecraft-server.readthedocs.io/en/latest/misc/autopause-autostop/autopause/`.
- Repo, origin/main 565668af: `compose/nf-live.yml` (lines 252-299), `compose/colo.yml` (lines 119, 125-127, 137-138), `compose/phase0.yml` (line 85), `deploy/nf-deploy.sh` (lines 49-50, 251-260), `neoforge-ledger/README.md` (lines 49-54), `neoforge-ledger/src/main/java/dev/geldar/ledger/neoforge/tick/TickCollector.java` (lines 27, 38-41, 106-117), `neoforge-ledger/src/main/java/dev/geldar/ledger/neoforge/world/WorldWiring.java` (lines 51-52), `docs/runbooks/backup-and-restore.md` (line 13), `docs/analysis/neoforge/per-shard-storage-design.md`, `eventsink/src/config.ts` (lines 14-20).
- Brief-supplied repo facts not re-read in this session: the neoforge-entrypoint line ranges, `deploy/nf-deploy.sh` lines 251-260, and the BlueMap template paths.
