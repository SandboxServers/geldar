---
title: "Capture the owed real provenance payloads"
type: how-to
audience: agents-never
status: draft
last_verified: 2026-11-19 against 7efad8ca
companions: [README.md, block-owner.md, scratch-stack.md, ../analysis/harness/test-package-design.md, ../analysis/harness/worknotes/AN-26a.md, ../analysis/harness/worknotes/AN-27a.md, ../analysis/harness/worknotes/AN-47a.md, ../analysis/harness/worknotes/AN-51a.md]
sources: [../../.claude/skills/run-shard/SKILL.md, ../../.claude/skills/body-bench/SKILL.md, ../../plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java, ../../plugin/core/src/main/java/dev/geldar/core/GeldarCore.java, ../../geldar.ps1, ../../bench/sheet/run.sh]
---

# Capture the owed real provenance payloads

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

## Read this first: the capture cannot run on `main` today

Checked 2026-11-19 on `origin/main` at `7efad8ca`. This is a gap, not a procedure step.

1. **No flag exists in code.** `grep -rn "provenance\.enabled" plugin geldar.ps1 compose shards` finds nothing. The
   only default named anywhere is in a card: AN-28c adds `c.getBoolean("provenance.enabled", false)`
   (`docs/analysis/harness/work-packets-sheet-w3-w5.md`, AN-28c step 1, line 447 at this commit). Setting a key by hand
   today changes nothing. `plugin/core/src/main/resources/config.yml` has no `provenance:` block, and AN-28c must not
   add one (its must-not-edit list).
2. **Break and pickup listeners are not wired to a sink.** `BlockOwnerSetup.java:83-84` registers
   `new BlockChangeListener(cache, publisher, () -> setup.enabled)`. That is the three-argument constructor
   (`BlockChangeListener.java:40`), which passes `sink = null` and `() -> false`
   (`BlockChangeListener.java:41`), so `onBreak` never reaches `sendBreakProvenance` (guard at
   `BlockChangeListener.java:62`). `PickupProvenanceListener` is constructed nowhere in `plugin/core/src/main`
   (`grep -rn "new PickupProvenanceListener" plugin/core/src/main` is empty). Both belong to AN-28c.
3. **Combat and take listeners are not registered.** `CombatFactListener` and `ContainerTakeListener` are constructed
   nowhere in `plugin/core/src/main`. `GeldarCore.java:200-205` builds the listener list with the exporter,
   `RecipeGrantListener`, `CommandBlockListener` and `GhostListener` only. The AN-47a worknote says "Nothing registers
   the listener" and the AN-51a worknote says "registration is AN-50a". The card for it,
   `work-packets-sheet-w6-w8.md` AN-50a, also schedules `CombatFactListener.tick()` each tick.
4. **Order conflict.** `docs/analysis/harness/sheet-next-wave-order.md:120` says AN-26b and AN-27b run "once ... the
   payload captures exist", then AN-28b and AN-28c "serial and last". But the captures need AN-28c (break, pickup) and
   AN-50a (combat, take) merged first. Both orders cannot hold. The orchestrator must choose: (a) run the capture
   after AN-28c and AN-50a and let AN-26b, AN-27b, AN-47b and AN-51b wait for it, or (b) have a `packet-coder` make a
   throwaway, never-merged registration branch (this runbook does not name or write it; an `ops` agent cannot).
   Do not invent a flag or a registration to get around this. If neither (a) nor (b) is decided, stop with
   `blocked: listeners unregistered` and report which of the four are missing.

