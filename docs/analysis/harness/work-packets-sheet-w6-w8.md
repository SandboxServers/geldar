# Sheet campaign cards, waves W6, W7 and W8 (estimated sheets, explore/farm/patrol, complete evidence)

Corrections 2026-11-15: the psyche calls now match the real signatures (`successProbability(score, dc, prof)` takes three positional arguments, `prof` required; `rngFor` takes one DrawKey); proficiency levels, including `socialProficiency`, come from the world state, never the sheet; decisions 0280-0289 then the overflow block 0320-0329; SQL 0050 to 0052 used or taken. Every change is listed in `worknotes/cards-w3-w12-corrections.md`.

Status: **proposal, nothing dispatched.** Written 2026-11-15 against geldar `origin/main` = `280b8ea9`. Coordinator: geldar-sheet (decisions 0280-0289, SQL 0050-0059). W2 and W3-W5 are written and coded elsewhere and are not in this file; this file only **assumes their names** (section "Assumed from W2 to W5").

Sources read: `docs/analysis/character-sheet/{README,work-packets,decisions-before-packets}.md`, `docs/analysis/sheet/RESUME.md`, the existing cards `harness/work-packets-geldar-a.md` (format and rigor), `work-packets-geldar-b.md` (W7, W8 base text), the kit repo's `work-packets-kit-c.md` (HC-27 to HC-31 base text), and the uploaded brief and v3 kit plan. These cards **supersede** the W6-W8 text in `work-packets-geldar-b.md` and `work-packets-kit-c.md` where they differ: the differences are listed in "Differences from the older cards" so nobody dispatches both.

## Ground rules that shape every card

