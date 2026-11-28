# Corrected kit cards: HC-20, HC-21a, HC-22, HC-27b, HC-30a, and the HC-46 remainder

Date 2026-11-27. These cards replace the FixNeeded text of the same ids in `docs/analysis/harness/ledger.md`, `work-packets-sheet-w6-w8.md` and the kit repo's `work-packets-kit-b.md`. Where a card here says nothing, the source card text stands. Authority: decisions 0320 (kit-b cards authoritative, OD-C), 0324 (positions and ids), 0391 item 4 (no id is ever told to an agent), 0058, 0059, 0068.

Every statement not checked against a file or `git show` is marked **unverified**.

## 0. Ground rules for every card here

- Repo: the sibling `geldar-scriptorium` checkout (the kit). Base: `origin/main` of the kit (verified: it holds tag `kit-v0.1.0-rc23`, which contains the merges of HC-47, HC-33, HC-48, HC-46a, HC-27a and HC-28a). Give the coder an absolute worktree path in the dispatch; never write a user-profile path in a card or worknote.
- Worknote per card: `docs/analysis/harness/worknotes/HC-<id>.md` (kit). It lists the "index line to add" for the orchestrator.
- Nothing an agent reads may coach it or say when to do things (0058, 0059, 0068). No card here adds agent-visible text. The only agent-visible strings these cards can cause are the existing templates in `packages/instinct/src/facts.ts` (`repeat_failure`, `new_sighting`, `own_act`), which are plain facts. Do not add a template.
- Features ship inactive and default off. The instinct step is off (the code does not read `GELDAR_INSTINCT` yet; verified in the kit README). `DEFAULT_FXS` in `run.ts` is `[]` (verified). No card here edits that line: the orchestrator adds one registration per card, named in the worknote. Tests pass fx lists explicitly to `decide` or to `runInstinct(env, runNo, now, connect, fxs)` (signature verified).
- Ids never reach an agent (0391 item 4): no `ag_` life id, player UUID or entity id in any fact, `why`, `world.line`, act argument or file under `/player`. Ids exist only inside the instinct step and the supervisor volume. Positions of what the agent's own Body perceived may appear in code; rendering one into agent-visible text needs an approved sentence (0324 item 2), so no card renders one.
- A test must fail when its named revert is applied. The coder applies each revert, sees the test fail, restores, and writes "seen failing" in the worknote.
- Checks (names from kit-b; **unverified** that the scripts are unchanged on kit main): `./scriptorium.ps1 pnpm exec vitest run <files>`, then `./scriptorium.ps1 pnpm lint`, `./scriptorium.ps1 pnpm typecheck`, `./scriptorium.ps1 pnpm check:repo`.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- File caps: soft 500, hard 700 lines. Edit only files listed under "may edit".

## 1. Kit facts the cards rely on (read from kit `origin/main`)

- `Observation` (`packages/instinct/src/observe.ts`): `tick` (always null today), `dead`, `night: boolean|null`, `position: {x,y,z}|null`, `health`, `hunger`, `inventory: Record<string,number>`, `foodCarried`, `inventoryFull` (always null), `agents: {name, distance}[]` (no position, no id), `entities: {kind, hostile, distance, pos?}[]`, `notable: {kind, distance, pos?}[]` (distance computed from own position by HC-46a), `intent: {goal, program, arguments: {status}}|null`, `events: EventLine[]`, `cursor`.
- Not in `Observation`, so no card may assume it: recipes or ingredients; a list of seen or remembered blocks; the Body's program list (`WorldLink` has only `call` and `close`); the arguments of the running intent (`planOf` keeps only `status`); event ids; actor ids; another agent's position; the world tick; a goal when no plan runs (`ctx.goal` is `obs.intent?.goal ?? null`); proficiency (a `Sheet` has none and `parseSheet` refuses the key).
- `FxContext`: `obs, sheet, state, cfg, lifeKey, tick, goal, knownText, check(fx, score, dc, prof?), draw(fx), rolls`. `run.ts` sets `knownText: ''` and never sets `state.last_intent` or `state.picks_in_a_row` (verified by grep). `Fx = (ctx) => FxResult`; `FxResult` is `act | facts{stop?} | escalate{reason} | pass`. An `escalate` ends `decide` at once.
- `contract.ts`: `FX_NAMES = ['failure','novelty','idle','guard','none']`; `PASS_REASONS` already holds `failure_past_cap, insight, no_variation, no_adopted_goal, no_candidate, think_draw, max_picks`; `actIntent(goal, program, args)` builds the act with `wake_on` and `limits`. `audit.ts` has `appendAudit(path, line: string)` and `buildAuditLine`.
- `InstinctState` (`state.ts`): `attempts, tried, seen, last_intent, habits, pending_acts, picks_in_a_row, cursor`; `SEEN_MAX 500`.
- Social (merged HC-27a, HC-28a): `social/model.ts` (`OtherModel` with optional `last_sample {tick, dist, me, them?}`, `applyEvidence`, `estimateOf`), `social/rules.ts` (`ObsKind`, `OBS_RULES`), `social/store.ts` (`SocialStore`, `SAFE_ID`), `social/predict.ts`, `social/branch.ts`.
- World contract (geldar `mcp-common.schema.json`, verified): `PlaySurroundings.agents[]` is `{name, distance, held_item, health_estimate, vertical?, in_reach?}`: no x, y, z, no id. Entities and notable blocks have x, y, z.
- The workspace path (where `memory/goals.md` and `memory/beliefs.md` live) is **unverified**: the kit has no env name for it. HC-21a and HC-22 read `GELDAR_INSTINCT_WORKSPACE`; unset means no goal and empty known text, so those fx do nothing.

