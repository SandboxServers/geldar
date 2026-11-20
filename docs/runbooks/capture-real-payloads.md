---
title: "Capture the owed real provenance payloads"
type: how-to
audience: agents-never
status: draft
last_verified: 2026-11-19 against origin/main cef94f2513a701a07d63d584fabd2e1ea6b0595b (read, not run)
companions: [README.md, block-owner.md, scratch-stack.md, ../analysis/harness/test-package-design.md, ../analysis/harness/worknotes/AN-26a.md, ../analysis/harness/worknotes/AN-27a.md, ../analysis/harness/worknotes/AN-47a.md, ../analysis/harness/worknotes/AN-51a.md]
sources: [../../.claude/skills/run-shard/SKILL.md, ../../.claude/skills/body-bench/SKILL.md, ../../plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java, ../../plugin/core/src/main/java/dev/geldar/core/GeldarCore.java, ../../geldar.ps1, ../../bench/sheet/run.sh]
---

# Capture the owed real provenance payloads

## OPS RUN SHEET (one page; read this, then the rest only for the reasons given)

Status (branch `phase1/sheet-capture-prep`, CAP-fix-2): the capture script exists
(`golem/test/live/scratch/provenance-capture.ts`, runner; pure table in `capture-cases.ts`), the subscriber and validator
exist (`tools/capture/`, see its README), and the CoreProtect overlay exists (`compose/opt-in/coreprotect.yml`). All
fifteen cases have a bot action; none is manual. NOTHING BELOW HAS BEEN RUN. Every server reply, every expected output
and every Docker, WSL, bind-mount and CoreProtect-jar step is UNPROVEN until stage 2 and stage 3 produce it. The
plugin flags are merged on `origin/main` (see "Merged state" below), so the flags are the only switch.

Run order, fixed: every case except `break-coreprotect-present` first; then the CoreProtect overlay step; then
`break-coreprotect-present` as the LAST case. The "absent" break runs before the overlay exists on the stack.

Rules: one shard, used by you alone. Never `adam up` (CLAUDE.md). Stop at the first stop condition.

### Stage 1: pre-flight (WSL, the clone on the WSL filesystem)

```
git status                                  # expected: clean, on the commit under test
docker compose version                      # expected: 2.24.4 or later
git ls-files --eol compose                  # expected: w/lf for every file
ls plugin/core/build/libs/geldar-core.jar plugin/velocity-identity/build/libs/geldar-velocity-identity.jar
```

### Stage 2: environment proof (the unproven items, first)

```
(cd plugin; ./gradlew build)                                  # expected: BUILD SUCCESSFUL
./geldar.ps1 shard up phase0 --rcon-host                      # expected: stack up, RCON on 127.0.0.1:25575
```

What `shard up` does (`geldar.ps1:460-496`): rebuilds the repo images, adds `compose/rcon-host.yml` when `--rcon-host` is
given (`:471`), starts the stack and waits until healthy, then runs `Assert-PluginsEnabled` (`:212-222,488`), which
looks in the paper log for `Geldar-Core enabled` and in the velocity log for `Geldar identity enabled`. A plain
`docker compose ... up -d` does none of this: no `--wait`, no plugin check, and no `rcon-host.yml` unless you add it.
Any recreate in this runbook therefore needs the explicit `-f compose/rcon-host.yml`, or RCON on 127.0.0.1:25575 stops.

Health rows (run-shard skill; skip Ollama). Each must be green:
Minecraft joins through Velocity; NATS 127.0.0.1:4222 answers; RCON `version` replies; `list` replies with 0 players.

Then the unproven items, with the expected output. Commands marked UNPROVEN were not run on this machine.