- **Which repo.** Each card names its repo. `geldar` = this repo. `kit` = `geldar-scriptorium` (`C:\Users\Steve\source\projects\geldar-scriptorium`). The in-house Mind (`animus/`) is **frozen and never edited**; the kit is the one Mind, so every W6 card is a kit card and the Mind-side halves of W7 and W8 are kit cards (HC-27c, HC-31). The live player path no longer lives in `animus/`: the `act` allow-list is `player-core/src/validate/bounds.ts` (`PHASE0_PROGRAMS`, `PROGRAM_ARGS`) and the event list is `player-core/src/link/mind-event.ts` (`MIND_EVENT_TYPES`); the `animus/` files are deprecated re-export stubs. Cards edit the `player-core` files, never the stubs.
- **psyche.** `psyche/` is the zero-import package (decision 0281): nothing in `psyche/src/` imports outside itself, and the kit mirrors it byte for byte (engine copy `packages/psyche/engine/`, the kit's own entry `packages/psyche/src/`, pinned by `psyche/RELEASE.json` tree hash). **No card here edits `psyche/`.** A W6 prediction needs a pure policy shape; if the released engine lacks a needed export, the card stops `blocked` and the orchestrator requests a psyche release (new `ENGINE_VERSION`, new tag, GX-02 procedure), not a drive-by edit.
- **Blindness (B1 to B9, kit-c).** Sheet scores, estimates, alignment labels and the word "estimate" never reach any model context, prompt, tool output, file or log the character can read. Agents are never told they are watched, measured, modelled or coached. Prediction numbers go to the operator ledger only.
- **Owner approval.** Any card that produces agent-visible text (a sentence, a prompt entry, a tool description) is marked **OWNER APPROVAL REQUIRED**. Such a card merges its code and text **inactive**: behind a flag that defaults false, or in an unreleased/unselected prompt version, with a test that the off path produces no text. Activation is a separate owner act (D-CS-10), never part of the card. Content that tells an agent who to be needs that approval; none of these cards writes such content (the prose bank in HC-29 is observation about others, but it is still agent-visible, so it is gated).
- **Principle 2 and decision 0058.** Nothing here imposes a goal. Programs are bounded means to an adopted goal (D-CS-01, D-CS-14); idle selection and stranger policy never write the goal stack, never speak, and a first sighting always goes to the model. An agent knows only what it saw, tried or was told: estimates update only from observer-scoped causal evidence, an unseen act changes nothing, an unobserved field stays at its prior and is never shown. Own-sheet-derived priors exist only as numbers inside the supervisor volume; no text derived from a prior alone is ever shown (a field renders only after at least one observation).
- **Numbers.** Decisions: 0280-0289, then the overflow block 0320-0329; 0280 and 0281 are used, **0282 is reserved for the account-erasure sheet ruling**, every other number is written `<allocate via registry>` (the orchestrator fills 0283 and up). SQL: 0050-0059; 0050 to 0052 are used or taken (0052 by PR #455's erasure comments); **no card in this file needs SQL** (the one conditional case is AN-46, which writes an "index line to add" and stops). Prompts: body-api is at `v9`; the card writes `<allocate via registry>` (recommend `v10`).
- **Contract regeneration is serial.** Cards touching `contract/` say so and list the shapes. Order: **AN-44, then AN-46**, and both after whatever W5 and W3-W5 contract cards (AN-24 and others) are queued. Two contract cards never run in parallel. `contract/src/index.ts` is 534 lines (over the 500 soft cap, under 700): new validators go in a new file `contract/src/<topic>.ts` and `index.ts` gets one `export *` line, nothing else.
- **Files:** soft cap 500, hard cap 700 lines. Exact version pins; no card adds a dependency (a needed dependency stops the card). LF endings. A behaviour change needs a test that fails when reverted (each card lists them).
- **No world-visible shortcuts.** New Body programs need the body-api contract change first: AN-44 (shapes) then AN-45 (registration and the published body-api version). Nothing lets a human act in the world (Principle 1).

## Dependency table

"Parallelizable now" = a coder can start today against the shapes written in this file (nothing it needs has to be merged to write and unit-test it); the **merge** still waits for the depends-on column. `no` = the card cannot be coded until a merged artifact exists.

| Card | Repo | Depends on | Parallelizable now | Why |
|---|---|---|---|---|
| HC-27a social model rules, arithmetic, store | kit | HC-18 (package `packages/instinct`), HC-17b (psyche types) | yes | pure new files; types stubbed from shape S-PSY |
| HC-27b observations, dedup, sampling, apply | kit | HC-27a, AN-28 (W5 field names) | yes (after HC-27a is on a branch) | reader table is one file; shapes S-OBS |
| HC-28a prediction by interpolation | kit | HC-27a, HC-17b | yes | pure; policy test double |
| HC-28b stranger policy | kit | HC-27b, HC-28a | no (imports both) | |
| HC-29 bounded social prose (OWNER APPROVAL) | kit | HC-27a | yes | pure; text inactive |
| HC-30a W6 integration | kit | HC-27b, HC-28b, HC-29, HC-24, HC-19 | no | wiring |
| HC-30b W6 close (docs) | kit | HC-30a | no | |
| AN-44 program shapes and contract | geldar | W5 contract cards merged (serial regen) | yes | **owns contract regen slot for W7** |
| AN-39 explore program | geldar | AN-44 (merge order only) | yes | reads args through `ArgReader`, no contract import |
| AN-40 farm program | geldar | AN-44 (merge order only) | yes | same |
| AN-41 patrol program | geldar | AN-44 (merge order only) | yes | same |
| AN-45 register, drift test, body-api v10 (OWNER APPROVAL) | geldar | AN-39, AN-40, AN-41, AN-44 | no | |
| HC-31 idle binding | kit | HC-21, AN-44, AN-45 | yes | catalog is an injected interface |
| AN-46 evidence contract (OWNER APPROVAL) | geldar | AN-45 (contract serial order), AN-24 | yes (write); regen waits its slot | |
| AN-47a combat facts, plugin | geldar | AN-46 (merge order), AN-27a (`ProvenanceSink`) | yes | JSON shapes in S-COMBAT |
| AN-47b combat award normaliser and fight filter | geldar | AN-46, AN-47a, AN-25, AN-09a (`AwardUnit`) | yes | shapes S-AWARD, S-PROV |
| AN-49 conversation exchange award | geldar | AN-46 (ADR only), AN-09a | yes | consumes stored `speech` events |
| AN-51a container-take facts, plugin | geldar | AN-46, AN-27a | yes | |
| AN-51b observed take, owner's Body | geldar | AN-46, AN-51a, AN-25 | yes | |
| HC-27c kit reader for `fight_seen` and `container_taken` | kit | HC-27b, AN-46 | yes | one table row plus tests |
| AN-50 evidence integration and leakage gate | geldar | AN-47b, AN-49, AN-51b, AN-28b | no | shared wiring owner |

Wave order: W6 may overlap W7 (different repos, no shared file). W8 follows W7 only for the contract slot; the plugin and sink cards of W8 can be coded while W7 is in flight.

## Owner decisions each card needs

| Card | Owner decision(s) needed before dispatch or before activation |
|---|---|
| HC-27a, 27b, 28a | D-CS-05 (interpolation), D-CS-06 (observer-scoped evidence), prior strength 2 and the observation values (unmeasured parameters). Assumed answers in the decision records; confirm. |
| HC-28b | D-CS-01 (heuristics choose means only; first sighting goes to the model), the stranger formula as written. |
| HC-29 | **OWNER APPROVAL REQUIRED** for the 8-sentence bank and the uncertainty sentence (agent-visible); D-CS-10 for activation. |
| HC-30a | D-CS-10 (activation); config default decided here as off (differs from kit-c, see Differences). |
| HC-30b | none |
| AN-44 | D-CS-14 (program boundaries: completion, limits, knowledge, property behavior), ADR `<allocate via registry>`. |
| AN-39, AN-40, AN-41 | D-CS-14. AN-40 also needs the property rule confirmed (own and world-generated cells only; unknown is protected, 0164). AN-41 needs the patrol "route is supplied, never looked up" ruling. |
| AN-45 | **OWNER APPROVAL REQUIRED** for the program summary sentences in body-api v10 and the `outcome-words` templates from AN-44; D-CS-14. |
| HC-31 | D-CS-14, D-CS-01. No agent text. |
| AN-46 | **OWNER APPROVAL REQUIRED** for the two new observation sentences; D-CS-04 (award units, one award per encounter), D-CS-06, D-CS-15 (exchange only; promises stay deferred with AN-48/D-HC-06), ADR `<allocate via registry>`. |
| AN-47a, 47b | D-CS-04 (combat: one award per encounter; same-event kill and survive do not both award), D-CS-06. Owner confirms `FIGHT_END_TICKS = 200` and the 512-encounter cap (unmeasured). |
| AN-49 | D-CS-15: the exchange window (`EXCHANGE_WINDOW_TICKS = 600`, owner parameter) and the participant/turn rule. |
| AN-51a, 51b | D-CS-06; the conservative reading that only the container's owner observes a take. |
| HC-27c | none beyond AN-46. |
| AN-50 | D-CS-04, D-CS-06; activation D-CS-10 (inactive rows listed below stay inactive). |

## Assumed from W2 to W5 and from the kit (names to confirm at dispatch; a mismatch stops the card)

- **S-AWARD** (W2, AN-09a): `type AwardUnit = { lifeId: string; domain: 'combat'|'farming'|'mining'|'building'|'crafting'|'exploring'|'social'; evidenceKey: string; tick: number }`. Normalisers are `(event: WorldEvent) => AwardUnit[]`, files under `eventsink/src/awards/`; registration into `eventsink/src/writer.ts` is AN-50's. Eventsink is the sole XP authority; uniqueness is `(life, domain, evidence_key)` (AN-10a).
- **S-OBSERVED** (W5, AN-24): `ObservedActor = { name: string; life: string }`, absent when the actor was not visible. WorldEvent type `observation` (`agent_id` = observer), payload `ObservationPayload` with `kind` in `gift_received | property_broken` (AN-46 appends `fight_seen | container_taken`), `actor?`, fields, `key`. `damage` payload gains optional `actor`. MCP presentation: `McpPlayerEvent.type` gains the same names, with optional structured `actor { name, life? }`, `item`, `count`, `block`; sentences are fixed templates in `contract/src/outcome-words.ts` `observationSentence`.
- **S-PROV** (W5, AN-24): `contract/schemas/provenance.schema.json`, subjects `geldar.<shard>.provenance.<break|pickup>` (4 tokens, outside the sink filter, Body role subscribes, plugin role publishes), helper `provenanceWildcard(shard)`; Body filters live under `golem/src/perception/provenance/` (`visible-actor.ts` from AN-25 exports `observedActor(bot, name)`); `ProvenanceSink.send(kind, json)` in the plugin (AN-27a); `subscribe.ts` (AN-28b) dispatches by subject tail.
- **S-PSY** (kit, HC-17): `packages/psyche` exports `CharacterSheet` (`attributes.{curiosity,common_sense,cleverness,aggression}`, `alignment.{law,good}`, `op_modes`), `Score`, `STANDARD_SHEET`, `successProbability(score, dc, prof)` (positional; `prof` is required, an integer 0 to 3 from the world state; `successChance` is the same function), `roll`, `rngFor`.
- **S-INSTINCT** (kit, HC-18/19/21/24): `packages/instinct`; `InstinctContext { stateDir, observer, lifeId, sheet, socialProficiency, tick, run, rolls, events, nearby, config }`; step result `{kind:'settle'|'facts'|'escalate'|'pass'}`; `appendLedger(stateDir, line)` (operator `instinct.jsonl`); `IdleCandidate { mode, program, args(ctx) }`; `WorldLink.programs()`.

If any assumed name is wrong, only the single adapter file named in the card changes; the card says which.

---

# Wave W6: estimated sheets and prediction (all kit)

**Wave branch (kit):** `scriptorium/hw4`. Worktrees `C:\Users\Steve\source\projects\geldar-scriptorium\.claude\worktrees\hc-<nn>`. All kit cards: one Haiku `packet-coder`, about 40k working tokens, kit rules R1-R12 and checks CK-1..CK-4 (CK-T where text is added), pnpm as `./scriptorium.ps1 pnpm`. **Shared kit files edited by W6: only HC-30a** (`packages/instinct/src/step.ts`, `config.ts`, `social/index.ts`); every other W6 card creates new files only. No W6 card edits `contract/`, SQL, `psyche/` or the world repo. Worknote `docs/analysis/harness/worknotes/<id>.md` (kit repo). No SQL: the social model is kit-local (D-HC-04), stored under the supervisor volume only.

## HC-27a: social model rules, update arithmetic and store

- **repo** kit. **wave** W6 (HW4). **depends-on** HC-18, HC-17b. **parallelizable now** yes. **size** 30k. **branch** `scriptorium/hc-27a-social-store`.
- **trim** from the world plan's AN-29: no SQL migration, no Postgres store, no lifecycle/export hook (kit-local, B3).
- **may-edit (all new)** `packages/instinct/src/social/rules.ts`, `model.ts`, `store.ts`, `model.test.ts`, `store.test.ts`. **must-not-edit** `packages/psyche/**` (read-only mirror), any `index.ts` or `package.json` (HC-30a), `template/**`, `contract/`, the world repo. **shared files edited** none.
- **decisions** D-CS-05, D-CS-06 (assumed). **owner approval** none (no agent text).
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
    last_run: number; spoke: boolean; last_sample?: { tick: number; dist: number; me: [number,number,number] };
    fields: Partial<Record<LearnedField, FieldEstimate>>; updated_tick: number }
  export function ownScore(sheet: CharacterSheet | null, f: Field): number;        // 3 when null
  export function priorFor(f: Field, own: CharacterSheet | null): number;          // 3 + 0.25*(5-own.common_sense)*(own[f]-3), clamp 1..5
  export function applyEvidence(cur: FieldEstimate | undefined, prior: number, evidence: number, tick: number, strength?: number): FieldEstimate;
                                                                                    // base + (evidence-base)/(n+strength), clamp 1..5, 6 decimals
  export function estimateOf(m: OtherModel | null, f: Field, own: CharacterSheet | null): { estimate: number; n: number; supported: boolean };
  export class SocialStore { constructor(stateDir: string, observer: string, lifeId: string);
    load(other: string): OtherModel | null; save(m: OtherModel): void; list(): OtherModel[] }
  export const SAFE_ID: RegExp; // /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/
  ```
  `common_sense` and `cleverness` have no rule: never stored, always read as their prior, `supported: false`. Store: one file per other, `<stateDir>/social/other-<id>.json`, key is the other's id never a display name, tmp-file-then-rename, mode 0600 (skip the mode assertion on win32), directory 0700; `meta.json {observer, life}`; a different `lifeId` renames the directory to `social.archive-<oldlife>` (id filtered to `SAFE_ID`) and starts fresh, so a new life never inherits an estimate while death inside one life keeps it.
- **tests** evidence 4.5 applied three times from prior 3 gives 3.75, 4.0, 4.125; prior projection (own common_sense 1 and curiosity 5 gives 5; common_sense 5 gives 3; common_sense 3 gives 4); clamp 1 and 5; unlearned fields unsupported even after other updates; inactive rules marked off; store round trip and mode; different life archives; unsafe ids refused (`../x`, `a b`, 40 chars).
- **checks** CK-1 (`packages/instinct/src/social/model.test.ts`, `store.test.ts`), CK-2, CK-3, CK-4.
- **revert-checks** divisor `n + 1` instead of `n + strength`: hand-value test fails. Drop the projection factor: prior test fails. Switch `fought_mob` active: inactive-rules test fails. Skip the life check in `open()`: archive test fails.
- **worknote** `HC-27a.md`. **commit** `feat(instinct): social model rules, update arithmetic and store (HC-27a)`. **on-cap** commit passing files, list missing tests, stop. **split line** `rules.ts`+`model.ts` first, `store.ts` second.

## HC-27b: observations: scope, dedup, sampling and apply

- **repo** kit. **depends-on** HC-27a, AN-28 (W5 names S-OBSERVED). **parallelizable now** yes against S-OBSERVED; merges after AN-28. **size** 38k. **branch** `scriptorium/hc-27b-social-observe`.
- **may-edit (new)** `packages/instinct/src/social/observe.ts`, `dedup.ts`, `sample.ts`, `apply.ts`, `observe.fixtures.ts`, `observe.test.ts`, `apply.test.ts`. **must-not-edit** HC-27a files (a gap is reported, not patched), anything outside `social/`, `template/**`. **shared files** none.
- **decisions** D-CS-06 (only visible, causal evidence; one update per valid observation). **owner approval** none.
- **shapes**
  ```ts
  export interface RawEvent { type: string; id: string; tick: number; data: Record<string, unknown> }
  export interface Observation { observer: string; kind: ObsKind; actor: string; actorName: string; key: string; tick: number }
  export function eventObservations(observer: string, events: readonly RawEvent[], nearby: readonly {id: string; name: string}[]): Observation[];
  export function positionObservations(observer, prev, tick, me, other): { observations: Observation[]; sample: NonNullable<OtherModel['last_sample']> };
  export class SeenSet { constructor(stateDir: string); has(key: string): boolean; add(key: string): void; flush(): void }  // newest 4000, FIFO, mode 0600
  export interface ApplyReport { applied: number; deduped: number; dropped: { foreign: number; self: number; inactive: number; badId: number } }
  export function applyObservations(store: SocialStore, seen: SeenSet, own: CharacterSheet | null, observer: string, obs: readonly Observation[], run: number, strength?: number): ApplyReport;
  export function noteSighting(store: SocialStore, other: string, name: string, run: number): void;
  ```
  Event table (the only place field names live; it follows the **W5 shapes S-OBSERVED**, not the older kit-c guess): `speech` with `to_me === true` gives `spoke_first` (key `speech:<event id>`); `hurt` carrying a structured `actor` gives `hit_me` (key `hurt:<id>`); `gift_received` gives `gave_me`; `property_broken` gives `took_mine` (law and good). An actor identified only by `name` is resolved to an id through `nearby` (exact name match, one hit); no match or two matches drops the observation (unknown stays unknown). Sampling constants (unmeasured): `SAMPLE_TICKS 6000`, `MIN_GAP_TICKS 100`, `MOVE_BLOCKS 6`, `SELF_STILL_BLOCKS 2`, `NEAR_BLOCKS 32`; a standing player makes no observation, one approach or keep-away per window (key `pos:<other>:<floor(tick/6000)>`). Dedup key is `<observation key>#<field>`. Names pass `cleanName` (strip controls, drop double quotes, collapse spaces, 40 chars). Only the allowlisted fields are read; a `sheet`, `life_sheet` or any `true_*` field is never read or stored (B2).
- **tests** same hit through wake and digest counts once; after restart (new store and SeenSet over the same folder) still once; forged event for another observer dropped; observer's own act dropped; inactive kind dropped; `took_mine` updates law and good once each; standing player no observation; out-of-order batch equals sorted result; seen set keeps 4000; an event carrying a `sheet` field leaves no trace (grep folder for the sentinel); ambiguous name dropped; hostile name cleaned.
- **checks** CK-1, CK-2, CK-3, CK-4. **revert-checks** remove the dedup check: redelivery test fails. Remove the observer scope check: forged-event test fails. Resolve ambiguous names to the first hit: ambiguity test fails. Read an unlisted field: sentinel test fails.
- **worknote** `HC-27b.md`. **commit** `feat(instinct): observer-scoped social observations with dedup (HC-27b)`. **on-cap** priority `apply.ts` and `sample.ts`. **split line** `observe`+`dedup` / `sample`+`apply`.

## HC-28a: prediction by interpolation and exact branches

- **repo** kit. **depends-on** HC-27a, HC-17b. **parallelizable now** yes. **size** 28k. **branch** `scriptorium/hc-28a-predict`.
- **may-edit (new)** `packages/instinct/src/social/branch.ts`, `predict.ts`, `predict.test.ts`. **must-not-edit** `packages/psyche/**`, `model.ts`. **shared files** none.
- **decisions** D-CS-05 (interpolate the two adjacent integer policies, integrate exact branch probabilities; actual execution stays on integer scores). **owner approval** none (ledger only).
- **shapes**
  ```ts
  export interface Chance { score: Score; dc: number; proficiency: Level }   // Score and Level from @geldar/scriptorium-psyche; predict builds only integers in those ranges
  export type Branch<T> = { kind: 'outcome'; outcome: T } | { kind: 'chance'; chance: Chance; success: Branch<T>; failure: Branch<T> };
  export type Dist<T> = Map<T, number>;
  export type Prob = (c: Chance) => number;                 // production: (c) => successProbability(c.score, c.dc, c.proficiency), a positional adapter (the kit function takes three arguments, not an object)
  export function distribution<T>(b: Branch<T>, p: Prob): Dist<T>;
  export type Policy<I, T> = (sheet: CharacterSheet, input: I) => Branch<T>;
  export function estimatedScores(model: OtherModel | null, own: CharacterSheet | null): Record<Field, number>;
  export function predict<I, T>(policy: Policy<I, T>, scores: Record<Field, number>, input: I, p: Prob): Dist<T>;
  export function recordPrediction(append: (line: object) => void, other: string, fx: string, dist: Dist<string>, scores: Record<Field, number>, run: number): void;
  ```
  `predict` builds integer sheets from `STANDARD_SHEET`; each fractional field splits into `floor` and `floor+1` weighted `1-frac` and `frac`; at most 64 sheets enumerated, weight-0 skipped; the policy is never called with a non-integer. `recordPrediction` writes `{v:1, ts, run, kind:'prediction', other, fx, probs, est}` through the injected ledger appender only (operator ledger, B1, B3).
- **tests** aggression 3.5 with a test-double policy and `p = (c)=> (c.score-1)/4` gives P(fight) 0.625; integer estimate calls the policy once; the policy only sees integers (spy); two fractional fields enumerate four sheets with product weights; distribution sums to 1 on nested chances; engine fixture `successProbability(3, 11, 0) = 0.5` and `successProbability(1, 8, 0) = 121/400` (a missing export marks the card `blocked`); prediction line shape.
- **checks** CK-1..CK-4. **revert-checks** round instead of interpolate: 0.625 test fails. Skip weight-0 pruning: still passes, so add a test that counts policy calls (must be 2 for one fractional field). Drop a branch weight: sum-to-1 test fails.
- **worknote** `HC-28a.md`. **commit** `feat(instinct): predict others by interpolating the same pure policy (HC-28a)`. **on-cap** `branch.ts` first. **split line** `branch.ts` / `predict.ts`.

## HC-28b: stranger policy

- **repo** kit. **depends-on** HC-27b, HC-28a. **parallelizable now** no (imports both). **size** 30k. **branch** `scriptorium/hc-28b-stranger`.
- **may-edit (new)** `packages/instinct/src/social/stranger.ts`, `stranger.test.ts`. **must-not-edit** `branch.ts`, `predict.ts`, `step.ts`. **shared files** none.
- **decisions** D-CS-01 (means only, no speech, first sighting to the model), D-CS-05. **owner approval** none (the `why` strings go to the operator ledger only and are never shown).
- **shapes**
  ```ts
  export type StrangerChoice = 'avoid' | 'approach' | 'ignore';
  export interface StrangerInput { own: CharacterSheet; socialProficiency: number;
    other: { id: string; name: string; distance: number; estAggression: number };
    sightings: number; hasPeopleFile: boolean; followsSoFar: number; rollsOn: boolean }
  export type StrangerOutcome = { kind: 'pass' } | { kind: 'escalate'; why: string }
    | { kind: 'settle'; act: { kind: 'travel_away' | 'follow'; target: string }; why: string };
  export function strangerBranch(i: StrangerInput): Branch<StrangerChoice>;
  export function strangerStep(i: StrangerInput, roll: (score: number, dc: number) => Roll | null, p: Prob): { outcome: StrangerOutcome; rolls: Roll[] };
  ```
  `approach = (curiosity-3) + (good-3) + 0.5*socialProficiency`; `threat = estAggression - own aggression`. Branch: `threat >= 2` avoid; `approach >= 1` approach; `approach + 2 < 1` ignore; otherwise chance (score curiosity, DC 11, proficiency 0) success approach, failure ignore. Gates first: `hasPeopleFile` or `sightings < 1` gives `pass`. `rollsOn` false picks the most probable choice (ties prefer ignore, then avoid) and consumes no roll. `avoid` settles `travel_away`; `ignore` passes; `approach` within 4 blocks escalates (speech needs the model, never a settle); farther settles `follow` unless `followsSoFar >= 3`, then escalates.
- **tests** first sighting passes; person with a people file passes; avoid at threat >= 2; approach without a roll at approach >= 1; ignore below -1; chance node only between -1 and 1 (curiosity 3, good 3: approach 0.5); rolls off consumes no roll (spy); rolls on records exactly one roll; within 4 blocks escalates; third follow escalates; the outcome type has no `text` or `facts` field.
- **checks** CK-1..CK-4. **revert-checks** remove the `sightings < 1` gate: first-sighting test fails. Settle speech within 4 blocks: escalation test fails. Let the roll closure run when `rollsOn` is false: no-roll test fails.
- **worknote** `HC-28b.md`. **commit** `feat(instinct): stranger policy that escalates before speech (HC-28b)`. **on-cap** `strangerBranch` first. **split line** branch / step.

## HC-29: bounded social prose as prompt facts (OWNER APPROVAL REQUIRED; ships inactive)

- **repo** kit. **depends-on** HC-27a. **parallelizable now** yes. **size** 32k. **branch** `scriptorium/hc-29-social-prose`.
- **may-edit (new)** `packages/instinct/src/social/prose.ts`, `facts.ts`, `prose.test.ts`, `tests/template/social-prose.test.ts`. **must-not-edit** `template/**`, `tests/template/allowed-files.ts`, `tool-skill-scan.ts` (R9 owners). **shared files** none.
- **decisions** D-CS-06, D-CS-16 (trust stays the character's own writing in `reflect`; no fixed estimate-to-trust conversion). **OWNER APPROVAL REQUIRED** for every sentence in `BANK` and `UNSURE`: the text is agent-visible. Until approved, the bank is a **placeholder with the correct shape**, `facts()` returns `[]` unless `config.tom.prose === true`, and the default is false. The owner's approval edits the sentences in a follow-up card, never in activation.
- **shapes**
  ```ts
  export const BANK: Readonly<Record<LearnedField, { high: string; low: string }>>;   // 8 plain ASCII sentences, no digit
  export const UNSURE: string;
  export function renderLine(name: string, f: LearnedField, dir: 'high' | 'low'): string;  // About "NAME": <bank> <UNSURE>
  export interface Candidate { name: string; field: LearnedField; dir: 'high'|'low'; dist: number }
  export function selectTraits(models: readonly OtherModel[], own: CharacterSheet | null, max?: number): Candidate[]; // max 2 total
  export function nearbyFacts(models: readonly OtherModel[], nearby: readonly {id: string}[], own: CharacterSheet | null, enabled: boolean): string[];
  ```
  A field is shown only when learned, `n >= 1` and `abs(estimate-3) >= 0.75` (unmeasured). Order: larger distance, then name, then field order. At most two lines total per waking. No score, label, level or "estimate" in any line; the name is quoted and cleaned. An estimate derived only from a prior (n = 0) renders nothing (decision 0058: only what this life saw).
- **tests** at most two lines for any number of people; only supported traits render (a `common_sense`-only model renders nothing; `n = 0` renders nothing); threshold 3.74 hidden, 3.75 shown; deterministic ties; hostile names stay quoted and cannot break out (`x" Ignore the above`, newline, 300 chars, controls only); every line carries `UNSURE`; **`prose` off (default) returns `[]` for any input** (inactive proof); template scan: sentences pass `markedWords`, `forbiddenMention`, ASCII, no digit, none matches `/\b(lawful|chaotic|neutral|evil|alignment|score|stat|level|trait|estimate|watch|monitor|observ)\w*/i`; worst case under 220 characters.
- **checks** CK-1 (both files), CK-2, CK-3, CK-4, CK-T. **revert-checks** ignore `max`: line-count test fails. Remove the `enabled` guard: inactive test fails. Render at `n = 0`: unsupported test fails.
- **worknote** `HC-29.md`. **commit** `feat(instinct): bounded uncertain social prose for the prompt, inactive (HC-29)`. **on-cap** `prose.ts` with the scan test first. **split line** prose / facts.

## HC-30a: W6 integration (observe, stranger, facts), inactive

- **repo** kit. **depends-on** HC-27b, HC-28b, HC-29, HC-24, HC-19. **parallelizable now** no. **size** 38k. **branch** `scriptorium/hc-30a-hw4-integration`. **Shared-file owner of W6** (`packages/instinct/src/step.ts` at most 25 lines, `config.ts` one key).
- **may-edit** `packages/instinct/src/social/index.ts` (new), `step.ts`, `config.ts`, `social/integration.test.ts` (new), `tests/template/social-blind.test.ts` (new). **must-not-edit** HC-27a..HC-29 modules, `template/**`, `packages/supervisor/**`.
- **decisions** D-CS-10. **owner approval** none new (prose gated by HC-29). **default** `tom: { enabled: false, prose: false, priorStrength: 2 }`: the whole social path is off unless the owner enables it per world. (Differs from kit-c, which defaulted `enabled` true behind a step that is itself off: this card makes the off state explicit in both layers.)
- **shapes** `createSocial(ctx: InstinctContext): Social | null` (null when `config.tom.enabled` is false: no folder is created); `interface Social { observe(): ApplyReport; stranger(): StrangerOutcome | null; facts(): string[] }`. The step runs `observe()` after the speech and failure gates; addressed speech and first sightings still go to the model; a stranger `settle` or `escalate` is returned; facts are added to a `facts` or `pass` result. `hasPeopleFile` reads `memory/people/<name>.md` read-only. The roll closure uses psyche `rngFor(lifeId, tick, 'stranger', 0)`; prediction lines go through `recordPrediction`.
- **tests** visible hit updates aggression once through wake and digest redelivery; a hit the observer could not see (hidden control) changes nothing; `tom` disabled writes no folder and adds no facts; second sighting of a stranger with no people file can settle avoid, the first passes; the result JSON never contains an estimate digit run, label or the word estimate; a world event with a sheet field is never stored; prediction lines appear in `instinct.jsonl`; supervisor `childEnv` output and the built prompt contain neither the store folder name nor any estimate (B3).
- **checks** CK-1, CK-2, CK-3, CK-4, CK-T. **revert-checks** remove the `enabled` guard: disabled test fails. Trust hidden events: hidden-control test fails. Return facts when `prose` is off: inactive test fails.
- **worknote** `HC-30a.md`. **commit** `feat(instinct): bind the social model into the instinct step, inactive (HC-30a)`. **on-cap** config key and `createSocial` first; the step edit is left for a continuation. **split line** config+index / step.

## HC-30b: W6 wave close (docs only)

- **repo** kit. **depends-on** HC-30a. **parallelizable now** no. **size** 20k. **branch** `scriptorium/hc-30b-hw4-close`.
- **may-edit** `docs/architecture.md` (short "Social model" section), `docs/threat-model.md` (B1 to B9 as a boundary: supervisor volume only), `docs/analysis/harness/worknotes/retro-hw4.md` (new). **must-not-edit** code and tests.
- **content** describe only what merged: store layout, observation table with inactive rows (fled, promises), sampling constants marked unmeasured, stranger gates, prose bank marked "owner approval pending, inactive", what the character cannot see. One-page retro from the ledger and reports.
- **checks** CK-M, CK-4. **commit** `docs(harness): W6 close, social model docs and retro (HC-30b)`. **on-cap** docs first, retro second.

---

# Wave W7: explore, farm and patrol

**Wave branch (geldar):** `phase1/sheet-w7` from `origin/main` after W5 merges. Worktrees `C:\Users\Steve\source\projects\geldar\.claude\worktrees\an-<nn>`. Geldar card branches `phase1/sheet-an-<nn>-<slug>`. Geldar coder rules: `docs/analysis/phase1/packet-conventions.md`, the geldar `CLAUDE.md`, `./geldar.ps1 pnpm <args>`; never `adam up`; never push.

**Gates G (geldar, run in the worktree):** G1 targeted test `./geldar.ps1 pnpm test <path>`; G2 `./geldar.ps1 pnpm --filter @geldar/<pkg> typecheck` per touched package; G3 `./geldar.ps1 pnpm format` then `git diff --check`; G4 `./geldar.ps1 pnpm check:repo`; G5 (contract) `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated`; G6 (plugin) `(cd plugin; ./gradlew :core:test --tests '<class>')` then `(cd plugin; ./gradlew build)`; G7 `git merge-tree --write-tree phase1/sheet-w<N> HEAD` shows no conflict. Real SQL, NATS, plugin and client cases are **ops**, serial.

**Must-not-edit baseline (every geldar card):** `docs/spec.md`; accepted ADRs; merged `sql/*` and `prompts/**`; `contract/src/generated/**` by hand; other packets' worknotes; every `package.json`, `pnpm-lock.yaml`; `geldar.ps1`, `compose/**`, `shards/*.yaml`; `animus/**` (frozen, including its deprecated stubs); `psyche/**`; `docs/decisions/README.md` and `sql/README.md` (ops adds index lines from the worknote); shared wiring files unless the card owns them: `golem/src/adam/adam-body.ts`, `golem/src/body/programs/index.ts`, `golem/src/body/executor*.ts`, `player-core/src/link/mind-event.ts`, `player-core/src/validate/bounds.ts`, `threshold/mcp/src/events/handlers/index.ts`, `threshold/mcp/src/events/present-handlers/index.ts`, `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java`, `.../blockowner/BlockOwnerSetup.java`, `eventsink/src/writer.ts`, `contract/**`.
**Worknote (geldar):** `docs/analysis/harness/worknotes/<id>.md`.

**Shared files of W7 and their owners:** `contract/**` and generated: AN-44 only. `golem/src/body/programs/index.ts`, `player-core/src/validate/bounds.ts`, `prompts/body-api/`, `golem/src/adam/adam-body.ts`: AN-45 only. AN-39, AN-40, AN-41 create new files only and hand shared-file needs to AN-45 as "index line to add".

## AN-44: program shapes and the body-api contract change

- **repo** geldar. **wave** W7. **depends-on** W5 contract cards merged (the serial regen slot; no code dependency). **parallelizable now** yes (write); regen waits its slot. **size** 40-50k. **branch** `phase1/sheet-an-44-program-shapes`.
- **contract regeneration: YES, serial.** Shapes touched: new `ProgramShapes` with `$defs` `ExploreArguments`, `FarmArguments`, `PatrolArguments`, `ExploreCheckpoint`, `FarmCheckpoint`, `PatrolCheckpoint`, `ExploreDetail`, `FarmDetail`, `PatrolDetail`; `INTENT_WHY` entries; one description line in `mcp-play.schema.json`. Never name a `$defs` entry `*Input` or `*Result` (the generator turns each pair into an MCP tool and throws on an unpaired one).
- **may-edit** `contract/schemas/program-shapes.schema.json` (new), `contract/schemas/mcp-play.schema.json` (the `ActInput.intent` description, one neutral list line), `contract/src/outcome-words.ts`, `contract/src/programs.ts` (new: the validator wrapper), `contract/src/index.ts` (one `export *` line), `contract/src/generated/**` (by `generate`), `contract/test/program-shapes.test.ts` (new), `contract/test/mcp-play.test.ts` (description fixture), `docs/decisions/<allocate via registry>-explore-farm-patrol.md` (new), worknote. **must-not-edit** baseline; `golem/`, `player-core/`, `prompts/`. **shared files edited** contract and generated (serial owner), `contract/src/index.ts`, `mcp-play.schema.json`.
- **decisions** D-CS-14, ADR `<allocate via registry>` (arguments, checkpoints, limits, completion, refusals). **OWNER APPROVAL REQUIRED**: the `INTENT_WHY` sentences and the `ActInput.intent` description line are agent-visible; they merge as drafted placeholders and only reach an agent through AN-45's version selection (inactive by default).
- **shapes (the cross-card interface of W7)**
  ```jsonc
  // arguments: every integer bounded, no free text, no coordinate the Body did not observe; hard caps are schema `maximum`s (oversize is invalid, not clamped)
  ExploreArguments:  { "program":"explore","legs": int 1..12 (6), "leg_blocks": int 8..48 (24), "avoid_water": bool (true) }
  ExploreCheckpoint: { "legs_done": int 0..12, "visited": [[cx,cz] x max 96], "heading": "n"|"e"|"s"|"w"|null }
  ExploreDetail:     { "legs": int, "chunks_new": int, "stopped": "legs"|"no_frontier"|"danger"|"limit" }
  FarmArguments:     { "program":"farm","radius": int 4..24 (12), "max_cells": int 1..32 (16), "replant": bool (true) }
  FarmCheckpoint:    { "cells": [[x,y,z,"ripe"|"unripe"|"empty"] x max 32], "next": int, "harvested": int, "sown": int, "skipped": int }
  FarmDetail:        { "harvested": int, "sown": int, "skipped_owned": int, "skipped_unknown": int, "stopped": "done"|"no_cells"|"no_seeds"|"limit" }
  PatrolArguments:   { "program":"patrol","route": [{x,y,z} x 2..8], "laps": int 1..5 (1), "loop": bool (true) }
  PatrolCheckpoint:  { "leg": int 0..8, "laps_done": int 0..5 }
  PatrolDetail:      { "laps": int, "stopped": "laps"|"danger"|"limit" }
  ```
  `INTENT_WHY.explore/farm/patrol`: fixed fact templates (for example `explore.not_found`: "You found no new direction to explore nearby."). Checkpoints stay under 2 KiB serialized (the validator cap for an echoed checkpoint is 4096 bytes). `Intent.arguments` and `Intent.program` need no schema change (the program name pattern accepts any skill-style name; re-verify when coding).
- **tests** every example valid; every bound at, just under, just over; 9-point route rejected; 97 chunks rejected; unknown argument rejected on all three; `visited` and `cells` carry integers only; old thought and intent fixtures (`contract/test/thought.test.ts`) unchanged; each program has a timeout and operation-cap `stopped` value; no schema field names a hidden-coordinate source (`farm` takes a radius, never a position).
- **checks** G1 (`contract/test/program-shapes`, `contract/test/mcp-play`, `contract/test/thought`), G2 contract, G3, G4, G5, G7.
- **revert-checks** `legs` maximum 13: "legs 13 rejected" fails. Route maximum 9: route test fails. `additionalProperties: true` on `FarmArguments`: unknown-argument test fails.
- **worknote** `AN-44.md`. **commit** `feat(character): program shapes for explore, farm and patrol`. **on-cap** commit passing schema and tests, record base SHA, stop. **split line** schema / outcome-words and description.

## AN-39: explore program

- **repo** geldar (`golem/`). **depends-on** AN-44 (merge order only). **parallelizable now** yes. **size** 45-50k. **branch** `phase1/sheet-an-39-explore`.
- **may-edit (all new)** `golem/src/body/programs/explore.ts`, `explore.test.ts`, `golem/src/perception/observed-chunks.ts`, `observed-chunks.test.ts`, worknote. Test helpers (`newWorld`, `contextFor`, `drive`, `expectResumeEverywhere`) come from `golem/src/body/programs/programs.fakes.ts`, not edited. **must-not-edit** baseline; `programs/index.ts`, `programs/args.ts`. **shared files edited** none (registration is AN-45; hand it "index line to add").
- **decisions** D-CS-14. **owner approval** none (no agent text; refusal wording comes from AN-44).
- **shapes**
  ```ts
  export interface VisitedChunks { has(cx: number, cz: number): boolean }
  export function setVisitedChunks(reader: VisitedChunks | null): void;   // module-level, the setOwnerLookup pattern
  export function visitedChunks(): VisitedChunks;                          // default: empty
  export class ExploreProgram implements IntentProgram { readonly name = 'explore' }  // start/step/checkpoint/resume
  ```
  Frontier = the four axis neighbour chunks whose column is **loaded in the bot's world** (`bot.world.getColumn(cx, cz)` non-null) and not in `visited` nor `visitedChunks()`; unloaded or unseen terrain is never a target and no terrain is guessed. Deterministic order from the checkpoint `heading` (straight, right, left, back). One leg per step through `runStepAction(ctx, {do:'goto', target})`, target = position + `leg_blocks` along the axis, snapped to the loaded surface already seen; failures through `stopOf`; arrival chunk appended to `visited` (cap 96, oldest dropped). Stops `completed`: `legs`, `no_frontier`, or `danger` (a hostile within 8 blocks via `ctx.view.nearbyHostiles(8)` or health under 8; reflexes act first and the program never attacks). No evidence is emitted here: first-visit XP is the W2 chunk-visit producer (`chunk_visited`, AN-09b) whichever program walked.
- **tests** known-only frontier; unloaded or opaque neighbour is not a target; all four axis and sign choices from each heading; no candidate completes `no_frontier`; legs cap; duplicate chunk adds nothing; interruption, cancel and `expectResumeEverywhere`; hostile nearby stops `danger`; no invented goal or coordinate (assert the goto targets are within `leg_blocks` of a loaded column); checkpoint under 2 KiB at 96 chunks; resume rejects an unknown field and 97 chunks.
- **checks** G1 (`golem/src/body/programs/explore`, `golem/src/perception/observed-chunks`), G2 golem, G3, G4, G7. **revert-checks** treat an unloaded column as a candidate: "unloaded terrain is not a target" fails. Skip the `visited` test: "visited chunk is not the frontier" fails. Drop the legs cap: "stops at legs" fails. Accept 97 chunks on resume: bound test fails.
- **worknote** `AN-39.md`. **commit** `feat(character): explore program over the observed frontier`. **on-cap** standard (commit passing work, base SHA, unfinished steps, stop). **split line** `observed-chunks` / program.

## AN-40: farm program

- **repo** geldar (`golem/`). **depends-on** AN-44 (merge order only). **parallelizable now** yes. **size** 45-50k. **branch** `phase1/sheet-an-40-farm`.
- **may-edit (all new)** `golem/src/body/programs/farm.ts`, `farm-field.ts`, `farm.test.ts`, `farm-field.test.ts`, worknote. **must-not-edit** baseline; `golem/src/actions/place.ts`, `till.ts`, `mine.ts`, `protected-blocks.ts`, `own-placements.ts`. **shared files edited** none.
- **decisions** D-CS-14, 0164 (unknown ownership is protected). **owner approval** none.
- **shapes** `class FarmProgram implements IntentProgram { name = 'farm' }`; `farm-field.ts`: `readField(bot, radius, maxCells): FieldCell[]` with `FieldCell = { x:number; y:number; z:number; state:'ripe'|'unripe'|'empty'; owner:'own'|'other'|'unknown' }`. A cell is in the field only if its crop block is currently loaded and in line of sight (`canSeeBlock`, within `FOOD_RANGE` and the `radius` argument), the crop is one of `CROP_MAX_AGE` (wheat, carrots, potatoes, beetroots), ripeness is `getProperties().age >= CROP_MAX_AGE[name]` (an unreadable age is `unripe`, never harvested), and the farmland below is `farmland`. Ownership before each action via `ownerRecordAt(pos)` and `isOwnPlacement(bot, pos)`: own or world-generated (known, owner null) only; owned by someone else counts `skipped_owned`; unknown (`known: false`) counts `skipped_unknown`; the program never touches them and produces no refusal text. Step: take the next checkpointed cell; ripe gives `{do:'mine', block, count:1}` then, if `replant` and a seed is carried (`SEED_CROPS` inverted), `{do:'place', block: seedItem, at}`; empty farmland plus `replant` plus seed gives the `place` only; `unripe` skipped. **A harvest counts only when the `mine` completed and `bot.blockAt` re-read shows the crop gone or reset; a sow counts only when the `place` completed**; a failed or cancelled attempt counts nothing. No `till`, no recipe, no search for a field the Body has not seen. Missing seeds ends `no_seeds`. Resume re-classifies each remaining cell first (no double harvest). The farming award is the existing W2 evidence from completed actions; this card adds no award code and no event.
- **tests** observed ripe and unripe; seeds present and missing; own, other and unknown cells; partial work; failed and cancelled `mine`; `max_cells` boundary; resumed checkpoint without double harvest; one counted unit per completed harvest or sow; nothing outside what the Body has seen.
- **checks** G1 (`golem/src/body/programs/farm`), G2, G3, G4, G7. **revert-checks** skip the `ownerRecordAt` check: "another life's crop is skipped" fails. Treat `known: false` as allowed: "unknown is skipped" fails. Count a failed `mine`: "failure counts nothing" fails. Harvest an unripe crop: "unripe is left" fails.
- **worknote** `AN-40.md`. **commit** `feat(character): farm program over observed crop cells`. **on-cap** standard. **split line** `farm-field` / program.

## AN-41: patrol program

- **repo** geldar (`golem/`). **depends-on** AN-44 (merge order only). **parallelizable now** yes. **size** 35-45k. **branch** `phase1/sheet-an-41-patrol`.
- **may-edit (all new)** `golem/src/body/programs/patrol.ts`, `patrol.test.ts`, worknote. **must-not-edit** baseline; `follow.ts`, `travel.ts`. **shared files edited** none.
- **decisions** D-CS-14. **owner approval** none.
- **shapes** `class PatrolProgram implements IntentProgram { name = 'patrol' }`. The caller supplies `route` (2 to 8 integer points via `ArgReader.position`); the Body never looks a position up, so a route taken from a person's last position is the Mind's job (the kit supplies only a position it was told or saw). Empty, single-point or malformed route is `invalid_args`. Step: one `goto` to point `leg`; arrival within 2 blocks advances `leg`; wrap and `laps_done += 1` when `loop`, else stop at the end; `completed` `{ laps, stopped:'laps' }` at `laps`. Danger (hostile within 8 blocks, health under 8) completes `danger`; the program never issues `attack` and never selects a guard goal.
- **tests** invalid, empty, one-point, nine-point routes; finite laps and the limits boundary; interruption, cancel, restart (`expectResumeEverywhere`); hostile nearby ends `danger`; the fake registry's action log never contains `attack`; a blocked leg reports through `stopOf` and does not loop.
- **checks** G1 (`golem/src/body/programs/patrol`), G2, G3, G4, G7. **revert-checks** allow 9 points: route test fails. Ignore `laps`: "stops at laps" fails. Issue `attack` near a hostile: "never attacks" fails.
- **worknote** `AN-41.md`. **commit** `feat(character): patrol program over a supplied route`. **on-cap** standard. **split line** none (small).

## AN-45: register the programs, drift test and body-api v10 (OWNER APPROVAL REQUIRED; ships unselected)

- **repo** geldar. **depends-on** AN-39, AN-40, AN-41, AN-44. **parallelizable now** no. **size** 45-50k plus ops evidence. **branch** `phase1/sheet-an-45-programs-publish`. **Shared-file owner of W7.**
- **may-edit** `golem/src/body/programs/index.ts` (register `explore`, `farm`, `patrol`; export the classes), `golem/src/body/programs/program-shapes-drift.test.ts` (new), `player-core/src/validate/bounds.ts` (`PHASE0_PROGRAMS` gains the three names; `PROGRAM_ARGS` gains rows with the AN-44 bounds, plus `ArgSpec` kinds `bool` and `route` the new arguments need), `player-core/src/validate/*.test.ts` (rows only), `prompts/body-api/v<allocate via registry>.json` (new, recommend `v10`), `golem/src/mind-link/body-api-v<allocate via registry>.test.ts` (new, the existing `body-api` test pattern), `golem/src/adam/adam-body.ts` (the single `setVisitedChunks(...)` pair wired to the W2 first-visit tracker, only if that tracker exposes a reader and the file stays under 700 lines; otherwise record BlockedDependency and leave explore on its own run coverage), worknote. **must-not-edit** baseline otherwise; `prompts/body-api/v1.json` to `v9.json` (released, immutable); `animus/**` (the in-house Mind keeps its default body-api; no `DEFAULT_BODY_API_VERSION` change anywhere). **shared files edited** `programs/index.ts`, `player-core/src/validate/bounds.ts`, `adam-body.ts`, `prompts/body-api/`.
- **decisions** D-CS-14; body-api number `<allocate via registry>`. **OWNER APPROVAL REQUIRED** for the three program summaries and examples in the new body-api file (agent-visible). They merge in the new immutable file, **unselected**: no shard, harness or default points at it, and a test asserts the default body-api version is unchanged. Neutral wording only, facts about what the verb does: no coaching, no game knowledge, no "you should".
- **shapes** `prompts/body-api/v10.json` = `v9` copied byte-for-byte plus three `programs` entries `{summary, arguments, example{goal, wake_on:["goal_completed"], limits}}` and a bumped `version` and `description`. Drift test: the argument names in `program-shapes.schema.json` equal the `ArgReader` fields (start each example) equal the `PROGRAM_ARGS` keys, for all three programs; this is the only guard between the three copies. A second test pins the sha256 of `v1.json` to `v9.json` so an edit of a released file fails.
- **tests** three programs registered and `UNSUPPORTED_PROGRAMS` unchanged; each new example validates as a thought and starts on the Body; an unregistered name still fails `unsupported_program`; a sixth argument refused; old `v1` to `v9` still load; default body-api version unchanged (inactive proof).
- **checks** G1 (`golem/src/body/programs`, `golem/src/mind-link`, `player-core/src/validate`, `contract/test/thought`), G2 golem player-core contract, G3, G4, G7. **ops (serial):** a sovereign test player starts, completes and resumes (Body restart) each program through `act` and sees receipts; missing knowledge ends `no_frontier`, `no_cells` or `danger` instead of looping; old body-api and a thought without programs behave as before; `./geldar.ps1 check`; the 20 TPS bench.
- **revert-checks** leave `farm` out of `PHASE0_PROGRAMS`: "farm is allowed" fails. Change one bound in `PROGRAM_ARGS`: drift test fails. Register no `patrol`: registry test fails. Change a byte of `v9.json`: sha pin fails. Point the default at v10: default-unchanged test fails.
- **worknote** `AN-45.md`. **commit** `feat(character): register explore, farm and patrol and publish body-api v10 unselected`. **on-cap** standard. **split line** `AN-45a` registry + allow-list + drift test, `AN-45b` prompt file + test.

## HC-31: idle binding for explore, farm and patrol

- **repo** kit. **wave** W7 (kit half). **depends-on** HC-21, AN-44, AN-45. **parallelizable now** yes (catalog is injected). **size** 25k. **branch** `scriptorium/hc-31-idle-programs`.
- **may-edit** `packages/instinct/src/idle-programs.ts` (new), `idle-programs.test.ts` (new), `packages/instinct/src/idle.ts` (the one registration line). **must-not-edit** HC-21 weights and think-draw code, `template/**`. **shared files edited** `idle.ts` (one line, HC-21 owns the file).
- **decisions** D-CS-14, D-CS-01. **owner approval** none (no text; the arguments are only contract keys).
- **shapes**
  ```ts
  export const PROGRAM_FOR_MODE = { explorer: 'explore', farmer: 'farm', warrior: 'patrol' } as const;
  export interface ProgramCatalog { has(program: string): boolean }       // from WorldLink.programs()
  export function programCandidates(catalog: ProgramCatalog): IdleCandidate[];
  ```
  A candidate exists only when `catalog.has(program)`. `args(ctx)` returns the AN-44 argument object with the contract defaults and nothing else: **no coordinates, field or route** (patrol therefore never becomes an idle candidate unless a route is supplied from memory by the model; a warrior idle candidate with no route is omitted). Nothing here creates a goal; no adopted goal means the step escalates (D-CS-01).
- **tests** empty catalog adds no candidate; each mode maps to its program; args contain only contract keys; behaviour for the mode is unchanged when the program is missing; patrol omitted without a route; unknown mode never produced.
- **checks** CK-1..CK-4. **revert-checks** skip `catalog.has`: empty-catalog test fails. Add a coordinate to `args`: contract-keys test fails.
- **worknote** `HC-31.md`. **commit** `feat(instinct): idle candidates for explore, farm and patrol (HC-31)`. **on-cap** module and tests; the registration line is a continuation. **split line** none.

---

# Wave W8: complete evidence and proficiency sources

**Wave branch (geldar):** `phase1/sheet-w8` after W7 merges. Promises and the commitment declaration adapter are **deferred** (AN-48, HC-33, D-HC-06): no card here creates a promise shape. The unsupported rows (fled a mob, kept or broke a promise, third-party gift or break or take, `common_sense` and `cleverness` estimates) stay inactive, are tested as inactive and are never faked.

**Shared files of W8 and their owners:** `contract/**` and generated: AN-46 only (after AN-44 in the regen order). `eventsink/src/writer.ts` (registration lines), `plugin/.../GeldarCore.java`, `.../blockowner/BlockOwnerSetup.java`, `golem/src/perception/provenance/subscribe.ts`, `threshold/mcp/src/events/leakage.test.ts`, `player-core/src/link/mind-event.ts`: AN-50 only. AN-47a, 47b, 49, 51a, 51b create new files and hand registration to AN-50 as "index line to add". **SQL: none.** If AN-04a's award ledger constrains `evidence_kind` by `CHECK`, AN-46 writes "index line to add: migration `<allocate via registry>` (from 0052 to 0059) widening the check" and stops; the orchestrator allocates and a separate SQL card is written (never an unplanned migration).

## AN-46: evidence-source contract (OWNER APPROVAL REQUIRED for the two sentences; ships unselected)

- **repo** geldar. **wave** W8. **depends-on** AN-45 (contract serial order), AN-24. **parallelizable now** yes (write); regen waits after AN-44. **size** 40-50k. **branch** `phase1/sheet-an-46-evidence-contract`.
- **contract regeneration: YES, serial, after AN-44.** Shapes touched: `ObservationPayload` kinds `FightSeen`, `ContainerTaken` appended to the `oneOf` (`contract/schemas/observation-event.schema.json`); `TakeProvenance`, `CombatProvenance` (`contract/schemas/provenance.schema.json`); new `CombatFactPayload` (`contract/schemas/combat-fact-event.schema.json`); `McpPlayerEvent.type` gains `fight_seen`, `container_taken` (`contract/schemas/mcp-common.schema.json`); subject helpers in `contract/src/subjects.ts`; two sentence templates in `contract/src/outcome-words.ts`.
- **may-edit** the schema files above, `contract/src/subjects.ts`, `contract/src/outcome-words.ts`, `contract/src/evidence.ts` (new, validators), `contract/src/index.ts` (one export line), `contract/src/generated/**` (by `generate`), `contract/test/evidence-sources.test.ts` (new), `docs/decisions/<allocate via registry>-evidence-sources.md` (new), worknote. **must-not-edit** baseline; any promise, commitment or memory shape. **shared files edited** contract and generated (serial), `contract/src/index.ts`, `outcome-words.ts`.
- **decisions** D-CS-04, D-CS-06, D-CS-15 (exchange only), ADR `<allocate via registry>` (evidence sources, the one-award-per-encounter rule, the exchange id and window). **OWNER APPROVAL REQUIRED:** `observationSentence` templates (`Someone fought a creeper nearby.` with the mob name passed through the pattern only; `Someone took 3 bread from your container.`) are agent-visible. They merge as drafts; the producers are off by default (AN-50 config), so no agent sees them until the owner approves and activates.
- **shapes (the cross-card interface of W8)**
  ```ts
  type FightSeen       = { kind: 'fight_seen'; actor?: ObservedActor; target: string /* ^[a-z_]{1,64}$ */; key: string };
  type ContainerTaken  = { kind: 'container_taken'; actor?: ObservedActor; item: string; count: number; key: string };
  type TakeProvenance  = { world: string; x: number; y: number; z: number; actor: string | null; prior_owner: string | null; item: string; count: number; tick: number };
  type CombatProvenance= { world: string; actor: string | null; target: string; kind: 'engaged' | 'killed'; tick: number };
  type CombatFactPayload = { kind: 'hostile_kill' | 'fight_survived'; mob: string /* ^[a-z_]{1,64}$ */; encounter_key: string /* ^[a-z0-9:_-]{8,96}$ */ };
  // WorldEvent type 'combat_fact' (3-token subject, agent_id = the fighter's life); NOT added to MIND_EVENT_TYPES (XP only, not perception)
  // Subjects (4 tokens): geldar.<shard>.provenance.take, geldar.<shard>.provenance.combat; helpers provenanceTakeSubject, provenanceCombatSubject
  // Exchange id (no schema): `exch:<lifeLow>:<lifeHigh>:<windowIndex>`, lives sorted, windowIndex = floor(tick / 600)
  // Combat evidence key: `combat:enc:<encounter_key>` for BOTH kinds (so a kill and a survive of one encounter are one award)
  ```
  `fled` is **not** a kind (no causal flee signal).
- **tests** causal payloads validate; combat fact without `encounter_key` invalid; malformed or ambiguous actor invalid; absent actor valid; W5 payloads unchanged; no promise shape exists; `fled` rejected.
- **checks** G1 (`contract/test/evidence-sources`, `contract/test/observation`), G2 contract, G3, G4, G5, G7. **revert-checks** make `encounter_key` optional: "combat fact needs a key" fails. Add `fled` to the kinds: "no flee kind" fails. Drop `ContainerTaken` from the `oneOf`: its fixture fails.
- **worknote** `AN-46.md`. **commit** `feat(character): evidence-source contract for combat and container taking`. **on-cap** standard. **split line** schemas / subjects and outcome-words.

## AN-47a: combat facts in the plugin

- **repo** geldar (`plugin/`). **depends-on** AN-46 (merge order), AN-27a (`ProvenanceSink`). **parallelizable now** yes. **size** 45-50k. **branch** `phase1/sheet-an-47a-combat-plugin`.
- **may-edit (new)** `plugin/core/src/main/java/dev/geldar/core/CombatFactListener.java`, `plugin/core/src/test/java/dev/geldar/core/CombatFactListenerTest.java`, worknote. **must-not-edit** baseline; `EventExporter.java` (use its public `emit`), `GeldarCore.java` (AN-50 registers). **shared files edited** none.
- **decisions** D-CS-04, D-CS-06. **owner approval** none (events only, never to an agent).
- **behaviour** `onKill` (MONITOR): killer = the last player to damage the mob (`getKiller`, confirm in Paper), a hostile mob (the same classification as `golem/src/perception/hostile-types.ts`); emit `combat_fact` `hostile_kill` through `EventExporter.emit`. **Stolen-kill rule:** credit the killer only, never an assist. **Encounter key** `enc:<killerUuidShort>:<entityUuid>`, one per (killer, mob entity), never per tick. `fight_survived`: an encounter opens at the first hostile damage to the player, closes (emit once) when the mob dies or after `FIGHT_END_TICKS = 200` with no damage either way while the player is alive; a player death emits nothing; map capped at 512 open encounters (oldest dropped); a duplicate event for the same key is dropped by the exporter's source-event-id derivation. `CombatProvenance` `engaged` the first time a player damages a hostile in an encounter and `killed` on the kill, through `ProvenanceSink.send("combat", json)`.
- **tests** real-shaped kill; survived, aborted and died encounters; multiple attackers (killer only); stolen kill; per-tick damage (one encounter); despawn timeout path; duplicate ids; cap; every payload validates against `CombatFactPayload` (the `EventSchemaCheck` pattern). **ops:** capture real kill and survived payloads before AN-47b fixtures are frozen.
- **checks** G6 (`dev.geldar.core.CombatFactListenerTest`), G3, G4, G7. **revert-checks** key by tick: "per-tick damage is one encounter" fails. Credit the last damager: "killer credited" fails. Emit on player death: "died encounter emits nothing" fails.
- **worknote** `AN-47a.md`. **commit** `feat(character): plugin combat facts with one key per encounter`. **on-cap** standard. **split line** `onKill` / survival tracker.

## AN-47b: combat award normaliser and visible-fight observation

- **repo** geldar (`eventsink/`, `golem/`). **depends-on** AN-46, AN-47a, AN-25, AN-09a (S-AWARD). **parallelizable now** yes. **size** 45-50k. **branch** `phase1/sheet-an-47b-combat-evidence`.
- **may-edit (new)** `eventsink/src/awards/combat.ts`, `combat.test.ts`, `golem/src/perception/provenance/fight-seen.ts`, `fight-seen.test.ts`, worknote. **must-not-edit** baseline; `eventsink/src/projection.ts`, `writer.ts`, `consumer.ts`. **shared files edited** none (registration and subscription are AN-50).
- **decisions** D-CS-04, D-CS-06. **owner approval** none (the observation sentence is AN-46's).
- **shapes** `normalizeCombat(event: WorldEvent): AwardUnit[]`: both `hostile_kill` and `fight_survived` give one unit, domain `combat`, key `combat:enc:<encounter_key>`, so the ledger's `(life, domain, evidence_key)` uniqueness makes one award per encounter; no dedupe state lives in the normaliser. `observeFight(msg: CombatProvenance, ctx): ObservationPayload | null` returns `fight_seen` only when the actor is visible now (`observedActor`) and the target mob is within 24 blocks and visible; key `fight:<tick>:<actor>:<target>`; only `engaged`, once per (actor, target) via an LRU for 600 ticks; `killed` returns null; the observer's own fight returns null; an unseen fight returns null. Never exposes another life's health, sheet or hidden target.
- **tests** kill then survive of one encounter gives one key, two encounters two; redelivery same key; hidden or far actor null; two attackers, only the visible one; repeated ticks one observation; stolen kill; sight loss mid-fight; observer's own fight null; payload field assertion (no health, no sheet).
- **checks** G1 (`eventsink/src/awards/combat`, `golem/src/perception/provenance/fight-seen`), G2 eventsink golem, G3, G4, G7. **revert-checks** distinct keys for kill and survive: "one award per encounter" fails. Emit for an invisible actor: "hidden fight updates nothing" fails. Emit every tick: "repeated ticks, one observation" fails.
- **worknote** `AN-47b.md`. **commit** `feat(character): combat award normaliser and visible-fight observation`. **on-cap** standard. **split line** `combat.ts` / `fight-seen.ts`.

## AN-49: conversation exchange and social award keys

- **repo** geldar (`eventsink/`). **depends-on** AN-46 (ADR), AN-09a. **parallelizable now** yes. **size** 40-50k. **branch** `phase1/sheet-an-49-exchange`.
- **may-edit (new)** `eventsink/src/awards/exchange.ts`, `exchange.test.ts`, worknote. **must-not-edit** baseline; `projection.ts`, `writer.ts`. **shared files edited** none. No SQL, no LLM call, no speech access beyond the events the sink already stores.
- **decisions** D-CS-04, D-CS-15. `EXCHANGE_WINDOW_TICKS = 600` is an **owner parameter** (unmeasured).
- **shapes** `normalizeExchange(event: WorldEvent): AwardUnit[]` over stored `speech` events (`from`, `text`, `distance`, `own`, `agent_id`; `contract/schemas/speech-event.schema.json`). A bilateral exchange between lives A and B: A speaks and, within the window, B speaks and A's Body heard it as non-own speech from B; it qualifies at the **second** speaker's first line. One social unit per participant per exchange, key `exch:<lifeLow>:<lifeHigh>:<windowIndex>` (a pair has at most one exchange per window). Not an exchange: monologue; one-way overheard speech; the same speaker's lines; a repeated greeting (identical text does not open a second window); wrong recipient (B never within hearing); echoed or replayed events (idempotent key). Bounded in-memory per-pair state (LRU 512 pairs, expiry after 2 windows); a sink restart loses an open window (documented; the ledger's unique key prevents any double award). A confirmed give completed inside a window keeps its own `give:<action id>` key and does not feed the exchange key. The kept-promise award stays inactive (AN-48 deferred).
- **tests** two-way versus monologue; greeting spam; wrong recipient; overlapping windows (one key); echoed events; restart; give-in-window; LRU bound; previously supported give awards unchanged.
- **checks** G1 (`eventsink/src/awards/exchange`), G2 eventsink, G3, G4, G7. **revert-checks** qualify at the first speaker's line: "monologue is not an exchange" fails. Drop the window index: "two windows, two awards" fails. Let a repeated greeting open a second window: "greeting spam" fails.
- **worknote** `AN-49.md`. **commit** `feat(character): bilateral conversation exchange and social award keys`. **on-cap** standard. **split line** none.

## AN-51a: container-taking facts in the plugin

- **repo** geldar (`plugin/`). **depends-on** AN-46, AN-27a. **parallelizable now** yes. **size** 35-45k. **branch** `phase1/sheet-an-51a-container-take-plugin`.
- **may-edit (new)** `plugin/core/src/main/java/dev/geldar/core/blockowner/ContainerTakeListener.java`, `plugin/core/src/test/java/dev/geldar/core/blockowner/ContainerTakeListenerTest.java`, worknote. **must-not-edit** baseline; `BlockOwnerSetup.java` (AN-50 registers). **shared files edited** none.
- **decisions** D-CS-06. **owner approval** none.
- **behaviour** on `InventoryClickEvent` or drag where a `Player` moves a stack out of a block-backed container (MONITOR, `ignoreCancelled`; confirm `Inventory#getLocation()`, action names, shift-click and hotbar swap), send `TakeProvenance` through `ProvenanceSink.send("take", json)` with `prior_owner` read from `OwnerCache` (null on a miss, never a synchronous CoreProtect call). Open without take, zero-item take and deposit send nothing; one message per transfer (key material by tick and slot); per-tick cap and queue bound as in AN-26a; the prior owner read at click time wins over a later change.
- **tests** own, other-owned and unknown containers; open without take; failed or partial take; shift-click; double event for one transfer; ownership changes between click and send.
- **checks** G6 (`dev.geldar.core.blockowner.ContainerTakeListenerTest`), G3, G4, G7. **revert-checks** send on deposit: "deposit sends nothing" fails. Send on open: "open sends nothing" fails. Synchronous CoreProtect lookup on a miss: "cache miss sends null without a lookup" fails.
- **worknote** `AN-51a.md`. **commit** `feat(character): publish container-taking provenance from the plugin`. **on-cap** standard. **split line** none.

