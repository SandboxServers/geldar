# World pregeneration and the extra-mods mechanism (NeoForge shard, Chunky 1.5.66)

- Status: design note, docs only. Proposed; the owner decides the items in section 8. Nothing here is built, deployed or in force.
- Base: origin/main 565668af (checked). The brief cited 58c2ddfc; the line numbers below were checked on 565668af.
- Date: 2026-11-18. Branch `phase1/nf-pregen-design`. No code, no node contact, no push.
- Reading rule: **UNVERIFIED** marks a claim not proven in code, config, docs or on a server. Paths are relative to the repo root. Facts are tagged with their source. **Research** means the 2026-11-18 research on the Chunky project recorded in the brief (Modrinth API and the Chunky wiki); this note did not re-fetch those sources. **Estimate** marks a number that is calculated from assumptions and is not measured.

## 0. Summary for the decider

- Pregenerate the NeoForge shard's overworld with Chunky 1.5.66 (NeoForge build, GPL-3.0-only), mounted through a generic extra-mods mechanism that a separate branch is building (`phase1/nf-extra-mods`, not on main).
- Before any pregen the world border must be set, because the vanilla border is effectively unbounded here and mobs do not spawn outside it (section 5a). The border radius is the owner's choice.
- The shard's `pause-when-empty-seconds` interacts with pregen (section 5d). The repo sets it nowhere, so the owner must choose how to handle it.
- Pregen uses the CPU the public game server needs. Start with a small radius, in a quiet window, and measure (section 5c).
- Enabling Chunky recreates the `neoforge` container, which restarts the public game server. Players must be warned.
- No backup of the NeoForge world exists (section 6). A volume copy before the first run is recommended and is the owner's call.

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
- **Server-only install.** Modrinth marks both sides optional, and the mods.toml side is BOTH. The project has no registry or payload classes, per the research. A server-only install is probably fine. **UNVERIFIED by docs**: test once with a plain client joining the shard.
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
- So the border is the vanilla default (effectively unbounded), the seed is random unless the owner set it by hand, and the spawn is the vanilla one. **UNVERIFIED**: ops must read the live values before choosing a radius: RCON `worldborder get`, `seed`, and the world's spawn point.
- The world path is presumably `/data/world` on the volume `geldar-nf_neoforge-data` (the compose project is `geldar-nf`, per `nf-live.yml`; UNVERIFIED that the itzg image uses `/data/world`).
- Comparison, the autonomous shard: border radius 9500 (diameter 19000), set by `RCON_CMDS_STARTUP` in `compose/colo.yml` lines 137-138 (`worldborder set 19000`, a diameter), and the seed 8675309 at `compose/colo.yml` line 119 (per the brief). The phase 0 compose file uses a 3000 diameter (`compose/phase0.yml` line 85). These are not the NeoForge shard's values and are shown only as reference points.
- Shard limits: `MAX_PLAYERS` 100 is the shard's one shared limit for humans and agents (owner decision 2026-11-18, `compose/nf-live.yml` lines 276-279).

## 5. The plan

### 5a. Set the border first

- Chunky's `worldborder` command copies the vanilla border (research). The border is the place where Chunky stops.
- Mobs do not spawn outside the world border (vanilla behaviour, UNVERIFIED on 26.1.2 here). The border must therefore cover the whole pregen area, and the players' play area too.
- The owner chooses the radius and the shape (`chunky shape square` or the default; research).
- Set the border by RCON (`worldborder set <diameter>`) or by an itzg env var that does it at startup, like `RCON_CMDS_STARTUP` on the colo shard. Which one is a decision (section 8). The env var keeps the value in git; RCON keeps it out of the git history but is lost on recreate unless re-run. The repo holds no NeoForge value for either.

### 5b. Radius options (ESTIMATES)

Formulas: a radius R in blocks is R/16 chunks; the square area in chunks is (2R/16)^2 = (R/8)^2. A region file holds 32 by 32 chunks = 1024 chunks.