---

## 2. HC-20: failure counting, the falling insight DC and the per-agent retry cap

- **id** HC-20. **repo** kit. **depends-on** HC-18 (merged), HC-47 (merged, #124). **branch** `scriptorium/hc-20-failure-fx`. **size** about 25k.
- **Corrections to kit-b HC-20**
  1. 0320 OD-C: proficiency is all zero and the run is degraded. Pass `0` as the `prof` argument of `ctx.check`. Do not read `sheet.proficiency` and add no `proficiency` key anywhere. Export `PROFICIENCY_DEGRADED = true` from `failure.ts` and state it in the worknote; add no field to `RollRecord` (the contract checks exact keys).
  2. Drop `variation.ts` and every act-variation step. `obs.intent.arguments` holds only `{status}`, so the failed try's arguments are not observable and nothing can be varied from them. An insight failure under the cap returns `{kind:'escalate', fx:'failure', reason:'no_variation'}`.
  3. `state.last_intent` is never set by `run.ts`; this card sets it.
- **may edit** `packages/instinct/src/fx/failure.ts` (new), `fx/failure.test.ts` (new), `packages/instinct/src/run.ts` (only step 1, not `DEFAULT_FXS`), `packages/instinct/src/run.test.ts` (one test), the worknote. **must not edit** `decide.ts`, `contract.ts`, `facts.ts`, `observe.ts`, `state.ts`.
- **exact shapes**
  ```ts
  export const PROFICIENCY_DEGRADED = true;
  export function problemKey(goal: string, program: string): string; // sha256(`${goal}\0${program}`) hex, first 16 chars; arguments never part of it
  export function retryCap(cleverness: Score, base: number): number; // clamp(base + (cleverness - 3), 2, 6); base 4 gives 2,3,4,5,6 for scores 1..5
  export const failureFx: Fx;
  ```
- **steps**
  1. `run.ts` `wake`: `decide` must see the previous intent, so assign `state.last_intent = obs.intent` (only when `obs.intent !== null`) immediately after `decide` returns and before `saveState`. Nothing else in `run.ts` changes.
  2. `failureFx(ctx)` in this order:
     a. Any event with `kind === 'intent_finished'`: delete `state.attempts[key]` and `state.tried[key]` for the key of `state.last_intent` (when non-null) and return `{kind:'pass'}`.
     b. No event of kind `intent_failed` or `action_failed`, or `state.last_intent === null`: `{kind:'pass'}`.
     c. `key = problemKey(last_intent.goal, last_intent.program)`; `attempts = (state.attempts[key] ?? 0) + 1`; store it. One increment per wake however many failure lines came.
     d. `attempts >= retryCap(ctx.sheet.attributes.cleverness, ctx.cfg.failureCap)`: return `{kind:'escalate', fx:'failure', reason:'failure_past_cap'}` with no roll.
     e. `ctx.check('insight', ctx.sheet.attributes.cleverness, Math.max(8, 14 - attempts), 0)`. On success, `makeFact('repeat_failure', {n: attempts})`; when it is non-null return `{kind:'facts', fx:'failure', stop:true, facts:[fact]}`.
     f. Otherwise (roll failed or fact null): `{kind:'escalate', fx:'failure', reason:'no_variation'}`.
- **tests** (in `failure.test.ts` unless named; build `FxContext` with a local helper like the one in `decide.test.ts`)
  - `first failure: attempts 1, insight DC 13`; `DC falls: attempts 2 gives 12, attempts 6 gives 8` (revert: remove `Math.max(8, ...)`).
  - `same goal and program with different arguments keep counting` (revert: put arguments into `problemKey`: the count restarts).
  - `past the cap escalates failure_past_cap with no roll` for cleverness 1 to 5 at caps 2 to 6 (revert: use `>` instead of `>=`).
  - `an intent_finished event clears the count; a different goal starts at 1`.
  - `insight success returns the repeat_failure fact with stop, and a later idle fx does not run` (revert: drop `stop`).
  - `insight failure under the cap escalates no_variation and sends no act`.
  - `rolls off: cleverness 3 fails at DC 13 and succeeds at DC 9` (check the arithmetic against psyche `check` first: **unverified**).
  - `three failure lines in one wake count once`.
  - `every roll the failure fx makes has bonus 0` (fails if a proficiency lookup is added).
  - `run.test.ts`: `last_intent is stored after a run and the next run's failure fx uses it` (two `runInstinct` calls over one state directory; revert: delete the step 1 assignment).
- **checks** section 0 on `fx/failure.test.ts` and `run.test.ts`, then `vitest run packages/instinct`.
- **commit** `feat(instinct): failure counting, falling insight DC and per-agent retry cap (HC-20)` plus the trailer.
- **stop and report** if `check` rejects `prof` 0.
- **index line to add**: register `failureFx` first in `DEFAULT_FXS`.

---

## 3. HC-21a: idle choice, the weighted pick among known means

- **id** HC-21a. **repo** kit. **depends-on** HC-18 (merged). HC-21b (habits) fills the candidates later; until then every run escalates `no_candidate`. **branch** `scriptorium/hc-21a-idle-pick`. **size** about 30k.
- **Corrections to kit-b HC-21a.** The recipe and seen-block inputs are not in `Observation`. The card uses only: `obs.night`, `obs.hunger`, `obs.foodCarried`, `obs.inventoryFull` (null today, so its rule never fires), `obs.intent` (is something running), `obs.events`, `ctx.sheet.op_modes`, `state.habits[goal]` and the seeded `ctx.draw`. It must not assume recipes, ingredients, a seen-block list, the Body's program list, the arguments of a running intent, a tick, or a goal from `obs.intent` while idle. The adopted goal comes only from the agent's own `memory/goals.md` via `GELDAR_INSTINCT_WORKSPACE`. Explorer, farmer and crafter candidates that need a map or recipe stay dropped (kit-b open item 7).
- **may edit** `packages/instinct/src/fx/idle.ts`, `idle.test.ts`, `goal.ts`, `goal.test.ts` (all new), `packages/instinct/src/run.ts` (only step 7), `run.test.ts` (one test), the worknote. **must not edit** other fx files, `decide.ts`, `contract.ts`, `DEFAULT_FXS`.
- **exact shapes**
  ```ts
  // goal.ts
  export function readAdoptedGoal(workspace: string | undefined): string | null;
  // idle.ts
  export interface Candidate { program: string; arguments: Record<string, unknown>; mode: 'explorer' | 'miner' | 'crafter' | 'builder' | 'warrior' | 'nitwit' }
  export function modeOf(program: string): Candidate['mode'] | null; // travel explorer, gather miner, craft crafter, build builder, follow warrior, rest nitwit; flee and others null
  export function candidatesFor(goal: string, state: InstinctState): Candidate[]; // from state.habits[goal]; null modes skipped
  export function weightOf(c: Candidate, ctx: FxContext): number;
  export const idleFx: Fx;
  ```
- **steps**
  1. `readAdoptedGoal`: undefined workspace, unreadable, non-regular or over 16 KiB gives `null`. Read `<workspace>/memory/goals.md`. The goal is the first line after any heading matching `^\s*(?:[-*]|[0-9]+[.)])\s+(.+?)\s*$`; trim, cut to 200 characters, strip control characters. The text is data: never put it in a fact or `why`.
  2. `idleFx`: `{kind:'pass'}` when `obs.intent !== null` or any event is `speech_to_me`. When `ctx.goal === null` return escalate `no_adopted_goal`.
  3. `state.picks_in_a_row >= cfg.maxPicks`: escalate `max_picks`. Else `u = ctx.draw('idle_think')`; `u < cfg.thinkP`: escalate `think_draw`.
  4. No candidates: escalate `no_candidate`.
  5. `weightOf = 2 ** (score - 3)` using `sheet.op_modes[mode]`; then, only when the field is non-null: `night === true` gives builder and nitwit times 4, the others times 0.25; `hunger <= 6` with `foodCarried === false` gives miner times 4; `inventoryFull === true` gives miner times 0. Drop weight 0; none left: `no_candidate`.
  6. Sort by program then stable argument JSON; one `ctx.draw('idle_pick')` over cumulative normalised weights. Return `{kind:'act', fx:'idle', why:'a means that worked for the top goal', act: actIntent(goal, program, arguments)}` with the recorded arguments untouched.
  7. `run.ts`: set `goal` to `obs.intent?.goal ?? readAdoptedGoal(env.GELDAR_INSTINCT_WORKSPACE)`; after an accepted act with `decided.fx === 'idle'` add 1 to `state.picks_in_a_row`; for every other outcome set it to 0.
- **tests and reverts**
  - `no adopted goal: escalate, never an act` (revert: pick any candidate).
  - goal reader: first ranked line, ignores headings and prose, trims, truncates to 200, ignores a 1 MB file, ignores an unset workspace.
  - `weights 0.25 0.5 1 2 4 by op mode score`; night, hunger and full-inventory multipliers (table test); `a null field applies nothing` (revert: treat null as false).
  - `after maxPicks accepted picks the next run escalates max_picks` (`run.test.ts`; revert: remove the increment).
  - `think draw below thinkP escalates think_draw; the draw is in rolls with mode off`.
  - same state and tick give the same pick; a different tick can differ.
  - a running intent gives pass; speech to me gives pass.
  - `the act has wake_on, limits and the recorded arguments only`.
  - `goals.md is unchanged (hash) and the goal text appears in no fact, why or audit line` (sentinel goal).
  - flee and unknown programs are never candidates.
- **checks** section 0 on `fx/idle.test.ts`, `fx/goal.test.ts`, `run.test.ts`.
- **commit** `feat(instinct): idle choice: weighted pick among known means to the adopted goal (HC-21a)` plus the trailer.
- **index line to add**: register `idleFx` last in `DEFAULT_FXS`. Activation held by D-CS-05.

---

## 4. HC-22: novelty from authorized knowledge

- **id** HC-22. **repo** kit. **depends-on** HC-18, HC-46a (merged, #127), HC-47 (merged, #124). **branch** `scriptorium/hc-22-novelty`. **size** about 25k.
- **Corrections to kit-b HC-22.**
  1. Proficiency is 0 (0320 OD-C): `ctx.check('novelty', curiosity, 11, 0)`; no `proficiency('exploring')`.
  2. Sightings come from `obs.entities` and `obs.notable`. Since HC-46a both have `distance` and optional `pos`. Use `distance !== null && distance <= radius`. Never write a position into a fact.
  3. Agents are not sightings: `obs.agents` has no position or id, and a first meeting is the guard's job (0324).
  4. No id of any kind is read or stored (0391 item 4): the seen key is built from the kind name only.
  5. `ctx.knownText` is `''` in `run.ts` today; this card fills it from the workspace.
- **may edit** `packages/instinct/src/fx/novelty.ts`, `novelty.test.ts`, `known.ts`, `known.test.ts` (all new), `packages/instinct/src/run.ts` (one line: `knownText: readKnownText(env.GELDAR_INSTINCT_WORKSPACE)`), the worknote. **must not edit** `DEFAULT_FXS`, `decide.ts`, `facts.ts`, `observe.ts`.
- **exact shapes**
  ```ts
  export function noticeRadius(curiosity: Score): number; // [4, 8, 16, 24, 32][curiosity - 1]
  export function readKnownText(workspace: string | undefined): string; // '' when unset
  export const noveltyFx: Fx;
  ```
- **steps**
  1. `readKnownText`: lowercase concatenation of `memory/beliefs.md`, `memory/summary.md`, `memory/journal/current.md` and the file names under `memory/people/` (each file at most 32 KiB, at most 40 names, unreadable parts skipped). Reads nothing outside `memory/`.
  2. `noveltyFx`: candidates are `entities` and `notable` within the radius. Key `sightingKey('thing', kind)` (from `decide.ts`). Skip when `state.seen` holds the key or the kind appears as a whole word in `ctx.knownText` (compare with `_` replaced by a space on both sides).
  3. Nearest first, at most 2 per run: push the key to `state.seen` first (bounded by `SEEN_MAX`), then `ctx.check('novelty', curiosity, 11, 0)`. Success: `makeFact('new_sighting', {name: kind.replace(/_/g, ' ')})`; a null fact is skipped. Failure adds nothing and the thing stays marked.
  4. Return `{kind:'facts', fx:'novelty', facts}` when any fact exists, else `{kind:'pass'}`. Never an act, never an escalate.
- **tests and reverts**
  - radius table 4 8 16 24 32; a thing beyond the radius stays new; a thing with distance null is ignored.
  - a name present in beliefs or summary gives nothing.
  - `a first sighting is marked seen whether the roll succeeds or fails` (revert: mark only on success: a second run rolls again).
  - success gives one `new_sighting` fact and no act; `rolls off: curiosity 3 at DC 11 succeeds` (check the arithmetic: **unverified**).
  - `a notable block with pos and distance is a sighting; the pos never appears in the fact`.
  - `an agent in obs.agents is never a novelty sighting` (revert: add agents).
  - a kind with a newline or a quote gives no fact.
  - `no file outside memory is read` (sentinel file next to `memory/`).
  - every roll has bonus 0.
- **checks** section 0 on the four new test files and `run.test.ts`.
- **commit** `feat(instinct): novelty from the agent's own authorized knowledge (HC-22)` plus the trailer.
- **index line to add**: register `noveltyFx` after `failureFx`.

---

## 5. HC-27b: observations: scope, dedup, sampling and apply (pure input)

- **id** HC-27b. **repo** kit. **depends-on** HC-27a (merged, #128). HC-46b (section 8) is needed by HC-30a, not here: this card never reads `Observation`. **branch** `scriptorium/hc-27b-social-observe`. **size** 38k.
- **Corrections to the W6 to W8 card**
  1. 0324 fields: on kit main `Observation.agents` is `{name, distance}` and the world sends no agent position, so in production `SocialSighting.position` is absent and `positionObservations` yields only a new sample. That is correct and safe; tests use fixtures. `OtherModel.last_sample.them` exists (verified), so the old STOP "blocked: last_sample shape" does not apply.
  2. 0391 item 4: `actorLife` and `SocialSighting.life` are supervisor-side values. HC-30a fills them from the supervisor-side roster (section 8), never from anything the agent was told. This card must not put a life id into any string that can reach an agent. Whether the state directory (which holds the social store) is unreadable to the agent is **unverified**; HC-26c proves blindness.
  3. Event ids are not in `Observation`; the adapter builds them (HC-30a). Here `id` only has to be a non-empty string.
- **may edit (new)** `packages/instinct/src/social/observe.ts`, `dedup.ts`, `sample.ts`, `apply.ts`, `observe.fixtures.ts`, `observe.test.ts`, `apply.test.ts`; the worknote. **must not edit** HC-27a or HC-28a files (report a gap, do not patch), anything outside `social/`.
- **exact shapes** (`ObsKind` from `social/rules.ts`, `OtherModel` from `social/model.ts`)
  ```ts
  export type SocialEventKind = 'speech_to_me' | 'hurt' | 'gift_received' | 'property_broken' | 'fight_seen' | 'container_taken';
  export interface SocialEvent { kind: SocialEventKind; id: string; tick: number; actorName?: string; actorLife?: string }
  export interface SocialSighting { name: string; life?: string; distance: number | null; position?: [number, number, number] | null }
  export interface SocialObservation { observer: string; kind: ObsKind; actor: string; actorName: string; key: string; tick: number }
  export function eventObservations(observer: string, events: readonly SocialEvent[], nearby: readonly SocialSighting[]): SocialObservation[];
  export function positionObservations(prev: OtherModel['last_sample'], tick: number, me: [number, number, number] | null, other: SocialSighting): { observations: SocialObservation[]; sample: NonNullable<OtherModel['last_sample']> | null };
  export class SeenSet { constructor(stateDir: string); has(key: string): boolean; add(key: string): void; flush(): void } // newest 4000, FIFO, mode 0600
  export interface ApplyReport { applied: number; deduped: number; dropped: { foreign: number; self: number; inactive: number; badId: number } }
  export function applyObservations(store: SocialStore, seen: SeenSet, own: CharacterSheet | null, observer: string, obs: readonly SocialObservation[], run: number, strength?: number): ApplyReport;
  export function noteSighting(store: SocialStore, other: string, name: string, run: number): void;
  ```
- **event table** (the only mapping): `speech_to_me` gives `spoke_first` key `speech:<id>`; `hurt` with an actor gives `hit_me` key `hurt:<id>`; `gift_received` gives `gave_me` key `gift:<id>`; `property_broken` gives `took_mine` key `break:<id>`; `fight_seen` (to `fought_mob`) and `container_taken` (to `took_mine`) are inactive here (HC-27c). An event without an actor gives nothing.
- **actor id rule.** `actorLife` when present; else the one `nearby` entry whose `name` equals `actorName` exactly, and its `life` when present; otherwise drop the observation. A name is never stored as an id. No match or two matches drops it. The id must pass `SAFE_ID` or it counts in `badId`. The observer as actor counts in `self`.
- **position sampling** (constants unmeasured: `SAMPLE_TICKS 6000`, `MIN_GAP_TICKS 100`, `MOVE_BLOCKS 6`, `SELF_STILL_BLOCKS 2`, `NEAR_BLOCKS 32`). The sample stores `dist`, `me`, `them`. No observation when `me`, `other.distance` or `other.position` is null or absent. No previous sample, a gap under `MIN_GAP_TICKS`, or own movement above `SELF_STILL_BLOCKS` returns only a new sample. Other moved under `MOVE_BLOCKS`: nothing. Else within `NEAR_BLOCKS` and distance falling: `approached`; rising: `kept_away`. Key `pos:<other>:<floor(tick/6000)>`. Dedup key `<observation key>#<field>`. `actorName` passes `cleanName` (strip control characters, drop double quotes, collapse spaces, at most 40 characters). Read only the listed fields.
- **tests and reverts**
  - the same hurt delivered twice counts once, also across a restart (new store and `SeenSet` over one folder) (revert: remove the dedup check);
  - an observation whose `observer` differs is dropped as foreign (revert: remove the scope check);
  - the observer's own act is dropped; `fight_seen` is dropped as inactive;
  - `took_mine` updates law and good once each;
  - a standing other (moved under 6 blocks) gives nothing; a sighting without a position gives nothing; own movement above 2 blocks gives nothing (revert: ignore own movement);
  - an out-of-order batch equals the sorted result; the seen set keeps 4000;
  - an ambiguous name is dropped (revert: take the first hit); a name with no `life` and no `actorLife` is dropped and never stored as an id (revert: fall back to the name);
  - a hostile name is cleaned;
  - an event object with an extra `sheet` field leaves no trace in the store folder (grep a sentinel);
  - `ApplyReport` holds counts only, and `SocialObservation.actorName` never equals the life id in a fixture where the two differ.
- **checks** section 0 on `social/observe.test.ts` and `social/apply.test.ts`.
- **commit** `feat(instinct): observer-scoped social observations with dedup (HC-27b)` plus the trailer. Split line: observe, dedup and sample first; apply second.

---

## 6. HC-30a: W6 integration (adapter and social fx), inactive

- **id** HC-30a. **repo** kit. **depends-on** HC-27b, HC-28b, HC-29, HC-24, HC-19, HC-46b (section 8). HC-28b and HC-29 are not in the merged list (only HC-28a is): **BlockedDependency** until they merge. **branch** `scriptorium/hc-30a-hw4-integration`. **size** 38k.
- **Corrections: the S-INSTINCT names.** The old card's `InstinctContext`, `appendLedger` as a package export, `IdleCandidate`, `WorldLink.programs()` and the `observer`, `socialProficiency`, `nearby` fields do not exist in the kit. The kit names are:
  - fx type `Fx = (ctx: FxContext) => FxResult` (`decide.ts`); input type `Observation`; context fields in section 1;
  - result kinds `act`, `facts`, `escalate`, `pass`; the act is built with `actIntent(goal, program, args)`;
  - the fx name list is `FX_NAMES` in `contract.ts`; this card appends `'social'` (its only edit to that file);
  - the ledger writer is `appendAudit(path, line: string)`; the path is `join(dirname(stateDir), 'instinct.jsonl')` with `stateDir = env.GELDAR_INSTINCT_STATE`, as `run.ts` computes it;
  - the observer is `ctx.lifeKey` (the last path segment of `GELDAR_MCP_URL`). Whether that segment is the life id used as the social key is **unverified**; if the worknote cannot confirm it from HC-19, STOP `blocked: observer id`;
  - social proficiency is `0` (OD-C, degraded); there is no proficiency input;
  - there is no program list: the stranger program and arguments come from the orchestrator's brief as constants, never guessed. No brief constant means the stranger step returns `pass`.
- **may edit** `packages/instinct/src/social/index.ts`, `social/adapter.ts`, `social/integration.test.ts`, `tests/template/social-blind.test.ts` (all new), `packages/instinct/src/contract.ts` (only: append `'social'` to `FX_NAMES`), `contract.test.ts` (one test), the worknote. **must not edit** HC-27a to HC-29 modules, `run.ts`, `decide.ts`, `DEFAULT_FXS`.
- **exact shapes**
  ```ts
  // adapter.ts: the only reader of Observation inside social/
  export function socialInput(obs: Observation, lifeOf: (name: string) => string | null): { events: SocialEvent[]; sightings: SocialSighting[]; me: [number, number, number] | null };
  // index.ts
  export interface SocialDeps { stateDir: string; observer: string; hasPeopleFile(name: string): boolean; appendLedger(line: object): void; env: Record<string, string | undefined> }
  export function socialFx(deps: SocialDeps): Fx; // a function returning { kind: 'pass' } unless deps.env.GELDAR_INSTINCT_TOM === 'on'
  export function socialFxFromEnv(env: Record<string, string | undefined>, observer: string): Fx; // binds appendLedger to appendAudit(join(dirname(stateDir), 'instinct.jsonl'), JSON.stringify(line))
  ```
- **steps**
  0. Open the merged `observe.ts` and the HC-46b worknote; list the added `Observation` field names and the roster reader name in this card's worknote. HC-46b not merged: STOP `blocked: HC-46b`.
  1. `socialInput`: events only from `obs.events` with `kind === 'speech_to_me'` (`actorName = from`). The hurt, gift, break, fight and take rows stay empty: `observe.ts` classifies `hurt` with no actor, and a card must first add actor fields to the world events (**unverified** whether the world sends them). Event id = first 16 hex of sha256 of `kind`, `\0`, `text`, `\0`, `obs.cursor ?? ''`. Whether a redelivered `wait` repeats text and cursor is **unverified**; if it does not, dedup fails open and the worknote says so. `tick` = `obs.tick ?? waking`. Sightings come from `obs.agents` with `life = lifeOf(name) ?? undefined`, `distance`, and `position` from the HC-46b field when present. `me` is `obs.position` as a tuple.
  2. `socialFx`: when off, return pass before any file is created. When on: `eventObservations`, `positionObservations`, `applyObservations`; `noteSighting` for each sighting that has a `life`; the stranger step (HC-28b) for a sighting seen at least twice with no people file, with `ctx.check('guard', score, dc, 0)`; a stranger settle becomes `{kind:'act', fx:'social', why:'a stranger was met again', act: actIntent(...)}` only when the brief's constants exist.
  3. Facts only when `GELDAR_INSTINCT_TOM_PROSE === 'on'`, from HC-29's bank, through `sanitizeFact`. Prediction lines go through `appendLedger` only.
  4. No id leaves the step: the returned `FxResult` holds no life id, player UUID or entity id, no estimate and no label.
- **tests and reverts**
  - a visible speech event updates the model once even when delivered twice (revert: skip dedup in the adapter);
  - an event with no actor changes nothing (revert: accept an actor-less event);
  - `GELDAR_INSTINCT_TOM` absent: no folder, no facts, no rolls (revert: remove the env guard);
  - prose off returns no facts (revert: return facts with prose off);
  - a stranger's second sighting with no people file may settle and the first passes; no brief constant gives pass;
  - `the serialized FxResult contains no roster life id, no digit run equal to an estimate, no label and not the word estimate` (revert: put the id into `why`);
  - prediction lines reach disk only through `appendLedger`;
  - `contract.test.ts`: a result with `fx: 'social'` parses (revert: remove `'social'` from `FX_NAMES`);
  - template test: no template in `facts.ts` gains an estimate slot or an id slot.
- **checks** section 0 on the two new test files and `contract.test.ts`, then `vitest run packages/instinct tests/template`.
- **commit** `feat(instinct): bind the social model into the instinct step, inactive (HC-30a)` plus the trailer.
- **index line to add**: `run.ts` must build `socialFxFromEnv(env, lifeKey)` into the per-run fx list. `DEFAULT_FXS` is static and this fx needs per-run env, so the orchestrator decides the exact line; do not guess it.

---

## 7. HC-46: is HC-46a the whole card?

**No.** The geldar ledger names HC-46 "kit observation carries positions and ids, per 0324"; 0324 asks for positions of what the Body perceived and the ids of perceived agents. The merged HC-46a (kit PR #127, verified on kit main and inside `kit-v0.1.0-rc23`) covers only entities and notable blocks: optional `pos` on both and a computed notable `distance`. Two things are left, both verified by reading `observe.ts` and the world schema:

1. Agents carry no position: the world's `PlaySurroundings.agents[]` has no x, y, z, so there is nothing to parse until the world sends it.
2. Ids: 0391 item 4 supersedes the id half of 0324. An id must not travel in the world output that the agent also reads, so "ids in the observation" is withdrawn as written and replaced by a supervisor-side roster.

What remains is the kit card in section 8, plus two items that are not kit cards and are not written here: (a) a geldar contract and Body change adding optional `x, y, z` to `PlaySurroundings.agents[]` (agent-visible, so it needs the approved sentence under 0324 item 2 before any rendering; whether 0391 item 4 is that approval is **unverified**); (b) a supervisor writer for `roster.json` (who writes it and from what name-to-life source is **unverified**; the NATS life registry in the repo notes is a candidate, **unverified** for this use).

---

## 8. HC-46b: agent positions and the supervisor-side roster (kit half)

- **id** HC-46b. **repo** kit. **depends-on** HC-46a (merged). **Ships inactive**: both inputs are optional and absence keeps today's behaviour. **branch** `scriptorium/hc-46b-agent-pos-roster`. **size** 22k.
- **may edit** `packages/instinct/src/observe.ts`, `observe.test.ts`, `packages/instinct/src/social/roster.ts` (new), `social/roster.test.ts` (new), the worknote. **must not edit** anything else.
- **exact shapes**
  ```ts
  // observe.ts: agents gains an optional position, nothing else
  agents: { name: string; distance: number | null; pos?: { x: number; y: number; z: number } }[];
  // roster.ts: names to life ids from the supervisor volume. Observation never carries an id.
  export function readRoster(stateDir: string): Map<string, string>; // <stateDir>/roster.json
  ```
- **steps**
  1. `agentsOf` reuses `posOf` (HC-46a) and adds `pos` only when all three numbers are finite. Existing `{name, distance}` fixtures must parse as before.
  2. `readRoster`: a missing, unreadable, non-regular or over-16-KiB file gives an empty map. The JSON is one object of `name: lifeId`; keep an entry only when the name has at most 40 characters and no control characters and the id passes `SAFE_ID`; drop the rest; never throw. Two names mapped to one id are both kept.
  3. Only the HC-30a adapter calls `readRoster`.
- **tests and reverts**
  - `an agent with x, y, z parses a pos; an agent without parses as before` (revert: drop the parse);
  - an agent with a missing z has no pos;
  - `readRoster`: missing file, oversize file, bad id and bad name give an empty map or dropped entries; a valid roster maps a name to its id (revert: return an empty map);
  - `Observation never has an id: parse a world reply with an id field on an agent and assert no id string appears anywhere in the parsed result` (revert: copy the id through).
- **checks** section 0 on `observe.test.ts` and `social/roster.test.ts`.
- **commit** `feat(instinct): optional agent position and a supervisor-side name roster (HC-46b)` plus the trailer.

---

## 9. Unverified list

- Kit check scripts (`pnpm lint`, `typecheck`, `check:repo`) and `./scriptorium.ps1` are as kit-b names them.
- The exact numbers of psyche `check` for the rolls-off tests.
- The env name `GELDAR_INSTINCT_WORKSPACE` and that the supervisor can set it.
- That `ctx.lifeKey` is the life id used as the social key.
- That a redelivered `wait` repeats the same event text and cursor.
- Whether the world sends actor and event ids for hurt, gift, break, fight and take; if not, W6 stays limited to speech.
- Whether the state directory is unreadable to the agent (HC-26c).
- Who writes `roster.json`, and from what source.
- Whether 0391 item 4 approves the agent-visible wording of a position field.

## 10. Roster delivery and its producer (added 2026-11-27, after the scriptorium orchestrator's check of HC-26a/b)

Status: proposal; no decision record. Everything here ships inactive.

- **Shape (accepted by the kit side).** `roster.json` is one flat JSON object `name: lifeId`, at most 16 KiB, as section 8 says. The model child never sees the path or any id.
- **Delivery (kit card change, kit side).** HC-26a/b gain a second stored file next to `sheet.json`: a host command like `sheet-set` stores `roster.json` in `player_dir`; HC-26b copies it with the same root helper (`--network none`, CHOWN and FOWNER only, a check first, then `mv` into `/vol/instinct`), owner 1001, mode 0600. Absent file means no roster. Owner of the change: the scriptorium orchestrator.
- **Reader (kit card change).** `readRoster` in HC-46b, called only by the HC-30a adapter (section 8).
- **Producer (geldar side, NEW card GX-ROSTER, not yet dispatched).** An operator-side export of name to life id from the registry (the agents table: displayed name to agent_id), written as one `roster.json` per player directory by an operator command. Operator-only: no agent can run it, and nothing here lets a human act in the world (Principle 1). Open points, all unverified: which tool holds it (a `tools/players-cli` verb is the likely home, and that path is a colo-images path, so the owner is warned before any merge), how aliases and display names map, and how often it refreshes when an agent joins or dies. No contract change is expected. Wording: none, since the file is never read by an agent.
- **Order.** The kit reader and delivery can merge inactive first. GX-ROSTER is written after the owner or Kiraifayi accepts the host-export design.