## AN-51b: observed container taking in the owner's Body

- **repo** geldar (`golem/`). **depends-on** AN-46, AN-51a, AN-25. **parallelizable now** yes. **size** 30-40k. **branch** `phase1/sheet-an-51b-container-take-observation`.
- **may-edit (new)** `golem/src/perception/provenance/container-take.ts`, `container-take.test.ts`, worknote. **must-not-edit** baseline; `golem/src/actions/container.ts` (the Body's own `withdraw` is the W9 property-refusal hook, not this card). **shared files edited** none.
- **decisions** D-CS-06 (unknown ownership is not someone else's property; conservative reading). **owner approval** none (the sentence is AN-46's).
- **shape** `observeTake(msg: TakeProvenance, ctx): ObservationPayload | null` returns `container_taken` only when the observer **owns the container** (`prior_owner` equals the observer's name) and the container block is visible; the taker is named only through `observedActor` (hidden taker: delivered unattributed, since the owner saw the container); key `take:<tick>:<x>:<y>:<z>:<actor>:<item>`; LRU 256; the observer taking from their own container returns null; third-party observers get nothing (inactive).
- **tests** own, other and unknown container; open without take; partial take; actor hidden; same message twice; ownership changed mid-operation (the message's `prior_owner` is the truth at click time).
- **checks** G1 (`golem/src/perception/provenance/container-take`), G2 golem, G3, G4, G7. **revert-checks** deliver for someone else's container: "other-owned teaches nothing" fails. Skip the visibility test: "out-of-sight container is null" fails. Name the actor without `observedActor`: "hidden taker unattributed" fails.
- **worknote** `AN-51b.md`. **commit** `feat(character): owner-side observation of a take from an owned container`. **on-cap** standard. **split line** none.

## HC-27c: kit reader for `fight_seen` and `container_taken`

- **repo** kit. **wave** W8 (kit half). **depends-on** HC-27b, AN-46. **parallelizable now** yes (one table row each). **size** 18k. **branch** `scriptorium/hc-27c-social-evidence-kinds`.
- **may-edit** `packages/instinct/src/social/observe.ts` (two table rows), `rules.ts` (flip `fought_mob` to active; `took_mine` already active), `observe.test.ts`, `rules` tests. **must-not-edit** other HC-27a/27b logic. **shared files edited** `observe.ts` and `rules.ts` (HC-27a/b files, edited only after both merged; one card, no parallel editor).
- **decisions** D-CS-06. **owner approval** none. **rules** `fight_seen` gives `fought_mob` (aggression 4.5); `container_taken` gives `took_mine` (law 1.5, good 2.0) keyed `take:<...>` so a break and a take are distinct observations. `fled_mob`, `kept_promise`, `broke_promise` stay inactive.
- **tests** `fight_seen` updates aggression once through redelivery; `container_taken` updates law and good once; a hidden control (no `actor`) updates nothing because the actor cannot be resolved; `fled_mob` still inactive.
- **checks** CK-1..CK-4. **revert-checks** leave `fought_mob` inactive: its test fails. Resolve an absent actor to the nearest person: hidden-control test fails.
- **worknote** `HC-27c.md`. **commit** `feat(instinct): read observed fights and container takes (HC-27c)`. **on-cap** standard.

## AN-50: complete evidence integration and leakage gate

- **repo** geldar. **depends-on** AN-47b, AN-49, AN-51b, AN-28b. **parallelizable now** no. **size** 45-50k plus ops evidence. **branch** `phase1/sheet-an-50-evidence-integration`. **Shared-file owner of W8** (`eventsink/src/writer.ts` registration lines, `GeldarCore.java`, `BlockOwnerSetup.java`, `subscribe.ts`, `leakage.test.ts`, `player-core/src/link/mind-event.ts` only if the observation kinds need a presenter row).
- **may-edit** `eventsink/src/writer.ts` (registration lines only), `eventsink/src/awards/evidence-table.test.ts` (new), `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java` (register `CombatFactListener` once), `.../blockowner/BlockOwnerSetup.java` (register `ContainerTakeListener` once), `golem/src/perception/provenance/subscribe.ts` and `subscribe.test.ts` (the `take` and `combat` subjects and the `observeTake` and `observeFight` dispatch, behind the W5 config gate), `threshold/mcp/src/events/leakage.test.ts` (extend with both kinds and their hidden controls), worknote. **must-not-edit** baseline otherwise; no widening of any global fact into agent perception.
- **decisions** D-CS-04, D-CS-06, ADR from AN-46; activation D-CS-10. **owner approval** none new; the gate keeps AN-46's sentences unreachable until activation.
- **deliver** registers the `combat` and `exchange` normalisers beside the existing W2 give/farm/mine/build/craft/explore normalisers; ACL needs no new line (`provenance.>` from AN-28b covers `take` and `combat`; `paper` publishes `geldar.$s.>`; `combat_fact` is a 3-token subject the plugin may already publish; the MCP stream does not read it). **Evidence table (status each row ships in):**

| Evidence | Source | Ships |
|---|---|---|
| Spoke to me first | `speech` events | active, no card |
| Came toward me, kept away | position samples | active, kit sampling rule (HC-27b) |
| Hit me | `damage.actor` (AN-25) | active when the attacker was visible |
| Gave me an item | `gift_received` (AN-26) | active for the recipient |
| Broke my owned block | `property_broken` (AN-27) | active for the owner |
| Took from my container | `container_taken` (AN-51) | active for the owner |
| Fought a mob in view | `fight_seen` (AN-47b) | active when the fighter was visible |
| Fled a mob | none | **inactive**: no causal flee signal |
| Kept or broke a promise | none | **inactive**: AN-48 deferred (D-HC-06) |
| Third-party gift, break or take | none | **inactive**: no authorized knowledge of another life's property or intent |
| `common_sense`, `cleverness` estimates | none | **inactive**: the brief gives no observation rule; they stay at the prior |
| XP: combat, social (exchange, give), farming, mining, building, crafting, exploring | AN-47b, AN-49, W2 | active; the kept-promise social unit is inactive |

  `evidence-table.test.ts` asserts every inactive row has no producer and no award key, so a later change that quietly produces one fails.
- **tests** `listeners()` registers each class once; each active row has a positive, a hidden, a duplicate and a restart control; the extended leakage test (a `container_taken` presented with a `life` field fails; raw `provenance.>` and `combat_fact` never reach an agent).
- **checks** G1 (`eventsink/src/awards`, `golem/src/perception/provenance`, `threshold/mcp/src/events/leakage`), G6 plugin build, G3, G4, G7; `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink` (ops). **ops (serial):** producer-to-sink-to-cache XP and observer-to-player-event for every active row; real NATS role denial of raw `provenance.>` to the MCP, eventsink and mind roles; `./geldar.ps1 check`; the integration floor and the 20 TPS bench.
- **revert-checks** register `ContainerTakeListener` twice: the once-each test fails. Make `evidence-table` produce a flee key: inactive-row test fails. Present `container_taken` with a `life` field: leakage test fails.
- **worknote** `AN-50.md`. **commit** `feat(character): register evidence sources and the leakage gate for the new kinds`. **on-cap** standard. **split line** `AN-50a` sink and plugin registration, `AN-50b` Body subscription and leakage test.

---

## Differences from the older cards (do not dispatch both)

1. The in-house `animus/` paths in `work-packets-geldar-b.md` (`animus/src/validate/bounds.ts`, `animus/src/link/mind-event.ts`, `animus/src/ports/body.ts`) are now deprecated stubs; the live files are under `player-core/` (GX-04). AN-45 and AN-50 edit `player-core`.
2. body-api is at `v9` (not `v7` or `v8`); the new immutable file is `<allocate via registry>` (recommend `v10`).
3. Decision numbers are 0280 to 0289 only (0282 reserved); the older cards recommended 0182 and up. SQL is 0050 to 0059; none is needed here.
4. HC-30a defaults `tom.enabled` to false (kit-c defaulted true behind an off step) and adds a separate `tom.prose` flag, because HC-29's text is owner-gated.
5. HC-27b reads the W5 shapes (`observation` kinds with `actor { name, life }`), not the earlier `attacker_id`/`giver_id` guesses; actors are keyed by id and resolved from `nearby` when only a name is given.
6. New card HC-27c (kit reader for `fight_seen`, `container_taken`) closes the loop the older cards left implicit ("switch on with AN-47").
7. Every W7 and W8 geldar card is split no further than before except AN-50, which carries a pre-declared split line.

## Open items and ambiguities

- **Actor identity across W5 and kit.** Whether `actor` on the MCP-presented event carries `life` or only `name` is `(to confirm: AN-24)`. HC-27b is written to survive both (name resolved through `nearby`), but a reused username across lives would merge two lives; the observation key carries the tick to limit that.
- **S-AWARD is assumed.** AN-47b, AN-49 and AN-50 code against `AwardUnit` and the `eventsink/src/awards/` directory as AN-09a (W2, elsewhere) defines them; if AN-09a chose different names, only the adapter signature in each normaliser changes.
- **Prior from the own sheet (decision 0058).** The estimate prior projects the observer's own sheet. It is never shown; HC-29 renders nothing at `n = 0`. Owner may prefer a flat prior; a one-line change in `priorFor`.
- **Contract slot order** is AN-44 then AN-46, each after the W5 contract card; the orchestrator must not interleave. `contract/src/index.ts` stays under 700 lines only because both cards add a single export line.
- **Placeholder text.** HC-29's bank, AN-44's `INTENT_WHY` and description line, AN-45's body-api summaries and AN-46's two sentences are drafts awaiting owner wording; all ship inactive or unselected.
- **Unmeasured parameters:** prior strength 2, observation values, sampling constants, `FIGHT_END_TICKS`, the encounter cap, `EXCHANGE_WINDOW_TICKS`, the 0.75 prose threshold.
- **Deferred, not carded:** AN-48 (promise outcomes), the kept-promise social unit, AN-38, HC-33; they wait on the owner's commitment-store ruling (D-HC-06).