| Radius R (blocks) | Chunks (estimate) | Regions (estimate) |
|---|---|---|
| 2000 | 62,500 | about 61 |
| 5000 | 390,625 | about 382 |
| 9500 (the autonomous shard's border) | about 1.41 million | about 1,377 |

Time at an assumed generation speed. **The speed is UNMEASURED** and depends on single-thread CPU and SSD speed. The NeoForge container has 3 CPUs (`nf-live.yml` lines 256-263); the speed is unknown for it.

| Radius | 50 chunks/s | 100 chunks/s | 200 chunks/s |
|---|---|---|---|
| 2000 | about 21 min | about 10 min | about 5 min |
| 5000 | about 2.2 h | about 65 min | about 33 min |
| 9500 | about 7.8 h | about 3.9 h | about 2.0 h |

Disk at an assumed 5, 10 and 20 MB per region file (**UNMEASURED**; the docs give no figures):

| Radius | 5 MB/region | 10 MB/region | 20 MB/region |
|---|---|---|---|
| 2000 | about 0.3 GB | about 0.6 GB | about 1.2 GB |
| 5000 | about 1.9 GB | about 3.8 GB | about 7.6 GB |
| 9500 | about 6.9 GB | about 13.8 GB | about 27.5 GB |

Free space: about 1.1 TiB free on `/mnt/nvme`, measured 2026-11-17 (comment at `deploy/nf-deploy.sh` line 49; per-shard-storage design section 7). The deploy script's own floor is 50 GiB free. So even the 9500 option fits by a wide margin, as an estimate.

**Start small.** Run the smallest useful radius first, use `chunky progress` to measure the real chunks per second, extrapolate, and only then run the full radius. Do not plan the full radius from these estimates.

### 5c. CPU and RAM

- The NeoForge container is capped at 3 CPUs and 12 GiB, with a 9 GiB heap (`MEMORY` from `NF_NEOFORGE_HEAP`, default 9G) and `cpu_shares` 256, so it yields to the autonomous shard under contention (`compose/nf-live.yml` lines 256-263, 275). The budget is a proposal, to be re-measured at deploy (comment at line 255).
- Chunky is single-purpose and fast by default (research). Expect it to take the CPUs and to lower the tick rate for players on the public lane while it runs. **This is an expectation, not a measurement.**
- Chunky has no documented throttle option (research: the Configuration page; **UNVERIFIED** that none exists). `silent` and `quiet` only change messages; `quiet <seconds>` is a message interval (research).
- Mitigations: a quiet window with few or no players; a small radius first; `chunky pause` if the tick rate or the players suffer; `chunky continue` when the window is clear.
- RAM: Chunky's own overhead inside the 9 GiB heap is UNVERIFIED. Watch the heap in the ledger's JVM metrics during the first run.

### 5d. Pause-when-empty (a decision)

- Vanilla `pause-when-empty-seconds` (default 60) pauses the server when no players are online. Source for the default: the `TickCollector.java` comment (`neoforge-ledger/src/main/java/dev/geldar/ledger/neoforge/tick/TickCollector.java` lines 38-41, which cites the default). Per the Chunky FAQ (research), a pause also pauses generation, and the FAQ says to set it to -1 for pregen.
- The repo sets `pause-when-empty-seconds` nowhere (checked in `compose/`; UNVERIFIED for the image's own defaults).
- How to set it on the itzg image is **UNVERIFIED**. Look at the image's docs at the pinned digest for an env var; otherwise a `server.properties` edit or `OVERRIDE_SERVER_PROPERTIES` may be needed. Neither is in the repo today.
- **Ledger impact.** The ledger's `TickCollector` treats zero players as paused and reports no stall (`TickCollector.java` lines 38-41, line 116 restarts the stall timer on pause). So a stalled pregen with zero players would be **invisible** to the ledger's stall events. Pregen progress must be checked with `chunky progress` directly.
- Options for the owner:
  1. Set `-1` for the pregen window and restore `60` after. The server then never pauses while idle; the cost is CPU use while nobody is online.
  2. Keep a connected player or bot during the run. Costs a bot's session and its slot in the shard's `MAX_PLAYERS` 100.
  3. Accept that the pregen stops when the server pauses and resume it on the next visit. The FAQ implies generation stops; this needs a test.
- Recommendation for the decision: option 1 for the window only, with a runbook step that restores `60`. The restore is a second step that must not be forgotten (section 7, P-D).

### 5e. Commands (ops, through `rcon-cli`)

The exact `rcon-cli` form is **UNVERIFIED** here (runbook section 4c in `docs/runbooks/nf-live-project.md`, per the brief). Chunky commands are from research (wiki Commands page):

- `chunky worldborder`: copies the vanilla border into Chunky's area.
- `chunky shape square` (or the default shape).
- `chunky world <dimension>`: the overworld first (section 5g).
- The centre and radius commands: the names are on the wiki's Commands page; this note does not list them (UNVERIFIED here).
- `chunky start`, `chunky progress`, `chunky pause`, `chunky continue`.
- `chunky cancel`: stops the task. It keeps the chunks generated so far, and the task is **not resumable** after a cancel (research).
- `chunky quiet <seconds>`: the interval of progress messages (research).
- Config `continue-on-restart`, default false (research): a restart stops a running task and, with the default, it does not resume. The reboots on the node (unattended upgrades, the automatic reboot window per `docs/spec.md`, section on the host OS) would stop a running pregen. **UNVERIFIED**: the 04:30 reboot time the brief gives is not found in the repo; check the host's timer before any window. The config file's location in the container is **UNVERIFIED**.

### 5f. Verify

- `chunky progress` during the run (generated, total, speed; research for the output format, UNVERIFIED for the exact text).
- The region file count and size on the volume, by a read-only `du` on the node by ops (no write, no delete).
- The ledger's `geldar_world_loaded_chunks` gauge for the overworld (`neoforge-ledger/README.md` line 49; the gauge comes from `ChunkEvent.Load` and `Unload`, `WorldWiring.java` lines 51-52). The README says the counts are approximate and drift (README lines 49-53), so do not use it as the exact pregen count.
- TPS: the ledger's tick events and `/tick query`.
- No BlueMap render or fly-through is needed for this design; that is a separate check.

### 5g. Scope: overworld first

- Pregenerate the overworld only in the first run.
- Nether and End: a decision (section 8). They add their own region files and their own border behaviour (UNVERIFIED for this shard).

## 6. What else changes

- **server.properties and config.** The entrypoint writes no pregen setting today. For Chunky itself, nothing is written. The border is set by RCON or an itzg env var (decision). `pause-when-empty-seconds` is a decision (section 5d).
- **Telemetry.** The geldar mod registers no chunk listener. The ledger counts `ChunkEvent.Load` and `Unload` into the OpenTelemetry gauge `geldar_world_loaded_chunks` (`neoforge-ledger/src/main/java/dev/geldar/ledger/neoforge/world/WorldWiring.java` lines 51-52; `WorldCollector` lines 47-49). It is a gauge, **not a NATS event**: no per-chunk NATS event exists, so pregen cannot flood the event sink. The sink's stream cap is 2 GiB or 30 days per NATS server (`eventsink/src/config.ts` lines 14-20, per the per-shard storage design).
- **Tick events.** Expect the tick collector to emit slow-tick, overrun and stall events during the run. `TickCollector.java` line 27 caps them at 5 per second. Expect a burst, and expect nothing for a paused server (section 5d).
- **Backups.** None exist for the NeoForge world: `docs/runbooks/backup-and-restore.md` line 13 says there is no backup procedure and no restore procedure in the repo. Pregen adds many GB to a volume with no backup. A volume copy before the first run is recommended. The owner decides the backup build and destination (decision 0076 and 0130 per that runbook).
- **Recreate.** Enabling Chunky through the extra-mods mechanism recreates `neoforge`, which is a restart of the public game server. Warn the players, and do it when the window is quiet. Disabling it recreates the container again.
- **Colo images.** The extra-mods mechanism needs no change to `.github/workflows/colo-images.yml`: `compose/**`, `deploy/**` and `docs/**` are outside its trigger paths (per the brief; UNVERIFIED against the workflow's current `paths:` list).
- **The mod's entry in CI.** The P-A packet adds pin tests under `tools/repo-checks/src/`. Their names are not decided here.

## 7. Packets and order

| Packet | What | Where | Gate |
|---|---|---|---|
| P-A | The extra-mods mechanism: compose overlays, `deploy/nf-extra-mods-lib.sh`, the entrypoint's `copy_pinned_jar` and stale-copy removal, the pins file, tests. | Branch `phase1/nf-extra-mods`. No node actions. | Checks and the revert-check per packet rules. |
| P-B | The jar entries: Chunky 1.5.66 pin (and BlueMap's pin). BlueMap's lock and template files are geldar-bluemap's. | Pins file in P-A; BlueMap files as the BlueMap packet defines them. | Pin tests; the 2-week rule re-checked at merge. |
| P-C | A scratch-stack compatibility run: the mod loads with the NeoForge build, and a plain client joins. | Owner or ops; scratch first, then live. | The owner's OK. |
| P-D | The pregen runbook: a section in `docs/runbooks/nf-extra-mods.md` (the mechanics; the file is not on main yet, per the brief) with the pregen steps. | Docs. | Written after the border and pause-when-empty decisions. |

Node steps, one at a time, each with the owner's OK:

1. Scratch run of the extra-mods stack.
2. Stage the jar on the host, pinned.
3. `NF_EXTRA_MODS=chunky` plan, then `up` (this recreates `neoforge`; warn the players).
4. Set the border (section 5a).
5. Set `pause-when-empty` for the window (section 5d).
6. Take the volume copy (section 6).
7. `chunky start` with the small radius; measure with `chunky progress`; extrapolate.
8. Run the full radius, or stop at the measured time budget.
9. Restore `pause-when-empty-seconds` to 60 and check the ledger.

## 8. Owner decisions

1. Chunky 1.5.66 (the pin in this note) or 1.5.4 (the fallback).
2. The border radius and shape. The reference points are section 4.
3. How the border is set: an itzg env var (in git) or RCON (not in git, lost on recreate).
4. `pause-when-empty-seconds` during the pregen window (section 5d, options 1 to 3).
5. Nether and End: in scope or later.
6. A volume copy before the first run.
7. The time window, and whether to run with players online (section 5c).
8. Whether the 2-week rule is re-checked at merge, and whether 1.5.4 becomes the pin if it is not.

## 9. UNVERIFIED list

1. Chunky's own claims (the commands, the config keys, `continue-on-restart`, the lack of a throttle, the FAQ's `pause-when-empty` advice): from research on 2026-11-18, not re-fetched here.
2. Chunky 1.5.66 runs on the NeoForge server side only (a plain client test is needed, P-C).
3. Chunky's generation speed on the shard (chunks per second). Unmeasured.
4. Region file size (5, 10 and 20 MB per region are assumptions). Unmeasured.
5. The node's live world values: border, seed, spawn, and the world path `/data/world` on `geldar-nf_neoforge-data`.
6. Whether the itzg image takes an env var for `pause-when-empty-seconds`, and its default.
7. The exact `rcon-cli` invocation (runbook 4c).
8. The 04:30 reboot time: the brief gives it, the repo does not show it; check the host timer.
9. Whether the autonomous shard's region generation and the vanilla border behave as described for mobs (section 5a).
10. The 2-week margin: the research date and time are not recorded precisely, so the margin of about 15 hours is an estimate.
11. Whether Modrinth's optional flags and the mods.toml side BOTH mean the same thing for a server-only install.
12. The sha256 of Chunky 1.5.4 (not computed).
13. Whether `copy_pinned_jar`, the stale-copy removal and the helper exist as described. They are in an unmerged branch.
14. The `colo-images.yml` trigger list (checked only as the brief describes it).
15. Whether the Chunky config file path in the container is as the research states.
16. Whether the centre and radius command names match the wiki (not listed here).
17. The NeoForge tick-stall behaviour when the server is paused for empty, against the ledger's assumption (`TickCollector.java` lines 38-41).

## 10. Sources

- Modrinth API (research 2026-11-18): `https://api.modrinth.com/v2/project/chunky/version?loaders=["neoforge"]&game_versions=["26.1.2"]`.
- Chunky wiki (research 2026-11-18): `https://github.com/pop4959/Chunky/wiki/Commands`, `.../Configuration`, `.../FAQ`.
- Repo, origin/main 565668af: `compose/nf-live.yml` (lines 252-299), `compose/colo.yml` (lines 119, 125-127, 137-138), `compose/phase0.yml` (line 85), `deploy/nf-deploy.sh` (lines 49-50, 251-260), `neoforge-ledger/README.md` (lines 49-54), `neoforge-ledger/src/main/java/dev/geldar/ledger/neoforge/tick/TickCollector.java` (lines 27, 38-41, 116), `neoforge-ledger/src/main/java/dev/geldar/ledger/neoforge/world/WorldWiring.java` (lines 51-52), `docs/runbooks/backup-and-restore.md` (line 13), `docs/analysis/neoforge/per-shard-storage-design.md`, `eventsink/src/config.ts` (lines 14-20).
- Brief-supplied repo facts not re-read in this session: the neoforge-entrypoint line ranges, `deploy/nf-deploy.sh` lines 251-260, and the BlueMap template paths.
