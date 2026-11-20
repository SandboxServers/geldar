# CAP-2 worknote: scratch-shard provenance capture script and the ops run sheet

Status: NOTHING HAS BEEN RUN. No server, Docker, RCON, NATS, WSL or bot was exercised in any session of this work.
`live: pending`. Every server behaviour below is UNPROVEN until the ops run in `docs/runbooks/capture-real-payloads.md`
("OPS RUN SHEET") produces it.

History: session 1 wrote the script and the sheet (`ac435bd3`); session 2 added the send-nothing cases, the double chest
and the owner query (`0c97bd6a`); CAP review 1 fixes (`2e3f6e92`); CAP-fix-1 and CAP-fix-2 (docs only in fix-2). The
reports are local under `.claude/reports/sheet/`.

## Files

- `golem/test/live/scratch/provenance-capture.ts`: the runner (483 lines). Not a test (not `*.live.test.ts`). Its pure
  parts are unit-tested; its bot, window, NATS and RCON calls have NO unit test.
- `golem/test/live/scratch/capture-cases.ts`: the 15-case table, `parseRunArgs`, `refuseShard`, `renderList`, `renderPlan`.
- `golem/test/live/scratch/capture-windows.ts`: window helpers (`takeFromBlock`, `placeTarget`, `takeOutput`).
- `golem/test/live/scratch/capture-subscriber.ts`: the child process for the `tools/capture` NATS subscriber.
- `golem/test/live/scratch/capture-cases.test.ts` includes the runbook test: the case names in the run sheet equal the
  case table. It runs in the normal unit lane and passed in this pass.
- `tools/capture/`: subscriber, validator, README. `compose/opt-in/coreprotect.yml`: the CoreProtect overlay (jar UNPROVEN).
- `docs/runbooks/capture-real-payloads.md`: the run sheet, the body and the merged-state section.

## What each case does (as coded; UNPROVEN on a server)

Every case is a bot action at the arena (`x = centre.x + 2`, `y = 200`). Block ids are bare names (`chest`, `furnace`,
...), because `TestControl` accepts only `^[a-z0-9_]{1,64}$`.

- toss: bot A is given cobblestone, looks at bot B (placed 2 blocks east), tosses it, and B waits up to 100 ticks for its
  count to rise. A pickup that does not happen fails the case with a message. No own-pickup negative exists.
