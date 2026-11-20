# Worknote: corrections to the sheet cards W3 to W12 (2026-11-15)

Scope: the three card files `work-packets-sheet-w3-w5.md`, `work-packets-sheet-w6-w8.md`, `work-packets-sheet-w9-w12.md`. Each has a `Corrections 2026-11-15` line at the top. No card id, scope or acceptance rule changed; only API names, signatures, numbers and the proficiency source changed.

Sources checked: geldar `psyche/src/` (index.ts, types.ts, rng.ts, roll.ts, sheet.ts, threat.ts, proficiency.ts, params.ts, alignment.ts, version.ts) and the kit package `@geldar/scriptorium-psyche` (`packages/psyche/src/index.ts`, `check.ts`, `sheet.ts` at `origin/scriptorium/hw0`, read after a fetch). The kit keeps the engine copy in `packages/psyche/engine/` and its own entry in `packages/psyche/src/`.

Real API facts used:
- Engine signatures: `roll(fx, score, dc, rng, proficiency = 0)`, `modeFor(score) -> {mode, bonus}`, `exactChance(score, dc, proficiency) -> {wins, total}`, `step(score, base, perPoint, min, max)`, `factor(score, base, k)`, `alignmentLabel(law, good)`, `levelForXp(xp, thresholds?)`, `rngFor(key: DrawKey)`, `decisionId(key)`, `seedFor(key, engineVersion?)`, `d20(rng)`.
- `DrawKey` is one object: `{ lifeId, producer: 'body' | 'kit', generation, tick, fx, decisionSeq }`. `decisionId` joins them with `:` and refuses `:` in `lifeId` or `fx`.
- `CharacterSheet` (the engine's name for the sheet type) has no proficiency field.
- Kit `check(fx, score, dc, rng, n, lifeKey, tick, { prof, rolls })` is the 8-argument call. `successChance(score, dc, prof)` is positional; `successProbability` is an alias of it.
- Kit entry exports by name, not `export *`. It does NOT export `TEMPERAMENT_BANK` or `temperamentFor`, and it does not export the engine's `decideThreat`, `fightFloor`, `fightLimitMs`, `ThreatCall` or `ThreatInput`. No card imports any of those now.
- Kit `parseSheet(text) -> Sheet | null` refuses a `proficiency` key; kit `normalizeSheet` (engine, re-exported) returns the error list.

## Table of changes

Line numbers are the line in the file before this commit.

| # | File | Line | Before | After | Why |
|---|---|---|---|---|---|
| 1 | w3-w5 | 1 to 3 | (no correction line) | `Corrections 2026-11-15:` paragraph before Status | the brief asks for a summary line at the top |
| 2 | w3-w5 | 8 | `mirrored ... into the kit (packages/psyche, HC-17a/b, ...)` | adds the layout: engine copy `packages/psyche/engine/`, kit entry `packages/psyche/src/`, package `@geldar/scriptorium-psyche` | the kit's mirror is not `packages/psyche/src/` |
| 3 | w3-w5 | 11 | `SQL numbers: 0050 and 0051 are used;` | `SQL numbers: 0050 to 0052 are used or taken (0052 by PR #455's erasure comments);` | 0052 is taken by the erasure ruling's comment migration |
| 4 | w3-w5 | 11 | `only 0283 to 0289 remain in this campaign's range (...)` | `... 0283 to 0289 remain ..., then the overflow block 0320 to 0329 (...)` | decision range now 0283 to 0289, then 0320 to 0329 |
| 5 | w3-w5 | 13 | exports list includes `temperamentFor`, `TEMPERAMENT_BANK` | both removed from the list | the kit entry does not export them |
| 6 | w3-w5 | 13 | (no note) | adds: `TEMPERAMENT_BANK` and `temperamentFor` are not exported by the kit, by design (temperament inactive) | explains the removal |
| 7 | w3-w5 | 97 | types come from `packages/psyche`, import path `@geldar/psyche`, `to confirm` | come from the kit package `@geldar/scriptorium-psyche`; types are type-only exports | real package name; the `to confirm` is resolved |
| 8 | w3-w5 | 148 | `FxContext.proficiency ... OD-C: all 0 and degraded` | adds: levels come from the world state (Body cache or supervisor feed), never from the sheet | proficiency source rule (OD-C) |
| 9 | w3-w5 | 150 | `draw(fx): { key: DrawKey; rng: Rng }` with a loose comment | comment says `key` is one DrawKey object with its six fields and `rng = rngFor(key)` | `rngFor` takes one DrawKey |
| 10 | w3-w5 | 233 | `the roll reads the program's domain level from ctx.proficiency` | adds `which the world state fills and never the sheet` | proficiency source rule |
| 11 | w3-w5 | 240 (HC-20) | `exactChance(cleverness, dc, level).wins * 2 >= total` | `exactChance(cleverness, dc, ctx.proficiency[domainOf(failed.program)]).wins * 2 >= total` | `level` is not defined in the card; the real call takes a Level |
| 12 | w3-w5 | 360 (HC-25) | `returns temperamentFor(sheet) ...` | returns the temperament sentences; correction: `temperamentFor` and `TEMPERAMENT_BANK` are not exported, so HC-25 stops `blocked` at that import until the OD-A route names one | the import does not exist |
| 13 | w3-w5 | 360 (HC-25) | `equals the SHA-256 of canonical JSON of TEMPERAMENT_BANK` | `... of the bank (TEMPERAMENT_BANK, by the route to confirm above)` | same missing export |
| 14 | w6-w8 | 1 to 3 | (no correction line) | `Corrections 2026-11-15:` paragraph before Status | the brief asks for a summary line at the top |
| 15 | w6-w8 | 10 | `the kit mirrors it byte for byte (packages/psyche, pinned by ...)` | adds the engine copy `packages/psyche/engine/` and kit entry `packages/psyche/src/` | mirror layout |
| 16 | w6-w8 | 14 | `Decisions: only 0280-0289;` | `Decisions: 0280-0289, then the overflow block 0320-0329;` | decision range |
| 17 | w6-w8 | 14 | `SQL: only 0050-0059; 0050 and 0051 are used;` | `SQL: 0050-0059; 0050 to 0052 are used or taken (0052 by PR #455's erasure comments);` | 0052 taken |
| 18 | w6-w8 | 74 | `successProbability(score, dc, proficiency?)` | `successProbability(score, dc, prof)`, positional, `prof` required (integer 0 to 3 from the world state); `successChance` is the same function | real signature: three positional arguments, prof required |
| 19 | w6-w8 | 153 | `Chance { score: number; dc: number; proficiency: number }` | `Chance { score: Score; dc: number; proficiency: Level }` with a note | real types; predict only builds integers in range |
| 20 | w6-w8 | 156 | `// production: successProbability from psyche` | `// production: (c) => successProbability(c.score, c.dc, c.proficiency), a positional adapter` | the kit function takes three arguments, not an object |
| 21 | w6-w8 | 164 | fixture `successProbability(3, 11) = 0.5` and `(1, 8) = 121/400` | `successProbability(3, 11, 0) = 0.5` and `successProbability(1, 8, 0) = 121/400` | prof argument is required; values checked by hand (score 1 is disadvantage, bonus -2: p = 11/20, squared = 121/400) |
| 22 | w9-w12 | 1 to 3 | (no correction line) | `Corrections 2026-11-15:` paragraph under the title | the brief asks for a summary line at the top |
| 23 | w9-w12 | 129 | `0289 spare. Decisions 0280 and 0281 are used.` | adds `the overflow block 0320 to 0329 is unused by these cards` | decision range |
| 24 | w9-w12 | 191 | `sheet(): { law; good; rolls; lawProficiency: 0 \| 1 \| 2 \| 3 }` | `sheet(): { law: Score; good: Score; rolls: boolean }`; rolls is the Body's config flag, not a sheet field | the sheet has no proficiency (types.ts) |
| 25 | w9-w12 | 192 | `check(decisionKey: string, score: number, proficiency, dc: 11)` | `check(key: DrawKey, score: Score, prof: Level, dc: 11)`; the Body runs `roll(fx, score, dc, rngFor(key), prof)` and records `decisionId(key)`; fx label `to confirm` | real engine shape (roll plus rngFor(DrawKey)); the level comes from the cache |
| 26 | w9-w12 | 199 | `and sheet.rolls is true and check(key, law, lawProficiency, 11).success` | `and the Body's rolls flag is true and check(key, law, prof, 11).success`, with prof from the cache for the domain the card names (`to confirm`: no Domain is law) | sheet has no rolls or proficiency; no psyche Domain is law |
| 27 | w9-w12 | 281 | `psyche/src/index.ts (exports);` | adds: named exports one per line; `export *` is refused | the engine rule |
| 28 | w9-w12 | 285 | `parentA: InnerSheet; parentB: InnerSheet` | `parentA: CharacterSheet; parentB: CharacterSheet` | `InnerSheet` does not exist; the engine type is `CharacterSheet` |
| 29 | w9-w12 | 287 | `{ sheet: InnerSheet; fields: ... }` | `{ sheet: CharacterSheet; fields: ... }` | same |
| 30 | w9-w12 | 289 | `u from rngFor(birthId, field)` | `u from rngFor(key).next()`, key a DrawKey with producer body, lifeId birthId, generation 0, tick 0, fx `inherit_` + field, decisionSeq 0; `seed` not a DrawKey field, so how it enters is `to confirm` | `rngFor` takes one DrawKey; fx may not contain `:` |
| 31 | w9-w12 | 298 | `may-edit packages/psyche/src/** (byte copy of psyche/src/ ...)` | `packages/psyche/engine/**` (byte copy); `packages/psyche/src/` is the kit's own entry and is not touched | mirror layout |
| 32 | w9-w12 | 299 | `Copy psyche/src/ at tag ... byte for byte;` | adds `into packages/psyche/engine/` | mirror layout |

## Checked, no change needed

- Number table in w9-w12 (lines 5 to 21): consistent with the cards (0282 kept, 0283 to 0289, SQL 0054 to 0058, 0052 PR #455). Left as is.
- S9-00 (w9-w12 line 155): says 0052 corrects the 0051 comments on PR #455; that matches the taken number. Left as is.
- No `export *` of the psyche engine appears in the three files. The one `export *` in w6-w8 concerns `contract/src/index.ts`, not psyche. Left as is.
- No card calls `check()` with another arity, or calls `rngFor(lifeKey, tick, fx, n)`. The only `check` calls were the w9 shape (fixed) and the w6 fixture (not a kit call).
- `sheet.proficiency` does not appear. HC-20 already reads `ctx.proficiency` (world state); the fix there is the undefined `level` name.
- `decideThreat`, `fightFloor`, `fightLimitMs`, `MAX_SHEET_BYTES`: no card imports them. If one later needs them, the kit entry must add named exports first (`to confirm`).
- `parseSheet` / `normalizeSheet` (w3-w5 line 373 names `normalizeSheet`, which the kit exports and which returns errors): left as is.
- Socials and stranger text (`socialProficiency`, w6-w8) are world-state inputs. The header line covers them; no per-line edit.

## Open items (not changed; `to confirm`)

- Fx label for the property refusal check (w9-w12 line 194).
- Which domain the law refusal reads for proficiency (w9-w12 line 199); no psyche Domain is law.
- How `InheritInput.seed` enters the draw (w9-w12 line 289).
- Route for the temperament bank (w3-w5 line 360, OD-A).

## 2026-11-18: the W3 to W5 file rewritten to the verified code and the operator rulings

Sources: [../sheet-cards-verification-2026-11-18.md](../sheet-cards-verification-2026-11-18.md) (G1 to G13 and the per-card mismatch table), [../sheet-next-wave-order.md](../sheet-next-wave-order.md), geldar `origin/main` `a8063b0a` and the kit `origin/scriptorium/hw0` `673d756` (read with `git -C`; nothing changed there), and the decision records the decisions session drafted the same day (0320, 0324, 0325, 0327). Only `work-packets-sheet-w3-w5.md` changed; the W6 to W8, W9 to W12 and NeoForge card files, the decisions, RESUME and the ledger are other sessions' files.

### Operator rulings applied

| # | Ruling | Where in the file |
|---|---|---|
| 1 | the kit repo's `work-packets-kit-b.md` is the authority for HC-19 to HC-26c (drafted 0320) | HC-18 marked Done; HC-19 to HC-26c replaced by stubs (status Retired, ids kept in the dependency table, "re-verify on dispatch" lines for the kit orchestrator); the "common shapes" block (`types.ts`, `store.ts`, `step.ts`, `InstinctStore`, `runStep`, `SnapshotView`) removed. The OD-C correction to kit-b HC-20 (all-zero, degraded round one; never read `sheet.proficiency`) is stated on the HC-20 stub and carried by the new kit change card HC-47, which also fixes kit-b HC-22's `proficiency('exploring')` |
| 2 | a kit change card for positions and ids in `observe.ts` (drafted 0324) | HC-46a (Code now: keep the `x, y, z` the world already sends on notable blocks and entities, and measure notable distance from the agent's position; no new agent-visible field) and HC-46b (BlockedDecision: "decision: observation fields (number assigned in the registry)", OWNER APPROVAL REQUIRED, lists what the agent is told today and the proposed agent position and id fields). Both ship inactive |
| 3 | the `psyche-v1.1.0` tag is approved (drafted 0325) | HC-48: annotated tag on merge `4cff991d` (PR #458; `psyche/` unchanged since), then the kit re-mirror at 1.1.0 (`vendor.ts` `RELEASE_TAG`, `MIRROR.json`, `engine/threat.ts`, the two pinned literals in `mirror.test.ts`); placed before HC-42. The push needs the operator when the pushing session lacks tag-push credentials |
| 4 | name the unruled item per card | "Status words and the unruled items" section and an "Unruled item that blocks it" column. OD-A, OD-B, OD-E are the unruled sentence items; OD-C ruled for round one by ruling 1; OD-D moot (GX-04) |

### Global fixes applied

| Fix | Change |
|---|---|
| G1 | kit base `scriptorium/hw0`; `scriptorium/hw2` removed from R2, R7 and the HC-24 stub |
| G2 | the local user-profile kit path removed; the kit is "the sibling repo `geldar-scriptorium`, path given in the brief"; a personal pronoun for the kit orchestrator replaced by the role |
| G3 | kit worknote `docs/analysis/harness/worknotes/HC-<nn>.md` |
| G4 | world worknote `docs/analysis/harness/worknotes/AN-<nn>.md` (was `docs/analysis/character-sheet/worknotes/`) |
| G5 | `phase1/sheet-w5` is created by the orchestrator from `origin/main` and named in the brief |
| G6 | 0320 to 0328 are now drafted by the decisions session, so the wave-order note's "AN-24 = 0320" is void: AN-24 takes the next free registry number at dispatch; a record-writing card adds its own `docs/decisions/README.md` row (`check:repo` fails an unlisted record, `tools/repo-checks/src/cli.test.ts` "decision index wiring") |
| G7 | no SQL in this file; 0053 stays free |
| G8 | `contract/src/index.ts` 557 lines; `observationSentence` moved to a new `contract/src/observation.ts`; `index.ts` gets named export lines only; `outcome-words.ts` is must-not-edit for AN-24 |
| G9 | `adam-body.ts` 413 lines; AN-28b tests go in a new `golem/src/adam/adam-body-observations.test.ts` |
| G10, G11 | RESUME and ledger belong to another session; new ids for the ledger are listed at the end of the card file: HC-46a, HC-46b, HC-47, HC-48, AN-28c |
| G12 | GATE-K spells out the kit commands (`format`, `lint`, `typecheck`, `pnpm exec vitest run`, `check:repo`, `lint:md`; `./scriptorium.ps1 setup` in a new worktree) |
| G13 | HC-48 is the tag and re-mirror card; no W3 to W5 card imports a 1.1.0 export |

### Per-card changes

| Card | Before | After | Why (verified) |
|---|---|---|---|
| HC-33 | worknote under `docs/analysis/scriptorium/worknotes/`; checks `check:repo` only | kit worknote path (G3); four fixed headings; checks add `lint:md` and `check:specs`; stop rule if `check:specs` needs an index entry | kit scripts on hw0 |
| AN-24 | `observationSentence` in `outcome-words.ts`; "about 535 lines"; number "allocate" | new `contract/src/observation.ts`; exact `$id`, titles, `$defs` and refs (`WorldName`, `BlockCoordinateXZ/Y`, `OwnerId` in `block-owner.schema.json`; `LifeId`, `ItemName` in `common.schema.json`); validators `validateObservationPayload`, `validateProvenance` (named after the schema title, `contract/scripts/generator.ts:78`); `McpPlayerEvent.type` enum edit; its README row | G8; generator rule; no `$defs` name collision |
| AN-25 | `lifeIdFor` "to confirm"; resolver behaviour loose | `observedActor(bot, username, lifeIdOf = lifeIdFor)`; new `actorUsernameOf` beside `attackerOf`; line refs (`hurt-trigger.ts:32, 55, 106`, `hurt.ts:21, 31, 92`, `registry.ts:51`, `visible-agent.ts:112`); byte-identical test without a resolver | verified in golem |
| AN-26a | test "built like `OwnerOverlayTest` with `ListenerDoubles.java`"; `getThrower` "to confirm"; "drop beyond 1024 pending" | own Proxy doubles (`ListenerDoubles` and `EventSchemaCheck` are package-private in `dev.geldar.core`); constructor with injected tick and online lookup; per-tick cap 64 only (the undefined pending queue dropped); static `pickupJson`; one `jar-contents.golden` line; compile-is-the-check stop rule for `Item#getThrower`, `Material#getKey` and the event constructor (the Paper jar is not in the local cache, so not confirmed here) | `plugin/core/build.gradle.kts` `verifyJarContents` |
| AN-26b | no resolver in ctx; `seen` LRU loose | `resolve` injected; exact attribution and loot rule including a null distance; the AN-26a capture as a fixture file | testability |
| AN-27a | `ProvenanceSink` under `plugin/.../blockowner/`; test with `:core:test`; "read the prior owner from the cache" | `ProvenanceSink` and the link `send` in `plugin/core-common`; static `priorOwner` over `freshBase` and `withChanges` (`OwnerCache` has no single-block read and is must-not-edit); link test in core-common (`:core-common:test`), listener test in core (`:core:test`); one golden line; `config.yml` must-not-edit | verified `OwnerCache`, `OwnerSource.OwnedBlock` |
| AN-27b | `canSee` implicit | `canSee(x, y, z)` injected; AN-28b builds it from `canSeeBlock(bot, block)` (`notable-blocks.ts:72`) and `bot.blockAt` | the real function takes a `Block` |
| AN-28a | three `animus/` files under OD-D | `player-core/src/ports/body.ts`, `player-core/src/link/mind-event.ts`, `player-core/src/link/link.fixtures.ts`, new `player-core/src/link/observation-event.test.ts`; `animus/**` must-not-edit; `handler-registry.test.ts` path corrected to `threshold/mcp/src/events/` | GX-04 landed; the animus files are 2-line stubs |
| AN-28b | one card for Body, plugin, ACL and leakage; extends `adam-body.test.ts`; gate unnamed | split: AN-28b keeps the Body subscription (`startObservations`), an `observations?: boolean` option on `AdamBodyEnv` (absent means off; nothing in production sets it) and the leakage test | the verification's split; G9 |
| AN-28c | (new) | plugin setup (`provenanceEnabled(FileConfiguration)`, the six-argument listener, the pickup listener registration), `geldar.ps1` `body` `Sub` and `PubDeny` gain `geldar.$s.provenance.>`, the two nats-auth tests; no `config.yml` default (its hash is in the golden) | split from AN-28b |

### Open after this edit (for the orchestrator)

- Drafted 0324 says the observation card is "HC-46, to be confirmed by the card author": it is split into HC-46a (no new agent-visible field) and HC-46b (the agent fields, waiting on the OD approval of the fields and wording). The world-side geldar card that adds agent fields to the MCP output is not written.
- Kit-b HC-21a's `goals.md` goal source versus merged `run.ts` (`obs.intent?.goal`) is noted on the HC-21a stub for the kit orchestrator.
- The Paper API names in AN-26a and AN-28c (`Item#getThrower`, `Material#getKey`, `Bukkit::getCurrentTick`, `Bukkit::getPlayer(UUID)`) are compile-checked by the coder with a stop rule; they were not confirmed against the jar here.