Everything below assumes a plugin jar that has AN-28c and AN-50a (or the throwaway branch of option b) built into it.

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
   NATS (`scratch.sh:7-9`), and under the auth overlay no role may subscribe to `provenance.*` (see "Capture raw
   NATS payloads"), so it does not suit this capture.

## Set the flag on the scratch shard

Only after the gap above is closed. The key `provenance.enabled` (AN-28c, default false) lives in the plugin's
`config.yml`. `saveDefaultConfig()` (`GeldarCore.java:93`) writes it into the plugin data directory in the Paper
volume (`compose/phase0.yml:88`, `paper-data:/data`); with `plugin.yml` name `GeldarCore` that path is
`/data/plugins/GeldarCore/config.yml` inside the Paper container. Unproven: I did not read a running container.

1. Add, by hand, in that file in the container, a top-level block `provenance:` with `enabled: true`. This is
   operator test setup on a scratch volume, not a repo change. Do not edit `plugin/core/src/main/resources/config.yml`
   (its hash is in `jar-contents.golden`, per the AN-26a card).
2. The plugin re-reads the config every 100 ticks, about 5 s at 20 TPS (`GeldarCore.java:167-171`:
   `reloadConfig()` then `owners.reload(getConfig())`). AN-28c's `reload` sets the flag from it. Wait 10 s, then
   confirm with the first capture, not with a log line (no log line is promised by the card).
3. The combat and take listeners share the same value as their `enabled` supplier (AN-50a card, may-edit list in
   `work-packets-sheet-w6-w8.md`). Verify that sentence against the merged code before relying on it.
4. `shard down phase0` keeps volumes (run-shard skill, "Stop"), so a hand-set flag survives a restart. Reset it in
   teardown.

CoreProtect: `compose/phase0.yml` mounts no CoreProtect jar; only `compose/colo.yml:148` does. So on phase0 CoreProtect
is absent, `sourceFor` answers "unavailable" (`BlockOwnerSetup.java:100-102`) and every `prior_owner` is null. The
"present" case needs an overlay that mounts the pinned jar (`plugins/coreprotect/coreprotect.lock.json`, version 24.1,
size and hashes in the lock) at `/plugins/coreprotect.jar` read-only. No such overlay exists in the repo: this is a
gap, not a flag. Writing it is a `packet-coder` or operator job. See also [coreprotect.md](coreprotect.md).

## Run two bots

Bot names matter. `CombatFactListener` and `ContainerTakeListener` ignore any name that fails `EventEnvelope.isLifeId`
(`CombatFactListener.java:125,133,146,153`; `ContainerTakeListener.java:86`). The pattern is
`^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$` (`EventEnvelope.java:27`). Existing live cases use names such as `GolemCombat`
and `GolemChest`, which fail it, so reusing them yields no combat or take message. Name the capture bots like
`ag_capa_01` and `ag_capb_01`, as `chatter-bot.ts:18` does with `ag_chatter_01`. The `give` action's `to` pattern
`^[A-Za-z0-9_]{3,16}$` (`contract/schemas/thought.schema.json:211`) accepts them.

| Case | Existing fixture that gives it | Gap |
|---|---|---|
| Toss (AN-26a) | none in the live lane. `golem/src/actions/give.ts` is the Body action; only unit tests (`give*.test.ts`) call it | NEW throwaway script: bot A gets items by `ctl.give`, runs `{do:'give', to, item, count}`, bot B picks up |
| Break (AN-27a) | `golem/test/live/mine.live.test.ts:33-50` breaks logs with `{do:'mine'}` | needs a life-id name and, for non-null `prior_owner`, a warm owner cache (see below) |
| Kill (AN-47a) | `golem/test/live/reflex-combat.live.test.ts:190-205` kills a summoned zombie through the registry (`summonZombie`, line 20) | name is `GolemCombat`; needs a life-id name |
| Survived fight (AN-47a) | `reflex-combat.live.test.ts:122-150` (unarmed bot flees) is the closest | the fact closes after more than 200 quiet ticks (`AN-47a.md` tick rule); script must wait that long |
| Chest take (AN-51a) | `golem/test/live/container.live.test.ts:93-118` withdraws through `{do:'withdraw'}` | life-id name; one withdraw is not a shift-click or number-key swap |
| Double chest, shift-click, number-key swap, crafting table, anvil, enchanting table, 2x2 view (send nothing), furnace and brewing stand (send a take) | none | NEW script using `bot.clickWindow(slot, mouseButton, mode)` (shift-click mode 1, number-key mode 2) |

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

### The new throwaway script

Propose `golem/test/live/scratch/provenance-capture.ts` (not `*.live.test.ts`, so the live lane
`golem/vitest.live.config.ts:7`, `include: ['test/live/**/*.live.test.ts']`, does not pick it up). Run it with
`node --experimental-strip-types` (the pattern in `golem/src/bench/sheet/cli.ts:3-5`). It would nest two
`withLiveBot` calls with distinct slots, run the cases in the table, and also subscribe (see next section) and write each
message to a file. Do not write it in this job. Keep it untracked, or commit it only through a reviewed packet:
`pnpm check:repo` and the 500-line soft cap apply to anything committed. No existing live case runs two bots at
once; `golem/test/live/chatter-bot.ts` is the nearest precedent (a scripted second life next to a case).

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
`Get-NatsUsers` (`geldar.ps1:391-424`) gives no role `Sub` on `provenance`: `body` hears `body.>`, `blockowner.changed`,
`state.*.level` (line 407); `mind`, `eventsink`, `mcp` hear only the inbox. AN-28c would give `body` alone the
subscription. Do not widen any role for the capture: capture on the open default shard.

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
| `docs/analysis/harness/worknotes/AN-26a.md` | `## Ops evidence (pending, not run in this packet)` | one `pickup` JSON, plus a negative: the thrower picking up its own item sends nothing |
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

## Do AN-28b and AN-28c change the default path? Is a per-card benchmark needed?

AN-28b and AN-28c are not on `main` (`golem/src/adam/adam-body.ts` has no `observations`;
`golem/src/perception/provenance/` holds only `container-take.ts` and `visible-actor.ts` plus tests; `BlockOwnerSetup`
is as quoted above). The statements below combine the cards (`work-packets-sheet-w3-w5.md` lines 424-457) with the
current code. Anything about the final diff is unverified until the PR exists.

- **AN-28b** (`adam-body.ts`: one option and one block). The card says: absent or false `observations`, "the code path
  is byte-for-byte today's (three-argument `watchHurts`, no subscription)", and nothing sets it in W5. Current code:
  `watchHurts(bot, hurts, tick)` at `adam-body.ts:340`, the block-owner transport only when `env.owners` is defined
  (`adam-body.ts:121-125`). So with the option unset the Body runs exactly today's code, provided the diff keeps
  the new block behind `env.observations === true && env.owners`. Verify in review that no line outside that block moves
  and that the "observations off" spy test exists. `startAdamBody` is called by `golem/src/adam/main.ts:248` and
  `golem/src/players/body-host.ts:46`; the card says player Bodies do not use it, which `body-host.ts` contradicts:
  flagged. The benchmark harness imports no `adam-body` (`golem/src/bench/runner.ts` imports, lines 1-20): it runs
  actions through the registry, so AN-28b cannot change a benchmark number.
- **AN-28c plugin part.** The default path does change in code, harmlessly if written as carded: `BlockOwnerSetup`
  would register `BlockChangeListener` with the six-argument constructor and add a `PickupProvenanceListener`. With the
  flag unset (code default false) nothing is sent: `onBreak` short-circuits on `provenanceEnabled` before any read
  (`BlockChangeListener.java:62`) and then runs the unchanged `record` (line 70), and `onPickup` returns on its first
  line (`PickupProvenanceListener.java:45-47`). What is added is one boolean read per break and one extra listener
  dispatch per pickup event. That is a cost on the server thread, not a behaviour change; its size is unmeasured.
- **AN-28c NATS role part** (`geldar.ps1`, the `body` entry of `Get-NatsUsers`: `provenance.>` added to `Sub` and
  `PubDeny`; today lines 403 and 407). It only matters where the auth overlay is used (`compose/nats-auth.yml`, opt-in;
  the default `compose/phase0.yml` NATS is open, `phase0.yml:39`). Where it is used, it changes the permissions of every
  `body` connection, so a bad entry would break the generated conf for every user: that is what the extended
  `nats-auth.test.ts` and `nats-auth.it.test.ts` prove. Today no Body publishes or subscribes on `provenance.*` (no
  such publish in `golem/src`), and the plugin's `paper` role already may publish `geldar.<shard>.>`
  (`geldar.ps1:424`), so no existing behaviour is denied. The card says the live node's conf is changed by hand by the
  operator, and nothing is switched on there. Unverified until the diff exists.
- **Benchmark.** The run-shard skill says to run the benchmark "once per wave, after the wave branch is merged and
  checked", at step 4 of the Wave test procedure. The body-bench skill's own trigger is "after any change to golem/
  actions or reflexes"; AN-28b touches `golem/src/adam`, not actions or reflexes. So neither card needs its own
  benchmark: run it once at the wave's end with the flag off. The AN-28c card itself says "the 20 TPS bench" at W5
  close. The one residual risk is the per-event plugin cost above; the end-of-wave 20 TPS gate (body-bench skill, "Gate")
  covers it.

## Failure modes

| Symptom | Cause | Action |
|---|---|---|
| No message for any case | flag unset, listener unregistered (gap above), subscriber started late | stop; check the gap list; restart the subscriber first |
| Combat or take silent, others fine | bot name is not a life id | rename the bot |
| `prior_owner` always null | CoreProtect absent, or the chunk base is older than 30 s | expected without CoreProtect; see the break case |
| Bot denied at join | not registered in the life registry (`GELDAR_NATS_URL` unset) | set it; read the Velocity log row |
| Run killed | tick rate or whitelist left changed | `bench --restore`, then the cleanup steps |