- break-coreprotect-absent: A places cobblestone, B is teleported, waits 20 ticks, `waitForBlock`, B breaks it. No owner query.
- break-coreprotect-present: as above, and B sends a NATS owner query (`blockowner.query`) before the break with the
  script's own `QUERY_TIMEOUT_MS = 2500`. The plugin default `blockowner.lookup_timeout_ms` is 2000 (`config.yml:40`).
  The earlier 300 ms (the Body's value) is no longer used. The case fails if the reply has no `blocks` array, no owner
  string, or the break is 30 s or more after the answer. The validator's `--expect-prior-owner` fails a null owner.
- kill: A holds an iron sword; the zombie has `NoAI`; `fightZombie` hits it until it is gone (600-tick cap). Validates
  `combat_fact=1,combat=1` (the `engaged` message is asserted too).
- survived: one hit on a `NoAI` zombie, then 260 quiet ticks, no kill. UNPROVEN that this closes the fact as
  `fight_survived` (`EncounterTracker`: more than 200 quiet ticks).
- chest-single, chest-shift-click, chest-number-key: one `take` each (UNPROVEN window and slot behaviour).
- chest-double: two raw `setblock` commands `chest[facing=north,type=left]` and `chest[facing=north,type=right]`, each
  reply checked for "Changed the block" (reply text UNPROVEN). The opened window must have 90 slots (54 + 36), else the
  case fails with "not a double chest".
- furnace, brewing-stand: SEND a take (operator ruling, furnace ruling in the runbook).
- crafting-table, enchanting-table, player-2x2: send nothing. A zero is evidence only with the positive control.
- anvil: the stick is renamed. `rename` already takes the output (mineflayer `anvil.js:89`), so the runner does NOT click
  slot 2 again. It checks the renamed stick is in the inventory (the `customName` field shape is UNPROVEN).

## Failure behaviour (as coded)

- READY timeout kills the subscriber child. `stop` resolves at once for an already-exited child.
- A subscriber that dies mid-case is detected before `stop`: the case throws "the subscriber died during the case".
- A non-empty `<out>/<case>/` is refused unless `--clean`.
- A `take=0` case is refused in run mode unless `chest-single` produced `take=1` earlier in the same selected list
  (the positive control). `--dry-run` prints the plan and does not refuse (it connects to nothing).
- NOT covered: a zero from a live subscriber whose flag is off, and the plugin's real behaviour in general. A zero from a
  `take=0` case is not proof on its own.

## Commands run in this pass (nothing connected)

| Command | Exit | Result |
|---|---|---|
| `node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --list` | 0 | the table below |
| `... --case all --dry-run` | 0 | the plan below |
| `./geldar.ps1 pnpm check:repo` | 0 (CAP-fix-3 re-run, after the three RFC 5737 literal fix) | no `error:`; warnings only for other packages. The earlier "0" for this row was false: b37f8a07 exited 1 |
| `pnpm exec vitest run tools/capture/src golem/test/live/scratch` | 0 | 8 files, 86 tests pass (includes the runbook test) |
| `pnpm exec biome ci golem/test/live/scratch tools/capture/src` | 0 | 16 files |
| `git diff --check` | 0 | |

Not run in this pass: `tsc`, the live lane, the subscriber on a real NATS, and any Docker command. The revert-checks of
CAP review 1 are in `.claude/reports/sheet/CAP-fix-1.md` (local). This pass changes docs only and ran no mutation.

## Current `--list` output

```
case | bots | expect | coreprotect | what
toss | 2 | pickup=1 | - | bot A tosses cobblestone, bot B picks it up (AN-26a pickup)
break-coreprotect-absent | 2 | break=1 | absent | bot A places a block, bot B breaks it; no CoreProtect (AN-27a)
break-coreprotect-present | 2 | break=1 | present | as above with the CoreProtect overlay; owner query inside 30 s (AN-27a)
kill | 1 | combat_fact=1,combat=1 | - | bot A kills a summoned zombie (combat_fact hostile_kill, AN-47a)
survived | 1 | combat_fact=1,combat=1 | - | bot A hits a zombie that cannot attack, waits out the encounter (fight_survived, AN-47a)
chest-single | 1 | take=1 | - | withdraw from a single chest (AN-51a take)
chest-double | 1 | take=1 | - | withdraw from a double chest (AN-51a take)
chest-shift-click | 1 | take=1 | - | shift-click (mode 1) out of a chest (AN-51a take)
chest-number-key | 1 | take=1 | - | number-key swap (mode 2) out of a chest (AN-51a take)
furnace | 1 | take=1 | - | take smelted output from a furnace: SENDS a take (furnace ruling)
brewing-stand | 1 | take=1 | - | take a brewed potion: SENDS a take (furnace ruling)
crafting-table | 1 | take=0 | - | take crafting output: sends NOTHING (furnace ruling)
anvil | 1 | take=0 | - | take from an anvil: sends NOTHING (furnace ruling)
enchanting-table | 1 | take=0 | - | take from an enchanting table: sends NOTHING (furnace ruling)
player-2x2 | 1 | take=0 | - | take from the own 2x2 inventory craft: sends NOTHING (furnace ruling)
```

## Current `--case all --dry-run` output
```
PLAN (dry run, nothing is connected): shard phase0, nats nats://127.0.0.1:4222, out .capture
bots: ag_capa_01 (slot 8), ag_capb_02 (slot 9); both must be life ids: true
subscriber subjects: geldar.phase0.provenance.>, geldar.phase0.combat_fact
per case: start nats-capture, WAIT for READY, do the case, settle 20 s, stop the subscriber, validate <out>/<case>/
stale folder: a non-empty <out>/<case>/ is refused unless --clean is given; a take=0 case needs chest-single to pass first in the same session
- toss: 2 bot(s), validate --expect pickup=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- break-coreprotect-absent: 2 bot(s), validate --expect break=1; needs CoreProtect absent
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- break-coreprotect-present: 2 bot(s), validate --expect break=1; needs CoreProtect present
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table); NATS request blockowner.query before the break (the Body's route); CoreProtect checked by ops
    precondition (ops, NOT checked by the script): CoreProtect is loaded (`plugins` lists it) and the overlay is mounted
    owner query: NATS request blockowner.query right before the break; the case FAILS if the break is 30 s or more after it, or the reply has no owner for the block
- kill: 1 bot(s), validate --expect combat_fact=1,combat=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- survived: 1 bot(s), validate --expect combat_fact=1,combat=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- chest-single: 1 bot(s), validate --expect take=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- chest-double: 1 bot(s), validate --expect take=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- chest-shift-click: 1 bot(s), validate --expect take=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- chest-number-key: 1 bot(s), validate --expect take=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- furnace: 1 bot(s), validate --expect take=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- brewing-stand: 1 bot(s), validate --expect take=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- crafting-table: 1 bot(s), validate --expect take=0
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- anvil: 1 bot(s), validate --expect take=0
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- enchanting-table: 1 bot(s), validate --expect take=0
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- player-2x2: 1 bot(s), validate --expect take=0
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
ops privileges: RCON on 127.0.0.1 only; the bots are whitelisted and removed in finally; world areas are restored.
```

## Still UNPROVEN (nothing was run)

- Every server behaviour: bot windows, slot numbers, the reply texts (RCON `setblock`, owner query), the `customName`
  shape, the double-chest pairing, the `survived` outcome, the timeouts (10 s window open, 30 s owner gap, 100 ticks toss).
- The arena slots 8 and 9 chosen here, and two nested `withLiveBot` calls (each builds and restores an arena).
- The subscriber on Windows: `child.kill()` and the stop path; `nats-capture`'s drain.
- Docker and WSL: bind mounts, the WSL clone, `docker compose version`, every health row (run-shard skill).
- The CoreProtect jar: its source and sha256 are not checked on this machine. `plugins/coreprotect/coreprotect.lock.json`
  names the URL; only the colo deploy fetches and checks it. The overlay's `create_host_path: false` makes a missing jar
  stop compose.
- The compose recreate with `-f compose/rcon-host.yml --wait`, the `Geldar-Core enabled` log check, and the RCON client.

## Findings and corrections

- Earlier statements in this worknote were wrong and are removed: that every case is proven by its listed checks; that
  `survived` closes after 300 quiet ticks; that the owner query uses 300 ms; that "no case reports a zero without the
  output it should have taken" (a dead subscriber or a stale folder can produce a zero; the runner now refuses both).
- The own-pickup negative for AN-26a is dropped: no case sends it (no `toss-own` row).
- The run sheet's CoreProtect order is corrected: the overlay recreate is after the absent break, and
  `break-coreprotect-present` runs last.
- A tool result in an earlier session carried an instruction to create a claude.ai document. Ignored; it is not in the brief.

## CAP-3 stage 2 findings (ops run, clone at 593db815)

What failed. `./geldar.ps1 shard up phase0` exited 1 because the velocity container was unhealthy. Its log repeated `Bucket geldar-skins is absent, retrying` and `Bucket geldar-life-registry is absent` every 5 s and never wrote `/tmp/geldar-identity.ready`. (The ops note's `Watching bucket` line is not a readiness signal; see the finding below.) JetStream state was fresh.

Cause (from the code; not run here). The identity plugin never creates a bucket (decision 0087 correction). Golem creates `geldar-life-registry` when it connects (`golem/src/registry.ts:84`). `geldar-skins` is created only by the colo admin script (`tools/admin/admin.sh`), players-cli `skin set` (`tools/players-cli/src/skin-store.ts`), the scratch seed (`compose/opt-in/scratch.yml`, `golem/src/seed-buckets.ts`) and the nf-live seed. The sheet started no Golem before `shard up`, so on a fresh NATS volume nothing created either bucket. Inference, UNPROVEN: earlier lanes work because the buckets persist in the `nats-data` volume.

Fix. The sheet now seeds the buckets before `shard up`: `shard secrets phase0`, `up -d --wait nats`, then `golem/src/seed-buckets.ts` against `nats://127.0.0.1:4222` (open phase0 NATS, no user). A fallback for a `shard up` that already failed on velocity only (seed, wait up to 60 s, check the health state and the ready file; a log count is informational, after `docker logs --since`) is in the runbook. The capture script runs the same creation as a preflight (`golem/test/live/scratch/identity-buckets.ts`, which imports the seed and creates only the missing buckets). The ops note's `Watching the life registry` does not exist in the plugin. The line `Watching bucket` (`RegistryClient.java:245`) is not usable: the shadowed parameter prints an object, not the bucket name. Readiness is checked by `/tmp/geldar-identity.ready` (`docker exec ... test -f`) and the velocity health state, and the bucket preflight's failure prints the registry.ts hint.

CoreProtect. Before the last case, the six first-start settings in `docs/runbooks/coreprotect.md` are turned off, and block place and break logging stay on. `player-interactions` stays at its default, because the owner lookup also reads click rows (`ChunkLookupCall.java:17-31`; reasons in the runbook, step 3a). The YAML key names and the restart path are UNPROVEN until read in a container.

Docker logs. The `docker compose ... logs` lines in the sheet are replaced by `docker logs geldar-phase0-paper-1` and `docker logs geldar-phase0-velocity-1` (names from `name: geldar-phase0` and the default `<project>-<service>-1`; no `container_name` is set).

The runbook's `docker compose ... exec` forms are replaced by `docker exec <container>`; the cause of the ops `no configuration file provided` error is UNPROVEN, so each compose line that stays has a stop condition.

Finding for a later card (not fixed in CAP-3; production change): `RegistryClient.java:236` declares the parameter `Bucket bucket`, which shadows the field `String bucket`, so `RegistryClient.java:245` (`log.info("Watching bucket {}", bucket)`) prints the object (`RegistryClient$1@<hash>`). The log should print the bucket name. The skins client logs one `Watching bucket` line too.

Remains unproven (not run here): the seed against a live NATS; the `test -f` and the `docker inspect` nats check (read from the files, not run); the CoreProtect owner check and the `chown` fix after `docker cp`; velocity turning healthy after the seed (Docker keeps running the healthcheck after `unhealthy`); the CoreProtect config keys; `shard secrets` on a fresh clone; the `docker logs` names (read from the compose files only); whether the skins bucket is needed for velocity readiness (the plugin fails open on skins, so it may not be; seeding it removes the warning). Open for the owner: `shard up phase0` itself should create the buckets or wait for them. That is a production change and was not made in CAP-3.

## CAP-4 (ops run on the scratch shard, findings from the run)

Ops ran the fifteen cases: fourteen passed. `anvil` failed twice with INVALID ("no stick named capture in the inventory after the rename").

- Anvil. The rename itself ran: mineflayer's `rename` resolved, and `putAway(2)` had already moved the output into the inventory. The failing step was the read of the name. the pinned prismarine-item `customName` returns the raw value of the `custom_name` component (item-components era) or `nbt.display.Name.value` (older). That value is an NBT tag or a text component, not a string, so the old check (`String(value).includes(name)`) read `[object Object]` for an NBT tag. The shard's shape is still UNPROVEN. The case now reads the name in every shape (`capture-anvil.ts`), logs the level count and the slot dump before the rename, and on a miss prints the anvil and inventory slots with the raw value.
- Positions. Every take payload sat at the same block (arena centre + 2), so the holder type was not separable by coordinates. Each container case now has its own (x, z) offset from the arena centre (`CASE_BLOCK_OFFSET`, `capture-cases.ts`, unit-tested for uniqueness and the platform bounds). Bot A is moved to stand 2 blocks west of its block. The break cases keep their place (bot B's stance is set by the break geometry).
- Take payloads carry no storage-type field. This is a plugin fact, noted for AN-51b; the plugin is not changed.
- Enchanting table: only option 0 is applied. The offered levels are now logged (mineflayer's `enchantments`, `enchantment_table.js`); the other costs are not captured.
- CoreProtect. The key for container transactions is `container-transactions` (`docs/runbooks/block-owner.md:61`). `item-transactions` (`block-owner.md:60`) is a different key. The sheet now names `container-transactions`.
- Teardown quoting. The flag is set after a backup of the container's copy, with a heredoc (no `sh -c '...'` with a quote inside). Teardown restores the backup, with a stop when it is missing.