| Item | Command | Expected |
|---|---|---|
| Paper loaded GeldarCore | `docker compose -p geldar-phase0 -f compose/phase0.yml -f compose/rcon-host.yml logs --no-color paper \| grep "Geldar-Core enabled"` (UNPROVEN: the project name `geldar-phase0` is assumed; `geldar.ps1` `Assert-PluginsEnabled` uses `docker compose` with the shard's files and checks the same text) | one line `Geldar-Core enabled for shard phase0` (`GeldarCore.java:195`); no line means the plugin did not load: stop |
| CoreProtect absent (the "absent" case) | RCON `plugins` (UNPROVEN: the RCON client; see "RCON commands" below) | no `CoreProtect` in the list |
| Plugin config reads the flags | `docker compose -f compose/phase0.yml exec paper cat /data/plugins/GeldarCore/config.yml` (UNPROVEN: the path comes from `saveDefaultConfig()` and `plugin.yml` name `GeldarCore`; not read in a container) | file exists; `blockowner:` block is there (`enabled: true`, repo default, `plugin/core/src/main/resources/config.yml:38`); no `provenance:` block (the default is false, `BlockOwnerSetup.java:27,152-153`) |
| Subscriber gets READY | the script prints `== case <name>` and waits; a READY timeout is a stop condition | READY in under 30 s |

Flag key names, verified in the merged source: `provenance.enabled` (default false, read by `getBoolean` at
`BlockOwnerSetup.java:153`) and `blockowner.enabled` (default true, `config.yml:38`). Edit only the container's volume
copy. Never edit `plugin/core/src/main/resources/config.yml`.

### Stage 3: captures (flag on, shard exclusive, one case at a time)

Flag on first (UNPROVEN until the first capture): do Stage 2's flag steps ("Set the flag on the scratch shard", steps 1-4,
below) before the first line of the block. Step 1 must show `blockowner:` with `enabled: true` (repo default,
`config.yml:38`), and `provenance:` with `enabled: true` after step 3. Run every line from the repo root with the same
`--out .capture/cap-phase0`. The send-nothing cases (`take=0`) count only after `chest-single` passed in that `--out`:
its pass writes `.capture/cap-phase0/positive-control.json`, which later runs read. So a lone `--case crafting-table`
exits 2 when the marker is missing; run `chest-single` first (it is in the block's order). After a failed case, rerun
that case with `--clean` and the same `--out`; never retry in a loop. Expected files are the count the validator shows.

```
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --list
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case all --dry-run --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case toss --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case break-coreprotect-absent --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case kill --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case survived --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case chest-single --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case chest-double --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case chest-shift-click --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case chest-number-key --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case furnace --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case brewing-stand --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case crafting-table --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case anvil --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case enchanting-table --out .capture/cap-phase0
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case player-2x2 --out .capture/cap-phase0
# CoreProtect steps 1-3 below must be done before the next line (it is the last case)
node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --case break-coreprotect-present --out .capture/cap-phase0
```

The CoreProtect steps go after the fourteen cases above and before the last line of the block. Nothing here was run.

1. Jar (UNPROVEN source). The overlay mounts `${GELDAR_COREPROTECT_JAR:-../.data/coreprotect/coreprotect.jar}` read-only
   with `create_host_path: false` (`compose/opt-in/coreprotect.yml`), so compose FAILS if the file is absent. Put the
   jar at `.data/coreprotect/coreprotect.jar` in the clone, or export `GELDAR_COREPROTECT_JAR` to its absolute path (a relative value resolves against `compose/`, not your shell). The version
   and the expected sha256 are in `plugins/coreprotect/coreprotect.lock.json` (version 24.1, file
   `CoreProtect-CE-24.1.jar`). The lock's URL is the only documented source; `deploy/common.sh` `fetch_coreprotect`
   downloads it and checks sha256 on the colo deploy path, which this phase0 path does not run. So the jar's origin on
   this machine is UNPROVEN until you download it yourself and check its sha256 against the lock (`sha256sum`, in WSL).
   Do not use a jar of unknown origin.
2. Recreate Paper with the overlay, keeping the RCON publish (the same files `shard up --rcon-host` uses, `geldar.ps1:471`):
   `docker compose -f compose/phase0.yml -f compose/rcon-host.yml -f compose/opt-in/coreprotect.yml up -d --wait paper`
   (UNPROVEN). `--wait` is required: `shard up` waits for health, plain `up -d` does not.
3. Check the plugin loaded, as `Assert-PluginsEnabled` does: `docker compose -f compose/phase0.yml -f compose/rcon-host.yml -f compose/opt-in/coreprotect.yml logs --no-color paper | grep "Geldar-Core enabled"`
   (UNPROVEN) must print one line. Then check CoreProtect with RCON `plugins` (see "RCON commands").
4. Only then: the block's last line. It is the LAST case; after it, go to teardown and remove the flag (Stage 4 step 2).
   The overlay is gone after `shard down`; the next `shard up` recreates Paper without it.

Each run writes `.capture/<case>/` (gitignored) and prints the validator table.

| Case | Expected files in `.capture/<case>/` | Validator `--expect` | Worknote to fill |
|---|---|---|---|
| toss | 1 `pickup`. There is NO own-pickup negative: no case in the table sends it (the table has no `toss-own` row), so the negative is dropped from this sheet | `pickup=1` | AN-26a, `## Ops evidence (pending, not run in this packet)` |
| break-coreprotect-absent | 1 `break`, `prior_owner` null | `break=1` | AN-27a, bullet `- CoreProtect absent:` |
| break-coreprotect-present (LAST) | 1 `break`; `prior_owner` non-null only if the owner query answered before the break (`QUERY_TIMEOUT_MS = 2500` in the script; the plugin's `blockowner.lookup_timeout_ms` default is 2000, `config.yml:40`). The script logs the answer and the gap to the break; the case fails if the reply has no `blocks` array or no owner string, or the gap is 30 s or more. The validator's `--expect-prior-owner` fails a null owner on a break | `break=1` | AN-27a, bullet `- CoreProtect present:` |
| kill | 1 `combat_fact` (hostile_kill). The bot holds an iron sword; the zombie has `NoAI`. The `engaged` message (`combat=1`) is asserted too | `combat_fact=1,combat=1` | AN-47a, below `Ops capture pending:` |
| survived | 1 `combat_fact` (fight_survived). One hit, then 260 quiet ticks, no kill; the zombie has `NoAI`. UNPROVEN that the encounter closes this way (`EncounterTracker`: more than 200 quiet ticks) | `combat_fact=1,combat=1` | AN-47a, same place |
| chest-single | 1 `take` | `take=1` | AN-51a, `## Pending (ops evidence, not run)` |
| chest-double | 1 `take`; the script prints "a double chest" only when the window has 90 slots (54 + 36), else the case fails | `take=1` | AN-51a, same |
| chest-shift-click | 1 `take` | `take=1` | AN-51a, same |
| chest-number-key | 1 `take` | `take=1` | AN-51a, same |
| furnace | 1 `take` (SENDS; furnace ruling) | `take=1` | AN-51a, holder table |
| brewing-stand | 1 `take` (SENDS) | `take=1` | AN-51a, holder table |
| crafting-table | 0 files: "send nothing". The script prints the window, the log moved into grid slot 1, the output it took; no output means the case fails | `take=0` (exact) | AN-51a, holder table |
| anvil | 0 files. Window, rename of a stick (`experience add` first), output slot 2 taken | `take=0` (exact) | AN-51a, holder table |
| enchanting-table | 0 files. Window, sword and lapis placed, enchant option 0, output slot 0 taken | `take=0` (exact) | AN-51a, holder table |
| player-2x2 | 0 files. The own inventory (46 slots, no container open), oak log in grid slot 1, output taken | `take=0` (exact) | AN-51a, holder table |

Stop conditions (stop, do not retry in a loop, report):
- any health row red, or RCON or NATS refuses (NATS auth refusing included);
- the subscriber does not print READY within 30 s;
- a send-nothing case (`take=0`) writes a file: a finding for the AN-51 owner, not a capture failure;
- a validator row reads `fail` (a fail means the capture refutes a worknote claim, or the payload breaks the contract);
- a case fails with a message saying the window did not open within 10 s, the output slot was empty, the window is the
  wrong kind, or the chest is not a double chest: no zero is claimed, the case is not evidence;
- a break case: the owner query failed, or the break came 30 s or more after it;
- a bot name is refused at join.

### Where each result goes (exact headings; paste the JSON verbatim, one per capture, plus the validator row)

Format: `Captured 2026-MM-DD at <commit sha>, shard phase0, case <id>, subject <subject>, validator: ok | <error>`
then a `json` fence with the message exactly as received. A case with no message: `case <id>: no message in <n> s,
subscriber active since <time>`.

- `docs/analysis/harness/worknotes/AN-26a.md`: heading `## Ops evidence (pending, not run in this packet)`. Toss pickup only (no own-pickup negative: no case sends it).
- `docs/analysis/harness/worknotes/AN-27a.md`: replace the word `pending` on the bullets `- CoreProtect present:` and `- CoreProtect absent:`.
- `docs/analysis/harness/worknotes/AN-47a.md`: the line `Ops capture pending:` at the end; kill and survived `combat_fact` and `engaged` (the `combat` kind).
- `docs/analysis/harness/worknotes/AN-51a.md`: heading `## Pending (ops evidence, not run)`, both bullets: each take case, and a holder table (chest, double chest, crafting table, furnace, anvil, enchanting table, brewing stand: reports a location? storage type? sent a message?).

Do not edit anything else in those worknotes, and do not create `fixtures/*.json` (AN-26b and the others own those).

### Stage 4: teardown

1. Stop the script (Ctrl+C). Confirm no bot online: RCON `list`.
2. Reset the flag: remove the `provenance:` block that Set-the-flag step 3 appended (or set `enabled: false`); set
   `blockowner.enabled` back only if you changed it; wait 10 s.
3. RCON `tick query` reads 20 TPS; `gamerule <name>` for any gamerule the case changed (none in CAP-2).
4. `git diff shards/phase0.yaml` must be empty (restore it with the owner's word if it is not; never `adam select`).
5. `./geldar.ps1 shard down phase0` (volumes are kept). Deleting the world volume needs the owner's word (run-shard skill).
6. Delete `.capture/` only after the worknotes are pasted. Then `git status` must be clean.

Type: how-to. Audience: the `ops` agent (it never edits code) and the orchestrator that dispatches it. This is
operator documentation about raw plugin messages that only a Body may ever read. Never copy it into a prompt, skill,
kit file, tool text, `identity.md`, player repo or sign.

Goal: one real payload for each case the four plugin cards owe, taken from a throwaway shard, recorded verbatim in
the card's worknote, so the Body-side cards (AN-26b, AN-27b, AN-47b, AN-51b) freeze fixtures on real shapes.

| Card | Owed capture | Subject (shard `phase0` shown) |
|---|---|---|
| AN-26a | one two-player item toss: a `pickup` message | `geldar.phase0.provenance.pickup` |
| AN-27a | one block break with CoreProtect present, one with it absent: two `break` messages | `geldar.phase0.provenance.break` |
| AN-47a | one real kill and one survived fight: `combat_fact` events (check the `player` key) and the `engaged` message | `geldar.phase0.combat_fact`, `geldar.phase0.provenance.combat` |
| AN-51a | container takes: single chest, double chest, shift-click, number-key swap; furnace and brewing stand (these SEND a take); crafting table, anvil, enchanting table and the player's own 2x2 view (these send nothing) | `geldar.phase0.provenance.take` |

## Merged state: the flags and the listeners (checked on origin/main cef94f25, read, not run)

The earlier "cannot run on main" section is withdrawn: the gap it described is closed on `origin/main`.

1. Break, pickup and container-take listeners are registered by `BlockOwnerSetup.java:95-101`, behind the same gate.
2. The flag is read by `provenanceEnabled` (`BlockOwnerSetup.java:152-153`: `getBoolean("provenance.enabled", false)`;
   no `provenance:` block in `plugin/core/src/main/resources/config.yml`). The plugin re-applies `blockowner.*` and
   `provenance.enabled` on its reload (`BlockOwnerSetup.java:142`; `GeldarCore.java:122`, `reloadConfig()` at `:172`).
3. The combat listener is registered in `GeldarCore` (`GeldarCore.java:127-129`) and is inert until
   `provenance.enabled` is true (`CombatFactListener.java:24`).
4. With BOTH `provenance.enabled` and `blockowner.enabled` true, the plugin publishes break, pickup, take and combat
   provenance messages. With the flag false they are inert. A break has a non-null `prior_owner` only with CoreProtect
   present (see the CoreProtect step in Stage 3).
5. Wave order is an orchestrator decision and is not settled here: `docs/analysis/harness/sheet-next-wave-order.md:120`
   places the AN-26b and AN-27b captures before AN-28b and AN-28c. The captures need the merged listeners above.

## Safety limits (CLAUDE.md)

- Never run `adam up` or `adam up --help` before or during the capture. `adam up` holds port 7410, the Thinker
  socket, and the live cases start their own Mind and Body (`CLAUDE.md`, "Live runs start their own stack").
- `bench` and `test:live` mutate the shard (tick rate, whitelist, world). Use the shard exclusively, one thing at a
  time, with nothing else connected: no Adam run, no second agent, no human client.
- Run only against a throwaway shard, never on the live or Colo stack. Fix nothing by acting in the world.
- No secret, account name or address goes into a worknote or a report. `127.0.0.1` is fine.

## Principle 1 and the human client

Spec section 2, principle 1 (`docs/spec.md:105`): humans never speak, build, give items or intervene. `CLAUDE.md`:
"nothing we build lets a human act inside the world". The repo also builds nothing for a human client on Paper: the
Velocity gate admits only usernames that Golem registered in the NATS life registry (run-shard skill, "Golem
connection settings"), and `docs/spec.md:313` bars a spectator from commands and RCON.

- The default here is scripted test bots (below). They are test lives, as `golem/test/live/chatter-bot.ts:1-8` says of
  its chatter, not human acts.
- RCON is allowed as test control for fixtures and ops tooling only (run-shard skill, "Logs and restarts"; decision
  0029 is the RCON framing record). Setting up a case with `give`, `setblock` or `summon` through `TestControl`
  (`golem/src/test-control.ts`) is that carve-out.
- An ordinary Minecraft client driven by a person on a scratch shard that holds no real agent would be a test tool,
  not a world act on a real shard. This runbook does not authorise it: it needs the owner's word, it still needs a
  registered name to pass the gate, and nothing in the repo registers one for a person. Use bots.

## Build and start the shard

1. Clean, committed tree on the commit under test (`git status` empty). The capture itself must not dirty the tree
   (see "Order" below): keep the throwaway script outside the tracked tree or untracked and ignored.
2. Build both plugin jars (`CLAUDE.md`, commands): `(cd plugin; ./gradlew build)`. `shard up` refuses without both
   jars (`geldar.ps1:198`).
3. Start the shard exactly as the run-shard skill says: `./geldar.ps1 shard up phase0 --rcon-host`. The
   `--rcon-host` flag publishes RCON on `127.0.0.1:25575` for host tools (`geldar.ps1:464-465`;
   `compose/phase0.yml` does not publish it). Walk the health rows of the run-shard skill. Skip the Ollama row: no model runs
   here.
4. Isolated alternative, unproven: `bench/sheet/run.sh up` starts `compose/phase0.yml` with
   `bench/sheet/phase0-sheet.yml` under a `scratch-` project name, with its own volume and the ports
   Minecraft 26566, NATS 14223, RCON 26576 and Postgres 15433, all on `127.0.0.1`, and `down` removes its volumes
   (`bench/sheet/run.sh` `up` and `down` cases; port list in the header of `bench/sheet/phase0-sheet.yml`). Its header calls itself a step 0
   helper "modelled on PR #507's harness (not yet on main)" (stale text) and I did not run it. If you use it, point
   Golem at those ports (`GELDAR_MC_PORT`, `GELDAR_RCON_PORT`, `GELDAR_NATS_URL`; names in `golem/src/config.ts` per the
   run-shard skill) and the NATS subscriber too. `deploy/scratch/scratch.sh` is the other scratch tool; it refuses open
   NATS (`scratch.sh:7-9`), and under the auth overlay no role could subscribe to `provenance.*` before AN-28c (merged, #817); see "Capture raw NATS payloads". It still does not suit
   this capture.

## Set the flag on the scratch shard

Only on the throwaway shard, after the health rows. Nothing below was run; each command is UNPROVEN until read on the container.

1. Read the file: `docker compose -f compose/phase0.yml exec paper cat /data/plugins/GeldarCore/config.yml` (UNPROVEN path: from
   `saveDefaultConfig()` and the plugin name `GeldarCore`; the volume is `paper-data`, `compose/phase0.yml:88`).
2. Check the file ends in a newline before you append: `docker compose -f compose/phase0.yml exec paper tail -c 1 /data/plugins/GeldarCore/config.yml | od -c`
   (UNPROVEN; expect `\n`). If it does not, stop and fix it by hand, or the appended key joins the last line.
3. Add the flag in the container's copy only: `docker compose -f compose/phase0.yml exec paper sh -c 'printf "provenance:\n  enabled: true\n" >> /data/plugins/GeldarCore/config.yml'`
   (UNPROVEN: that the Paper image has `sh` and `printf`). `blockowner.enabled` is already `true` by default (`config.yml:38`);
   if step 1 shows `enabled: false` under `blockowner:`, set that line to `enabled: true` in the container copy (UNPROVEN
mechanism: `sed -i` in the Paper image; read the file again to confirm). Never add a second `blockowner:` key.
4. The plugin reloads its config on a timer (`GeldarCore.java:122,172`; the 5 s figure is the comment's, not re-measured).
   Wait 10 s, then confirm with the first capture. No log line is promised.
5. Teardown: remove the appended `provenance:` block (or set `enabled: false`), wait 10 s.

## CoreProtect on phase0 (absent by default)

`compose/phase0.yml` mounts no CoreProtect jar; `compose/colo.yml:148` does. So on phase0 CoreProtect is absent, the owner
source answers unavailable, and every `prior_owner` is null. The overlay `compose/opt-in/coreprotect.yml` mounts the jar
for the present case; its jar steps are Stage 3 step 1. The jar's origin is UNPROVEN on this machine: the lock names
the URL (`plugins/coreprotect/coreprotect.lock.json`), and only the colo deploy fetches and checks it. See
[coreprotect.md](coreprotect.md).

## RCON commands (client UNPROVEN)

The repo's RCON client is the one golem uses (`golem/src/test-control.ts`), on `127.0.0.1:25575` with `--rcon-host`.
Concrete form (UNPROVEN in this image; the repo's precedent is `docs/runbooks/scratch-stack.md:307,311`), for example
`docker compose -p geldar-phase0 -f compose/phase0.yml -f compose/rcon-host.yml exec paper rcon-cli plugins`; the same
prefix with `rcon-cli list` or `rcon-cli tick query`. Read-only verbs:
- `plugins`: lists `CoreProtect` once the overlay loaded it (the absent and present checks);
- `list`: players online (0 before a case, and 0 after teardown);
- `tick query`: TPS (20 expected).

## Run two bots

Bot names matter. `CombatFactListener` and `ContainerTakeListener` ignore any name that fails `EventEnvelope.isLifeId`
(`CombatFactListener.java:125,133,146,153`; `ContainerTakeListener.java:86`). The pattern is
`^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$` (`EventEnvelope.java:27`). Existing live cases use names such as `GolemCombat`
and `GolemChest`, which fail it, so reusing them yields no combat or take message. Name the capture bots like
`ag_capa_01` and `ag_capb_01`, as `chatter-bot.ts:18` does with `ag_chatter_01`. The `give` action's `to` pattern
`^[A-Za-z0-9_]{3,16}$` (`contract/schemas/thought.schema.json:211`) accepts them.

| Case | Existing fixture that gives it | Gap |
|---|---|---|
| Toss (AN-26a) | none in the live lane. `golem/src/actions/give.ts` is the Body action; only unit tests (`give*.test.ts`) call it | `provenance-capture.ts` toss case: bot A gets cobblestone by `ctl.give`, tosses it, bot B picks it up |
| Break (AN-27a) | `golem/test/live/mine.live.test.ts:33-50` breaks logs with `{do:'mine'}` | needs a life-id name and, for non-null `prior_owner`, a warm owner cache (see below) |
| Kill (AN-47a) | `golem/test/live/reflex-combat.live.test.ts:190-205` kills a summoned zombie through the registry (`summonZombie`, line 20) | name is `GolemCombat`; needs a life-id name |
| Survived fight (AN-47a) | `reflex-combat.live.test.ts:122-150` (unarmed bot flees) is the closest | the fact closes after more than 200 quiet ticks (`AN-47a.md` tick rule); script must wait that long |
| Chest take (AN-51a) | `golem/test/live/container.live.test.ts:93-118` withdraws through `{do:'withdraw'}` | life-id name; one withdraw is not a shift-click or number-key swap |
| Double chest, shift-click, number-key swap, crafting table, anvil, enchanting table, 2x2 view (send nothing), furnace and brewing stand (send a take) | none | `provenance-capture.ts` (`bot.clickWindow`: shift-click mode 1, number-key mode 2; send-nothing windows) |

Rules for the capture bots: the fixture whitelists a bot before it joins and removes it in `finally`, and registers
it in the life registry (`golem/test/live/fixture.ts:24-80`, run-shard skill "Golem connection settings"); set
`GELDAR_NATS_URL` for any run that is not the bench CLI or the live lane. Start from `resetBot`
(`fixture.ts:133`) so no case depends on time of day or earlier inventory.

Prior owner on a break: `priorOwner` reads the cache only when a chunk base is fresh (`BlockChangeListener.java`
`priorOwner`, base TTL 30 s, change overlay TTL 60 s: `OwnerCache.java:22-23`). With CoreProtect absent the base is
never filled, so `prior_owner` is null. To see a non-null owner with CoreProtect present: bot A places a block, wait
for CoreProtect to log it, send one owner query for that chunk (the Body does this when `goto` digs; or publish on
`geldar.phase0.blockowner.query`), then bot B breaks the block inside 30 s. Capture the natural-block break (null
owner) too. Unproven end to end.

### The script (exists; not run)

`golem/test/live/scratch/provenance-capture.ts` (483 lines, committed on this branch; pure table in `capture-cases.ts`).
Run with `node --experimental-strip-types`. It is not a `*.live.test.ts`, so the live lane does not pick it up. It starts
two life-id bots, `ag_capa_01` and `ag_capb_02`. For each case it starts the subscriber, waits for READY (a READY timeout
kills the child), performs the case, settles 400 ticks, stops the subscriber, and validates `<out>/<case>/`. A non-empty
case folder is refused unless `--clean`. A shard other than `phase0` needs `--i-know-this-is-a-scratch-shard`; names
matching colo, live or prod are refused even with it.

## Capture raw NATS payloads

Subjects, from `contract/src/subjects.ts:114-149` and `NatsBlockOwnerLink.java:22-25,114-125`. The plugin only
publishes the four tails `break`, `pickup`, `take`, `combat`.

| Case | Subject | Where it can be replayed |
|---|---|---|
| pickup | `geldar.phase0.provenance.pickup` | nowhere: core NATS only |
| break | `geldar.phase0.provenance.break` | nowhere: core NATS only |
| take | `geldar.phase0.provenance.take` | nowhere: core NATS only |
| engaged | `geldar.phase0.provenance.combat` | nowhere: core NATS only |
| combat_fact event | `geldar.phase0.combat_fact` | stream `GELDAR_EVENTS` |

Why: `NatsBlockOwnerLink.publish` is a plain `nc.publish` (`NatsBlockOwnerLink.java:176-181`), and the stream takes
only `geldar.*.*` (`NatsEventPublisher.java:199`), three tokens; `geldar.phase0.provenance.pickup` has four. A
provenance message missed because the subscriber started late is lost: subscribe first, then act. `combat_fact` has
three tokens and goes through `exporter.emit` (`CombatFactListener.java:170`) into the stream, so
`nats stream view GELDAR_EVENTS --subject "geldar.phase0.combat_fact"` can read it later (the form in
`eventsink/README.md:21`).

Who may subscribe: the default `compose/phase0.yml` NATS is open (`phase0.yml:39`, "without it NATS stays open"), so
any client on `127.0.0.1:4222` may subscribe. Under the auth overlay (`compose/nats-auth.yml`), the role table
`Get-NatsUsers` in `geldar.ps1` gave no role `Sub` on `provenance` before AN-28c: `body` heard `body.>`,
`blockowner.changed`, `state.*.level`; `mind`, `eventsink`, `mcp` heard only the inbox. Since AN-28c (merged, #817)
the `body` role has `Sub` and `PubDeny` on
`geldar.<s>.provenance.>`; no other role changes. A capture subscriber needs a role that may subscribe, so after
AN-28c it is either the open phase0 NATS or the `body` credential. Unproven: I have not run a capture with the
`body` credential, so treat the open default shard as the proven path and the `body` credential as untested. Do not
widen any other role for the capture.

Tool, unproven: the repo has two `nats` CLI uses, both unrun by me: `docker exec <nats container> nats sub --raw '<subject>'`
(`docs/runbooks/progress-metrics.md:48`) and `nats stream view` (`eventsink/README.md:21`). The image is
`nats:2.15.1-alpine` (`compose/phase0.yml:38`); I did not check that it holds the `nats` CLI, and this machine may not
have it on the host. Fallback with no CLI: have the throwaway script open its own subscription with
`@nats-io/transport-node` (as `golem/test/live/adam-seed.ts:9-10,23` does) on `GELDAR_NATS_URL`, subscribe to
`geldar.phase0.provenance.>` and `geldar.phase0.combat_fact` before the first action, and write each message body
unchanged, one file per message. Either way, start the subscriber before the case and keep the raw bytes.

## Validate and record

Validate each captured JSON against the contract before it goes anywhere. Provenance messages:
`validateProvenance` (exported through `contract/src/perception-events.ts:11`); combat facts:
`validateCombatFactPayload` (`contract/src/evidence.ts:29`) on the event's `payload`. Command, unproven (the
`node --experimental-strip-types` form is the one `golem/src/bench/sheet/cli.ts` uses; the import and the result shape
are not run):

```powershell
./geldar.ps1 pnpm --filter @geldar/golem exec node --experimental-strip-types --input-type=module -e "import { validateProvenance } from '@geldar/contract'; import { readFileSync } from 'node:fs'; console.log(JSON.stringify(validateProvenance(JSON.parse(readFileSync(process.argv[1], 'utf8')))))" <file>
```

If it fails to run, the cards' own tests are the validators: AN-26b "the captured real payload validates with
`validateProvenance` and maps" (AN-26b card). Report the failure, do not weaken a schema.

Known mismatch to check, not to fix: the `combat_fact` payload carries a `player` key beyond the four the listener
builds (`AN-47a.md`, "Deviation"). The AN-47a worknote says the schema forbids it; on `origin/main` the schema now has an
optional `player` (`contract/schemas/combat-fact-event.schema.json:10`, description names AN-46). The worknote text is
stale. Record the real keys, whether `player` is present, and whether `validateCombatFactPayload` accepts it.

Furnace ruling (operator, 2026-11-19, decided): a furnace and a brewing stand are containers, so taking a smelted or
brewed item SENDS a `take`; a crafting table, anvil, enchanting table and the player's own 2x2 view send nothing. A
case that deviates from this is a finding for the AN-51 owner, not a capture failure.

### Where to write each capture

Record in the worknote only; the Body-side cards copy fixtures later (do not create `fixtures/*.json`, such as
`golem/src/perception/provenance/fixtures/pickup-real.json`, which AN-26b owns).

| Worknote | Section to fill | What goes in |
|---|---|---|
| `docs/analysis/harness/worknotes/AN-26a.md` | `## Ops evidence (pending, not run in this packet)` | one `pickup` JSON |
| `docs/analysis/harness/worknotes/AN-27a.md` | the two bullets `- CoreProtect present:` and `- CoreProtect absent:` | one `break` JSON each; replace the word `pending` |
| `docs/analysis/harness/worknotes/AN-47a.md` | below `Ops capture pending:` at the end | the kill `combat_fact` and `engaged`, the survived `combat_fact` |
| `docs/analysis/harness/worknotes/AN-51a.md` | `## Pending (ops evidence, not run)`, both bullets | each take case, and a holder table (chest, double chest, crafting table, furnace, anvil: reports a location? storage type? sent a message?) |

Format for each capture, nothing else:

````markdown
Captured 2026-MM-DD at <commit sha>, shard <name>, case <id>, subject <subject>, validator: ok | <error text>
```json
<the message body, byte for byte, as received; pretty-print is not allowed>
```
````

A case that sends nothing is recorded as `case <id>: no message in <n> s, subscriber active since <time>`.

The capturing agent must NOT edit: the one-line runbook pointer under each pending line, any other worknote text, code,
tests, config, `plugin/core/src/main/resources/config.yml`, `contract/` (schemas and generated code), `shards/*.yaml`,
`compose/**`, `geldar.ps1`, the fixtures of AN-26b, AN-27b, AN-47b and AN-51b, or `docs/spec.md`. A needed code
change is an item in the report.

## Order against the Wave test procedure

The run-shard skill's "Wave test procedure" runs: shard up and health rows, the live lane (about 11 minutes, in the
background), the eventsink integration tests with the stack idle, then the benchmark, each alone. Put the capture pass
after the benchmark, as step 5, and not inside the sequence. Reasons:

- The flag and listeners change what the plugin does. The wave test must measure the default path (flag off), so the
  live lane, `GELDAR_IT` tests and benchmark run first with the flag unset.
- `bench --record` needs a clean committed tree and refuses a dirty one without `--allow-dirty` (body-bench skill, "Before
  you run" and flags). The throwaway script and any flag edit would dirty it or the volume. Do the recorded bench first.
- The live lane, the integration tests, the bench and the capture each assume nothing else is connected. The capture
  bots are extra players, so none may overlap another step.
- The worknote edits come last, on a docs branch, so the tested commit is not changed mid-run.

Order: (1) `shard up phase0 --rcon-host` and health rows; (2) `./geldar.ps1 pnpm --filter @geldar/golem test:live` in
the background, read the output file once; (3) `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink` (add
`--no-file-parallelism` if the two `.it` files collide); (4) `./geldar.ps1 bench`, with `--record` only on the clean
tree; (5) the capture pass (flag on, throwaway script, subscriber); (6) teardown. If only the capture is wanted, skip
2 to 4 but keep the clean tree and the health rows.

## Clean up and tear down

1. Stop the throwaway script. Confirm no bot is online (`list` over RCON, or `shard logs phase0 paper`).
2. Reset the flag: remove the `provenance:` block or set `enabled: false` in the container's config file, wait 10 s.
   `shard down` keeps the volume, so this step matters.
3. Restore world, whitelist and tick rate. The fixture restores the world and removes the whitelist entry in `finally`;
   if a run was killed, `./geldar.ps1 bench --restore` restores 20 TPS and the world (body-bench skill, flags).
   Check `/tick rate` reads 20 over RCON. Remove any leftover capture name from the whitelist.
4. Restore `shards/phase0.yaml`: `git diff shards/phase0.yaml` must be empty (run-shard skill: `adam select` rewrites
   it). This runbook never runs `adam select`; check anyway. `git status` must be clean.
5. `./geldar.ps1 shard down phase0` (volumes kept). Delete the volume only with the owner's word (run-shard skill).
   With the `bench/sheet/run.sh` overlay, its `down` removes the scratch volumes.
6. Do not copy `compose/secrets/` anywhere; none of it goes in a worknote.

## This machine: Docker runs in WSL

The shard must run from a clone inside WSL. Check these first. Nothing below was run for this runbook; each is
unproven on this machine.

| Check | Why | Evidence |
|---|---|---|
| Clone on the WSL filesystem, not under the Windows mount | bind mounts and file modes; the FX-SECRETS test ran on an ext filesystem home directory | `docs/analysis/phase1/worknotes/FX-SECRETS.md:36,49` |
| Docker is the WSL daemon and `docker compose version` is at least 2.24.4 | the scratch overlay needs the `!override` tag | `deploy/scratch/scratch.sh:23`; `bench/sheet/phase0-sheet.yml` uses it |
| Jars exist at `plugin/core/build/libs/geldar-core.jar` and `plugin/velocity-identity/build/libs/geldar-velocity-identity.jar` inside the WSL clone | `phase0.yml:91` mounts `../plugin/core/build/libs/geldar-core.jar`; a missing source becomes a directory (`geldar.ps1:194-205`) | build with a JDK in WSL (unproven: JDK and Gradle there), or copy the two binary jars from a Windows build (`.gitattributes` marks `*.jar` binary) |
| No CRLF in anything Docker reads | `.gitattributes` forces LF on checkout (`* text=auto eol=lf`); a copy from a Windows checkout can break `compose/paper/paper-entrypoint.sh` | `git ls-files --eol compose` shows `w/lf` for each file |
| `pwsh` 7 and Node 22 (`.nvmrc`) installed in WSL | `./geldar.ps1` and the Golem live lane run there | FX-SECRETS ran pwsh 7.6 in WSL; `shard up` itself was not run there |
| Secrets generated inside the WSL clone | modes 700 and 600 are asserted on Linux | `FX-SECRETS.md:36-37` |
| Host ports free: 4222, 8222, 5432, 25565 (and 25575 with `--rcon-host`), 7410 | a Windows-side or other-WSL stack may hold them; `adam up` holds 7410 | `compose/phase0.yml:26,44-45,121` |
| Golem, the subscriber and RCON clients run in the same WSL distro as the stack | published ports are on `127.0.0.1` inside WSL; Windows forwarding to them is unproven here. Golem accepts only `127.0.0.1` or `localhost` as host (run-shard skill) | do not run the live lane from Windows against a WSL stack until a probe passes |
| Ollama row skipped | Ollama runs on the host (`docs/decisions/0002`); the capture needs no model | run-shard skill |

If any row fails, stop and report; do not work around it by touching the live stack.

## Design notes for the card owners

The earlier per-card analysis of AN-28b and AN-28c (default-path cost, NATS role, benchmark need) was removed from this
runbook: AN-28c and AN-50a are merged on `origin/main` (cef94f25), so it no longer describes the code. Benchmark timing is
the wave owner's decision.

## Failure modes

| Symptom | Cause | Action |
|---|---|---|
| No message for any case | flag unset, listener unregistered (see "Merged state" and the flag steps), subscriber started late | stop; check the gap list; restart the subscriber first |
| Combat or take silent, others fine | bot name is not a life id | rename the bot |
| `prior_owner` always null | CoreProtect absent, or the chunk base is older than 30 s | expected without CoreProtect; see the break case |
| Bot denied at join | not registered in the life registry (`GELDAR_NATS_URL` unset) | set it; read the Velocity log row |
| Run killed | tick rate or whitelist left changed | `bench --restore`, then the cleanup steps |
