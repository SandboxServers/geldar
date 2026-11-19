# Sheet cards W3 to W12: verification against current code (2026-11-18)

Scope: every card in [work-packets-sheet-w3-w5.md](work-packets-sheet-w3-w5.md), [work-packets-sheet-w6-w8.md](work-packets-sheet-w6-w8.md) and [work-packets-sheet-w9-w12.md](work-packets-sheet-w9-w12.md), after the corrections in [worknotes/cards-w3-w12-corrections.md](worknotes/cards-w3-w12-corrections.md). Read-only check; no card file is changed by this note. The dispatch order is in [sheet-next-wave-order.md](sheet-next-wave-order.md).

Checked against:

- geldar `origin/main` = `a8063b0a` (W0 to W2 merged: AN-11a #480, AN-11c #487, AN-12a #493, AN-12b #492, GX-06 #504, AN-09c #509, GX-08 #526, nats-auth split #534).
- kit `geldar-scriptorium`: `origin/main` = `44b9aee` and `origin/scriptorium/hw0` = `673d756` (HC-04 to HC-11, HC-17a, HC-17b and HC-18 merged there). Read with `git -C`; nothing changed.

Verdicts: **READY** (a Haiku coder can follow the card once the global fixes G1 to G13 are written into its dispatch brief), **FIX-NEEDED** (the card names a file, symbol, number or shape that is wrong, or a step that is not literal enough; the fix is listed), **BLOCKED** (an unmerged dependency, an external campaign or an owner decision stops it; the reason is listed). "Code now" says whether the card can be written in a worktree today with its merge held.

## 1. Number and state facts (current main)

| Item | Card files say | Actual on `origin/main` `a8063b0a` |
|---|---|---|
| Highest SQL migration | (not stated) | `0066_events_trace_id.sql`. Sheet block: 0050, 0051, 0052 used; **0053 to 0059 free**. geldar-3b block: 0060 to 0063, 0065, 0066 used; 0064 free. No remote branch holds a 0053 to 0059 file. |
| Highest decision | (not stated) | `0388`. Sheet block: 0280, 0281, 0282 used; **0283 to 0289 free; 0320 to 0329 free** (checked on main and every `origin/*` branch). 0262 (registration erasure ruling) is on main. |
| 0052 / PR #455 | "queued" (W9 S9-00, number table) | merged: `sql/0052_character_erase_comments.sql`, `docs/decisions/0282-sheet-erasure-covers-dead-lives.md` |
| psyche | "pinned by tag psyche-v1.0.0" | `psyche/package.json` 1.1.0 (`threat.ts` from AN-08a); only tag `psyche-v1.0.0` exists. Kit `packages/psyche/MIRROR.json` pins `psyche-v1.0.0`, tree `b89848ab...`; the kit mirror has no `threat.ts`. `ENGINE_VERSION` 1. |
| `contract/src/index.ts` | 534 or 535 lines | **557 lines** (soft cap 500, hard 700). Style: named exports plus one `export * from './mcp.ts'`. |
| `golem/src/adam/adam-body.ts` | about 293 (W5) or 311 (W9) lines | **413 lines**; `adam-body.test.ts` is **624 lines** (over the soft cap) |
| `golem/src/actions/mine.ts` | 405 | 414 (`container.ts` 365, as stated) |
| `tools/repo-checks/src/nats-auth.test.ts` | 544, to split | 154 (split by #534) |
| `prompts/body-api/` | at v9, new file v10 | **v1 to v10 exist**; v10 is released (commit `319d5be0`). The next file is **v11**. |
| `animus/` live files | W5 AN-28a edits `animus/src/link/mind-event.ts`, `animus/src/ports/body.ts`, `link.fixtures.ts` under OD-D | GX-04 landed: each is a 2-line deprecated `export *` stub. Live code is `player-core/src/link/mind-event.ts`, `player-core/src/ports/body.ts`, `player-core/src/link/link.fixtures.ts`. OD-D is moot. |
| XP award code (S-AWARD) | `eventsink/src/awards/<x>.ts`, `type AwardUnit = { lifeId, domain, evidenceKey, tick }`, registered in `eventsink/src/writer.ts` | No `eventsink/src/awards/`. Real: `eventsink/src/xp/awards.ts` `awardsFor(event: WorldEvent): XpAward[]` with `XpAward { lifeId, domain, evidenceKey, sourceEventId, worldTick }`; one `switch (event.type)` in `awardsOf`; `writer.ts:107` calls `awardsFor`. New sources are new `case` arms or helpers called from that switch. |
| Existing combat XP | (not mentioned) | `actionAwards` `case 'attack'`: a completed attack with `detail.killed === true && target_kind === 'mob'` awards `combat` key `kill:<action_id>`. AN-47b's `combat:enc:<encounter_key>` would award the same kill a second time. |
| Plugin block-owner classes | `plugin/core/src/main/java/dev/geldar/core/blockowner/{NatsBlockOwnerLink,OwnerCache,BlockOwnerPublisher}.java`, test `OwnerOverlayTest` beside them | Those three and `OwnerOverlayTest` are in **`plugin/core-common/`** (same package). `BlockChangeListener.java`, `BlockOwnerSetup.java` are in `plugin/core/`. `EventSchemaCheck.java` is a core-common **testFixtures** class. `ListenerDoubles.java` is `plugin/core/src/test/java/dev/geldar/core/`. |
| CI psql line | "one `-f sql/test/<file>` line each" | `.github/workflows/ci.yml` has **one** `psql ... -f a.sql -f b.sql ...` command ending `-f sql/test/check-schema-body-host.sql`; a card appends ` -f sql/test/<new>.sql` to that command, it does not add a line. |
| Kit wave branches | `scriptorium/hw2` (W3, W4), `scriptorium/hw4` (W6) | Neither exists. Only `origin/main` and `origin/scriptorium/hw0`. |
| Geldar wave branches | `phase1/sheet-w5`, `-w7`, `-w8`, `-w<N>` | None exists yet. |
| `GX-08` non-advancing wait | "must land before GELDAR_INSTINCT is enabled" (RESUME) | merged (#526). The kit `packages/instinct/README.md` still says the world has no non-advancing read; kit-side use of it is not wired. |

## 2. The kit cards W3 and W4 are written against shapes the merged HC-18 does not have

HC-18 merged on `scriptorium/hw0` (`4ab4493`) following the kit's own card file `docs/analysis/harness/work-packets-kit-b.md` (in the kit repo), not the "common shapes" block of `work-packets-sheet-w3-w5.md`. Every W3, W4 and W6 kit card in this repo that codes against that block is therefore wrong at the import line. The kit repo's `work-packets-kit-b.md` HC-19 to HC-26c cards **do** use the merged names (`runInstinct`, `GELDAR_INSTINCT_*`, `run --run <n>`, `InstinctResult`).

| Sheet-file claim (W3 to W6) | Merged HC-18 (`packages/instinct/src/`, hw0) |
|---|---|
| package `@geldar/instinct`, bin `geldar-instinct` | `@geldar/scriptorium-instinct`; `geldar-instinct` verbs `run --run <n>` and `check-sheet <path>` (`cli.ts`) |
| files `types.ts`, `store.ts`, `problem-key.ts`, `step.ts`, `config.ts`, `wake-map.ts`, `registry.ts` | files `audit.ts`, `cli.ts`, `contract.ts`, `decide.ts`, `facts.ts`, `index.ts`, `observe.ts`, `run.ts`, `state.ts`, `world.ts`. None of the seven named files exists. |
| `interface Fx { name; policy; applies(ctx); run(ctx) }` | `type Fx = (ctx: FxContext) => FxResult` (`decide.ts`) |
| `FxResult` = `pass` / `act {act, note: DecisionNote}` / `escalate {effort, tag, note}` | `pass` / `act {fx, why, act: ActRecord}` / `facts {fx, facts, stop?}` / `escalate {fx, reason: PassReason}` |
| `FxContext { lifeId, generation, tick, cycle, wake, snapshot, goal, sheet, sheetStandard, proficiency, proficiencyDegraded, config, store, draw(fx) -> {key, rng} }` | `FxContext { obs: Observation, sheet: Sheet, state: InstinctState, cfg: InstinctConfig, lifeKey, tick, goal, knownText, check(fx, score, dc, prof?), draw(fx): number, rolls }`. No `proficiency` map, no `wake`, no `store`. |
| `InstinctStore` with `bumpAttempts(key, observationId)`, `remembered(kind)`, `habit(goal)`; `openStore(dir, lifeId)` | `InstinctState` plain object (`waking, picks_in_a_row, attempts, tried, seen, last_intent, habits, pending_acts, cursor`); `loadState`, `saveState`, `emptyState` (`state.ts`). No remembered places, blocks or agents. |
| `runStep(ctx, registry, world)`, `StepResult {v, outcome: handled/escalated/refused/passed, ...}` | `decide(ctx, fxs)` and `runInstinct(env, runNo, ...)`; `InstinctResult` = `settle` / `pass-with-facts` / `pass {reason, forced}` (`contract.ts`) |
| `InstinctConfig` from `--config <file>` (`enabled, rolls, idle_requires_goal, max_heuristic_picks, ...`) | `readConfig(env)` from `GELDAR_INSTINCT_ARM`, `_FAILURE_CAP`, `_MAX_PICKS`, `_THINK_P`, `_ROLLS` (`run.ts`); `{arm, failureCap, maxPicks, thinkP, rolls}` |
| `SnapshotView` with block, structure and agent coordinates | `Observation` (`observe.ts`): `agents: {name, distance}[]`, `notable: {kind, distance}[]`, no coordinates, no block or structure list, no recipes |
| fx registry `defaultRegistry` in `registry.ts` (HC-24) | `DEFAULT_FXS: readonly Fx[] = []` in `run.ts` |
| W6 S-INSTINCT: `InstinctContext {stateDir, observer, socialProficiency, nearby, events, ...}`, `appendLedger`, `IdleCandidate`, `WorldLink.programs()` | none exists; the audit writer is `appendAudit`/`buildAuditLine`; `WorldLink` has only `call` and `close` |
| psyche type `CharacterSheet` | the kit's own parsed type is `Sheet` (`packages/psyche/src/sheet.ts`); `CharacterSheet` is also exported as a type |

Two more kit facts: `packages/mind-loop` with HC-10 (`tokens.ts`) and HC-11 (`validate.ts`, one corrective retry in `loop.ts`) is merged on hw0, so HC-23a is no longer blocked by them; and the kit worknote folder in use is `docs/analysis/harness/worknotes/` (HC-17a, HC-17b), not `docs/analysis/scriptorium/worknotes/`.

Note for whoever adopts the kit-b cards instead: kit-b HC-20 reads proficiency from `sheet.proficiency`, but the kit's `parseSheet` refuses a `proficiency` key (corrections worknote) and OD-C says levels come from the world state. That card needs the same correction before dispatch.

## 3. Global fixes (write into every dispatch brief)

| # | Applies to | Fix |
|---|---|---|
| G1 | all kit cards | Base branch is `scriptorium/hw0` (or a wave branch the orchestrator creates from it); `scriptorium/hw2` and `scriptorium/hw4` do not exist. `git merge-tree --write-tree <base> HEAD` uses that base. |
| G2 | all three card files | The kit checkout path is written as a local user-profile path that is wrong on this machine and names an account (repo rule: no account names). Give the absolute worktree path in the dispatch; refer to the repo only as the sibling `geldar-scriptorium` checkout. Scrub the path from the card files in the next card edit. |
| G3 | kit cards | Worknote `docs/analysis/harness/worknotes/HC-<nn>.md` in the kit repo. |
| G4 | W5 cards | Worknote `docs/analysis/harness/worknotes/AN-<nn>.md` (the W6 to W12 convention); `docs/analysis/character-sheet/worknotes/` does not exist. |
| G5 | all geldar cards | Wave branches do not exist; the orchestrator creates `phase1/sheet-w<N>` from `origin/main` before dispatch and names it in the brief. |
| G6 | every card with `<allocate via registry>` or a fixed decision number | 0283 to 0289 and 0320 to 0329 are free. W9 to W12 pre-assign 0283 to 0288; W3 to W8 need six more ADRs (HC-23a, HC-24, HC-25 in the kit if the kit records geldar-numbered ADRs, AN-24, AN-44, AN-46). Allocate in dispatch order from one list (proposal in the wave-order note). |
| G7 | SQL cards | 0053 free and unused by any card; 0054 to 0057 as W9 to W12 say; 0058, 0059 spare. |
| G8 | contract cards | `contract/src/index.ts` is 557 lines: new code goes in a new `contract/src/<topic>.ts`, `index.ts` gets named export lines only (match the file's style; W6 to W8 say "one `export *` line", use named exports). Regeneration is serial (order in the wave note). |
| G9 | cards editing `adam-body.ts` | 413 lines now. New adam-body tests go in a new `golem/src/adam/adam-body-<topic>.test.ts`, not in the 624-line `adam-body.test.ts`. |
| G10 | `docs/analysis/sheet/RESUME.md` | Stale: AN-11a, AN-11c, AN-12a, AN-12b, GX-08 and the nats-auth split are merged; 0262 is on main. Update before the next dispatch. |
| G11 | `ledger.md` | Generated from the older geldar-c and kit-c files: it lists AN-33 to AN-60 and HC-27 to HC-39 ids from those files and none of S9-00 to S12-07, HC-41 to HC-45, nor the sheet-file versions of AN-24 to AN-51b. Regenerate from the sheet files or mark the old rows superseded. |
| G12 | W6 to W8 kit cards | `CK-1` to `CK-4`, `CK-T`, `CK-M` and "kit rules R1 to R12" are defined only in the kit's `work-packets-kit-c.md`. Paste the commands into each brief: CK-1 `./scriptorium.ps1 pnpm vitest run <files>`, CK-T `./scriptorium.ps1 pnpm check:template`, CK-M `./scriptorium.ps1 pnpm lint:md`, plus `format`, `lint`, `typecheck`, `check:repo`. |
| G13 | any kit card that needs `decideThreat`, `fightFloor`, `fightLimitMs` or a later psyche export | The kit mirror is at psyche 1.0.0. A tag `psyche-v1.1.0` (owner approval) and a kit re-mirror card come first. |

## 4. Mismatch table (card-specific)

| Card | Claim in the card | Actual |
|---|---|---|
| HC-18 | to be written (W3) | merged on hw0 with different files and shapes (section 2). Card is history. |
| HC-19 | `runInstinctStep(opts)`, `instinct-step.ts`, child gets `--state-dir`/`--config` args, `StepResult.outcome === 'handled'` | real verb `run --run <n>`, env-var config, `InstinctResult.kind === 'settle'`; kit-b HC-19 is the matching card (`execSelf`, `instinctEnv`, `last.json`) |
| HC-20 | `failureFx: Fx` object with `applies`; `problemKey` from `store`; `wake.failed.observationId`; `roll(...draw('insight').rng...)` | `Fx` is a function; no `problemKey`, no `observationId`, failure seen as `obs.events` kinds `intent_failed`/`action_failed`; use `ctx.check('insight', score, dc, prof)`; `remembered('place')` does not exist |
| HC-21a | `wake.reason`, `store.consecutivePicks()`, `snapshot.unlockedRecipes`, `store.remembered('block')` | `state.picks_in_a_row`; no recipe list or seen-block list in `Observation` |
| HC-21b | `wake.completed.source`, `store.setHabit` | `state.habits` (list per goal, max 5); `obs.events` `intent_finished` has no source field |
| HC-22 | Euclidean radius over snapshot coordinates; `store.remember` | `Observation` has distances only, no coordinates; no remembered set beyond `state.seen` (sighting keys) |
| HC-23a | BlockedDependency on HC-10, HC-11; loop file "to confirm" | both merged on hw0; the loop is `packages/mind-loop/src/loop.ts` |
| HC-23b | spawn file "to confirm" | depends on HC-19's real spawn path (`deps.ts` `execSelf` in kit-b) |
| HC-24 | `registry.ts`, `index.ts` barrel, `defaultRegistry` | registration point is `DEFAULT_FXS` in `run.ts`; `index.ts` already exists (HC-18 owns its current form) |
| HC-25 | imports `temperamentFor`/`TEMPERAMENT_BANK` | not exported by the kit (stated in the card); still blocked on OD-A route; identity cap value "to confirm" |
| HC-26a | `messages.d/sheet.*`, `launcher/test/sheet.*` | messages live in `launcher/messages.d/NN-<group>.tsv` (`00-core.tsv` ... `55-commands.tsv`): name a new `5x-sheet.tsv` |
| HC-26b | `packages/instinct/src/check-sheet.ts` stub; compose "to confirm" | `check-sheet` is already a verb in `cli.ts`; compose is `image/compose/player.yml` |
| HC-26c | `readSheetFile` returns `CharacterSheet`, inject a `SheetSource` into `instinct-step.ts` | `run.ts` reads `sheet.json` itself with `parseSheet` (type `Sheet`); there is no `SheetSource` seam |
| AN-24 | `index.ts` about 535 lines; worknote in `character-sheet/worknotes` | 557 lines (G8); worknote G4. Schema refs `WorldName`, `BlockCoordinateXZ`, `BlockCoordinateY`, `OwnerId` exist in `block-owner.schema.json`; `LifeId` in `common.schema.json`; `contract/test/agent-visible-text.test.ts`, `px-perception.test.ts`, `mcp-play.test.ts` exist. |
| AN-25 | `lifeIdFor` "to confirm" | `lifeIdFor(username)` is `golem/src/registry.ts:51`; `findVisibleAgent(bot, name)` `golem/src/perception/visible-agent.ts:112`; `watchHurts(bot, reporter, tick)` has three parameters as stated |
| AN-26a | test "built like `OwnerOverlayTest`" beside it in `plugin/core/.../blockowner/` | `OwnerOverlayTest` is in `plugin/core-common`; `Item#getThrower()` and UUID-to-name are "to confirm" (Paper API, not a coder task) |
| AN-26b | `PICKUP_WAIT_MS`, `GIVE_REACH` | both exported from `golem/src/actions/give.ts` (5000 ms, 3) as stated |
| AN-27a | `ProvenanceSink.java` and `NatsBlockOwnerLink.java` under `plugin/.../blockowner/`; test with `:core:test` | `NatsBlockOwnerLink.java` is in `plugin/core-common/src/main/java/dev/geldar/core/blockowner/`, so `ProvenanceSink` must go in core-common too (core depends on it); link tests run with `(cd plugin; ./gradlew :core-common:test --tests '...')`; the listener test stays `:core:test` |
| AN-28a | edits three `animus/` files under OD-D | edit `player-core/src/link/mind-event.ts`, `player-core/src/ports/body.ts`, `player-core/src/link/link.fixtures.ts`; never the stubs; test path `player-core/src/link` instead of `animus/src/link` |
| AN-28b | `adam-body.ts` about 293 lines; `nats-auth.test.ts` large | 413 and 154 (G9). `Get-NatsUsers` in `geldar.ps1` has `body` `Sub`/`PubDeny` as named. `threshold/mcp/src/events/leakage.test.ts` does not exist (new file, as the card says). |
| HC-27b | `RawEvent` with ids; `nearby: {id, name}[]`; position samples | `Observation.agents` has `name` and `distance` only: no id, no position, so `positionObservations` cannot be computed and id resolution has no input |
| HC-28a | `successProbability(score, dc, prof)` | exported by `@geldar/scriptorium-psyche` (`check.ts`) as stated |
| HC-30a | `step.ts`, `config.ts`, `rngFor(lifeId, tick, 'stranger', 0)`, `InstinctContext` | no `step.ts`/`config.ts`; `rngFor` takes one `DrawKey`; use `ctx.check`/`ctx.draw`; config is `readConfig(env)` |
| HC-31 | `IdleCandidate`, `WorldLink.programs()`, edit `packages/instinct/src/idle.ts` | none exists; `idle.ts` would be HC-21a's file (`fx/idle.ts` in both card sets) |
| AN-39 | test helpers `newWorld`, `contextFor`, `drive`, `expectResumeEverywhere` in `programs.fakes.ts`; `ctx.view.nearbyHostiles` | all exist (`ProgramContext.view` is a `BodyView`) |
| AN-40 | `CROP_MAX_AGE`, `SEED_CROPS`, `FOOD_RANGE`, `canSeeBlock`, `ownerRecordAt`, `isOwnPlacement` (no paths) | `golem/src/perception/surroundings/food-known.ts` (`CROP_MAX_AGE`, `FOOD_RANGE`), `golem/src/actions/place.ts` (`SEED_CROPS`), `golem/src/perception/notable-blocks.ts` (`canSeeBlock`), `golem/src/actions/protected-blocks.ts` (`ownerRecordAt`), `golem/src/actions/own-placements.ts` (`isOwnPlacement`) |
| AN-44 | `INTENT_WHY` entries | `INTENT_WHY` is a non-exported `const` in `contract/src/outcome-words.ts:36` read by `intentWhy()`; edit it there |
| AN-45 | new `prompts/body-api/v10.json` (= v9 plus programs); sha pin v1 to v9; "no `DEFAULT_BODY_API_VERSION` change" | v10 exists: the new file is **v11** = v10 plus three programs; pin v1 to v10; no symbol `DEFAULT_BODY_API_VERSION` exists (the version is `bodyApiVersion` in `player-core/src/ports/prompts.ts` and the shard config): the default-unchanged test must name the real source; `ArgSpec` has kinds `int`, `name`, `player`, `blueprint`, `target` (adds `bool`, `route` as stated); W2's chunk tracker is `golem/src/body/evidence/chunk-visits.ts` `watchChunkVisits` with no reader, so the `setVisitedChunks` pair is BlockedDependency as the card allows |
| AN-46 | conditional SQL if `evidence_kind` has a CHECK | `xp_evidence` (0050) has no `evidence_kind` column: `domain` CHECK already lists `combat` and `social`, `evidence_key` CHECK is length 1 to 200; no SQL needed |
| AN-47a | validate with `EventSchemaCheck`; `getKiller` "to confirm" | `EventSchemaCheck` is a core-common testFixture (check that `plugin/core` test config uses `testFixtures(project(":core-common"))`); `EventExporter.emit(String type, String playerName, JsonObject payload)` exists |
| AN-47b | `eventsink/src/awards/combat.ts`, `AwardUnit` | `eventsink/src/xp/` and `XpAward`; and a kill already awards `combat` `kill:<action_id>`, so one encounter would award twice |
| AN-49 | `eventsink/src/awards/exchange.ts`, `AwardUnit` | `eventsink/src/xp/exchange.ts` (proposed), `XpAward`; speech payload fields `from`, `text`, `distance`, `own` exist as stated; `give` already awards `social` `give:<action_id>` as stated |
| AN-50 | registers normalisers in `eventsink/src/writer.ts` | add `case` arms in `eventsink/src/xp/awards.ts` `awardsOf` (writer already calls `awardsFor`); `player-core/src/link/mind-event.ts` is the live list |
| S9-00 | coverage: every `public` table with a `life_id` column must appear as `DELETE FROM <table>` in `sheet_erase_life`; "the real catalog must report nothing missing" | `sheet_erase_life` (0051) covers the six sheet tables with `DELETE FROM public.<t>`; the catalog also has `life_id` in `mcp_players`, `mcp_budget`, `mcp_journal` (0002), `mcp_sleep_marks` (0003), `mcp_life_deaths`, `mcp_death_events` (0023), `actions`, `intents`, `skill_runs`, `turn_records` (0060). Those are erased (or not) by the account-deletion function in 0040, not by `sheet_erase_life`; `turn_records` is in neither. The check as written fails on main. |
| S9-01 | `FailReason` union member; `metrics.ts` reason list; "file names to confirm" | `FAIL_REASONS` array in `golem/src/actions/outcome.ts` (add `'declined'`); `OUTCOME_REASON_LABELS` in `golem/src/metrics.ts:234`; `threshold/mcp/src/events/handlers/intent.ts` exists; `REASON_PHRASE` and `markedWords` exist |
| S9-02 | `mine.ts` 405 lines; law check "domain to confirm" | 414 lines; no psyche `Domain` is law (combat, farming, mining, building, crafting, exploring, social), so the `prof` argument needs a ruling (proposal: `prof = 0`, recorded) |
| S9-03 | `character-config.ts` recognises `morality_hooks` new | `morality_hooks`, `drift`, `tom` and others are already in a tolerated-and-ignored list (lines 29 to 37); `KNOWN_KEYS = ['mode','rolls','proficiency']`; the card moves `morality_hooks` to known. `golem/src/players/main.ts` exists (183 lines): whether player Bodies use `adam-body.ts` is still "to confirm". `shards/fixtures/` does not exist (new folder). |
| S10-01b | eight-table erase list | correct (six plus two); `REFERENCES events (source_event_id)` is valid: `events.source_event_id` is `TEXT UNIQUE NOT NULL` (0001 line 109) |
| S10-02 | `ENGINE_VERSION` stays 1; minor bump | psyche is 1.1.0 untagged; S10-02 makes 1.2.0; `psyche-v1.1.0` must be tagged first or the release tool records both (owner approval for tags). `tools/psyche-release/src/cli.ts` exists. Seed entry still "to confirm". |
| S10-04 | `tools/admin/src/lineage-query.ts` | `tools/admin/` holds `Dockerfile` and `admin.sh` only; no TS package. Placement needs a ruling. |
| S11-01 | shared-contract `EffectiveSheet { sheet: InnerSheet }` (w9-w12 line 111) | `InnerSheet` does not exist; the 2026-11-15 corrections fixed lines 285, 287 but missed line 111: use `CharacterSheet` |
| S11-02 | baseline-update trigger on `agents` "to confirm it does not already exist in 0050" | it exists: `agents_sheet_immutable()` with `BEFORE UPDATE OF character_sheet, sheet_hash, sheet_adopted_at ON agents` (0050). The card must not add one. Ten-table erase list correct. |
| S12-01 | `pg` pinned as `tools/mcp-tokens` does | correct pattern; new package plus SQL plus exporter is over the size budget (split as the card says) |
| S12-03 | floor 6, fight limit 30 s at all-3 | `fightFloor(3) = 6`, `fightLimitMs(3) = 30000` (`psyche/src/threat.ts`) |
| S12-04 | adoption `source` CHECK widened by 0057 | 0051 `CHECK (source IN ('config','roster','birth'))` as stated; `tools/mcp-tokens/src/cli.ts` is **545 lines** (over the soft cap): the new verb needs its own module and at most a dispatch line in `cli.ts` |

## 5. Per-card verdicts

Size column: the card's own estimate; "over 70k" marks cards whose real load (the card file is 20k to 25k tokens to read, plus the code it names, plus checks) exceeds about 70k for a Haiku coder unless the dispatch brief extracts the card and its shapes alone.

### W3 and W4 (kit)

| Card | Verdict | Code now | Size | Reason |
|---|---|---|---|---|
| HC-18 | DONE (other card set) | n/a | | merged on hw0 (`4ab4493`) per kit-b; retire this copy |
| HC-19 | FIX-NEEDED | no | 40k | written against shapes HC-18 does not have; kit-b HC-19 matches the merged code. Supervisor files need the scriptorium orchestrator's go. |
| HC-20 | FIX-NEEDED | no | 45k | section 2 and table 4; also choose kit-b's retry cap rule or this file's fixed cap 4 (they differ) |
| HC-21a | FIX-NEEDED | no | 45k | needs recipe and seen-block inputs the `Observation` lacks, or drop those candidates |
| HC-21b | FIX-NEEDED | no | 25k | `state.habits` shape differs; no completion source |
| HC-22 | FIX-NEEDED | no | 35k | radius math needs coordinates the observation does not carry; an `observe.ts` change or a distance-only rule is a design ruling |
| HC-23a | FIX-NEEDED | yes, after fix | 45k | no longer blocked by HC-10/11; set the loop file to `packages/mind-loop/src/loop.ts`; OD-B wording stays unapproved (ships inactive) |
| HC-23b | BLOCKED | no | 25k | HC-19, HC-23a, HC-26c |
| HC-25 | BLOCKED | no | 40k | OD-A (temperament route); the bank is not exported |
| HC-26a | FIX-NEEDED | yes, after fix | 38k | message file naming; base branch; launcher owner's go |
| HC-26b | FIX-NEEDED | no | 35k | `check-sheet` already exists; compose path is `image/compose/player.yml`; after HC-26a |
| HC-26c | FIX-NEEDED | no | 35k | no `SheetSource` seam; sheet read is in `run.ts`; after HC-26b, HC-19 |
| HC-33 | READY | yes | 15k | docs only; G1, G3 |
| HC-24 | FIX-NEEDED | no | 45k plus ops | registry is `DEFAULT_FXS` in `run.ts`; last of the wave |

### W5 (geldar)

| Card | Verdict | Code now | Size | Reason |
|---|---|---|---|---|
| AN-24 | READY | yes | 40k | contract slot 1; G4, G6, G8; OD-E text ships unused |
| AN-25 | READY | after AN-24 merges (types) | 40k | `lifeIdFor` resolved (table 4); owns `hurt.ts`, `hurt-trigger.ts` |
| AN-26a | FIX-NEEDED | after AN-27a | 40k | test location; Paper `getThrower` and name mapping must be confirmed by the planner, not the coder |
| AN-26b | READY | after AN-24, AN-25, AN-26a and its ops payload | 40k | |
| AN-27a | FIX-NEEDED | yes, after fix | 40k | `ProvenanceSink` and the link edit live in `plugin/core-common`; two Gradle test tasks |
| AN-27b | READY | after AN-24, AN-25, AN-27a ops payload | 35k | |
| AN-28a | FIX-NEEDED | after AN-24, AN-25 | 45k | `player-core` paths replace `animus/`; OD-D is moot |
| AN-28b | FIX-NEEDED | no (last) | 50k plus ops, over 70k | G9; split now into AN-28b (Body subscription, leakage test) and AN-28c (plugin setup, `geldar.ps1`, two nats-auth tests) |

### W6 (kit)

| Card | Verdict | Code now | Size | Reason |
|---|---|---|---|---|
| HC-27a | READY | yes | 30k | pure new files under `packages/instinct/src/social/`; import `CharacterSheet` from `@geldar/scriptorium-psyche`; G1, G3, G12 |
| HC-27b | FIX-NEEDED | no | 38k | no actor id or position in `Observation`; needs W5 merged and an `observe.ts` field decision |
| HC-28a | READY | yes | 28k | pure; the psyche function exists |
| HC-28b | READY | after HC-27b, HC-28a | 30k | pure; own input type |
| HC-29 | READY | yes | 32k | pure, inactive text; `tests/template/` exists in the kit |
| HC-30a | FIX-NEEDED | no | 38k | every S-INSTINCT name is wrong (section 2) |
| HC-30b | BLOCKED | no | 20k | after HC-30a |

### W7

| Card | Verdict | Code now | Size | Reason |
|---|---|---|---|---|
| AN-44 | READY | yes (regen at slot 2) | 40-50k | `INTENT_WHY` location noted; G8 |
| AN-39 | READY | yes | 45-50k | new files only; merge after AN-44 |
| AN-40 | FIX-NEEDED | yes, after fix | 45-50k | add the six import paths from table 4 to the card |
| AN-41 | READY | yes | 35-45k | new file only |
| AN-45 | FIX-NEEDED | no | 45-50k plus ops, over 70k | body-api **v11**, not v10; sha pin v1 to v10; name the real default-version source; split AN-45a/AN-45b now |
| HC-31 | BLOCKED | no | 25k | HC-21 not merged; `IdleCandidate` and `WorldLink.programs()` do not exist |

### W8

| Card | Verdict | Code now | Size | Reason |
|---|---|---|---|---|
| AN-46 | READY | yes (regen at slot 3) | 40-50k | no SQL needed (table 4); OD text ships unused |
| AN-47a | FIX-NEEDED | yes, after fix | 45-50k | `EventSchemaCheck` is a core-common testFixture; Paper `getKiller` to confirm by the planner |
| AN-47b | BLOCKED | no | 45-50k | owner ruling on double combat XP (existing `kill:<action_id>` versus `combat:enc:<key>`); paths to `eventsink/src/xp/` |
| AN-49 | FIX-NEEDED | yes, after fix | 40-50k | `eventsink/src/xp/exchange.ts`, `XpAward`; registration handed to AN-50 |
| AN-51a | FIX-NEEDED | after AN-27a | 35-45k | Paper inventory API confirmations by the planner; sink location as AN-27a |
| AN-51b | READY | after AN-46, AN-51a, AN-25 | 30-40k | |
| HC-27c | READY | after HC-27b, AN-46 | 18k | two table rows |
| AN-50 | FIX-NEEDED | no (last) | 45-50k plus ops, over 70k | register in `xp/awards.ts`; split AN-50a/AN-50b now |

### W9 to W12

| Card | Verdict | Code now | Size | Reason |
|---|---|---|---|---|
| S9-00 | FIX-NEEDED | after a scoping ruling | 20k | the catalog-wide coverage fails today (table 4). Choose: (a) scope to the sheet tables by an explicit list plus a rule for new sheet tables, or (b) check the union of `sheet_erase_life` and the 0040 account-deletion function, with `turn_records` reported as a real gap. Match `DELETE FROM public.<t>`. Append to the one CI psql command. |
| S9-01 | BLOCKED (merge) | yes | 35k | OD-1, OD-2 before merge to a wave branch; resolved file names (table 4); contract slot 4 |
| S9-02 | BLOCKED | no | 50k, over 70k | OD-1, OD-3, OD-4; law has no proficiency domain (ruling); fx label to confirm; split S9-02a/b |
| S9-03 | FIX-NEEDED | after S9-02 | 35k | tolerated-key list; player Body seam to confirm; new `shards/fixtures/` |
| HC-41 | BLOCKED | no | 30k | HC-32 is BlockedDecision; package unnamed |
| S9-04 | BLOCKED | no | ops | after S9-00 to S9-03, HC-41 |
| S10-01a | BLOCKED | yes (write) | 40k | OD-5, OD-7; decision 0284 Accepted before merge |
| S10-01b | BLOCKED | after S10-01a | 45k | owner gate (OD-5, OD-7, OD-12); otherwise literal |
| S10-02 | FIX-NEEDED | after S10-01a | 40k | seed entry to confirm; psyche 1.1.0 tag ordering |
| HC-42 | BLOCKED | no | 20k | S10-02 tagged; the kit mirror is still at 1.0.0 (G13) |
| S10-03 | BLOCKED | no | 50k, over 70k | C4 birth lifecycle not on main; OD-5, OD-6 |
| HC-43 | BLOCKED | no | 35k | HC-34b, HC-35b; OD-6; flag names to confirm |
| S10-04 | BLOCKED | no | 35k plus ops | after S10-03; `tools/admin` has no TS package (placement ruling) |
| S11-01 | BLOCKED | yes (write) | 40k | OD-8, 0285; fix `InnerSheet` to `CharacterSheet` (line 111); `drift` key already tolerated |
| S11-02 | BLOCKED | after S11-01 | 45k | owner gate; drop the "add a baseline trigger" step (it exists) |
| S11-03 | BLOCKED | no | 50k, over 70k | the evidence rule must be written in 0285 first |
| S11-04 | BLOCKED | no | 50k, over 70k | after S11-03; push subject to confirm |
| S11-05 | BLOCKED | no | 40k | after S11-04 |
| HC-44 | BLOCKED | no | 35k | OD-9; HC-36a; GX-03 |
| S11-06 | BLOCKED | no | ops | after S11-05, HC-44 |
| S12-01 | BLOCKED | after S11-02 | 50k, over 70k | split role/SQL from exporter as the card says |
| S12-02 | BLOCKED | after S12-01 | 50k, over 70k | needs the run-folder format and HC-37b names |
| S12-03 | READY | yes | 35k | test-only; AN-12 merged; the refusal case is added only if S9-02 has merged |
| S12-04 | BLOCKED (apply) | dry-run part yes | 45k, over 70k | OD-10 gates any write; `cli.ts` 545 lines: put the verb in `convert-sheets.ts`, one dispatch line in `cli.ts`; split S12-04a/b |
| HC-45 | FIX-NEEDED | no | 35k | may-edit names no exact file ("the supervisor settings reader"); after HC-19, HC-26 |
| S12-05 | BLOCKED | no | 30k docs | OD-10, OD-11, 0288 |
| S12-06 | BLOCKED | no | 45k | OD-11; placement to confirm |
| S12-07 | BLOCKED | no | 25k | last |

## 6. Coverage of the AN-13 to AN-61 candidate ids

| Candidate ids | Card now |
|---|---|
| AN-13 to AN-17 | HC-18 to HC-21b, HC-24 (W3, kit) |
| AN-18 to AN-23 | HC-22, HC-23a/b, HC-25, HC-33, HC-24 (W4, kit); AN-20 deferred (D-HC-06) |
| AN-24 to AN-28 | AN-24 to AN-28b (W5) |
| AN-29 to AN-32 | HC-27a to HC-30b (W6, kit) |
| AN-33 to AN-36 | S12-01, S12-02, S12-06, S12-07 |
| AN-37, AN-52, AN-53 | S9-02, S9-01, S9-03 |
| AN-38, AN-48 | deferred (D-HC-06), no card |
| AN-39 to AN-41, AN-44, AN-45 | same ids (W7) |
| AN-42, AN-54, AN-55, AN-57 | S10-02, S10-01a/b, S10-03, S10-04 |
| AN-43, AN-58, AN-59, AN-60 | S11-04, S11-01/02, S11-03, S11-04/05 |
| AN-46, AN-47, AN-49 to AN-51 | same ids (W8) |
| AN-56 (child prose synthesis) | kit HC-35a/b/c (kit-c), not in these three files |
| AN-61 | HC-32 plus HC-41 |

## 7. Literalness for a Haiku coder

Cards that still carry a `(to confirm)` or a choice the coder would have to make, which the planner must settle in the brief: HC-23a (call site), HC-23b (spawn file), HC-25 (bank route, identity cap), HC-26b (compose), AN-25 (resolved above), AN-26a and AN-51a and AN-47a (Paper API names), AN-44 ("re-verify when coding"), AN-45 (default-version source), S9-01 (resolved above), S9-02 (fx label, domain), S9-03 (player Body seam), S10-02 (seed), S10-03 (CLI placement), S10-04 (placement), S11-04 (subject), S12-06 (placement), HC-41 (package), HC-43 (flag names), HC-45 (files). Every READY card above names its files, test command, revert-checks and commit subject; the brief must add the base branch, worknote path, decision number and gate commands from section 3.
