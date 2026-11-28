# Sheet campaign cards, waves W6, W7 and W8 (estimated sheets, explore/farm/patrol, complete evidence)

Status: **proposal, nothing dispatched.** Revised 2026-11-18 against geldar `origin/main` = `a8063b0a` and kit `origin/scriptorium/hw0` = `673d756`, applying [sheet-cards-verification-2026-11-18.md](sheet-cards-verification-2026-11-18.md) (fixes G1 to G13 and the per-card mismatches) and the operator rulings of 2026-11-18 as recorded in decisions 0320 (kit-b cards authoritative), 0321 (combat XP keyed by encounter), 0322 (NeoForge as inert code) and 0324 (observation positions and ids). Earlier corrections are listed in `worknotes/cards-w3-w12-corrections.md`. Coordinator: geldar-sheet.

Every card here is written for one Haiku `packet-coder` at low effort. The dispatch brief pastes **one card** plus the "Ground rules", "Real names" and "Gates" sections, never the whole file. A card whose step 0 fails, or that meets a name this file does not give, **stops** and reports; the coder never chooses a design.

## What changed in this revision

1. Real names everywhere: `eventsink/src/xp/awards.ts` and `XpAward` (no `eventsink/src/awards/`, no `AwardUnit`); the merged kit instinct names (`Fx`, `FxContext`, `DEFAULT_FXS`, `readConfig`, `appendAudit`, `Observation`); `@geldar/scriptorium-psyche`; plugin core-common paths; body-api **v11**; `DEFAULT_BODY_API_VERSION` is `animus/src/prompts/library.ts:135` (value 10).
2. Combat XP (ruling 2, decision 0321 "Combat XP is keyed by encounter"): AN-46 defines one encounter key `enc:<life_id>:<mob_uuid>`; AN-47b changes the existing `kill:` row in `awards.ts` to that key (from a new `target_uuid` in the Body's kill record) and provides the combat-fact helper; AN-50a, which stays the owner of the registration `case` arms (0321), adds the `combat_fact` arm. A kill inside an encounter pays once. Old AN-47b is split: **AN-47b** (sink key and the Body's kill record) and **AN-47c** (Body visible-fight observation).
3. AN-47a and AN-51a carry the NeoForge-delta amendments A2 to A4 (Bukkit-free core-common classes), so the inert NeoForge twins (decision 0322) reuse them ([../sheet/neoforge-delta.md](../sheet/neoforge-delta.md) section 3).
4. Splits: AN-45 into **AN-45a** and **AN-45b**; AN-50 into **AN-50a** and **AN-50b**.
5. HC-27b takes its own pure input (actor ids, positions, event ids as plain fields), so it can be coded and tested now; the adapter from the kit `Observation` is HC-30a's and reads the position and id fields that HC-46 adds under decision 0324 ("The kit's instinct observation carries positions and ids").
6. Kit card set (decision 0320): the kit's own kit-b cards are authoritative for HC-19 to HC-26c; HC-30a and HC-31 depend on those (HC-24, HC-21a), not on the retired in-repo copies.
7. No user-profile path or account name: the kit is "the sibling `geldar-scriptorium` checkout"; the dispatch gives absolute worktree paths.
8. New card **AN-40a** (operator ruling 2026-11-18, option (a) of AN-40 open item 1): a program's `mine` digs one exact cell, as a program-only run option (no contract field, no regeneration slot, no prompt change; decision 0349). AN-40 gains an amendment: it passes the cell and prefetches owners before its first step.
9. Contract file rule (CS-1, 2026-11-19): `contract/src/index.ts` is a re-export file. A card adds its exports to its own domain file under `contract/src/` (or a new domain file named for its content) and at most one `export * from` line to `contract/src/index.ts`; nothing else goes in `index.ts`. Line caps still apply (soft 500, hard 700): `index.ts` was 599 of 700 before the split, so a card that pushes any contract file past 500 lines splits it first. The `contract/test/public-surface.golden.json` and `public-types.check.ts` files pin the public surface: a card that adds an export updates both in the same commit, and a card that drops or renames one needs an owner call.

## Ground rules that shape every card

- **Which repo.** Each card names its repo. `geldar` = this repo. `kit` = the sibling `geldar-scriptorium` checkout (the dispatch gives the absolute worktree path; this file never writes a local path). The in-house Mind (`animus/`) is **frozen and never edited**, its deprecated stubs included. The live player path is `player-core/`: the `act` allow-list is `player-core/src/validate/bounds.ts` (`PHASE0_PROGRAMS`, `PROGRAM_ARGS`), the event list is `player-core/src/link/mind-event.ts` (`MIND_EVENT_TYPES`).
- **psyche.** `psyche/` (geldar, version 1.1.0, only tag `psyche-v1.0.0`) is the zero-import package (decision 0281). The kit mirrors psyche 1.0.0 as `@geldar/scriptorium-psyche` (`packages/psyche/`), which exports `CharacterSheet`, `Score`, `Level`, `Domain`, `DrawKey`, `Rng`, `Roll`, `STANDARD_SHEET`, `rngFor`, `roll`, `check`, `successChance`, `successProbability` (same function as `successChance`, three positional arguments `(score, dc, prof)`), `RollRecord`, `Sheet`, `parseSheet`. **No card here edits `psyche/` or `packages/psyche/`.** A card that needs an export the kit mirror lacks (for example `decideThreat`, `fightFloor`, `fightLimitMs`) stops `blocked: psyche export <name>` (G13: tag `psyche-v1.1.0` and a kit re-mirror card come first).
- **Blindness.** Sheet scores, estimates, alignment labels and the word "estimate" never reach any model context, prompt, tool output, file or log the character can read. Agents are never told they are watched, measured, modelled or coached. Prediction numbers go to the operator ledger (`instinct.jsonl`) only.
- **Owner approval.** A card that produces agent-visible text is marked **OWNER APPROVAL REQUIRED**. It merges its text **inactive** (flag default false, or an unselected prompt version) with a test that the off path produces no text. Activation is a separate owner act (D-CS-10). All sheet features stay held on the live server (owner ruling 2026-11-15); evidence runs use the test shard only.
- **Principle 2 and decision 0058.** Nothing here imposes a goal. Programs are bounded means to an adopted goal (D-CS-01, D-CS-14). An agent knows only what it saw, tried or was told; an unobserved field stays at its prior and is never shown.
- **Numbers.** Decisions written by W3 to W8 cards take a free number after the operator-ruling records 0320 to 0328 (Accepted, 2026-11-18); a card names its record by title with "(number assigned in the registry)" and the dispatch gives the number from `docs/analysis/phase1/packets/decision-number-registry.md`. A coder never picks a number. **No card in this file writes SQL** (`xp_evidence` has no `evidence_kind` column; its `domain` CHECK already lists `combat` and `social`; `evidence_key` is 1 to 200 characters). Prompts: body-api v1 to v10 exist and are released; the next file is **`prompts/body-api/v11.json`**.
- **Contract regeneration is serial**: AN-44 (slot 2), then AN-46 (slot 3), each after the one before it merged; ask the contract slot holder (geldar-3b) before each. `contract/src/index.ts` is **557 lines**: new code goes in a new `contract/src/<topic>.ts`; `index.ts` gets **named export lines only** in its existing style (`export { a, b } from './<topic>.ts';` and `export type { T } from './generated/types.ts';`), never `export *`.
- **Files:** soft cap 500, hard cap 700 lines. Exact version pins; no card adds a dependency (a needed one stops the card). LF endings. A behaviour change needs a test that fails when reverted; each card lists the revert-checks: make the one edit, run the named test, see the named case fail, restore with `git checkout -- <path>`, rerun green, record it in the worknote.
- **NeoForge.** The sheet includes the NeoForge shard as **inert code** (OD-NF-7 yes). The twin cards in [work-packets-sheet-neoforge.md](work-packets-sheet-neoforge.md) are merged but off and stay blocked on P3-LIVE and P4. A Paper card that an amendment A1 to A4 names creates the Bukkit-free class it names in `plugin/core-common`, so the twin can reuse it; `neoforge/src/test/java/dev/geldar/neoforge/NoRegistryScanTest.java` scans `plugin/core-common/src/main` too, so a core-common file never contains the words it lists (for example `ChatType`, `CommandEvent`, `BuiltInRegistries`).

## Real names (verified on `a8063b0a` and kit `673d756`)

- **XP (S-AWARD).** `eventsink/src/xp/awards.ts` (145 lines): `export interface XpAward { lifeId: string; domain: Domain; evidenceKey: string; sourceEventId: string; worldTick: number }`; `export function awardsFor(event: WorldEvent): XpAward[]` (never throws) calls `awardsOf`, which requires `payload.life_id` to be a string equal to `event.agent_id`, then `switch (event.type)` with `case 'action'`, `'intent'`, `'chunk_visited'`. `actionAwards` `case 'attack'` awards `combat` key `kill:<action_id>` for a completed attack with `detail.killed === true && detail.target_kind === 'mob'`; `case 'give'` awards `social` `give:<action_id>`. `EVIDENCE_KEY_MAX = 200`. Fixtures: `eventsink/src/xp/fixtures.ts` (`CAPTURED` map of exact event JSON strings, for example `kill_completed`); tests `eventsink/src/xp/awards.test.ts` (424 lines; `keysOf(name)`, `withDetail(name, detail)`, `actionIdOf(name)`). `eventsink/src/writer.ts:107` calls `awardsFor`; no registration list exists, a new source is a new `case` arm or a helper called from `awardsOf`.
- **Body attack.** `golem/src/actions/attack.ts` (220 lines): `attackAction.run` finds `first` (a prismarine `Entity`, whose `uuid?: string` is set for mobs), builds a `KillRecord { target, swings, weapon, at, start, targetKind }` and `afterKill(ctx, kill)` returns `completed({ target, target_kind, swings, killed: true, weapon, picked, note? })`.
- **W7 names.** `golem/src/body/programs/index.ts` (60 lines, `createProgramRegistry`, `UNSUPPORTED_PROGRAMS = ['trade_wait']`); `golem/src/body/programs/programs.fakes.ts` (`newWorld`, `contextFor`, `drive`, `expectResumeEverywhere`); `golem/src/body/programs/action-step.ts` (`runStepAction(ctx, action)`, `stopOf(run, ctx?)`); `golem/src/body/program.ts` (`IntentProgram`, `ProgramContext` with `view: BodyView`, `view.nearbyHostiles(radius)`); `player-core/src/validate/bounds.ts` (218 lines; `ArgSpec` kinds `int`, `name`, `player`, `blueprint`, `target`; `PHASE0_PROGRAMS` lists travel, gather, craft, rest, flee, follow, build); `golem/src/perception/surroundings/food-known.ts` (`CROP_MAX_AGE`, `FOOD_RANGE = 24`); `golem/src/actions/place.ts` (`SEED_CROPS`: seed item to crop block); `golem/src/perception/notable-blocks.ts` (`canSeeBlock(bot, block)`); `golem/src/actions/protected-blocks.ts` (`ownerRecordAt(pos): OwnerAnswer | null`, `OwnerAnswer = { known: false } | { known: true; owner: string | null; block? }`); `golem/src/actions/own-placements.ts` (`isOwnPlacement(bot, cell)`); `contract/src/outcome-words.ts` (328 lines; `INTENT_WHY` is a non-exported `const` at line 36 read by `intentWhy()`); `golem/src/mind-link/body-api.test.ts` (the body-api test pattern, reads `v2.json`); `animus/src/prompts/library.ts:135` `DEFAULT_BODY_API_VERSION = 10`, pinned by `animus/src/prompts/library.test.ts:121`. The W2 chunk tracker `golem/src/body/evidence/chunk-visits.ts` (`watchChunkVisits`) has **no reader**, so explore keeps its own `visited` list and no card wires a visited-chunk reader.
- **Plugin.** `plugin/core/src/main/java/dev/geldar/core/EventExporter.java` `public void emit(String type, String playerName, JsonObject payload)`; `GeldarCore.java` (258 lines) `static List<Listener> listeners(EventExporter exporter, Logger log, boolean grantRecipesOnJoin)`; `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java` (132 lines, registers `BlockChangeListener`); `plugin/core-common/src/main/java/dev/geldar/core/blockowner/{OwnerCache,NatsBlockOwnerLink,BlockOwnerPublisher}.java`; `dev.geldar.core.EventEnvelope.isLifeId(String)` (core-common); `EventSchemaCheck` is a **package-private** core-common testFixture in package `dev.geldar.core` with `static List<Error> errors(EventEnvelope)` (envelope schema only, not payload schemas); `plugin/core/build.gradle.kts` has `testImplementation(testFixtures(project(":core-common")))`; both Gradle projects set the system property `geldar.schemas` to the absolute `contract/schemas` path. `golem/src/perception/hostile-types.ts` exports `ALWAYS_HOSTILE`.
- **Kit instinct** (`packages/instinct/src/`, package `@geldar/scriptorium-instinct`): `decide.ts` (`InstinctConfig { arm, failureCap, maxPicks, thinkP, rolls }`, `FxContext { obs, sheet, state, cfg, lifeKey, tick, goal, knownText, check(fx, score, dc, prof?), draw(fx), rolls }`, `FxResult` = `act {fx, why, act}` / `facts {fx, facts, stop?}` / `escalate {fx, reason}` / `pass`, `type Fx = (ctx: FxContext) => FxResult`); `contract.ts` (`FX_NAMES = ['failure','novelty','idle','guard','none']`, `PassReason`, `ActRecord`, `actIntent(goal, program, args)`, `MAX_FACTS = 4`, `MAX_FACT_CHARS = 200`, `sanitizeFact`); `observe.ts` (`Observation { tick, dead, night, position: {x,y,z} | null, health, hunger, inventory, foodCarried, inventoryFull, agents: {name, distance: number | null}[], entities, notable, intent, events: EventLine[], cursor }`, `EventLine { kind: 'speech_to_me'|'intent_finished'|'intent_failed'|'action_failed'|'hurt'|'death'|'other'; text; from? }`: **no actor ids, no event ids, no other agent's position**); `run.ts` (`DEFAULT_FXS: readonly Fx[] = []`, `readConfig(env)` from `GELDAR_INSTINCT_*`, state dir `env.GELDAR_INSTINCT_STATE`, audit file `join(dirname(stateDir), 'instinct.jsonl')`); `audit.ts` (`appendAudit(path, line)`); `state.ts` (`InstinctState`, `loadState`, `saveState`); `world.ts` (`WorldLink`: `call`, `close` only). Template scans: `tests/template/tool-skill-scan.ts` exports `markedWords`, `forbiddenMention`.

Names that W5 cards create (AN-24 to AN-28c in [work-packets-sheet-w3-w5.md](work-packets-sheet-w3-w5.md)) are used here as written there: `ObservedActor { name; life }` (both required, as AN-24 defines it; the optional `life?` shape was amendment A6, which is on hold), the `observation` WorldEvent and `ObservationPayload` `oneOf` in `contract/schemas/observation-event.schema.json`, `contract/schemas/provenance.schema.json`, subject helpers in `contract/src/subjects.ts`, `observedActor(bot, name)` in `golem/src/perception/provenance/visible-actor.ts`, `golem/src/perception/provenance/subscribe.ts`, `ProvenanceSink` and `ProvenanceJson` in `plugin/core-common/src/main/java/dev/geldar/core/provenance/` (amendments A1, A2), the Paper key `provenance.enabled` read in `BlockOwnerSetup` (default false). Each card that uses one checks it in step 0 and stops `blocked: <name> missing` when absent.

## Gates

**Geldar gates (run in the worktree, PowerShell):** G1 targeted test `./geldar.ps1 pnpm test <path>`; G2 `./geldar.ps1 pnpm --filter @geldar/<pkg> typecheck` per touched package; G3 `./geldar.ps1 pnpm format` then `./geldar.ps1 pnpm lint` then `git diff --check` prints nothing; G4 `./geldar.ps1 pnpm check:repo`; G5 (contract) `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated`; G6 (plugin) `Push-Location plugin; ./gradlew <project>:test --tests '<class>'; Pop-Location` (project `:core` or `:core-common` as the card says) then `Push-Location plugin; ./gradlew build; Pop-Location`; G7 `git merge-tree --write-tree origin/phase1/sheet-w<N> HEAD` prints a tree id and no `CONFLICT` line. Real SQL, NATS, plugin and client cases are **ops**, serial, test shard only. Never `adam up`.

**Kit gates (run in the kit worktree):** CK-1 `./scriptorium.ps1 pnpm test <files>`; CK-2 `./scriptorium.ps1 pnpm typecheck`; CK-3 `./scriptorium.ps1 pnpm format` then `./scriptorium.ps1 pnpm lint` then `git diff --check`; CK-4 `./scriptorium.ps1 pnpm check:repo` and `git merge-tree --write-tree origin/scriptorium/hw0 HEAD` (or the wave branch the brief names) with no `CONFLICT`; CK-T `./scriptorium.ps1 pnpm check:template`; CK-M `./scriptorium.ps1 pnpm lint:md`.

**Branches and worknotes.** Geldar: the orchestrator creates `phase1/sheet-w7` and `phase1/sheet-w8` from `origin/main` and pushes them before the first dispatch (G5); card branches `phase1/sheet-an-<nn>-<slug>`; worknote `docs/analysis/harness/worknotes/AN-<nn>.md`. Kit: base `origin/scriptorium/hw0` (no `scriptorium/hw4` exists); card branches `scriptorium/hc-<nn>-<slug>`; worknote `docs/analysis/harness/worknotes/HC-<nn>.md` in the kit repo. The coder never pushes, tags, opens a PR or merges. Commit subject as on the card, then the attribution lines the dispatch gives, verbatim.

**Must-not-edit baseline (every geldar card):** `docs/spec.md`; accepted ADRs; merged `sql/*` and released `prompts/**`; `contract/src/generated/**` by hand; other packets' worknotes; every `package.json`, `pnpm-lock.yaml`; `geldar.ps1`, `compose/**`, `shards/*.yaml`; `animus/**`; `psyche/**`; `docs/decisions/README.md`, `sql/README.md`, ledger and RESUME (ops adds index lines from the worknote); shared wiring files unless the card owns them (table below). **Kit baseline:** `packages/psyche/**`, `template/**`, `template-src/**`, `tests/template/allowed-files.ts`, `tests/template/tool-skill-scan.ts`, `packages/supervisor/**`, `launcher/**`, every `package.json`, `pnpm-lock.yaml`, unless the card names the file.

**On-cap (every card).** Commit what passes, write base SHA, passing tests and unfinished steps in the worknote, leave the branch clean, stop. Never weaken a test or invent a design.

## Dependency table

| Card | Repo | Depends on | Status | Code now |
|---|---|---|---|---|
| HC-27a social model rules, arithmetic, store | kit | HC-18 (merged on hw0) | READY | yes |
| HC-27b observations, dedup, sampling, apply (pure input) | kit | HC-27a | READY (merge after HC-27a; the live path waits for HC-46 through HC-30a) | yes, after HC-27a is on a branch |
| HC-28a prediction by interpolation | kit | HC-27a | READY | yes |
| HC-28b stranger policy | kit | HC-27b, HC-28a | READY (after both merge) | no |
| HC-29 bounded social prose (OWNER APPROVAL) | kit | HC-27a | READY (text inactive) | yes |
| HC-30a W6 integration | kit | HC-27b, HC-28b, HC-29, HC-24 (kit-b, 0320), HC-46 (0324) | BLOCKED (HC-24, HC-46 not merged) | no |
| HC-30b W6 close (docs) | kit | HC-30a | BLOCKED | no |
| AN-44 program shapes and contract | geldar | AN-24 merged (contract slot 1) | READY | write yes; regen at slot 2 |
| AN-39 explore program | geldar | AN-44 (merge order) | READY | yes |
| AN-40a a program's `mine` digs one exact cell (0349) | geldar | none (no contract slot) | READY | yes |
| AN-40 farm program | geldar | AN-44 (merge order), AN-40a (code and merge order; amendment) | READY after AN-40a | amendment after AN-40a merges |
| AN-41 patrol program | geldar | AN-44 (merge order) | READY | yes |
| AN-45a register, allow-list, drift test | geldar | AN-39, AN-40, AN-41, AN-44 | READY after deps | no |
| AN-45b body-api v13 unselected (OWNER APPROVAL; re-carded 2026-11-27) | geldar | AN-45a | READY after deps | no |
| HC-31 idle binding | kit | HC-21a (kit-b), AN-45a | BLOCKED | no |
| AN-46 evidence contract and combat key (OWNER APPROVAL for two sentences) | geldar | AN-44 merged (slot 3), AN-24 | READY | write yes; regen at slot 3 |
| AN-47a combat facts in the plugin (A2, A3) | geldar | AN-46, AN-27a (A1) | READY after deps (creates `ProvenanceJson`) | no |
| AN-47b combat key: the Body's kill pays the encounter key (0321) | geldar | AN-46 | READY after AN-46 | no |
| AN-47c visible-fight observation | geldar | AN-46, AN-25, AN-28b (subject helpers) | READY after deps | no |
| AN-49 conversation exchange award | geldar | AN-46 (ADR) | READY | yes |
| AN-51a container-take facts in the plugin (A2, A4) | geldar | AN-46, AN-27a (A1, A4), AN-47a (`ProvenanceJson`) | READY after deps | no |
| AN-51b observed take, owner's Body | geldar | AN-46, AN-51a, AN-25 | READY after deps | no |
| HC-27c kit reader for `fight_seen`, `container_taken` | kit | HC-27b, AN-46 | READY after deps | no |
| AN-50a sink and plugin registration | geldar | AN-47a, AN-47b, AN-49, AN-51a, AN-28c | READY after deps | no |
| AN-50b Body subscription and leakage gate | geldar | AN-50a, AN-47c, AN-51b, AN-28b | READY after deps | no |

W6 may overlap W7 (different repos). W8 follows W7 only for the contract slot; AN-47a, AN-49 and AN-51a touch disjoint new files and can be coded in parallel once their dependencies merge.

**Shared files and their owners (one owner at a time, in this order):**

| File | Owners |
|---|---|
| `contract/**` and `contract/src/generated/**` | AN-44, then AN-46 |
| `golem/src/body/programs/index.ts`, `player-core/src/validate/bounds.ts`, `player-core/src/validate/*.test.ts` | AN-45a |
| `golem/src/actions/mine.ts`, `golem/src/actions/registry.ts`, `golem/src/body/program.ts`, `golem/src/body/runtime.ts`, `golem/src/body/executor-intent.ts`, `golem/src/body/programs/action-step.ts` | AN-40a only |
| `prompts/body-api/v13.json` (new; was v11, re-carded 2026-11-27) | AN-45b |
| `eventsink/src/xp/awards.ts`, `awards.test.ts`, `fixtures.ts` | AN-47b (the `attack` row only), then AN-50a (the registration `case` arms, 0321) |
| `golem/src/actions/attack.ts`, `attack.test.ts` | AN-47b |
| `plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceJson.java` | AN-47a creates it (AN-27a did not; corrected 2026-11-19) with `combatJson`; AN-51a adds `takeJson` |
| `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java`, `.../blockowner/BlockOwnerSetup.java` | AN-28c (W5), then AN-50a |
| `golem/src/perception/provenance/subscribe.ts`, `threshold/mcp/src/events/leakage.test.ts`, `player-core/src/link/mind-event.ts` | AN-28a/b (W5), then AN-50b |
| kit `packages/instinct/src/social/observe.ts`, `rules.ts` | HC-27a/HC-27b, then HC-27c |
| kit `packages/instinct/src/contract.ts` (`FX_NAMES`), `run.ts` (`DEFAULT_FXS`) | HC-24 (kit-b) and the orchestrator, then HC-30a (one `FX_NAMES` entry only) |

This refines the `eventsink/src/xp/awards.ts` row of [sheet-next-wave-order.md](sheet-next-wave-order.md) ("AN-50a only") as decision 0321 directs: AN-47b changes the `kill:` row to the shared key; AN-50a keeps the registration `case` arms.

## Owner decisions each card needs

| Card | Decision(s) |
|---|---|
| HC-27a, 27b, 28a | D-CS-05 (interpolation), D-CS-06 (observer-scoped evidence), prior strength 2 and the observation values (unmeasured). Assumed; confirm. |
| HC-27b | 0324 (positions and ids are supervisor-side facts the Body perceived; no wording approval needed because nothing here is agent-visible) |
| HC-28b | D-CS-01, the stranger formula as written |
| HC-29 | **OWNER APPROVAL REQUIRED** for the 8-sentence bank and the uncertainty sentence; D-CS-10 for activation |
| HC-30a | 0320 (kit-b HC-24 is the base), 0324 (HC-46 fields); D-CS-10 |
| AN-44, AN-39 to AN-41, AN-45a | D-CS-14 (program boundaries); AN-40 also the property rule (own and world-generated cells only; unknown is protected, 0164); AN-41 "route is supplied, never looked up" |
| AN-40a | Operator ruling 2026-11-18 (option (a): an exact cell for `mine`), recorded as 0349 by the card; no owner approval (nothing agent-visible) |
| AN-45b | **OWNER APPROVAL REQUIRED** for the three program summaries in body-api v11 and AN-44's `INTENT_WHY` templates |
| HC-31 | D-CS-14, D-CS-01 |
| AN-46 | **OWNER APPROVAL REQUIRED** for the two observation sentences; D-CS-04, D-CS-06, D-CS-15. Ruling 2 (combat key) is decided. |
| AN-47a, 47b, 47c | D-CS-04, D-CS-06; owner confirms `FIGHT_END_TICKS = 200` and the 512-encounter cap (unmeasured) |
| AN-49 | D-CS-15: `EXCHANGE_WINDOW_TICKS = 600` (owner parameter) and the participant rule |
| AN-51a, 51b | D-CS-06; only the container's owner observes a take |
| AN-50a, 50b | D-CS-04, D-CS-06; activation D-CS-10 |

---

# Wave W6: estimated sheets and prediction (all kit)

All W6 cards are kit cards. Base `origin/scriptorium/hw0`; worktree path from the dispatch; about 30k to 40k working tokens each. **Shared kit files edited by W6: only HC-30a** (one `FX_NAMES` entry in `contract.ts`, new `social/index.ts`); every other W6 card creates new files under `packages/instinct/src/social/` only. No W6 card edits `contract/`, SQL, `psyche/` or the geldar repo. The social model is kit-local (D-HC-04), stored under the supervisor volume only. Import psyche types as `import type { CharacterSheet, Score, Level } from '@geldar/scriptorium-psyche';` (already a dependency of `@geldar/scriptorium-instinct`).

## HC-27a: social model rules, update arithmetic and store

- **repo** kit. **wave** W6. **status** READY. **depends-on** HC-18 (merged on hw0). **size** 30k. **branch** `scriptorium/hc-27a-social-store`.
- **may-edit (all new)** `packages/instinct/src/social/rules.ts`, `model.ts`, `store.ts`, `model.test.ts`, `store.test.ts`; the worknote. **must-not-edit** kit baseline, `packages/instinct/src/index.ts` (HC-30a), every other `packages/instinct/src/*.ts`.
- **decisions** D-CS-05, D-CS-06 (assumed). **owner approval** none (no agent text).
- **Step 0.** `Select-String -Path packages/psyche/src/index.ts -SimpleMatch -Pattern 'CharacterSheet,'` prints one line; otherwise STOP `blocked: psyche export CharacterSheet`.
- **shapes (exported; HC-27b, 28a, 29, 30a code against these)**
  ```ts
  export const LEARNED_FIELDS = ['curiosity', 'aggression', 'law', 'good'] as const;
  export type LearnedField = (typeof LEARNED_FIELDS)[number];
  export type Field = LearnedField | 'common_sense' | 'cleverness';
  export const PRIOR_STRENGTH = 2; // unmeasured
  export type ObsKind = 'spoke_first'|'approached'|'kept_away'|'hit_me'|'gave_me'|'took_mine'
    |'fought_mob'|'fled_mob'|'kept_promise'|'broke_promise';
  export interface Update { field: LearnedField; value: number }
  export interface ObsRule { active: boolean; updates: readonly Update[] }
  export const OBS_RULES: Readonly<Record<ObsKind, ObsRule>>;
  // active: spoke_first{curiosity 4.0} approached{curiosity 3.5} kept_away{curiosity 2.5}
  //   hit_me{aggression 4.5} gave_me{good 4.5} took_mine{law 1.5, good 2.0}
  // inactive: fought_mob{aggression 4.5} (HC-27c switches it on), fled_mob{aggression 1.5} (never: no causal signal),
  //   kept_promise{law 4.5}, broke_promise{law 1.5} (deferred with AN-48)
  export interface FieldEstimate { estimate: number; n: number; tick: number }
  export interface OtherModel { v: 1; observer: string; other: string; name: string; sightings: number;
    last_run: number; spoke: boolean; last_sample?: { tick: number; dist: number; me: [number, number, number]; them?: [number, number, number] };
    fields: Partial<Record<LearnedField, FieldEstimate>>; updated_tick: number }
  export function ownScore(sheet: CharacterSheet | null, f: Field): number;        // 3 when null; attributes.* or alignment.*
  export function priorFor(f: Field, own: CharacterSheet | null): number;          // 3 + 0.25*(5-own.common_sense)*(own[f]-3), clamp 1..5
  export function applyEvidence(cur: FieldEstimate | undefined, prior: number, evidence: number, tick: number, strength?: number): FieldEstimate;
                                                                                    // base + (evidence-base)/(n+strength), clamp 1..5, 6 decimals
  export function estimateOf(m: OtherModel | null, f: Field, own: CharacterSheet | null): { estimate: number; n: number; supported: boolean };
  export class SocialStore { constructor(stateDir: string, observer: string, lifeId: string);
    load(other: string): OtherModel | null; save(m: OtherModel): void; list(): OtherModel[] }
  export const SAFE_ID: RegExp; // /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/
  ```
  `rules.ts` holds `LEARNED_FIELDS` to `OBS_RULES`; `model.ts` holds `FieldEstimate` to `estimateOf`; `store.ts` holds `SocialStore` and `SAFE_ID`. `common_sense` and `cleverness` have no rule: never stored, always read as their prior, `supported: false`. Store: one file per other, `<stateDir>/social/other-<id>.json`, key is the other's id never a display name, write a tmp file then `renameSync`, mode 0600 (skip the mode assertion when `process.platform === 'win32'`), directory 0700; `meta.json {observer, life}`; a different `lifeId` renames the directory to `social.archive-<oldlife>` (old life filtered to `SAFE_ID`, else `unknown`) and starts fresh.
- **tests** evidence 4.5 applied three times from prior 3 gives 3.75, 4.0, 4.125; prior projection (own common_sense 1 and curiosity 5 gives 5; common_sense 5 gives 3; common_sense 3 gives 4); clamp 1 and 5; unlearned fields unsupported even after other updates; inactive rules marked off; store round trip and mode; different life archives; unsafe ids refused (`../x`, `a b`, 40 characters).
- **checks** CK-1 `./scriptorium.ps1 pnpm test packages/instinct/src/social/model.test.ts packages/instinct/src/social/store.test.ts`, CK-2, CK-3, CK-4.
- **revert-checks** divisor `n + 1` instead of `n + strength`: the 3.75/4.0/4.125 test fails. Drop the projection factor: the prior test fails. Set `fought_mob.active` true: the inactive-rules test fails. Skip the life check in the constructor: the archive test fails.
- **exit criteria** both test files pass; CK-2 to CK-4 pass; four revert-checks recorded.
- **worknote** `HC-27a.md`. **commit** `feat(instinct): social model rules, update arithmetic and store (HC-27a)`. **split line** `rules.ts` + `model.ts` first, `store.ts` second.

## HC-27b: observations: scope, dedup, sampling and apply (pure input)

- **repo** kit. **status** READY (codes against HC-27a's branch; merges after HC-27a). **depends-on** HC-27a. **size** 38k. **branch** `scriptorium/hc-27b-social-observe`.
- **why the input is its own type.** On hw0 the kit `Observation` carries no event ids, no actor ids and no other agent's position (`agents` is `{name, distance}` only). Decision 0324 extends it (card HC-46: positions of what the Body perceived and life ids of perceived agents), but HC-46 is not merged. This card therefore defines a pure input with those fields as plain values; HC-30a fills it from `Observation` once HC-46 has merged. Nothing here reads `observe.ts`.
- **may-edit (new)** `packages/instinct/src/social/observe.ts`, `dedup.ts`, `sample.ts`, `apply.ts`, `observe.fixtures.ts`, `observe.test.ts`, `apply.test.ts`; the worknote. **must-not-edit** HC-27a files (a gap is reported, not patched), anything outside `social/`, kit baseline.
- **decisions** D-CS-06 (only visible, causal evidence; one update per valid observation). **owner approval** none.
- **shapes**
  ```ts
  export type SocialEventKind = 'speech_to_me' | 'hurt' | 'gift_received' | 'property_broken' | 'fight_seen' | 'container_taken';
  export interface SocialEvent { kind: SocialEventKind; id: string /* non-empty, built by the adapter */; tick: number;
    actorName?: string; actorLife?: string }   // actor fields only when the event names a visible actor
  export interface SocialSighting { name: string; life?: string; distance: number | null; position?: [number, number, number] | null }
  export interface SocialObservation { observer: string; kind: ObsKind; actor: string; actorName: string; key: string; tick: number }
  export function eventObservations(observer: string, events: readonly SocialEvent[], nearby: readonly SocialSighting[]): SocialObservation[];
  export function positionObservations(prev: OtherModel['last_sample'], tick: number, me: [number, number, number] | null,
    other: SocialSighting): { observations: SocialObservation[]; sample: NonNullable<OtherModel['last_sample']> | null };
  export class SeenSet { constructor(stateDir: string); has(key: string): boolean; add(key: string): void; flush(): void }  // newest 4000, FIFO, mode 0600
  export interface ApplyReport { applied: number; deduped: number; dropped: { foreign: number; self: number; inactive: number; badId: number } }
  export function applyObservations(store: SocialStore, seen: SeenSet, own: CharacterSheet | null, observer: string,
    obs: readonly SocialObservation[], run: number, strength?: number): ApplyReport;
  export function noteSighting(store: SocialStore, other: string, name: string, run: number): void;
  ```
  Event table (the only place event kinds map to observations): `speech_to_me` gives `spoke_first` (key `speech:<id>`); `hurt` with an actor gives `hit_me` (key `hurt:<id>`); `gift_received` gives `gave_me` (key `gift:<id>`); `property_broken` gives `took_mine` (key `break:<id>`); `fight_seen` and `container_taken` map to `fought_mob` and `took_mine` but are **inactive here** (HC-27c switches them on). The actor id is `actorLife` when present, else the one `nearby` entry whose `name` equals `actorName` exactly (its `life` when present, else its name); no match or two matches drops the observation. An event without an actor gives nothing. The actor id must pass `SAFE_ID` (else `badId`). An observation whose actor is the observer is `self`. Position sampling (0324; constants unmeasured: `SAMPLE_TICKS 6000`, `MIN_GAP_TICKS 100`, `MOVE_BLOCKS 6`, `SELF_STILL_BLOCKS 2`, `NEAR_BLOCKS 32`); the sample stores `dist`, `me` and `them` (the other's position; HC-27a's `last_sample.them`), and the other's movement is `them` now against `them` in the previous sample (if HC-27a merged without the optional `them` field, STOP `blocked: last_sample shape`). No observation when `me`, `other.distance` or `other.position` is null or absent (a sighting without a position never produces approach or keep-away); no previous sample, a tick gap under `MIN_GAP_TICKS`, or own movement since the previous sample above `SELF_STILL_BLOCKS` returns only a new sample; a standing other (own movement under `MOVE_BLOCKS`) gives nothing; otherwise the other moved at least `MOVE_BLOCKS` and the distance fell to within `NEAR_BLOCKS`: `approached`; the distance rose: `kept_away`; key `pos:<other>:<floor(tick/6000)>` (one per window). Dedup key `<observation key>#<field>`. Names pass `cleanName` (strip control characters, drop double quotes, collapse spaces, at most 40 characters). Only the fields of `SocialEvent` and `SocialSighting` are read.
- **tests** the same hurt delivered twice counts once; after restart (new store and `SeenSet` over the same folder) still once; an event whose `observer` differs is dropped as foreign; the observer's own act is dropped; an inactive kind (`fight_seen`) is dropped; `took_mine` updates law and good once each; standing other (moved under 6 blocks) gives no observation; a sighting without a position gives no observation; own movement above 2 blocks gives no observation; out-of-order batch equals the sorted result; the seen set keeps 4000; ambiguous name dropped; hostile name cleaned; an object with an extra `sheet` field passed as an event leaves no trace in the store folder (grep the folder for the sentinel value).
- **checks** CK-1 `./scriptorium.ps1 pnpm test packages/instinct/src/social/observe.test.ts packages/instinct/src/social/apply.test.ts`, CK-2, CK-3, CK-4.
- **revert-checks** remove the dedup check: the redelivery test fails. Remove the observer scope check: the foreign test fails. Resolve ambiguous names to the first hit: the ambiguity test fails. Ignore own movement: the "own movement" test fails.
- **exit criteria** both test files pass; four revert-checks recorded.
- **worknote** `HC-27b.md`. **commit** `feat(instinct): observer-scoped social observations with dedup (HC-27b)`. **split line** `observe` + `dedup` / `sample` + `apply`.

## HC-28a: prediction by interpolation and exact branches

- **repo** kit. **status** READY. **depends-on** HC-27a. **size** 28k. **branch** `scriptorium/hc-28a-predict`.
- **may-edit (new)** `packages/instinct/src/social/branch.ts`, `predict.ts`, `predict.test.ts`; the worknote. **must-not-edit** kit baseline, `model.ts`.
- **decisions** D-CS-05 (interpolate the two adjacent integer policies; actual execution stays on integer scores). **owner approval** none (ledger only).
- **shapes**
  ```ts
  export interface Chance { score: Score; dc: number; proficiency: Level }   // from @geldar/scriptorium-psyche
  export type Branch<T> = { kind: 'outcome'; outcome: T } | { kind: 'chance'; chance: Chance; success: Branch<T>; failure: Branch<T> };
  export type Dist<T> = Map<T, number>;
  export type Prob = (c: Chance) => number;                 // production: (c) => successProbability(c.score, c.dc, c.proficiency)
  export function distribution<T>(b: Branch<T>, p: Prob): Dist<T>;
  export type Policy<I, T> = (sheet: CharacterSheet, input: I) => Branch<T>;
  export function estimatedScores(model: OtherModel | null, own: CharacterSheet | null): Record<Field, number>;
  export function predict<I, T>(policy: Policy<I, T>, scores: Record<Field, number>, input: I, p: Prob): Dist<T>;
  export function recordPrediction(append: (line: object) => void, other: string, fx: string, dist: Dist<string>,
    scores: Record<Field, number>, run: number): void;
  ```
  `predict` builds integer sheets from `STANDARD_SHEET`; each fractional field splits into `floor` and `floor+1` weighted `1-frac` and `frac`; at most 64 sheets, weight-0 skipped; the policy never sees a non-integer. `recordPrediction` writes `{v:1, ts, run, kind:'prediction', other, fx, probs, est}` through the injected appender only.
- **tests** aggression 3.5 with a test-double policy and `p = (c) => (c.score - 1) / 4` gives P(fight) 0.625; an integer estimate calls the policy once; one fractional field calls it exactly twice (spy); the policy only sees integers; two fractional fields enumerate four sheets with product weights; distribution sums to 1 on nested chances; engine fixtures `successProbability(3, 11, 0) === 0.5` and `successProbability(1, 8, 0) === 121/400` (to 1e-12); prediction line shape.
- **checks** CK-1 `./scriptorium.ps1 pnpm test packages/instinct/src/social/predict.test.ts`, CK-2, CK-3, CK-4.
- **revert-checks** round instead of interpolate: the 0.625 test fails. Skip weight-0 pruning: the "exactly twice" call-count test fails. Drop a branch weight: the sum-to-1 test fails.
- **exit criteria** the test file passes; three revert-checks recorded. **worknote** `HC-28a.md`. **commit** `feat(instinct): predict others by interpolating the same pure policy (HC-28a)`. **split line** `branch.ts` / `predict.ts`.

## HC-28b: stranger policy

- **repo** kit. **status** READY after HC-27b and HC-28a merge. **depends-on** HC-27b, HC-28a. **size** 30k. **branch** `scriptorium/hc-28b-stranger`.
- **may-edit (new)** `packages/instinct/src/social/stranger.ts`, `stranger.test.ts`; the worknote. **must-not-edit** kit baseline, `branch.ts`, `predict.ts`, `decide.ts`, `run.ts`.
- **decisions** D-CS-01 (means only, no speech, first sighting to the model), D-CS-05. **owner approval** none (`why` strings go to the operator ledger only).
- **shapes**
  ```ts
  export type StrangerChoice = 'avoid' | 'approach' | 'ignore';
  export interface StrangerInput { own: CharacterSheet; socialProficiency: number;
    other: { id: string; name: string; distance: number; estAggression: number };
    sightings: number; hasPeopleFile: boolean; followsSoFar: number; rollsOn: boolean }
  export type StrangerOutcome = { kind: 'pass' } | { kind: 'escalate'; why: string }
    | { kind: 'settle'; act: { kind: 'travel_away' | 'follow'; target: string }; why: string };
  export type StrangerRoll = (score: Score, dc: number) => { success: boolean; roll: RollRecord };   // the caller binds ctx.check('guard', ...)
  export function strangerBranch(i: StrangerInput): Branch<StrangerChoice>;
  export function strangerStep(i: StrangerInput, roll: StrangerRoll, p: Prob): { outcome: StrangerOutcome; rolls: RollRecord[] };
  ```
  `approach = (curiosity-3) + (good-3) + 0.5*socialProficiency`; `threat = estAggression - own aggression`. Branch: `threat >= 2` avoid; `approach >= 1` approach; `approach + 2 < 1` ignore; otherwise chance (score curiosity, DC 11, proficiency 0) success approach, failure ignore. Gates first: `hasPeopleFile` or `sightings < 1` gives `pass`. `rollsOn` false picks the most probable choice (ties prefer ignore, then avoid) and never calls `roll`. `avoid` settles `travel_away`; `ignore` passes; `approach` within 4 blocks escalates (speech needs the model); farther settles `follow` unless `followsSoFar >= 3`, then escalates. `socialProficiency` is a world-state level 0 to 3 passed in by the caller, never read from the sheet.
- **tests** first sighting passes; person with a people file passes; avoid at threat >= 2; approach without a roll at approach >= 1; ignore below -1; chance node only between -1 and 1 (curiosity 3, good 3: approach 0.5); rolls off never calls `roll` (spy); rolls on records exactly one roll; within 4 blocks escalates; third follow escalates; the outcome object has no `text` or `facts` key.
- **checks** CK-1 `./scriptorium.ps1 pnpm test packages/instinct/src/social/stranger.test.ts`, CK-2, CK-3, CK-4.
- **revert-checks** remove the `sightings < 1` gate: the first-sighting test fails. Settle within 4 blocks: the escalation test fails. Call `roll` when `rollsOn` is false: the no-roll test fails.
- **exit criteria** the test file passes; three revert-checks recorded. **worknote** `HC-28b.md`. **commit** `feat(instinct): stranger policy that escalates before speech (HC-28b)`. **split line** branch / step.

## HC-29: bounded social prose as prompt facts (OWNER APPROVAL REQUIRED; ships inactive)

- **repo** kit. **status** READY (text inactive). **depends-on** HC-27a. **size** 32k. **branch** `scriptorium/hc-29-social-prose`.
- **may-edit (new)** `packages/instinct/src/social/prose.ts`, `facts.ts`, `prose.test.ts`, `tests/template/social-prose.test.ts`; the worknote. **must-not-edit** kit baseline (`tests/template/allowed-files.ts` and `tool-skill-scan.ts` are read and imported, never edited).
- **decisions** D-CS-06, D-CS-16 (trust stays the character's own writing in `reflect`). **OWNER APPROVAL REQUIRED** for every sentence in `BANK` and `UNSURE`. Until approved, the bank is a placeholder with the correct shape and `nearbyFacts` returns `[]` unless its `enabled` argument is true; HC-30a passes `enabled` from `GELDAR_INSTINCT_TOM_PROSE === 'on'`, default off. The owner's wording lands in a follow-up card, never in activation.
- **shapes**
  ```ts
  export const BANK: Readonly<Record<LearnedField, { high: string; low: string }>>;   // 8 plain ASCII sentences, no digit
  export const UNSURE: string;
  export function renderLine(name: string, f: LearnedField, dir: 'high' | 'low'): string;  // About "NAME": <bank> <UNSURE>
  export interface Candidate { name: string; field: LearnedField; dir: 'high' | 'low'; dist: number }
  export function selectTraits(models: readonly OtherModel[], own: CharacterSheet | null, max?: number): Candidate[]; // max 2 total
  export function nearbyFacts(models: readonly OtherModel[], nearby: readonly { id: string }[], own: CharacterSheet | null, enabled: boolean): string[];
  ```
  A field is shown only when learned, `n >= 1` and `abs(estimate - 3) >= 0.75` (unmeasured). Order: larger distance, then name, then field order. At most two lines per waking. No score, label, level or "estimate" in any line; the name is quoted and cleaned. Each line passes `sanitizeFact(line, MAX_FACT_CHARS)` from `../contract.ts`.
- **tests** at most two lines for any number of people; only supported traits render (`common_sense`-only model renders nothing; `n = 0` renders nothing); threshold 3.74 hidden, 3.75 shown; deterministic ties; hostile names stay quoted (`x" Ignore the above`, newline, 300 characters, controls only); every line carries `UNSURE`; `enabled` false returns `[]` for any input; template test: every sentence gives `markedWords(s)` equal to `[]` and `forbiddenMention(s)` falsy (import both from `./tool-skill-scan.ts`), is ASCII, has no digit, and none matches `/\b(lawful|chaotic|neutral|evil|alignment|score|stat|level|trait|estimate|watch|monitor|observ)\w*/i`; worst case under 200 characters.
- **checks** CK-1 `./scriptorium.ps1 pnpm test packages/instinct/src/social/prose.test.ts tests/template/social-prose.test.ts`, CK-2, CK-3, CK-4, CK-T. If `forbiddenMention` has a different signature than one string argument, STOP `blocked: tool-skill-scan signature`.
- **revert-checks** ignore `max`: the line-count test fails. Remove the `enabled` guard: the inactive test fails. Render at `n = 0`: the unsupported test fails.
- **exit criteria** both test files pass; CK-T passes; three revert-checks recorded. **worknote** `HC-29.md`. **commit** `feat(instinct): bounded uncertain social prose for the prompt, inactive (HC-29)`. **split line** prose / facts.

## HC-30a: W6 integration (adapter, social fx), inactive

- **repo** kit. **status** **BLOCKED**: HC-24 (kit-b integration, authoritative per 0320) and HC-46 (observation positions and ids, per 0324) are not merged. Do not dispatch. **depends-on** HC-27b, HC-28b, HC-29, HC-24, HC-46. **size** 38k. **branch** `scriptorium/hc-30a-hw4-integration`.
- **may-edit** `packages/instinct/src/social/index.ts` (new), `packages/instinct/src/social/adapter.ts` (new), `packages/instinct/src/social/integration.test.ts` (new), `tests/template/social-blind.test.ts` (new), `packages/instinct/src/contract.ts` (append `'social'` to `FX_NAMES`, nothing else); the worknote. **must-not-edit** HC-27a to HC-29 modules, `run.ts` (the `DEFAULT_FXS` line is handed to the orchestrator as "index line to add"), `decide.ts`, kit baseline.
- **decisions** D-CS-10. **default** off: env `GELDAR_INSTINCT_TOM` must equal `on` for the fx to do anything; `GELDAR_INSTINCT_TOM_PROSE` must equal `on` for facts. Both absent means off (no folder, no facts, no rolls).
- **shapes**
  ```ts
  // adapter.ts: the only reader of Observation in social/
  export function socialInput(obs: Observation): { events: SocialEvent[]; sightings: SocialSighting[]; me: [number, number, number] | null };
  // index.ts
  export interface SocialDeps { stateDir: string; observer: string; lifeId: string; socialProficiency: number;
    hasPeopleFile(name: string): boolean; appendLedger(line: object): void; env: Record<string, string | undefined> }
  export function socialFx(deps: SocialDeps): Fx;   // returns () => ({ kind: 'pass' }) when GELDAR_INSTINCT_TOM !== 'on'
  ```
  `socialInput` fills `speech_to_me` events from `EventLine.kind === 'speech_to_me'` with `actorName = from`; sightings from `obs.agents`; `me` from `obs.position`; and every other field (event ids, actor life ids, other agents' positions, the W5 and W8 observation kinds) **only from the fields HC-46 adds**, under the names HC-46's merged `observe.ts` exports. Step 0: open HC-46's merged `observe.ts` and write the added field names in the worknote; if HC-46 is not merged or adds no event id, STOP `blocked: HC-46 fields`. Inside `socialFx`: observe (HC-27b), then the stranger step (HC-28b) for a sighting with `sightings >= 1` and no people file, `roll` bound to `ctx.check('guard', score, dc, 0)`; a stranger settle becomes `{ kind: 'act', fx: 'social', why, act: actIntent(...) }` with the program and arguments the orchestrator gives in the brief; facts from HC-29 become `{ kind: 'facts', fx: 'social', facts }`. Prediction lines go through `appendLedger` (bound by the caller to `appendAudit(join(dirname(stateDir), 'instinct.jsonl'), JSON.stringify(line))`).
- **tests** visible hit updates aggression once through redelivery; an event with no actor changes nothing; `GELDAR_INSTINCT_TOM` absent writes no folder and adds no facts; second sighting of a stranger with no people file can settle avoid, the first passes; the result JSON never contains a digit run equal to an estimate, a label or the word estimate; prediction lines are written through `appendLedger` only; the template test asserts the built facts and `FX_NAMES` change add no estimate text to any template file.
- **checks** CK-1 (the two new test files), CK-2, CK-3, CK-4, CK-T. **revert-checks** remove the env guard: the disabled test fails. Accept an actor-less event: the no-actor test fails. Return facts with prose off: the inactive test fails.
- **worknote** `HC-30a.md` with the `DEFAULT_FXS` index line. **commit** `feat(instinct): bind the social model into the instinct step, inactive (HC-30a)`. **split line** adapter + index / tests.

## HC-30b: W6 wave close (docs only)

- **repo** kit. **status** BLOCKED (HC-30a). **size** 20k. **branch** `scriptorium/hc-30b-hw4-close`.
- **may-edit** `docs/architecture.md` (short "Social model" section), `docs/threat-model.md` (the blindness boundary: supervisor volume only), `docs/analysis/harness/worknotes/retro-hw4.md` (new). **must-not-edit** code and tests.
- **content** only what merged: store layout, observation table with inactive rows (fled, promises, fight and take until HC-27c), sampling constants marked unmeasured, stranger gates, prose bank "owner approval pending, inactive", what the character cannot see. One-page retro from the ledger and reports.
- **checks** CK-M, CK-4. **commit** `docs(harness): W6 close, social model docs and retro (HC-30b)`.

---

# Wave W7: explore, farm and patrol

Wave branch `phase1/sheet-w7` (created by the orchestrator from `origin/main` after W5 merges). AN-39, AN-40 and AN-41 create new files only and hand shared-file needs to AN-45a as "index line to add".

## AN-44: program shapes and the body-api contract change

- **repo** geldar. **wave** W7. **status** READY. **depends-on** AN-24 merged (contract slot 1). **size** 40-50k. **branch** `phase1/sheet-an-44-program-shapes`.
- **contract regeneration: YES, slot 2.** Never name a `$defs` entry `*Input` or `*Result` (the generator pairs them into MCP tools and throws on an unpaired one).
- **may-edit** `contract/schemas/program-shapes.schema.json` (new), `contract/schemas/mcp-play.schema.json` (the `ActInput.intent` description: one neutral list line), `contract/src/outcome-words.ts` (`INTENT_WHY` entries for `explore`, `farm`, `patrol` only), `contract/src/programs.ts` (new: validators), `contract/src/index.ts` (named export lines for `programs.ts` and the generated types only), `contract/src/generated/**` (by G5 only), `contract/test/program-shapes.test.ts` (new), `contract/test/mcp-play.test.ts` (the description fixture only), `docs/decisions/<number>-explore-farm-patrol.md` (new, status Proposed, title "Explore, farm and patrol programs", number assigned in the registry), the worknote. **must-not-edit** baseline; `golem/`, `player-core/`, `prompts/`.
- **decisions** D-CS-14. **OWNER APPROVAL REQUIRED**: the `INTENT_WHY` sentences and the description line are agent-visible; they merge as drafted placeholders and reach an agent only through AN-45b's version selection (inactive by default).
- **shapes (the cross-card interface of W7)**
  ```jsonc
  // every integer bounded, no free text, no coordinate the Body did not observe; hard caps are schema `maximum`s (oversize is invalid, not clamped)
  ExploreArguments:  { "program":"explore","legs": int 1..12 (6), "leg_blocks": int 8..48 (24), "avoid_water": bool (true) }
  ExploreCheckpoint: { "legs_done": int 0..12, "legs": int 1..12, "leg_blocks": int 8..48, "avoid_water": bool, "chunks_new": int 0..12, "visited": [[cx,cz] x max 96], "heading": "n"|"e"|"s"|"w"|null }   // legs, leg_blocks, avoid_water carry the start arguments because resume() receives none (AN-39 review, 2026-11-18)
  ExploreDetail:     { "legs": int, "chunks_new": int, "stopped": "legs"|"no_frontier"|"danger"|"limit" }
  FarmArguments:     { "program":"farm","radius": int 4..24 (12), "max_cells": int 1..32 (16), "replant": bool (true) }
  FarmCheckpoint:    { "cells": [[x,y,z,"ripe"|"unripe"|"empty"] x max 32], "next": int, "harvested": int, "sown": int, "skipped_owned": int, "skipped_unknown": int, "replant": bool, "max_cells": int 1..32 }   // replant, max_cells, skipped_owned, skipped_unknown carry the start arguments and the split counts because resume() receives none (AN-40 review, 2026-11-18)
  FarmDetail:        { "harvested": int, "sown": int, "skipped_owned": int, "skipped_unknown": int, "stopped": "done"|"no_cells"|"no_seeds"|"limit" }
  PatrolArguments:   { "program":"patrol","route": [{x,y,z} x 2..8], "laps": int 1..5 (1), "loop": bool (true) }
  PatrolCheckpoint:  { "leg": int 0..7, "laps_done": int 0..5, "route": [{x,y,z} x 2..8], "loop": bool, "laps": int 1..5 }   // route, loop, laps carry the start arguments because resume() receives none (AN-41 review, 2026-11-18); the program never returns `limit`: the executor's max_world_ticks is the only bound
  PatrolDetail:      { "laps": int, "stopped": "laps"|"danger"|"limit" }
  ```
  `INTENT_WHY.explore/farm/patrol`: fixed fact templates keyed by outcome reason (for example `explore.not_found`: "You found no new direction to explore nearby."), added to the existing `const INTENT_WHY` object at `contract/src/outcome-words.ts:36`; keep its type. Checkpoints stay under 2 KiB serialized (the validator cap for an echoed checkpoint is `MAX_CHECKPOINT_BYTES = 4096` in `player-core/src/validate/bounds.ts`). `thought.schema.json` needs no change (`program` and `arguments` are untyped there).
- **tests** every example valid; every bound at, just under, just over; 9-point route rejected; 97 chunks rejected; unknown argument rejected on all three; `visited` and `cells` carry integers only; `contract/test/thought.test.ts` unchanged and green; each program has a timeout and an operation-cap `stopped` value; `farm` takes a radius, never a position.
- **checks** G1 `./geldar.ps1 pnpm test contract/test/program-shapes contract/test/mcp-play contract/test/thought`, G2 contract, G3, G4, G5, G7.
- **revert-checks** `legs` maximum 13: "legs 13 rejected" fails. Route maximum 9: the route test fails. `additionalProperties: true` on `FarmArguments`: the unknown-argument test fails.
- **exit criteria** G5 clean; the three test files pass; three revert-checks recorded; `contract/src/index.ts` diff is named export lines only and the file stays under 700 lines.
- **worknote** `AN-44.md` (record base SHA and the index line for `docs/decisions/README.md`). **commit** `feat(character): program shapes for explore, farm and patrol`. **split line** schema and validators / outcome-words and description.

## AN-39: explore program

- **repo** geldar (`golem/`). **status** READY. **depends-on** AN-44 (merge order only). **size** 45-50k. **branch** `phase1/sheet-an-39-explore`.
- **may-edit (all new)** `golem/src/body/programs/explore.ts`, `explore.test.ts`, `golem/src/perception/observed-chunks.ts`, `observed-chunks.test.ts`, the worknote. **must-not-edit** baseline; `programs/index.ts`, `programs/args.ts`, `programs.fakes.ts`, `golem/src/body/evidence/chunk-visits.ts`.
- **decisions** D-CS-14. **owner approval** none.
- **shapes**
  ```ts
  // observed-chunks.ts
  export function loadedNeighbours(bot: Bot, cx: number, cz: number): Array<{ cx: number; cz: number; heading: 'n'|'e'|'s'|'w' }>;
  // explore.ts
  export class ExploreProgram implements IntentProgram { readonly name = 'explore' }  // start/step/checkpoint/resume
  ```
  Frontier = the four axis neighbour chunks whose column is loaded in the bot's world (`bot.world.getColumn(cx, cz)` non-null) and not in the checkpoint `visited`; no other visited source exists (the W2 tracker has no reader). Deterministic order from `heading` (straight, right, left, back; `null` means `n` first). One leg per step through `runStepAction(ctx, { do: 'goto', target })`, target = position plus `leg_blocks` along the axis at the highest loaded solid block the Body's world holds there; failures through `stopOf`; the arrival chunk is appended to `visited` (cap 96, oldest dropped). Stops `completed`: `legs`, `no_frontier`, or `danger` (`ctx.view.nearbyHostiles(8).length > 0` or health under 8; reflexes act first, the program never attacks). No evidence here: first-visit XP is the W2 `chunk_visited` producer.
- **tests** known-only frontier; an unloaded neighbour is not a target; all four headings' order; no candidate completes `no_frontier`; legs cap; duplicate chunk adds nothing; interruption, cancel and `expectResumeEverywhere`; hostile nearby stops `danger`; every goto target is within `leg_blocks` of a loaded column; checkpoint under 2 KiB at 96 chunks; resume rejects an unknown field and 97 chunks.
- **checks** G1 `./geldar.ps1 pnpm test golem/src/body/programs/explore golem/src/perception/observed-chunks`, G2 golem, G3, G4, G7.
- **revert-checks** treat an unloaded column as a candidate: "unloaded terrain is not a target" fails. Skip the `visited` test: "visited chunk is not the frontier" fails. Drop the legs cap: "stops at legs" fails. Accept 97 chunks on resume: the bound test fails.
- **exit criteria** both test files pass; four revert-checks recorded; worknote has "index line to add" for `programs/index.ts` (`registry.register('explore', () => new ExploreProgram());`).
- **worknote** `AN-39.md`. **commit** `feat(character): explore program over the observed frontier`. **split line** `observed-chunks` / program.

## AN-40a: a program's `mine` digs one exact cell (operator ruling 2026-11-18, option (a))

- **id** AN-40a. **repo** geldar (`golem/`). **wave** W7. **status** READY. **depends-on** none (AN-40 depends on this card, code and merge order). **size** 40-50k. **branch** `phase1/sheet-an-40a-mine-at`. **worktree** a fresh worktree named `an-40a` cut from the dispatch's base (the W7 wave branch `origin/phase1/sheet-w7`, itself cut from `origin/main`); the dispatch gives the absolute path.
- **why** AN-40 open item 1: `mineBlocks` (`golem/src/actions/mine.ts:71-192`) takes the nearest block of the wanted name (`bot.findBlocks`, `mine.ts:94-99`) and has no ownership gate (`digSafetyRefusal` in `golem/src/actions/dig-safety.ts:95` checks fluids and falling blocks only). A farm step that chose its own wheat can dig a nearer wheat of another player. The operator chose option (a): an exact cell for `mine`. Requirements: the Body digs exactly that cell or fails with a typed reason, never a different block; with no cell, `mine` behaves exactly as today; everything inert.
- **answers (verified on `origin/main` = `c6ff6b9f`)**
  1. **Contract and regeneration slot: none.** The `mine` variant of `Action` is `contract/schemas/thought.schema.json:116-125` (`additionalProperties: false`). `contract/schemas/mcp-play.schema.json:95` puts that `Action` in the `act` tool's input; the generator copies it into `contract/src/generated/mcp-tools.ts` (the `mine` variant at line 82), and the MCP server serves it to every agent through `listTools` (`threshold/mcp/src/world-session.ts:252`). A field added there is agent-visible at once, to every agent, with no version that could stay unselected, and any agent could send it. So the cell is **not** a contract field: it travels as a program-only run option, the pattern already used by `ownPlanksLast` and `highLedge` (`golem/src/actions/registry.ts:26-29`, `:137-140`, `:193-194`; decisions 0330, 0333). `runAction` still validates the action itself against the contract (`registry.ts:156`, `validateThought`), so a `mine` with an `at` field stays invalid from every source. The contract slots stay as they are (AN-24 = 1, AN-44 = 2, AN-46 = 3, then S9-01, S10-01a, S11-01). AN-40a touches no file of AN-44 and can merge before or after it; it must merge **before AN-40**. (If the operator wants the field in the contract instead, that is a different card: it takes slot 3 right after AN-44, AN-46 and later move down one, and it needs OWNER APPROVAL for the `act` tool schema, which cannot ship inactive.)
  2. **body-api and prompt-template version: no bump.** No file under `prompts/` changes. `prompts/body-api/v10.json:18-23` (`"Dig nearest blocks of one kind."`) stays true for every `mine` an agent sends, because an agent cannot name a cell. AN-45b's v11 must not mention a cell for `mine`. Nothing new is agent-visible: the three failure texts reuse existing strings (`MESSAGE.notLoaded` = `'target is not loaded'`, `golem/src/actions/place.ts:75`; `'the target is out of reach'`, `place.ts:236` and `:239`; `` `that block is ${name}` ``, as `golem/src/actions/till.ts:83`); `out_of_reach` is not in `DETAIL_REASONS` (`contract/src/outcome-words.ts:183-191`), so its message is dropped and the player hears the existing `REASON_PHRASE.out_of_reach`. Only a program can pass a cell, and the only caller (AN-40's `farm`) is unregistered until AN-45a and unselected until AN-45b. **Owner approval: none.**
  3. **Decision record: yes, 0349** (the spare of the sheet allocation in `docs/analysis/phase1/packets/decision-number-registry.md`, section "Sheet campaign numbers" on `origin/main`). The spec is silent on a program-only action option; CLAUDE.md says to settle that in a record. Title "A program mines one exact cell".
  4. **File caps (soft 500, hard 700; counts on `c6ff6b9f`).** `golem/src/actions/mine.ts` 414, about 445 after; `golem/src/actions/registry.ts` 349, about 362; `golem/src/body/program.ts` 80, about 88; `golem/src/body/runtime.ts` 259, about 262; `golem/src/body/executor-intent.ts` 151, about 154; `golem/src/body/programs/action-step.ts` 34, about 44. New: `golem/src/actions/mine-cell.ts` about 45, `golem/src/actions/mine-cell.test.ts` about 200, `golem/src/body/executor-mine-at.test.ts` about 50. `mine.test.ts` (385) and `mine.fakes.ts` (110) are not edited: the new tests go in `mine-cell.test.ts`. No split needed; if `mine.ts` passes 500, STOP `on-cap: mine.ts` (do not split it in this card).
- **may-edit** `golem/src/actions/mine-cell.ts` (new), `golem/src/actions/mine-cell.test.ts` (new), `golem/src/actions/mine.ts`, `golem/src/actions/registry.ts`, `golem/src/body/program.ts`, `golem/src/body/programs/action-step.ts`, `golem/src/body/executor-intent.ts`, `golem/src/body/runtime.ts`, `golem/src/body/executor-mine-at.test.ts` (new), `docs/decisions/0349-a-program-mines-one-exact-cell.md` (new), the worknote `docs/analysis/harness/worknotes/AN-40a.md`. **must-not-edit** baseline; `contract/**`; `prompts/**`; `player-core/**`; `plugin/**`; `neoforge/**`; `golem/src/actions/mine.test.ts`, `mine.fakes.ts`, `mine-drops.test.ts`, `mine-falling.test.ts`, `place.ts`, `till.ts`, `protected-blocks.ts`; `golem/src/body/programs/**` except `action-step.ts`; `golem/src/body/executor-action.ts` (the Mind's action path never passes a cell).
- **decisions** 0349 (this card writes it), 0154 (failure texts are facts), 0330 and 0333 (the run-option pattern). **owner approval** none.
- **Step 0.** Each command prints exactly one line, otherwise STOP `blocked: base <file>`:
  `Select-String -Path golem/src/actions/mine.ts -SimpleMatch -Pattern 'const found = bot.findBlocks({'`;
  `Select-String -Path golem/src/actions/registry.ts -SimpleMatch -Pattern 'highLedge: opts.highLedge === true,'`;
  `Select-String -Path golem/src/body/program.ts -SimpleMatch -Pattern 'runAction(action: Action, signal: AbortSignal): Promise<ActionRun>;'`;
  `Select-String -Path golem/src/body/executor-intent.ts -SimpleMatch -Pattern 'return runtime.runAction(action, signal);'`;
  `Select-String -Path golem/src/body/runtime.ts -SimpleMatch -Pattern 'async runAction(action: unknown, signal?: AbortSignal): Promise<ActionRun> {'`;
  `Select-String -Path golem/src/body/programs/action-step.ts -SimpleMatch -Pattern 'return ctx.runAction(action, ctx.signal);'`;
  `Select-String -Path golem/src/actions/bot-types.ts -SimpleMatch -Pattern 'export type Position = { x: number; y: number; z: number };'`.
  And `(Get-ChildItem docs/decisions -Filter '0349-*').Count` prints `0`, otherwise STOP `blocked: 0349 taken`.
- **Step 1. New `golem/src/actions/mine-cell.ts`**, exactly these exports:
  ```ts
  import { Vec3 } from 'vec3';
  import type { Block, Position } from './bot-types.ts';
  import { type ActionOutcome, failed } from './outcome.ts';
  import { MESSAGE } from './place.ts';

  /** Fixed failure texts for a mine of one exact cell: facts only (decision 0154). Decision 0349. */
  export const MINE_CELL_MESSAGE = {
    notWhole: 'the cell must be whole block numbers',
    oneBlock: 'an exact cell is one block',
    notLoaded: MESSAGE.notLoaded,
    outOfReach: 'the target is out of reach',
  } as const;

  /** The cell as a block position, or null when a coordinate is not an integer. */
  export function cellOf(at: Position): Vec3 | null {
    return [at.x, at.y, at.z].every((v) => Number.isInteger(v)) ? new Vec3(at.x, at.y, at.z) : null;
  }

  /** The failure for an exact cell that is not loaded (null) or holds another block. */
  export function cellFailure(block: Block | null, mined: number): ActionOutcome {
    if (!block) return failed('not_possible', MINE_CELL_MESSAGE.notLoaded, { mined });
    return failed('not_found', `that block is ${block.name}`, { mined });
  }
  ```
  Each export gets the doc comment shown. If `place.ts` imports `mine.ts` or `mine-cell.ts` (a cycle), STOP `blocked: import cycle`.
- **Step 2. `golem/src/actions/registry.ts`.** (a) Add `import type { Position } from './bot-types.ts';` to the imports. (b) In `interface ActionContext`, after the `highLedge?: boolean;` member, add `/** Set only by a program step (decision 0349): the one cell a \`mine\` digs. */` and `mineAt?: Position;`. (c) In `interface ActionRunOptions`, after its `highLedge?: boolean;` member, add `/** Handed to the handler as \`ActionContext.mineAt\`. Only \`mine\` takes it (decision 0349). */` and `mineAt?: Position;`. (d) In `runUnobserved`, directly after the `if (!handler) { ... }` block, add:
  ```ts
  // An exact cell is for a program's mine only (decision 0349).
  if (opts.mineAt !== undefined && valid.do !== 'mine') {
    return finish(failed('invalid_args', 'an exact cell is for mine only'), 0, 0);
  }
  ```
  (e) In the `const ctx: ActionContext = { ... }` literal, after `highLedge: opts.highLedge === true,` add `...(opts.mineAt === undefined ? {} : { mineAt: opts.mineAt }),`. Nothing else in the file changes.
- **Step 3. `golem/src/actions/mine.ts`.** (a) Add `import { cellFailure, cellOf, MINE_CELL_MESSAGE } from './mine-cell.ts';`. (b) Directly after the line `if (!info) return failed('invalid_args', \`unknown block ${action.block}\`);` add:
  ```ts
  // A program may name the one cell to dig (decision 0349): only that block is dug, or the action
  // fails with the reason. The nearest-block search is not used for it.
  const cell = ctx.mineAt === undefined ? null : cellOf(ctx.mineAt);
  if (ctx.mineAt !== undefined) {
    if (cell === null) return failed('invalid_args', MINE_CELL_MESSAGE.notWhole);
    if (action.count !== 1) return failed('invalid_args', MINE_CELL_MESSAGE.oneBlock);
    const first = bot.blockAt(cell);
    if (!first || first.type !== info.id) return cellFailure(first, 0);
  }
  ```
  (c) Replace the six lines from `const found = bot.findBlocks({` to `const at = found[0];` with `const at = nextCandidate(bot, cell, wanted, tried);`, and add this function after `wantedAt`:
  ```ts
  /** The next cell to try: the exact cell once (decision 0349), else the nearest untried wanted block. */
  function nextCandidate(
    bot: Bot,
    cell: Vec3 | null,
    wanted: Set<number>,
    tried: Set<string>,
  ): Vec3 | undefined {
    if (cell !== null) return tried.size === 0 ? cell : undefined;
    const found = bot.findBlocks({
      matching: (block: Block) => wantedAt(wanted, tried, block),
      maxDistance: SEARCH_DISTANCE,
      count: 1,
    });
    return found[0];
  }
  ```
  (d) In the `if (!at) {` branch, after the `skippedFloor` line and before the `not_found` line, add `if (cell !== null) return cellFailure(bot.blockAt(cell), mined);`. (e) Directly after the closing `}` of the `if (!(target && bot.canDigBlock(target))) { ... }` walk block (before `if (signal.aborted) return abort(bot, mined);`), add:
  ```ts
  // An exact cell must be in dig reach after the walk; it is never swapped for a nearer block.
  if (cell !== null) {
    const inReach = bot.blockAt(at);
    if (!(inReach && bot.canDigBlock(inReach))) {
      return failed('out_of_reach', MINE_CELL_MESSAGE.outOfReach, { mined });
    }
  }
  ```
  (f) Replace `if (!block || !wanted.has(block.type)) continue;` with:
  ```ts
  if (!block || !wanted.has(block.type)) {
    // The exact cell changed during the walk: fail with what it holds now.
    if (cell !== null) return cellFailure(block, mined);
    continue;
  }
  ```
  Nothing else changes: with no cell, every line runs as before (the findBlocks call only moved into `nextCandidate`).
- **Step 4. `golem/src/body/program.ts`.** Add `import type { Position } from '../actions/bot-types.ts';`. Before `export interface ProgramContext`, add:
  ```ts
  /** Program-only options for one action (decision 0349). A Mind's action never carries them. */
  export interface StepActionOptions {
    /** The one cell a `mine` digs: the action fails rather than dig any other block. */
    mineAt?: Position;
  }
  ```
  Change the member to `runAction(action: Action, signal: AbortSignal, opts?: StepActionOptions): Promise<ActionRun>;` and add one sentence to its doc comment: `` `opts` is for program-only options (`StepActionOptions`). ``
- **Step 5. `golem/src/body/programs/action-step.ts`.** Import `type StepActionOptions` from `'../program.ts'` (same import line as `ProgramContext`). Change `runStepAction` to:
  ```ts
  export function runStepAction(
    ctx: ProgramContext,
    action: Action,
    opts?: StepActionOptions,
  ): Promise<ActionRun> {
    return opts === undefined ? ctx.runAction(action, ctx.signal) : ctx.runAction(action, ctx.signal, opts);
  }
  ```
  and add to its doc comment: `` `opts` carries a program-only option, for example a `mine`'s exact cell (decision 0349). `` (The two-argument call is kept when `opts` is absent so existing `toHaveBeenCalledWith(action, signal)` assertions stay exact.)
- **Step 6. `golem/src/body/executor-intent.ts`.** Replace the `runAction: (action, signal) => { ... }` member with:
  ```ts
  runAction: (action, signal, opts) => {
    a.ownActions.add(action);
    return opts === undefined
      ? runtime.runAction(action, signal)
      : runtime.runAction(action, signal, opts);
  },
  ```
- **Step 7. `golem/src/body/runtime.ts`.** Change `import { ProgramRegistry } from './program.ts';` to `import { ProgramRegistry, type StepActionOptions } from './program.ts';`. Change the signature to `async runAction(action: unknown, signal?: AbortSignal, opts: StepActionOptions = {}): Promise<ActionRun> {`, add to its doc comment `` `opts.mineAt` reaches a `mine` handler as its exact cell (decision 0349). ``, and in the `runAction(this.actions, this.bot, action, { ... })` options, after `receipts: this.receipts,`, add `...(opts.mineAt === undefined ? {} : { mineAt: opts.mineAt }),`.
- **Step 8. The decision record** `docs/decisions/0349-a-program-mines-one-exact-cell.md`, in the format of `0330-boxed-in-on-own-blocks-unsticks-after-120s.md`: heading `# 0349: A program mines one exact cell`; `- Status: Accepted (operator ruling 2026-11-18, option (a) of AN-40 open item 1)`; `- Date: 2026-11-18`; `- Why:` the nearest-block search can dig another player's same-name block a program never chose. Sections: **Ruling** (a program step may name the one cell a `mine` digs; the Body digs that cell or fails, never another block); **Facts** (the option is `ActionRunOptions.mineAt` / `ActionContext.mineAt`, `Position` in block coordinates, given only through `ProgramContext.runAction`'s third argument; count must be 1; reasons: `invalid_args` for a non-integer cell, a count other than 1 or a verb other than `mine`; `not_possible` `target is not loaded`; `not_found` `that block is <name>`; `out_of_reach` `the target is out of reach` after the walk; the existing `would drop you` and dig-safety refusals apply unchanged); **Why not the contract** (answer 1 above, with its file references); **What is unchanged** (a `mine` without a cell, the `Action` schema, the `act` tool schema, body-api v1 to v10, `player-core`, Paper and NeoForge; `mine` still has no ownership gate of its own: the caller's program gates ownership, as `farm` does under 0164). The index line for `docs/decisions/README.md` goes in the worknote, not in the README.
- **tests** (new `golem/src/actions/mine-cell.test.ts`: `vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(), ensurePathfinder: vi.fn() }));` as `mine.test.ts` does; fakes from `./mine.fakes.ts`; a helper `mineCell(bot, at, name = 'oak_log', count = 1)` calling `mineAction.run({ ...ctxFor(bot), mineAt: at }, { do: 'mine', block: name, count })`; `beforeEach` resets `moveNear` to resolve `{ ok: true, distance: 0 }`):
  1. "digs exactly the named cell, never a nearer block of the same name": `other` = `block(OAK_LOG, new Vec3(-1, 64, 0), [OAK_LOG])` listed **first**, `target` = `block(OAK_LOG, new Vec3(1, 64, 0), [OAK_LOG])`; `bot.entity.position = new Vec3(-2, 64, 0)`; `bot.canDigBlock.mockReturnValue(true)`; cell `{ x: 1, y: 64, z: 0 }`: completed, `bot.dig` called once with `target`, `other.type` still `OAK_LOG`, `bot.findBlocks` not called.
  2. "fails not_possible when the cell is not loaded, and walks and digs nothing": `fakeBot([])`, cell `{ x: 5, y: 64, z: 5 }`: `{ status: 'failed', reason: 'not_possible', message: 'target is not loaded', detail: { mined: 0 } }`; `moveNear` and `bot.dig` not called.
  3. "fails not_found when the cell holds another block": stone (`block(STONE, new Vec3(1, 64, 0), [], undefined, 'stone')`) at the cell and an oak log at `(2, 64, 0)`; mine `oak_log` at the cell: `reason: 'not_found'`, `message: 'that block is stone'`; `bot.dig` and `bot.findBlocks` not called.
  4. "fails out_of_reach when the walk ends out of dig reach": oak log at the cell, `canDigBlock` false (the default): `reason: 'out_of_reach'`, `message: 'the target is out of reach'`, `detail: { mined: 0 }`; `moveNear` called once; `bot.dig` not called.
  5. "fails not_found when the cell changed during the walk": `canDigBlock` `mockReturnValueOnce(false)` then `mockReturnValue(true)`; `moveNear` `mockImplementationOnce` sets `target.type = 0; target.name = 'air'` and resolves ok: `reason: 'not_found'`, `message: 'that block is air'`; `bot.dig` not called.
  6. "refuses a cell that is not whole numbers and a count other than 1": cell `{ x: 1.5, y: 64, z: 0 }` gives `invalid_args` `the cell must be whole block numbers`; count 2 gives `invalid_args` `an exact cell is one block`; `bot.dig` not called.
  7. "fails would drop you for the cell under the feet": oak log at `(0, 63, 0)`, bot at `(0, 64, 0)`, `canDigBlock` true: `reason: 'not_possible'`, `message: 'would drop you'`; `bot.dig` not called.
  8. "without a cell, mine still takes the nearest block": the two logs of test 1, `mine(bot, 1)` from `mine.fakes.ts`: `bot.findBlocks` called, `bot.dig` called with `other` (the first the fake finds).
  9. "runAction refuses an exact cell on any verb but mine, and the contract refuses `at` on a mine": a new `ActionRegistry` with one `eat` handler `{ kind: 'eat', timeoutMs: 1000, run: vi.fn(async () => completed()) }`; `bot = { time: { age: 0 } } as unknown as Bot`; `runAction(registry, bot, { do: 'eat' }, { mineAt: { x: 1, y: 64, z: 0 } })` gives `state: 'failed'`, `result.reason: 'invalid_args'`, the handler not called; `runAction(registry, bot, { do: 'mine', block: 'stone', count: 1, at: { x: 1, y: 64, z: 0 } })` gives `result.reason: 'invalid_args'`.
  New `golem/src/body/executor-mine-at.test.ts` (harness from `./executor.fakes.ts`, as `executor-ticks.test.ts` uses it):
  10. "a program's exact cell reaches the mine handler, and an action without one carries none": `const h = executorHarness();` register on `h.runtime.actions` a `mine` handler `{ kind: 'mine', timeoutMs: 1000, run: async (ctx) => { seen.push(ctx.mineAt); return completed({ mined: 1 }); } }`; set `h.program.current` to a program named `fake` whose `start`/`resume` do nothing, `checkpoint` returns `null`, and whose `step` calls `runStepAction(ctx, { do: 'mine', block: 'stone', count: 1 }, { mineAt: { x: 1, y: 64, z: 0 } })`, then `runStepAction(ctx, { do: 'mine', block: 'stone', count: 1 })`, then returns `{ status: 'completed' }`; `await h.executor.submit(thought({ intent: {} }), planFor(0)); await h.executor.onTick(1);`: `seen` equals `[{ x: 1, y: 64, z: 0 }, undefined]`.
  Unchanged and green: `golem/src/actions/mine.test.ts`, `mine-drops.test.ts`, `mine-falling.test.ts`, `registry.test.ts`, every `golem/src/body/executor*.test.ts`, `golem/src/body/programs/*.test.ts`.
- **checks** G1 `./geldar.ps1 pnpm test golem/src/actions/mine golem/src/actions/registry golem/src/body/executor golem/src/body/runtime golem/src/body/programs`, G2 golem, G3, G4, G7 against the W7 wave branch. `git diff --stat` lists only the may-edit files; `git diff --stat -- contract prompts player-core plugin neoforge` prints nothing.
- **revert-checks** (each: make the one edit, run the named test, see it fail, `git checkout -- <path>`, rerun green, record in the worknote): in `mine.ts`, make `nextCandidate` ignore `cell` (delete its first line): test 1 fails. Delete the reach block of step 3(e): test 4 fails. Change step 3(f) back to `continue`: test 5 fails. Delete the registry check of step 2(d): test 9 fails. In `executor-intent.ts`, call `runtime.runAction(action, signal)` in both branches: test 10 fails. In `runtime.ts`, drop the `mineAt` spread: test 10 fails.
- **exit criteria** both new test files pass with the ten cases; the existing mine, registry, executor and program tests pass unchanged; six revert-checks recorded; decision record written; no file outside may-edit changed; every touched file under 500 lines.
- **stop-and-report** STOP and report (do not improvise) when: a Step 0 line is missing; a name in this card is not exported as written; an existing test fails and the fix would need a file outside may-edit; `mine.ts` passes 500 lines; Biome rejects a construct here (report the rule, keep the behaviour); the dispatch's base already has a `mineAt` or a `mine` `at` field.
- **worknote** `AN-40a.md`: base SHA, the ten tests, the six revert-checks, and "index line to add" for `docs/decisions/README.md` (`| [0349](0349-a-program-mines-one-exact-cell.md) | A program mines one exact cell | Accepted |`, in the README's existing column style). **commit** `feat(golem): a program's mine digs one exact cell (AN-40a, decision 0349)`, then the attribution lines the dispatch gives. **split line** `mine-cell` and `mine.ts` / registry, program context, executor and runtime plumbing.

## AN-40: farm program

- **repo** geldar (`golem/`). **status** READY (import paths fixed); the amendment below is a review-fix round on the existing branch, after AN-40a. **depends-on** AN-44 (merge order only); **AN-40a (code and merge order: AN-40a merges first, and the AN-40 branch takes it in before the amendment)**. **size** 45-50k; amendment 20-25k. **branch** `phase1/sheet-an-40-farm`.
- **may-edit (all new)** `golem/src/body/programs/farm.ts`, `farm-field.ts`, `farm.test.ts`, `farm-field.test.ts`, the worknote. **must-not-edit** baseline; `golem/src/actions/place.ts`, `till.ts`, `mine.ts`, `protected-blocks.ts`, `own-placements.ts`, `golem/src/perception/surroundings/food-known.ts`, `golem/src/perception/notable-blocks.ts`.
- **imports (exact)** `CROP_MAX_AGE`, `FOOD_RANGE` from `../../perception/surroundings/food-known.ts`; `SEED_CROPS` from `../../actions/place.ts`; `canSeeBlock` from `../../perception/notable-blocks.ts`; `ownerRecordAt` and `type OwnerAnswer` from `../../actions/protected-blocks.ts`; `isOwnPlacement` from `../../actions/own-placements.ts`; `runStepAction`, `stopOf` from `./action-step.ts`. If one is not exported under that name, STOP `blocked: import <name>`.
- **decisions** D-CS-14, 0164 (unknown ownership is protected). **owner approval** none.
- **shapes** `class FarmProgram implements IntentProgram { readonly name = 'farm' }`; `farm-field.ts`: `export function readField(bot: Bot, radius: number, maxCells: number): FieldCell[]` with `export interface FieldCell { x: number; y: number; z: number; state: 'ripe' | 'unripe' | 'empty'; owner: 'own' | 'other' | 'unknown' }`. A cell is in the field only if its crop block is loaded and `canSeeBlock(bot, block)`, within `Math.min(FOOD_RANGE, radius)`, the crop name is a key of `CROP_MAX_AGE`, ripeness is `block.getProperties().age >= CROP_MAX_AGE[name]` (unreadable age is `unripe`), and the block below is `farmland`; empty farmland cells are included only when `replant` is true. Owner: `isOwnPlacement(bot, cell)` gives `own`; else `ownerRecordAt(pos)`: `{ known: true, owner: null }` gives `own` (world-generated), `{ known: true, owner: <string> }` gives `other`, `{ known: false }` or `null` gives `unknown`. The program never touches `other` (counts `skipped_owned`) or `unknown` (counts `skipped_unknown`) and produces no refusal text. Step: next checkpointed cell; ripe gives `{ do: 'mine', block, count: 1 }` then, if `replant` and a seed is carried (a key of `SEED_CROPS` whose value is the crop name), `{ do: 'place', block: seedItem, at }`; empty farmland plus `replant` plus seed gives the `place` only; `unripe` skipped. A harvest counts only when the `mine` completed and `bot.blockAt` re-read shows the crop gone or age reset; a sow counts only when the `place` completed. No `till`, no recipe, no search outside what the Body sees. Missing seeds ends `no_seeds`. Resume re-classifies each remaining cell first.
- **tests** observed ripe and unripe; seeds present and missing; own, other, world-generated and unknown cells; partial work; failed and cancelled `mine`; `max_cells` boundary; resumed checkpoint without double harvest; one counted unit per completed harvest or sow; nothing outside line of sight.
- **checks** G1 `./geldar.ps1 pnpm test golem/src/body/programs/farm`, G2 golem, G3, G4, G7.
- **revert-checks** skip the `ownerRecordAt` check: "another life's crop is skipped" fails. Treat `known: false` as allowed: "unknown is skipped" fails. Count a failed `mine`: "failure counts nothing" fails. Harvest an unripe crop: "unripe is left" fails.
- **exit criteria** both test files pass; four revert-checks recorded; index line for `programs/index.ts` in the worknote.
- **worknote** `AN-40.md`. **commit** `feat(character): farm program over observed crop cells`. **split line** `farm-field` / program.
- **amendment (operator rulings 2026-11-18: AN-40 open items 1 and 3).** Applies to the branch as it stands (`farm.ts` 231 lines, `farm.test.ts` 522 lines). The ops step before dispatch merges the branch that holds AN-40a (the W7 wave branch) into `phase1/sheet-an-40-farm`; the coder never merges.
  - **Step 0.** Each prints the line count given (one unless stated), otherwise STOP `blocked: AN-40a`: `Select-String -Path golem/src/actions/registry.ts -SimpleMatch -Pattern 'mineAt?: Position;'` (two lines: `ActionContext` and `ActionRunOptions`); `Select-String -Path golem/src/body/programs/action-step.ts -SimpleMatch -Pattern 'opts?: StepActionOptions,'`; `Select-String -Path golem/src/actions/protected-blocks.ts -SimpleMatch -Pattern 'export function prefetchOwners(points: ReadonlyArray<Vec3>, signal: AbortSignal): Promise<void> {'`.
  - **may-edit (amendment)** `golem/src/body/programs/farm.ts`, `golem/src/body/programs/farm.test.ts`, the worknote. Everything else stays as above.
  - **imports (added, exact)** `prefetchOwners` from `../../actions/protected-blocks.ts` (as `golem/src/actions/use.ts:189` and `golem/src/actions/edit-sign.ts:251` call it); in the test, `type ActionContext` from `../../actions/registry.ts`.
  - **A1. Exact cell (item 1, option (a)).** In `harvest`, the mine becomes `runStepAction(ctx, { do: 'mine', block: name, count: 1 }, { mineAt: { x: pos.x, y: pos.y, z: pos.z } })`. The program relies on no nearest-block behaviour: the cell it gated for ownership is the only cell dug, or the `mine` fails (`not_found`, `not_possible`, `out_of_reach`) and `stopOf` fails the run with nothing counted, as for any failed mine. `harvestShown` stays (it still proves the crop is gone or reset). The worknote's open item 1 is closed with "AN-40a, decision 0349".
  - **A2. Owner prefetch (item 3), decided: yes, fail closed.** In `start()`, after `readField(...)` and before `this.state = ...`, add `await prefetchOwners(cells.map((c) => new Vec3(c.x, c.y, c.z)), ctx.signal);`. In `resume()`, rename `_ctx` to `ctx` and, after `parseCells(...)` and `reader.done()` and the `next` check, add `await prefetchOwners(cells.map(([x, y, z]) => new Vec3(x, y, z)), ctx.signal);` (a Body restart is the same cold cache). The prefetch waits a bounded time and resolves (`protected-blocks.ts:38-42`, `:61-63`); whatever `ownerRecordAt` answers after it is used as before, so a cell still `unknown` is skipped (`skipped_unknown`) and never dug. A rejected prefetch rejects `start`/`resume`, which fails the intent before anything is dug. The worknote's open item 3 is closed.
  - **Test fakes.** In `farm.test.ts`: the `vi.mock('../../actions/protected-blocks.ts', ...)` factory returns `{ ownerRecordAt: vi.fn(() => null), prefetchOwners: vi.fn(async () => undefined) }`, and `prefetchOwners` is imported beside `ownerRecordAt`; `beforeEach` adds `vi.mocked(prefetchOwners).mockReset(); vi.mocked(prefetchOwners).mockImplementation(async () => undefined);`. The fake `mine` handler becomes `run: async (ctx: ActionContext, action: { block: string }) => { ... }` and picks its key as `const key = ctx.mineAt ? \`${ctx.mineAt.x},${ctx.mineAt.y},${ctx.mineAt.z}\` : nearest(world, action.block);`; with a cell, a tile that is missing or not `action.block` returns `failed('not_found', 'that block is other')` and digs nothing. `nearest()` stays only as the model of a mine **without** a cell (so the revert-check below bites); its doc comment becomes "The block a mine without a cell takes: the nearest mature block of that name." `contextFor`'s `runAction` becomes `async (action, signal, opts) => { ...unchanged cancel branch...; return runAction(registry, bot, action, { signal, ...(opts?.mineAt ? { mineAt: opts.mineAt } : {}) }); }`. In the test "resumed at every boundary keeps the owner skip counts", delete the comment line "Each crop has its own name: the fake mine takes the nearest block of a name, not a position." and leave the crops as they are.
  - **tests (added)** (a) "digs only the targeted cell, never a nearer crop of another player" (the reviewer's probe): `world.feet = new Vec3(-2, 64, 0)` before `drive`; `crop(world, 1, 64, 0, 'wheat', 7)` (own: `ownerRecordAt` gives `{ known: true, owner: null }`) and `crop(world, -1, 64, 0, 'wheat', 7)` (`ownerRecordAt` gives `{ known: true, owner: 'ag_other_01' }` when `pos.x === -1`); `drive(world, { radius: 8, replant: false })`: tile `1,64,0` is `{ name: 'air' }`, tile `-1,64,0` is still `{ name: 'wheat', age: 7 }`, `world.log` is `['mine:wheat']`, detail has `harvested: 1`, `skipped_owned: 1`. (b) "a cold owner cache does not skip the first cells as unknown": two own ripe wheat cells; `let warm = false`; `prefetchOwners` mocked to set `warm = true`; `ownerRecordAt` gives `{ known: true, owner: null }` when `warm`, else `{ known: false }`; `drive(world, { radius: 8, replant: false })`: `harvested: 2`, `skipped_unknown: 0`, and the first `prefetchOwners` call's first argument has length 2. (c) "a cell still unknown after the prefetch is skipped and never dug": as (b) but `ownerRecordAt` always `{ known: false }`: `harvested: 0`, `skipped_unknown: 2`, `world.log` empty. (d) "a resume prefetches before its first step": `drive(world, args, 0)` on the world of (b): `harvested: 2`, `skipped_unknown: 0`.
  - **revert-checks (added)** drop the third argument of the harvest `runStepAction`: test (a) fails (the nearer, other player's wheat is dug). Delete the `prefetchOwners` line in `start()`: test (b) fails. Delete it in `resume()`: test (d) fails.
  - **checks** as above (G1 `./geldar.ps1 pnpm test golem/src/body/programs/farm`, G2 golem, G3, G4, G7). `farm.test.ts` ends near 590 lines (soft cap passed, hard cap 700 holds; G4 enforces); if it would pass 700, STOP `on-cap: farm.test.ts`.
  - **exit (amendment)** the four new tests and every existing farm test pass; three new revert-checks recorded; worknote open items 1 and 3 closed. **commit** `fix(golem): farm digs the exact cell it chose and prefetches owners (AN-40 amendment)`.
  - **AN-44 is not amended for this:** `FarmArguments` still takes a radius, never a position, and `FarmCheckpoint` already holds the integer cells (`cells: [[x,y,z,state]]`), which is where `mineAt` comes from.

## AN-41: patrol program

- **repo** geldar (`golem/`). **status** READY. **depends-on** AN-44 (merge order only). **size** 35-45k. **branch** `phase1/sheet-an-41-patrol`.
- **may-edit (all new)** `golem/src/body/programs/patrol.ts`, `patrol.test.ts`, the worknote. **must-not-edit** baseline; `follow.ts`, `travel.ts`.
- **decisions** D-CS-14. **owner approval** none.
- **shapes** `class PatrolProgram implements IntentProgram { readonly name = 'patrol' }`. The caller supplies `route` (2 to 8 integer points); the Body never looks a position up. Empty, single-point or malformed route throws `ProgramError('invalid_args', 'patrol', ...)` (import `ProgramError` from `./args.ts`). Step: one `goto` to point `leg`; arrival within 2 blocks advances `leg`; wrap and `laps_done += 1` when `loop`, else stop at the end; `completed` `{ laps, stopped: 'laps' }` at `laps`. Danger (`ctx.view.nearbyHostiles(8).length > 0`, health under 8) completes `danger`; never `attack`.
- **tests** invalid, empty, one-point, nine-point routes; finite laps and the limit boundary; interruption, cancel, restart (`expectResumeEverywhere`); hostile nearby ends `danger`; the fake registry's action log never contains `attack`; a blocked leg reports through `stopOf` and does not loop.
- **checks** G1 `./geldar.ps1 pnpm test golem/src/body/programs/patrol`, G2 golem, G3, G4, G7. **revert-checks** allow 9 points: the route test fails. Ignore `laps`: "stops at laps" fails. Issue `attack` near a hostile: "never attacks" fails.
- **exit criteria** the test file passes; three revert-checks recorded; index line in the worknote. **worknote** `AN-41.md`. **commit** `feat(character): patrol program over a supplied route`. **split line** none.

## AN-45a: register the programs, allow-list and drift test

- **repo** geldar. **status** READY after AN-39, AN-40, AN-41, AN-44 merge. **size** 35-40k. **branch** `phase1/sheet-an-45a-programs-register`. **Shared-file owner** of `programs/index.ts` and `bounds.ts`.
- **may-edit** `golem/src/body/programs/index.ts` (import and export the three classes; three `registry.register` lines in `createProgramRegistry`; update its doc comment count), `golem/src/body/programs/program-shapes-drift.test.ts` (new), `player-core/src/validate/bounds.ts` (`PHASE0_PROGRAMS` gains `'explore'`, `'farm'`, `'patrol'`; `ArgSpec` gains `| { kind: 'bool'; required: boolean } | { kind: 'route'; min: number; max: number; required: boolean }`; `PROGRAM_ARGS` gains three rows with the AN-44 bounds; the argument checker that switches on `spec.kind` handles the two new kinds: `bool` accepts `true`/`false` only, `route` accepts an array of `min` to `max` objects `{x, y, z}` with integer values), `player-core/src/validate/*.test.ts` (new rows only), the worknote. **must-not-edit** baseline; `golem/src/adam/adam-body.ts` (no visited-chunk wiring: the W2 tracker has no reader); `prompts/**`.
- **decisions** D-CS-14. **owner approval** none (no agent text).
- **tests** three programs registered and `UNSUPPORTED_PROGRAMS` unchanged; an unregistered name still fails `unsupported_program`; a fourth unknown argument refused for each program; `bool` and `route` kinds accept and refuse at their bounds. Drift test (`program-shapes-drift.test.ts`): read `contract/schemas/program-shapes.schema.json` with `readFileSync(join(repoRoot(), 'contract', 'schemas', 'program-shapes.schema.json'))` (`repoRoot` from `../../config.ts`); for each program, the `properties` keys of its `*Arguments` minus `program` equal the keys of `PROGRAM_ARGS[program]`, and each integer `minimum`/`maximum` equals the `ArgSpec` `min`/`max`.
- **checks** G1 `./geldar.ps1 pnpm test golem/src/body/programs player-core/src/validate`, G2 golem player-core, G3, G4, G7.
- **revert-checks** leave `farm` out of `PHASE0_PROGRAMS`: "farm is allowed" fails. Change one bound in `PROGRAM_ARGS`: the drift test fails. Do not register `patrol`: the registry test fails.
- **exit criteria** all named tests pass; three revert-checks recorded. **worknote** `AN-45a.md`. **commit** `feat(character): register explore, farm and patrol with bounded arguments`. **split line** none.

## AN-45b: body-api v13 with explore, farm and patrol, unselected (re-carded 2026-11-27)

**Re-card note.** The card was stale. `prompts/body-api/` holds v1 to v10 and v12 and no v11 (v12 is the building version, decision 0425); neither v10 nor v12 lists explore, farm or patrol (v12's description says its programs are the same as v10's). The three programs are live through #864 under decision 0392, and the Mind is told their arguments through the `intent` description in `contract/schemas/mcp-play.schema.json`. The new file is therefore `v13.json`, built from `v12.json`. Statements below marked UNVERIFIED were not checked.

- **repo** geldar. **status** READY (AN-45a merged as #864). **size** 30-35k plus ops. **branch** `phase1/sheet-an-45b-body-api-v13`.
- **may-edit** `prompts/body-api/v13.json` (new), `golem/src/mind-link/body-api-v13.test.ts` (new, copied from the pattern of `golem/src/mind-link/body-api.test.ts`, reading `v13.json`), `golem/src/mind-link/body-api-released.test.ts` (new: sha256 pins), the `prompts/README.md` listing line for v13, the worknote. **must-not-edit** `prompts/body-api/v1.json` to `v10.json` and `v12.json` (released), `contract/**`, every shard file.
- **decisions** D-CS-14, 0344, 0391 item 3, 0392. **OWNER APPROVAL REQUIRED** for the three program summaries and examples: neutral facts about what each program does, no coaching, no "you should". Note: 0391 item 3 approves the `INTENT_WHY` failure sentences, not the body-api summaries; the summaries stay Proposed until approved (UNVERIFIED that no later record approved them). The summaries must agree with the approved failure sentences and with the live `intent` description in `mcp-play.schema.json`.
- **Default version: unchanged, and not set in this repo.** `docs/reference/prompt-templates.md:27` says the default is v10 (`DEFAULT_BODY_API_VERSION`) and v12 while `body_actions.building` is on, but those constants lived in `animus/src/prompts/library.ts`, and `animus/` is removed (decision 0430; the reference doc itself says "nothing renders body-api now"). `git grep -n DEFAULT_BODY_API_VERSION` finds no code on main. Which body-api file the live Mind (the scriptorium, outside this repo) reads is UNVERIFIED. So v13 is published and selected by nothing here; the card must not select it, and the old statement "`animus/**` (`DEFAULT_BODY_API_VERSION` stays 10)" no longer applies. If the operator wants selection, that is a separate card in the scriptorium repo.
- **Step 1.** Copy `prompts/body-api/v12.json` to `v13.json` byte for byte (`Copy-Item`), then change only its `version` (13) and `description` fields and append three `programs` entries `{ "program": ..., "summary": ..., "arguments": ..., "example": { "goal": ..., "program": ..., "arguments": ..., "wake_on": ["goal_completed"], "limits": ... } }` in the key order v12's existing entries use. The `arguments` keys and bounds are those of decision 0344 (explore `legs`, `leg_blocks`, `avoid_water`; farm `radius`, `max_cells`, `replant`; patrol `route`, `laps`, `loop`). The `mine` entry and any other must not mention a cell (AN-40a).
- **Step 2.** In `body-api-released.test.ts`, compute `sha256` of each of `v1.json` to `v10.json` and `v12.json` (eleven files: v1 to v12 as released, there being no v11) now and write the digests as literals; the test recomputes and compares, and asserts that no `v11.json` exists.
- **tests** each new v13 example validates as a thought and starts on the Body (the copied pattern, through `createProgramRegistry`); every program name in v13 is registered; the v13 examples' arguments are inside the `PROGRAM_ARGS` bounds; v1 to v10 and v12 hashes unchanged; the agent-text marker-word scan covers v13 (the scan that lived in `animus/src/prompts/agent-text.test.ts` is gone with animus; whether another scan covers `prompts/` is UNVERIFIED, so the new test reads v13 through `markedWords` from `@geldar/contract`).
- **checks** G1 `./geldar.ps1 pnpm test golem/src/mind-link contract/test/thought`, G2 golem, G3, G4, G7. **ops (serial, test shard):** a test player starts, completes and resumes (Body restart) each program through `act` and sees receipts; old body-api versions unchanged; `./geldar.ps1 check`.
- **revert-checks** change one byte of `v10.json` (and again of `v12.json`): the sha pin fails (restore at once). Break the `farm` example's `radius` to 30: the v13 example test fails. Remove `patrol` from `PHASE0_PROGRAMS` in a scratch edit: the v13 "names only registered programs" or example test fails (restore at once; the card never commits that change). Add the word "observer" to a v13 summary: the marker-word test fails.
- **colo-images path filter.** `.github/workflows/colo-images.yml` lists under `on.push.paths` (and the same list as given): `golem/**`, `player-core/**`, `eventsink/**`, `threshold/mcp/**`, `tools/admin/**`, `glass/**`, `threshold/register/**`, `supervisor/**`, `tools/mcp-tokens/**`, `tools/players-cli/**`, `tools/migrate/**`, `golem/src/players/**`, `sql/**`, `shards/phase0.yaml`, `tools/repo-checks/src/identity-mode.ts`, `contract/**`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.github/workflows/colo-images.yml`, then the negations `'!golem/test/**'` and `'!**/*.test.ts'`. `prompts/**` is NOT in it, so `prompts/body-api/v13.json` and `prompts/README.md` do not rebuild images. The new tests sit under `golem/**` but match `'!**/*.test.ts'`, so they do not rebuild either. The release-notes pin test and the v13 test are both `*.test.ts`. (Read from the file on main, 2026-11-27; the surrounding trigger key, whether `push` only, was not re-read in full.)
- **contract slot: none.** No file under `contract/**` changes (the card edits `prompts/`, `golem/` tests and a worknote); the `intent` description in `mcp-play.schema.json` already names the three programs, so it is not edited. Verified from the may-edit list; whether the drift check reads `prompts/` is UNVERIFIED.
- **exit criteria** the named tests pass; revert-checks recorded; v1 to v10 and v12 untouched (`git diff --stat prompts/body-api` lists only `v13.json`).
- **worknote** `AN-45b.md`. **commit** `feat(character): publish body-api v13 with explore, farm and patrol, unselected`. **split line** none.

## HC-31: idle binding for explore, farm and patrol

- **repo** kit. **status** **BLOCKED**: HC-21a (kit-b idle fx) is not merged, so the idle candidate shape and its file do not exist; `WorldLink` has no program listing. Do not dispatch. **depends-on** HC-21a, AN-45a. **size** 25k. **branch** `scriptorium/hc-31-idle-programs`.
- **may-edit (when unblocked)** `packages/instinct/src/fx/idle-programs.ts` (new), `idle-programs.test.ts` (new); the registration line is handed to the owner of HC-21a's idle file as "index line to add".
- **shape** `export const PROGRAM_FOR_MODE = { explorer: 'explore', farmer: 'farm', warrior: 'patrol' } as const;` and `export function programCandidates(has: (program: string) => boolean): <HC-21a candidate type>[]`. A candidate exists only when `has(program)`; `args` carry the AN-44 contract defaults only, no coordinates, field or route (patrol is omitted without a route). Nothing creates a goal.
- **tests** empty catalog adds no candidate; each mode maps to its program; args contain only contract keys; patrol omitted without a route. **revert-checks** skip `has`: the empty-catalog test fails. Add a coordinate: the contract-keys test fails. **commit** `feat(instinct): idle candidates for explore, farm and patrol (HC-31)`.

---

# Wave W8: complete evidence and proficiency sources

Wave branch `phase1/sheet-w8` (from `origin/main` after W7 merges). Promises and the commitment adapter stay **deferred** (AN-48, D-HC-06). The unsupported rows (fled a mob, kept or broke a promise, third-party gift, break or take, `common_sense` and `cleverness` estimates) stay inactive, are tested as inactive and are never faked. **SQL: none.**

## AN-46: evidence-source contract and the combat key (OWNER APPROVAL REQUIRED for two sentences)

- **repo** geldar. **wave** W8. **status** READY. **depends-on** AN-44 merged (contract slot 3), AN-24. **size** 40-50k. **branch** `phase1/sheet-an-46-evidence-contract`.
- **contract regeneration: YES, slot 3.**
- **Step 0.** `Test-Path contract/schemas/observation-event.schema.json` and `Test-Path contract/schemas/provenance.schema.json` print `True` (AN-24); otherwise STOP `blocked: AN-24`.
- **may-edit** `contract/schemas/observation-event.schema.json` (append `FightSeen`, `ContainerTaken` to the `oneOf`), `contract/schemas/provenance.schema.json` (add `TakeProvenance`, `CombatProvenance`), `contract/schemas/combat-fact-event.schema.json` (new), `contract/schemas/mcp-common.schema.json` (`McpPlayerEvent.type` gains `fight_seen`, `container_taken`), `contract/src/subjects.ts` (two helpers), `contract/src/outcome-words.ts` (two `observationSentence` templates), `contract/src/evidence.ts` (new: validators and `encounterKey`), `contract/src/index.ts` (named export lines only), `contract/src/generated/**` (G5), `contract/test/evidence-sources.test.ts` (new), `docs/decisions/<number>-evidence-sources.md` (new, status Proposed, title "Evidence sources for observed fights, container takes and conversation exchanges", number assigned in the registry; it cites 0321 for the combat key), the worknote. **must-not-edit** baseline; any promise, commitment or memory shape.
- **decisions** D-CS-04, D-CS-06, D-CS-15; **decision 0321** (Accepted): combat XP is keyed by encounter, and the Body's existing kill award and the plugin's combat fact pay one shared key. This card fixes the key format (below) and its record cites 0321; it does not restate the ruling as a new decision. **OWNER APPROVAL REQUIRED:** the two `observationSentence` templates (`Someone fought a creeper nearby.` with the mob name passed through the name pattern only; `Someone took 3 bread from your container.`) merge as drafts; the producers are off by default.
- **shapes (the cross-card interface of W8)**
  ```ts
  type FightSeen       = { kind: 'fight_seen'; actor?: ObservedActor; target: string /* ^[a-z_]{1,64}$ */; key: string };
  type ContainerTaken  = { kind: 'container_taken'; actor?: ObservedActor; item: string; count: number; key: string };
  type TakeProvenance  = { world: string; x: number; y: number; z: number; actor: string | null; prior_owner: string | null; item: string; count: number; tick: number };
  type CombatProvenance= { world: string; actor: string | null; target: string; kind: 'engaged' | 'killed'; tick: number };
  type CombatFactPayload = { life_id: LifeId; kind: 'hostile_kill' | 'fight_survived'; mob: string /* ^[a-z_]{1,64}$ */; encounter_key: string };
  // encounter_key pattern: ^enc:ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
  //   = "enc:" + the fighter's life id + ":" + the mob entity's UUID in lowercase. life_id must equal the life part.
  // WorldEvent type 'combat_fact' (3-token subject, agent_id = life_id); NOT added to MIND_EVENT_TYPES (XP only)
  // Subjects (4 tokens): geldar.<shard>.provenance.take, geldar.<shard>.provenance.combat; helpers provenanceTakeSubject, provenanceCombatSubject
  // Exchange id (no schema): `exch:<lifeLow>:<lifeHigh>:<windowIndex>`, lives sorted, windowIndex = floor(tick / 600)
  export function encounterKey(lifeId: string, mobUuid: string): string | null;  // contract/src/evidence.ts; null when lifeId fails LifeId or mobUuid is not a UUID (case-insensitive input, lowercase output)
  ```
  **The combat evidence key is the encounter key itself**, in domain `combat`, for every combat source: the Body's completed kill (AN-47b reads its new `target_uuid`), `hostile_kill` and `fight_survived` (AN-47b's `combatFactAwards`, registered by AN-50a). A kill inside an encounter therefore pays once, and a kill and a survive of one encounter pay once. `fled` is not a kind.
- **tests** causal payloads validate; combat fact without `encounter_key` invalid; `encounter_key` whose life part differs from `life_id` is accepted by the schema but `encounterKey` round-trips only the matching pair (the sink check is AN-47b's); uppercase UUID in `encounter_key` invalid; malformed or ambiguous actor invalid; absent actor valid; W5 payloads unchanged; no promise shape exists; `fled` rejected; `encounterKey('ag_kestrel_01', 'ABCDEF01-2345-6789-ABCD-EF0123456789')` gives the lowercase key; a non-UUID gives null.
- **checks** G1 `./geldar.ps1 pnpm test contract/test/evidence-sources contract/test/observation`, G2 contract, G3, G4, G5, G7.
- **revert-checks** make `encounter_key` optional: "combat fact needs a key" fails. Add `fled` to the kinds: "no flee kind" fails. Drop `ContainerTaken` from the `oneOf`: its fixture fails. Remove `.toLowerCase()` from `encounterKey`: the lowercase test fails.
- **exit criteria** G5 clean; tests pass; four revert-checks recorded; the decision record cites 0321 and gives the key pattern.
- **worknote** `AN-46.md`. **commit** `feat(character): evidence-source contract and one combat key per encounter`. **split line** schemas / subjects, evidence.ts and outcome-words.

## AN-47a: combat facts in the plugin (amendments A2, A3)

- **repo** geldar (`plugin/`). **status** READY after AN-46 and AN-27a merge. **depends-on** AN-46, AN-27a (with A1 `ProvenanceSink`; A2 `ProvenanceJson` does not exist on main: **AN-47a creates it** with `combatJson` only, in package `dev.geldar.core.provenance`; AN-27a built no JSON class). **size** 45-50k. **branch** `phase1/sheet-an-47a-combat-plugin`.
- **Step 0.** Each prints one line, otherwise STOP `blocked: <file>`: `Select-String -Path plugin/core-common/src/main/java/dev/geldar/core/blockowner/ProvenanceSink.java -SimpleMatch -Pattern 'void send(String tail, String json);'` (corrected 2026-11-19: `ProvenanceSink` is under `blockowner/`, not `provenance/`); `Select-String -Path contract/schemas/combat-fact-event.schema.json -SimpleMatch -Pattern '"life_id"'`.
- **may-edit** new: `plugin/core-common/src/main/java/dev/geldar/core/combat/EncounterTracker.java`, `HostileMobs.java`, `plugin/core-common/src/test/java/dev/geldar/core/combat/EncounterTrackerTest.java`, `HostileMobsTest.java`, `plugin/core/src/main/java/dev/geldar/core/CombatFactListener.java`, `plugin/core/src/test/java/dev/geldar/core/CombatFactListenerTest.java`; edit: `plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceJson.java` (add `combatJson` only); the worknote. **must-not-edit** baseline; `EventExporter.java` (use its public `emit`), `GeldarCore.java` (AN-50a registers), `OwnerCache.java`.
- **decisions** D-CS-04, D-CS-06, 0321. **owner approval** none (events only, never to an agent).
- **shapes (A3; the NeoForge twin AN-NF-47a compiles against these exact lines)**
  ```java
  // plugin/core-common/src/main/java/dev/geldar/core/combat/EncounterTracker.java
  public final class EncounterTracker {
      public static final int FIGHT_END_TICKS = 200;
      public static final int MAX_OPEN = 512;
      public record Fact(String kind, String player, String mob, String encounterKey) {}   // kind: hostile_kill | fight_survived
      public record Step(String kind, String player, String mob) {}                      // kind: engaged
      public void playerHurtByMob(String player, String playerUuid, String mobUuid, String mobType, long tick)
      public Optional<Step> playerHitMob(String player, String playerUuid, String mobUuid, String mobType, long tick)
      public List<Fact> mobDied(String mobUuid, String mobType, String killer, String killerUuid, long tick)
      public void playerDied(String player, long tick)
      public List<Fact> advance(long tick)
  }
  // plugin/core-common/src/main/java/dev/geldar/core/combat/HostileMobs.java
  public static boolean isHostile(String mobType)   // mobType without namespace
  // ProvenanceJson.java (A2)
  public static String combatJson(String world, String actor, String target, String kind, long tick)
  ```
  Encounter = one (player, mob entity UUID) pair; `encounterKey = "enc:" + player + ":" + mobUuid.toLowerCase(Locale.ROOT)` (callers pass life ids only; the listener filters with `EventEnvelope.isLifeId`). An encounter opens at the first hostile damage either way. `playerHitMob` returns `Step("engaged", ...)` the first time in an encounter, empty after. `mobDied` with a non-null `killer` returns one `hostile_kill` for the killer's encounter (opening it if needed; killer only, never an assist) and closes every encounter of that mob; other open encounters on that mob close as `fight_survived` for their (still alive) players. `advance(tick)` closes, as `fight_survived`, each encounter with no damage either way for more than `FIGHT_END_TICKS` ticks. `playerDied` closes that player's encounters with no fact. More than `MAX_OPEN` open encounters drop the oldest. A closed key is never emitted again (keep the last 512 closed keys). `HostileMobs` holds the names of `ALWAYS_HOSTILE` in `golem/src/perception/hostile-types.ts`, in the same order.
- **Paper listener.** `CombatFactListener implements Listener` with a constructor `(EventExporter exporter, ProvenanceSink sink, BooleanSupplier enabled, LongSupplier tick)`: `@EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)` on `EntityDamageByEntityEvent` (player damaged by a hostile: `playerHurtByMob`; player damaging a hostile: `playerHitMob`, and a returned step sends `sink.send("combat", ProvenanceJson.combatJson(world, player, mob, "engaged", tick))`), on `EntityDeathEvent` (`event.getEntity().getKiller()` gives the killer `Player` or null; a `Player` entity's death calls `playerDied`), and a `tick()` method the registrant schedules once per tick that calls `advance`. Mob type: `entity.getType().getKey().getKey()`; UUID: `entity.getUniqueId().toString()`; world: `entity.getWorld().getName()`. Each `Fact` is emitted with `exporter.emit("combat_fact", fact.player(), payload)` where `payload` is a Gson `JsonObject` with exactly `life_id` (= player), `kind`, `mob`, `encounter_key`. A player whose name fails `EventEnvelope.isLifeId` is ignored entirely. Everything is skipped when `enabled.getAsBoolean()` is false. If a Paper name above does not compile, STOP `blocked: compile <symbol>`.
- **tests** `EncounterTrackerTest` (`:core-common`): kill gives one `hostile_kill` with the key `enc:<life>:<uuid lowercase>`; survived, aborted (timeout at exactly 200 and 201 ticks) and died encounters; multiple attackers (killer only gets `hostile_kill`, the other gets `fight_survived`); per-tick damage keeps one encounter; cap 512; a closed key is not emitted twice. `HostileMobsTest`: reads `Path.of(System.getProperty("geldar.schemas")).getParent().getParent().resolve("golem/src/perception/hostile-types.ts")`, collects the quoted names inside the `ALWAYS_HOSTILE` set, and asserts they equal `HostileMobs`'s list. `CombatFactListenerTest` (`:core`, package `dev.geldar.core`, doubles from `ListenerDoubles.java`): a real-shaped kill emits one envelope whose `EventSchemaCheck.errors(envelope)` is empty and whose payload keys are exactly the four; a human-named player emits nothing; disabled emits nothing.
- **checks** G6 `Push-Location plugin; ./gradlew :core-common:test --tests 'dev.geldar.core.combat.*'; Pop-Location`, then `Push-Location plugin; ./gradlew :core:test --tests 'dev.geldar.core.CombatFactListenerTest'; Pop-Location`, then the full `./gradlew build`; G3 (`git diff --check`), G4, G7. **ops (serial, test shard):** capture a real kill and a real survived payload before AN-47b's fixtures are frozen.
- **revert-checks** key by tick: "per-tick damage is one encounter" fails. Credit the last damager instead of the killer argument: "killer only" fails. Emit on player death: "died encounter emits nothing" fails. Drop the `isLifeId` filter: "human emits nothing" fails.
- **exit criteria** all three test classes pass; build passes (so `NoRegistryScanTest` in `neoforge/` is not affected; run `Push-Location neoforge; ./gradlew test --tests 'dev.geldar.neoforge.NoRegistryScanTest'; Pop-Location` once and record it); four revert-checks recorded; index line for AN-50a (`all.add(new CombatFactListener(...))` and the tick task) in the worknote.
- **worknote** `AN-47a.md`. **commit** `feat(character): plugin combat facts with one key per encounter`. **split line** core-common tracker and tests / Paper listener and test.

## AN-47b: combat key: the Body's kill pays the encounter key (eventsink and the Body's kill record)

- **repo** geldar (`eventsink/`, `golem/`). **status** READY after AN-46 merges. **depends-on** AN-46. **size** 35-40k. **branch** `phase1/sheet-an-47b-combat-key`. **Owner** of the `attack` row of `eventsink/src/xp/awards.ts` (before AN-50a, which keeps the `case` arms, 0321) and of `golem/src/actions/attack.ts`.
- **decisions** D-CS-04, 0321. The key comes from the attack record alone, through the new `target_uuid` field, as 0321 requires. Known effect (record in the worknote): a completed kill whose record has no `target_uuid` (records written before this card, or a mob mineflayer gave no UUID) awards nothing from the attack row; the combat fact still awards it when the plugin source is on. Keys already in `xp_evidence` (`kill:<action_id>`) stay; no SQL.
- **may-edit** `eventsink/src/xp/combat.ts` (new), `eventsink/src/xp/combat.test.ts` (new), `eventsink/src/xp/awards.ts`, `eventsink/src/xp/awards.test.ts`, `eventsink/src/xp/fixtures.ts` (two new entries only), `golem/src/actions/attack.ts`, `golem/src/actions/attack.test.ts`, the worknote. **must-not-edit** baseline; `eventsink/src/writer.ts`, `projection.ts`, `consumer.ts`, `ledger.ts`.
- **Step 0.** `Select-String -Path contract/src/index.ts -SimpleMatch -Pattern 'encounterKey'` prints a line (AN-46); otherwise STOP `blocked: AN-46`.
- **Step 1 (Body).** In `golem/src/actions/attack.ts`: add `targetUuid: string | null;` to `interface KillRecord`; in `attackAction.run`, after `const targetKind = targetKindOf(first);`, add `const targetUuid = typeof first.uuid === 'string' ? first.uuid : null;`; pass `targetUuid` in the `afterKill(ctx, { ... })` call; in `afterKill`, destructure it and add `...(targetUuid ? { target_uuid: targetUuid } : {})` to the `completed({ ... })` detail. Nothing else changes.
- **Step 2 (sink).** Create `eventsink/src/xp/combat.ts`:
  ```ts
  import { encounterKey } from '@geldar/contract';
  import type { XpAward } from './awards.ts';
  type Fields = Record<string, unknown>;
  type Award = (domain: 'combat', evidenceKey: string) => XpAward[];
  /** The one combat key of a completed kill record: the encounter key, or null without a valid target_uuid. */
  export function killKey(lifeId: string, detail: Fields): string | null;
  /** One award per encounter from a combat_fact payload; [] unless kind, mob and encounter_key are valid and the key's life is the payload's life. */
  export function combatFactAwards(payload: Fields, award: Award): XpAward[];
  ```
  `killKey` returns `typeof detail.target_uuid === 'string' ? encounterKey(lifeId, detail.target_uuid) : null`. `combatFactAwards` requires `payload.kind` in `hostile_kill`/`fight_survived`, `payload.mob` a string, and `payload.encounter_key === encounterKey(payload.life_id, <the UUID part of the key>)`; then `award('combat', payload.encounter_key)`.
- **Step 3 (sink).** In `awards.ts`: (a) `actionAwards` `case 'attack'` becomes: `{ const key = detail.killed === true && detail.target_kind === 'mob' ? killKey(payload.life_id as string, detail) : null; return key ? award('combat', key) : []; }`; (b) import `killKey` from `./combat.ts`; (c) **do not** add a `combat_fact` case (AN-50a owns the `case` arms, 0321); (d) export the `Award` type (`export type Award = ...`) so `combat.ts` and AN-50a reuse it.
- **Step 4 (fixtures).** Add to `CAPTURED` in `fixtures.ts`: `kill_uuid_completed` (a copy of `kill_completed` with `"target_uuid":"0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b"` added to `detail`, a new `source_event_id` and `action_id` of the same format) and `combat_fact_kill` (a `combat_fact` envelope for `ag_kestrel_01`: `payload` `{"life_id":"ag_kestrel_01","kind":"hostile_kill","mob":"zombie","encounter_key":"enc:ag_kestrel_01:0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b"}`). Both are hand-built (say so in the comment above them) and must pass `validateWorldEvent`.
- **tests** `awards.test.ts`: change `awards a kill of a mob` to expect `[]` for `kill_completed` (no `target_uuid`) and add `awards a kill of a mob by its encounter key` for `kill_uuid_completed` (key `enc:ag_kestrel_01:0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b`). `combat.test.ts`: `killKey` with an uppercase UUID gives the lowercase key; a non-UUID gives null; `combatFactAwards` of the `combat_fact_kill` payload gives exactly that key; a `fight_survived` of the same encounter gives the same key; a key that names another life gives `[]`. **One fight, one row:** in `combat.test.ts`, build an in-memory `XpStore` (copy `memoryStore` from `eventsink/src/xp/ledger.test.ts`, it is not exported), run `applyAward` for every award of `awardsFor(kill_uuid_completed)` and of `combatFactAwards(combat_fact_kill payload, award)` (build `award` as `awardsOf` does), in both orders; assert exactly one evidence row and `xp` 1 for `(ag_kestrel_01, combat)`, and the second `applyAward` returns `awarded: false`. `attack.test.ts`: a completed kill of a fixture entity with `uuid` has `target_uuid` in its detail; one without `uuid` has none.
- **checks** G1 `./geldar.ps1 pnpm test eventsink/src/xp golem/src/actions/attack`, G2 eventsink golem, G3, G4, G7.
- **revert-checks** restore `award('combat', \`kill:${id}\`)` in the attack case: "one fight, one row" fails (two evidence rows, `xp` 2: both keys pay). Drop the life check in `combatFactAwards`: "another life's key gives []" fails. Remove `.toLowerCase()` handling (pass `target_uuid` through unchanged): the uppercase test fails. Remove `target_uuid` from the attack detail: the attack test fails.
- **exit criteria** all named tests pass; four revert-checks recorded; the known-effect note and the index line for AN-50a (`case 'combat_fact': return combatFactAwards(payload, award);`) are in the worknote.
- **worknote** `AN-47b.md`. **commit** `feat(character): the Body's kill pays the shared combat encounter key`. **split line** Body step 1 / sink steps 2 to 4.

## AN-47c: visible-fight observation (Body)

- **repo** geldar (`golem/`). **status** READY after AN-46, AN-25 and AN-28b merge. **size** 30-35k. **branch** `phase1/sheet-an-47c-fight-seen`.
- **Step 0.** `Test-Path golem/src/perception/provenance/visible-actor.ts` is `True` and `Select-String` finds `export function observedActor(` in it; otherwise STOP `blocked: AN-25`.
- **may-edit (new)** `golem/src/perception/provenance/fight-seen.ts`, `fight-seen.test.ts`, the worknote. **must-not-edit** baseline; `subscribe.ts` (AN-50b wires it).
- **decisions** D-CS-06. **owner approval** none (the sentence is AN-46's).
- **shape** `export function observeFight(msg: CombatProvenance, ctx: { bot: Bot; tick: number; self: string }): ObservationPayload | null` returns `fight_seen` only when `msg.kind === 'engaged'`, `observedActor(ctx.bot, msg.actor)` is non-null, and a mob of type `msg.target` is within 24 blocks of the bot and passes the same line-of-sight test `observedActor` uses; key `fight:<msg.tick>:<actor>:<target>`; once per (actor, target) per 600 ticks (a bounded map of 256 entries, oldest dropped); `killed` returns null; `msg.actor === ctx.self` returns null; a null actor returns null. Never exposes another life's health, sheet or the mob's position.
- **tests** visible fight gives one observation; hidden or far actor null; two attackers, only the visible one; repeated engaged messages within 600 ticks give one; after 600 ticks a new one; `killed` null; own fight null; payload keys are exactly `kind`, `actor`, `target`, `key`.
- **checks** G1 `./geldar.ps1 pnpm test golem/src/perception/provenance/fight-seen`, G2 golem, G3, G4, G7. **revert-checks** emit for an invisible actor: "hidden fight updates nothing" fails. Drop the 600-tick map: "repeated messages, one observation" fails. Accept `killed`: "killed is null" fails.
- **exit criteria** the test file passes; three revert-checks recorded; index line for AN-50b. **worknote** `AN-47c.md`. **commit** `feat(character): observe a visible fight from combat provenance`. **split line** none.

## AN-49: conversation exchange and social award keys

- **repo** geldar (`eventsink/`). **status** READY (registration handed to AN-50a). **depends-on** AN-46 (ADR). **size** 40-50k. **branch** `phase1/sheet-an-49-exchange`.
- **may-edit (new)** `eventsink/src/xp/exchange.ts`, `exchange.test.ts`, the worknote. **must-not-edit** baseline; `awards.ts` (AN-47b, then AN-50a), `projection.ts`, `writer.ts`. No SQL, no LLM call.
- **decisions** D-CS-04, D-CS-15. `EXCHANGE_WINDOW_TICKS = 600` is an owner parameter (unmeasured). NeoForge: speech is not proximity-limited there (NF-CHAT); this card's code is neutral and inactive.
- **shape** `export class ExchangeTracker { constructor(maxPairs = 512); awardsFor(event: WorldEvent): XpAward[] }` over stored `speech` events (fields `from`, `text`, `distance`, `own`, `agent_id`; `contract/schemas/speech-event.schema.json`). A bilateral exchange between lives A and B: A speaks and, within the window, B speaks and A's Body heard it as non-own speech from B; it qualifies at the **second** speaker's first line. One `social` award per participant per exchange, key `exch:<lifeLow>:<lifeHigh>:<windowIndex>`. Not an exchange: monologue; one-way overheard speech; the same speaker's lines; a repeated greeting (identical text does not open a second window); wrong recipient; echoed or replayed events (idempotent key). LRU of 512 pairs, expiry after 2 windows; a sink restart loses an open window (documented). A give inside a window keeps its own `give:<action_id>` key. `XpAward` from `./awards.ts`.
- **tests** two-way versus monologue; greeting spam; wrong recipient; overlapping windows (one key); echoed events; restart; give-in-window; LRU bound; `awardsFor` of the give fixture unchanged.
- **checks** G1 `./geldar.ps1 pnpm test eventsink/src/xp/exchange`, G2 eventsink, G3, G4, G7. **revert-checks** qualify at the first speaker's line: "monologue is not an exchange" fails. Drop the window index: "two windows, two awards" fails. Let a repeated greeting open a window: "greeting spam" fails.
- **exit criteria** the test file passes; three revert-checks recorded; index line for AN-50a (a sink-held `ExchangeTracker` called beside `awardsFor` in `writer.ts`, or a `case 'speech'` arm; AN-50a chooses per its card). **worknote** `AN-49.md`. **commit** `feat(character): bilateral conversation exchange and social award keys`. **split line** none.

## AN-51a: container-taking facts in the plugin (amendments A2, A4)

- **repo** geldar (`plugin/`). **status** READY after AN-46 and AN-27a merge. **depends-on** AN-46, AN-27a (A1, A4), AN-47a (creates `ProvenanceJson`; A2 is not in AN-27a). **size** 40-45k. **branch** `phase1/sheet-an-51a-container-take-plugin`.
- **Step 0.** One line each, otherwise STOP: `ProvenanceSink.java` as in AN-47a (corrected path: `.../blockowner/ProvenanceSink.java`); `ProvenanceJson.java` exists (AN-47a created it with `combatJson`; if AN-47a is not merged, STOP `blocked: AN-47a`). **`PriorOwner.java` does not exist on main** (corrected 2026-11-19): AN-51a creates `plugin/core-common/src/main/java/dev/geldar/core/provenance/PriorOwner.java` itself (new; add it and its test to may-edit) unless the packet writer finds an equivalent in `OwnerCache`; do not assume it exists.
- **may-edit** new: `plugin/core-common/src/main/java/dev/geldar/core/provenance/TakeDiff.java`, `plugin/core-common/src/test/java/dev/geldar/core/provenance/TakeDiffTest.java`, `plugin/core/src/main/java/dev/geldar/core/blockowner/ContainerTakeListener.java`, `plugin/core/src/test/java/dev/geldar/core/blockowner/ContainerTakeListenerTest.java`; edit: `ProvenanceJson.java` (add `takeJson` only); the worknote. **must-not-edit** baseline; `BlockOwnerSetup.java` (AN-50a registers), `OwnerCache.java`.
- **decisions** D-CS-06. **owner approval** none.
- **shapes**
  ```java
  // TakeDiff (Bukkit-free): what a player took from one container between two snapshots
  public static Map<String, Integer> taken(Map<String, Integer> before, Map<String, Integer> after)  // item -> positive decrease only, sorted keys
  // ProvenanceJson (A2)
  public static String takeJson(String world, int x, int y, int z, String actor, String priorOwner, String item, int count, long tick)
  ```
  Behaviour: on `InventoryClickEvent` (MONITOR, `ignoreCancelled = true`) where `event.getWhoClicked()` is a `Player` whose name passes `EventEnvelope.isLifeId`, and `event.getView().getTopInventory().getLocation()` is non-null (a block-backed container), snapshot the top inventory's item counts (material key path to total count) and the prior owner with `PriorOwner.of(cache, pos)` at click time; on the next tick (an injected `Consumer<Runnable> nextTick`, in production `Bukkit.getScheduler().runTask(plugin, r)`) snapshot again and send, for each entry of `TakeDiff.taken(before, after)`, one `sink.send("take", ProvenanceJson.takeJson(world, x, y, z, player, priorOwner, item, count, tick))`. `InventoryDragEvent` only places items, so it is not listened to. One click is one snapshot pair; at most 64 messages per tick (then dropped and counted). Nothing is sent when the provenance flag is false or the sink is null. A prior owner that fails `isLifeId` is written as null.
- **tests** `TakeDiffTest`: decrease counted, increase ignored, removed key counted, unchanged empty. `ContainerTakeListenerTest`: own, other-owned and unknown containers (prior owner null on a cache miss, no CoreProtect call); open without take sends nothing; deposit sends nothing; shift-click take of a full stack sends one message with the stack count; ownership changed between click and next tick keeps the click-time owner; a human player sends nothing; the per-tick cap.
- **checks** G6 `Push-Location plugin; ./gradlew :core-common:test --tests 'dev.geldar.core.provenance.TakeDiffTest'; Pop-Location`, `Push-Location plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.ContainerTakeListenerTest'; Pop-Location`, full build; G3, G4, G7. If a Bukkit name above does not compile, STOP `blocked: compile <symbol>`.
- **revert-checks** count increases in `TakeDiff`: "deposit sends nothing" fails. Read the owner at the next tick: "click-time owner wins" fails. Drop the `isLifeId` filter: "human sends nothing" fails.
- **exit criteria** both classes pass; build passes; three revert-checks recorded; index line for AN-50a. **worknote** `AN-51a.md`. **commit** `feat(character): publish container-taking provenance from the plugin`. **split line** `TakeDiff` and `takeJson` / listener.

## AN-51b: observed container taking in the owner's Body

- **repo** geldar (`golem/`). **status** READY after AN-46, AN-51a and AN-25. **size** 30-40k. **branch** `phase1/sheet-an-51b-container-take-observation`.
- **may-edit (new)** `golem/src/perception/provenance/container-take.ts`, `container-take.test.ts`, the worknote. **must-not-edit** baseline; `golem/src/actions/container.ts`.
- **decisions** D-CS-06. **owner approval** none.
- **shape** `export function observeTake(msg: TakeProvenance, ctx: { bot: Bot; tick: number; self: string }): ObservationPayload | null` returns `container_taken` only when `msg.prior_owner === ctx.self` and the container block at `(msg.x, msg.y, msg.z)` passes `canSeeBlock(ctx.bot, block)` (from `golem/src/perception/notable-blocks.ts`); the taker is named only through `observedActor(ctx.bot, msg.actor)` (null gives an unattributed observation); key `take:<tick>:<x>:<y>:<z>:<actor or ->:<item>`; an LRU of 256 keys drops repeats; `msg.actor === ctx.self` returns null; third parties get nothing.
- **tests** own, other and unknown container; actor hidden; same message twice; ownership changed mid-operation (the message's `prior_owner` is the truth); out-of-sight container null.
- **checks** G1 `./geldar.ps1 pnpm test golem/src/perception/provenance/container-take`, G2 golem, G3, G4, G7. **revert-checks** deliver for another life's container: "other-owned teaches nothing" fails. Skip the visibility test: "out-of-sight container is null" fails. Name the actor without `observedActor`: "hidden taker unattributed" fails.
- **exit criteria** the test file passes; three revert-checks recorded; index line for AN-50b. **worknote** `AN-51b.md`. **commit** `feat(character): owner-side observation of a take from an owned container`. **split line** none.

## HC-27c: kit reader for `fight_seen` and `container_taken`

- **repo** kit. **status** READY after HC-27b and AN-46 merge. **size** 18k. **branch** `scriptorium/hc-27c-social-evidence-kinds`.
- **may-edit** `packages/instinct/src/social/observe.ts` (activate the two event rows), `rules.ts` (`fought_mob.active = true`), `observe.test.ts`, `model.test.ts`; the worknote. **must-not-edit** other HC-27a/27b logic.
- **rules** `fight_seen` gives `fought_mob` (aggression 4.5), key `fight:<id>`; `container_taken` gives `took_mine` (law 1.5, good 2.0), key `take:<id>`, so a break and a take are distinct observations. `fled_mob`, `kept_promise`, `broke_promise` stay inactive. On the live path these rows still need HC-30a's adapter to produce the two kinds.
- **tests** `fight_seen` updates aggression once through redelivery; `container_taken` updates law and good once; an event without an actor updates nothing; `fled_mob` still inactive.
- **checks** CK-1 `./scriptorium.ps1 pnpm test packages/instinct/src/social/observe.test.ts packages/instinct/src/social/model.test.ts`, CK-2 to CK-4. **revert-checks** leave `fought_mob` inactive: its test fails. Resolve an absent actor to the nearest person: the no-actor test fails.
- **exit criteria** tests pass; two revert-checks recorded. **worknote** `HC-27c.md`. **commit** `feat(instinct): read observed fights and container takes (HC-27c)`.

## AN-50a: sink and plugin registration

- **repo** geldar. **status** READY after AN-47a, AN-47b, AN-49, AN-51a and AN-28c merge. **size** 35-40k. **branch** `phase1/sheet-an-50a-evidence-registration`. **Owner** of the `awards.ts` registration `case` arms (after AN-47b; 0321), `writer.ts` (registration lines only), `GeldarCore.java`, `BlockOwnerSetup.java`.
- **Step 0.** `Select-String -Path plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java -SimpleMatch -Pattern 'provenance.enabled'` prints a line (AN-28c), and `Select-String -Path eventsink/src/xp/combat.ts -SimpleMatch -Pattern 'export function combatFactAwards('` prints a line (AN-47b); otherwise STOP `blocked: <card>`.
- **may-edit** `eventsink/src/xp/awards.ts` (in `awardsOf`'s switch add `case 'combat_fact': return combatFactAwards(payload, award);` before `default`, import it from `./combat.ts`, and name `combat_fact` in the doc comment of `awardsFor`; nothing else), `eventsink/src/xp/awards.test.ts` (one `describe`), `eventsink/src/writer.ts` (hold one `ExchangeTracker` per sink and call its `awardsFor(event)` INSTEAD OF the stateless `awardsFor(event)` at line 107 (the tracker already returns the stateless awards too, so appending would run every give or craft award twice; AN-49 review 1, 2026-11-19); nothing else), `eventsink/src/xp/evidence-table.test.ts` (new), `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java` (construct `CombatFactListener` once, register it, schedule its `tick()` every tick with `runTaskTimer(this, listener::tick, 1L, 1L)`; enabled supplier = the same `provenance.enabled` value BlockOwnerSetup reads), `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java` (register `ContainerTakeListener` once with the link as sink), `plugin/core/src/test/java/dev/geldar/core/GeldarCoreTest.java` and the BlockOwnerSetup test (one case each), the worknote. **must-not-edit** baseline otherwise.
- **decisions** D-CS-04, D-CS-06; activation D-CS-10.
- **tests** `awards.test.ts` `describe('one combat key per encounter')`: **the Body's kill and the plugin's kill of the same mob give the same single key** (`keysOf('kill_uuid_completed')` equals `keysOf('combat_fact_kill')`, each of length 1, `new Set([...a, ...b]).size === 1`); a `combat_fact` for another life's key gives `[]`. `listeners()` registration: `CombatFactListener` once, `ContainerTakeListener` once; `evidence-table.test.ts` asserts every inactive row of the table below has no producer and no award key (for each fixture of an inactive kind, `awardsFor` and the exchange tracker give `[]`), and every active XP row gives exactly one key.
- **checks** G1 `./geldar.ps1 pnpm test eventsink/src/xp eventsink/src/writer`, G6 (`GeldarCoreTest`, the BlockOwnerSetup test, full build), G3, G4, G7; ops `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink`.
- **revert-checks** delete the `combat_fact` case: "the Body's kill and the plugin's kill give the same single key" fails (the plugin side gives `[]`). Register `ContainerTakeListener` twice: the once-each test fails. Make the exchange tracker produce a flee key: the inactive-row test fails. Drop the exchange append in `writer.ts`: "exchange is active" fails.
- **exit criteria** tests and build pass; four revert-checks recorded. **worknote** `AN-50a.md`. **commit** `feat(character): register combat, exchange and take evidence sources`. **split line** sink / plugin.

## AN-50b: Body subscription and the leakage gate

- **repo** geldar. **status** READY after AN-50a, AN-47c, AN-51b and AN-28b merge. **size** 35-40k plus ops. **branch** `phase1/sheet-an-50b-evidence-leakage`. **Owner** of `subscribe.ts`, `leakage.test.ts`, `mind-event.ts` (only if a presenter row is needed).
- **may-edit** `golem/src/perception/provenance/subscribe.ts` and `subscribe.test.ts` (subscribe to `provenanceTakeSubject` and `provenanceCombatSubject`, dispatch to `observeTake` and `observeFight`, behind the W5 gate), `threshold/mcp/src/events/leakage.test.ts` (extend with both kinds and their hidden controls), `player-core/src/link/mind-event.ts` and its presenter row only if `fight_seen`/`container_taken` are not already presented (STOP and report if a presenter needs new text), the worknote. **must-not-edit** baseline otherwise; no widening of any global fact into agent perception.
- **evidence table (the status each row ships in)**

| Evidence | Source | Ships |
|---|---|---|
| Spoke to me first | `speech` events | active, no card |
| Came toward me, kept away | distance samples | active, kit rule (HC-27b) |
| Hit me | `damage.actor` (AN-25) | active when the attacker was visible |
| Gave me an item | `gift_received` (AN-26) | active for the recipient |
| Broke my owned block | `property_broken` (AN-27) | active for the owner |
| Took from my container | `container_taken` (AN-51) | active for the owner |
| Fought a mob in view | `fight_seen` (AN-47c) | active when the fighter was visible |
| Fled a mob | none | **inactive**: no causal flee signal |
| Kept or broke a promise | none | **inactive**: AN-48 deferred (D-HC-06) |
| Third-party gift, break or take | none | **inactive** |
| `common_sense`, `cleverness` estimates | none | **inactive**: stay at the prior |
| XP: combat (one key per encounter), social (exchange, give), farming, mining, building, crafting, exploring | AN-47b, AN-49, W2 | active; the kept-promise social unit is inactive |

- **tests** each active observation row has a positive, a hidden, a duplicate and a restart control; the extended leakage test fails when a `container_taken` is presented with a `life` field; raw `provenance.>` and `combat_fact` never reach an agent.
- **checks** G1 `./geldar.ps1 pnpm test golem/src/perception/provenance threshold/mcp/src/events/leakage`, G2 golem mcp, G3, G4, G7. **ops (serial, test shard):** producer-to-sink XP and observer-to-player-event for every active row; real NATS role denial of raw `provenance.>` to the MCP, eventsink and mind roles; `./geldar.ps1 check`; the integration floor; the 20 TPS bench.
- **revert-checks** present `container_taken` with a `life` field: the leakage test fails. Subscribe with the gate off: the gate test fails.
- **exit criteria** tests pass; two revert-checks recorded. **worknote** `AN-50b.md`. **commit** `feat(character): Body subscription for take and combat provenance with the leakage gate`. **split line** none.

---

## AN-45c: actor basis on ObservedActor, and the named sentence (0450 item 6)

- **repo** geldar. **status** BLOCKED: open contract PR #955 (`fix/0391-observation-wording`) must merge first; contract-regenerating, so one at a time in the serial contract order; `colo-images` paths, held for geldar-69's batch window. **inert / held-live**: no producer sets a basis other than `seen`, and the `observations` option stays absent in production. **size** 30-35k (estimate). **branch** `phase1/sheet-an-45c-actor-basis` for the contract and Body half; the presenter half is an extension on `phase1/sheet-presenter-rows`.
- **may-edit** `contract/schemas/observation-event.schema.json`, `contract/src/generated/` (by generator only), `contract/src/observation.ts`, `contract/src/observation.test.ts`, `golem/src/perception/provenance/visible-actor.ts`, `golem/src/perception/provenance/visible-actor.test.ts`, `threshold/mcp/src/events/handlers/observation.ts` and its test, the worknote `AN-45c.md`.
- **must-not-edit** `docs/spec.md`; any other contract schema; `present-handlers/observation.ts` beyond the line field it already has.
- **decisions** 0450 items 4 to 6, 0343, 0391 item 2 (amended only when this card merges). **owner approval** none for the field; the sentences are 0450's Accepted set.
- **shape** `ObservedActor` gains an optional `basis` with enum `seen | spoke | signed`; `name` and `life` stay required. `observedActor` sets `basis: 'seen'` (the only producer that exists). The chat and sign producers are NOT in this card. `observationSentence` takes an optional `actor`; it builds the named sentence only when `actor.basis` is present and `visibleActorName` passes; otherwise the "Someone" form, which is the current sentence.
- **steps.** 1. Confirm #955 is merged and take the next serial contract slot; ask the slot holder first. 2. Edit the schema; run `pnpm generate` in `contract/` and never hand-edit `contract/src/generated/`. 3. Set `basis: 'seen'` in `observedActor`. 4. Presenter extension on `phase1/sheet-presenter-rows`.
- **tests** schema accepts an actor with and without `basis`, and rejects `basis: "heard"`; `observedActor` returns `basis: 'seen'` for a visible player; a named sentence only when `basis` is present; `Observer1` and `Streamer` give the "Someone" form; no output contains `ag_`, a UUID or digits beyond the count; an actor without `basis` gives the exact current sentence.
- **checks** `pnpm check:generated` (contract), contract tests, `golem/src/perception/provenance` tests, `threshold/mcp` observation tests, G4 and G7 of the worktree check. **revert-checks** delete the enum: "rejects heard" fails. Make the presenter ignore `basis`: "name without basis is Someone" fails. Drop `markedWords` from the presenter: "Observer1 gives Someone" fails. Each is one line changed in the worktree, restored from a scratchpad copy.
- **exit criteria** the named tests pass; three revert-checks recorded; `pnpm check:generated` clean; the AN-51c contract slot is named in the worknote. **worknote** `AN-45c.md`. **commit** `feat(contract): optional actor basis for observation evidence, named only when seen`. **split line** the presenter half may split into its own commit on `phase1/sheet-presenter-rows`.

## AN-51c: perceived positions in `agents[].pos`, never ids (0391 item 4, 0451 if needed)

- **repo** geldar. **status** BLOCKED on AN-45c (serial contract slot after it) and on the owner's approval of the wording of the field (approved in principle by 0289 and 0391). **inert / held-live**: the field is absent in production until the held-live ruling of 2026-11-15 is lifted. **size** 30-40k (estimate). **branch** `phase1/sheet-an-51c-agent-pos`. **contract-regenerating**: one at a time.
- **may-edit** the snapshot contract schema that carries `agents[]` (`contract/schemas/snapshot.schema.json` is the candidate; confirm the owner of the agents array before editing), `contract/src/generated/` (by generator only), the Body file that builds `agents[]` (locate; not verified in this card), their tests, the worknote `AN-51c.md`.
- **must-not-edit** any `life` or id field; `docs/spec.md`; the held-live switches.
- **decisions** 0391 item 4 (agents may be told perceived positions, never ids), 0289 (`agents[].pos` approved by 0391), 0058, 0059. A record number 0451 is needed only if the field's shape is not already settled by 0391; check the decisions index before taking it.
- **shape** `agents[].pos` is an optional `{x, y, z}` (integers, block coordinates) on each agent the Body can perceive. The Body omits `pos` for an agent it cannot perceive. No id of any kind (`life`, `ag_` ids, UUID, entity id) is added to the agent entry or any text.
- **steps.** 1. Land AN-45c first (contract slot order). 2. Add `pos` as optional in the schema; `pnpm generate`. 3. The Body fills `pos` only from perception of that agent in view. 4. Leave any id out of the emitted entry and out of any sentence.
- **tests** a snapshot with `pos` validates; a `pos` with a non-integer or a missing axis is rejected; a perceived agent gets `pos`; an unperceived agent gets no `pos` key; across every axis and sign (negative x and z, negative y) the emitted value equals the Body's position; the emitted entry and agent text contain no `ag_`, no UUID and no `life` key.
- **checks** `pnpm check:generated`, contract tests, the Body test file, G4 and G7. **revert-checks** remove the "unperceived omits pos" guard: "unperceived agent has no pos key" fails. Negate the z sign: "negative z axis" fails. Emit `life` on the entry: "no life key in the entry" fails. One change each, restored from a scratchpad copy.
- **exit criteria** the named tests pass; three revert-checks recorded; the contract slot after AN-45c named in the worknote. **worknote** `AN-51c.md`. **commit** `feat(contract): optional agents[].pos for perceived agents, never ids`. **split line** the Body half may split out.

## GX-ROSTER: operator-only roster export through `players-cli`

- **repo** geldar (`tools/players-cli/`). **status** BLOCKED: `tools/players-cli` is `colo-images` and is held for geldar-69's batch window. **operator-only**: the verb runs from the operator's shell and never from the MCP or Body. **size** 20-25k (estimate). **branch** `phase1/sheet-gx-roster-export`.
- **may-edit** `tools/players-cli/src/cli.ts`, a new `tools/players-cli/src/roster-export.ts` and its test, the worknote `GX-ROSTER.md`.
- **must-not-edit** `tools/players-cli/src/roster.ts` beyond an import; the shard config; any model-facing file; `docs/spec.md`.
- **decisions** 0289 (roster by an operator-run players-cli verb, GX-ROSTER), 0391 item 4 (no ids to agents). **owner approval** none beyond 0289.
- **shape** `players-cli roster export --out <path>` writes `roster.json`: a flat JSON object mapping `name` to `lifeId`, both strings. The file is at most 16 KiB (16384 bytes); a larger roster is refused with a non-zero exit and nothing is written. The file is never shown to the model: no MCP tool, prompt or Body reads it.
- **steps.** 1. Add the verb to `cli.ts` with a `--out` path it writes atomically (temp file then rename). 2. Build the object from `findPlayer`'s roster read. 3. Enforce the 16 KiB cap before writing. 4. Add a test that no file under `threshold/`, `golem/src/` or `contract/` imports `roster.json`.
- **tests** the output is a flat object of string to string; a nested value is refused; the 16 KiB cap refuses an oversize roster and writes no file; the cap is exact at 16384 bytes; the atomic write leaves no partial file on a failed write; no model-facing source names `roster.json`.
- **checks** `players-cli` tests, `pnpm check:repo`, G4 and G7. **revert-checks** remove the cap: "oversize roster is refused" fails. Write the file in place without the temp file: "failed write leaves no file" fails. Let the model-facing grep pass a file named `roster.json`: "no model-facing source names roster.json" fails. One change each, restored from a scratchpad copy.
- **exit criteria** the named tests pass; three revert-checks recorded. **worknote** `GX-ROSTER.md`. **commit** `feat(players-cli): operator-only roster export as flat name-to-life JSON`. **split line** none.

## Differences from the older cards (do not dispatch both)

1. `work-packets-geldar-b.md` and the kit's `work-packets-kit-c.md` W6 to W8 text is superseded where it differs. The `animus/` paths are deprecated stubs; live files are under `player-core/` (GX-04).
2. body-api: the new file is **v11** (v10 is released).
3. Decisions for W3 to W8 come from the 0320 block; SQL none.
4. HC-30a's switches are environment keys (`GELDAR_INSTINCT_TOM`, `GELDAR_INSTINCT_TOM_PROSE`), default off, matching the merged `readConfig` style; there is no `config.tom` object.
5. HC-27b reads its own pure input (no actor ids or coordinates assumed); the adapter is HC-30a's.
6. Combat XP: one encounter key shared by the Body's kill and the plugin's combat fact (decision 0321), replacing `kill:<action_id>` and the older `combat:enc:<key>`.
7. AN-45, AN-50 and the old AN-47b are split (AN-45a/b, AN-50a/b, AN-47b/c).

## Open items

- **Kit dependencies.** The card-set question is ruled (0320: kit-b) and the observe-fields question is ruled in principle (0324); HC-30a, HC-30b and HC-31 still wait for kit-b HC-24 and HC-21a and for HC-46 to merge. The exact agent-visible wording for positions and ids stays pending (0324 item 2); nothing in these cards renders them.
- **Unmeasured parameters:** prior strength 2, observation values, sampling constants, `FIGHT_END_TICKS`, the encounter cap, `EXCHANGE_WINDOW_TICKS`, the 0.75 prose threshold.
- **Placeholder text** (owner approval): HC-29's bank, AN-44's `INTENT_WHY` and description line, AN-45b's body-api summaries, AN-46's two sentences. All ship inactive or unselected.
- **Deferred, not carded:** AN-48 (promise outcomes), the kept-promise social unit, AN-38; they wait on D-HC-06.
