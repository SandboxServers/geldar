# Sheet cards, waves W3 to W5: the instinct step, checks and prose (kit), and observed evidence (world)

Corrections 2026-11-15: checked against the real engine (`psyche/src`) and the kit package `@geldar/scriptorium-psyche`. Changed: the kit package name and mirror layout; the export list (`TEMPERAMENT_BANK` and `temperamentFor` are not exported, so HC-25 stops blocked at that import); `rngFor` takes one DrawKey (`draw` returns `rngFor(key)`); proficiency levels come from the world state, never the sheet (OD-C); the HC-20 `exactChance` call (an undefined `level`); decision and SQL numbers. Every change is listed in `worknotes/cards-w3-w12-corrections.md`.

Status: **proposal, nothing dispatched.** Written 2026-11-15 against geldar `origin/main` = `280b8ea9`. It continues [work-packets-geldar-a.md](work-packets-geldar-a.md) (W1, W2) and replaces, for these three waves only, the candidate sections AN-13 to AN-28 of [../character-sheet/work-packets.md](../character-sheet/work-packets.md). W5 refines the cards already drafted in [work-packets-geldar-b.md](work-packets-geldar-b.md); where they differ, this file wins. W2 (AN-08 to AN-12) is being coded and is not in this file.

**Facts every card respects.**

- The in-house Mind (`animus/`) is **frozen** (D-HC-01). The player kit (repo `geldar-scriptorium`, local path `C:\Users\Steve\source\projects\geldar-scriptorium`) is the one Mind. So every Mind-side candidate of W3 and W4 is a **kit card** (`HC-nn`, repo scriptorium) and every W5 card is a **world card** (`AN-nn`, repo geldar). Each card says `repo`.
- `psyche/` is a pure, zero-import package (geldar) mirrored byte for byte into the kit (HC-17a/b, pinned by tag `psyche-v1.0.0`, tree hash `b89848ab...`). In the kit the engine copy is `packages/psyche/engine/`; `packages/psyche/src/` is the kit's own package entry (`check.ts`, `sheet.ts`, `index.ts`), package name `@geldar/scriptorium-psyche`. **No card here edits `psyche/src/`**; if one needs a new export, stop and ask (a change means `--write`, a version bump and a new tag).
- **The sheet scores never reach any model context.** Agents are never told they are watched, scored or coached. Anything an instinct step does reaches the model only as the world's normal results of a settled act, and no card adds text for it.
- **OWNER APPROVAL REQUIRED** marks a card that produces agent-visible text (or text that tells an agent who to be). Such a card **ships inactive**: the text is data behind a switch that defaults off and a test proves off adds nothing. Approval of the wording is a separate owner act, recorded after review.
- Decision numbers: only 0283 to 0289 remain in this campaign's range, then the overflow block 0320 to 0329 (0280, 0281 used; 0282 is reserved for the account-erasure sheet ruling). Every number below is `<allocate via registry>`. SQL numbers: 0050 to 0052 are used or taken (0052 by PR #455's erasure comments); **no card here needs SQL** (kit state is a file, D-HC-04; W5 evidence is NATS only).
- Contract regeneration is serial. Only **AN-24** touches `contract/` in these three waves (shapes listed on the card). Nothing in W3 or W4 touches `contract/`.
- Already merged and available (geldar): psyche roll, params, proficiency, temperament; `AuditPublisher`; sink audit projection; character-config loaders. Exact psyche exports used: `rngFor`, `decisionId`, `DrawKey`, `d20`, `roll`, `exactChance`, `modeFor`, `DEFAULT_DCS`, `factor`, `step`, `levelForXp`, `normalizeSheet`, `sheetOrStandard`, `canonicalSheetJson`, `STANDARD_SHEET`, `ENGINE_VERSION`. Not exported by the kit package, by design: `TEMPERAMENT_BANK` and `temperamentFor` (temperament is inactive).

## Dependency table

"Parallel now" means a coder can start now, in its own worktree, by coding against the shapes stated in this file; **merge order is still the depends-on column.** `no` means a hard blocker with nothing to code against.

| Card | Wave | Repo | Depends on | Parallel now? | Needs owner decision |
|---|---|---|---|---|---|
| HC-18 instinct skeleton, world port, state store | W3 | kit | HC-17a, HC-17b (psyche mirror; not merged) | no (mirror absent) | D-CS-01, D-CS-03, D-CS-05 |
| HC-19 supervisor runs the step | W3 | kit | HC-18, HC-04 | yes (shapes) | D-CS-05, D-HC-09 (assumed) |
| HC-20 failure count, insight, variation | W3 | kit | HC-18 | yes (shapes) | D-CS-05, OD-C |
| HC-21a idle weighted pick | W3 | kit | HC-18 | yes (shapes) | D-CS-01, D-CS-05 |
| HC-21b habits | W3 | kit | HC-21a, HC-20 | yes (shapes) | D-CS-01 |
| HC-22 novelty | W4 | kit | HC-18 | yes (shapes) | D-CS-01, D-CS-05 |
| HC-23a sanity veto in `mind-loop` | W4 | kit | HC-10, HC-11 (kit A), HC-17b | no (BlockedDependency) | D-CS-18, D-CS-05, OD-B (APPROVAL) |
| HC-23b veto parameters on fd 4 | W4 | kit | HC-19, HC-23a, HC-26c | no | none beyond HC-23a |
| HC-25 sheet to persona temperament | W4 | kit | HC-17b | yes (shapes) | OD-A (APPROVAL), D-CS-10 |
| HC-26a host side of sheet delivery | W4 | kit | HC-25 | yes after HC-25 shapes | D-HC-03 (accepted) |
| HC-26b deliver sheet into the volume | W4 | kit | HC-26a, HC-18 | yes (shapes) | D-HC-03 |
| HC-26c supervisor reads the sheet; proof model never sees it | W4 | kit | HC-26b, HC-19 | no | D-HC-03 |
| HC-33 promises and due wakes (question card) | W4 | kit | none | yes (docs only) | D-HC-06 (deferred) |
| HC-24 HW2 integration and wave close | W4 | kit | HC-17a to HC-23b, HC-25, HC-26c | no (last) | D-CS-10 (values), OD-C |
| AN-24 observed-actor contract | W5 | geldar | AN-12 (W2 close), contract slot | yes (contract slot only) | D-CS-06, OD-E (APPROVAL) |
| AN-25 visible attacker identity | W5 | geldar | AN-24 | yes (shapes) | D-CS-06 |
| AN-26a pickup provenance (plugin) | W5 | geldar | AN-24, AN-27a (owns `ProvenanceSink`) | yes (shape below) | D-CS-06 |
| AN-26b recipient gift observation | W5 | geldar | AN-24, AN-25, AN-26a | yes (shapes) | D-CS-06 |
| AN-27a break provenance (plugin) | W5 | geldar | AN-24 | yes | D-CS-06 |
| AN-27b owner-side break observation | W5 | geldar | AN-24, AN-25, AN-27a | yes (shapes) | D-CS-06 |
| AN-28a delivery path (normaliser, MCP handlers) | W5 | geldar | AN-24, AN-25, GX-04 or OD-D | no until OD-D | D-CS-06, OD-D, OD-E (APPROVAL) |
| AN-28b Body wiring, plugin setup, ACL, leakage gate | W5 | geldar | AN-25, AN-26b, AN-27b, AN-28a | no (last) | D-CS-06 |

Owner decisions named above (D-CS ids are from [../character-sheet/decisions-before-packets.md](../character-sheet/decisions-before-packets.md); the recommended answers are assumed until the owner rules):

| Id | Question | Cards |
|---|---|---|
| D-CS-01 | Heuristics choose means to an adopted goal only; no goal means escalate; no dialogue in code | HC-18, 21a, 21b, 22 |
| D-CS-03 | One immutable adopted baseline; missing sheet is the standard sheet | HC-18, 26b |
| D-CS-05 | `rolls:false` means d20 checks become the deterministic rule (success iff exact chance at least 0.5); weighted and think draws stay seeded and recorded | HC-18 to 23a |
| D-CS-06 | Attribution needs a visible causal actor; unknown stays unknown | W5 |
| D-CS-10 | Production sheet values; nothing activated without it | HC-24, HC-25 |
| D-CS-18 | At most two model calls for one decision across correction, veto and stale-plan handling | HC-23a |
| OD-A | Wording and delivery route of the temperament sentences (the open item in `sheet/RESUME.md`) | HC-25 |
| OD-B | Wording of the sanity veto messages | HC-23a |
| OD-C | Where the kit gets proficiency levels. Round one: all zero, marked degraded. A supervisor-only feed from the world is a later decision | HC-20, 24 |
| OD-D | `animus/src/link` is frozen but the MCP server imports it. Either GX-04 lands first (the pieces move to a neutral home) or the owner grants a named exception for the three `animus/` rows in AN-28a | AN-28a |
| OD-E | Wording of the two observation sentences ("You received 3 bread." and the broken-block sentence) | AN-24, AN-28a |
| D-HC-06 | Commitments and promises are deferred (no store in the kit) | HC-33 |

## Shared files and who owns them

| Shared file or surface | Owner in this file | Everyone else |
|---|---|---|
| `packages/instinct/src/index.ts` (barrel), `packages/instinct/src/registry.ts` (the ordered list of fx) | HC-24 (one edit, at integration) | export from your own file only; tests import by path; "index line to add" in the worknote |
| `packages/instinct/src/types.ts`, `store.ts`, `step.ts`, `world.ts` | HC-18 | read-only for all later cards |
| `packages/instinct/package.json`, `pnpm-lock.yaml`, `packages/psyche/**` (mirror) | HC-18 creates the package; HC-17a owns the mirror | nobody edits `psyche` |
| `packages/supervisor/src/*` (settings, run loop) | HC-19, later HC-26c | **message the scriptorium orchestrator before editing** (RESUME rule); HC-19 first, HC-26c after |
| `packages/mind-loop/src/*` | HC-23a (after HC-10, HC-11) | same message rule |
| `launcher/geldar-play`, `launcher/geldar-play.ps1`, `messages.d` | HC-25 (persona verb), then HC-26a (`sheet` group), serial | one launcher card at a time |
| `template-src/instructions.md`, `template/**` | nobody in this file | the scriptorium orchestrator owns kit text; **no card here edits agent-facing instructions** |
| `contract/schemas/*`, `contract/src/index.ts`, `subjects.ts`, `outcome-words.ts`, `contract/src/generated/**` | AN-24 only | nobody; regenerate serially (ask geldar-3b for the slot, `sheet/RESUME.md`) |
| `golem/src/adam/adam-body.ts` | AN-28b only | AN-25 to AN-27b hand "index line to add" |
| `geldar.ps1` (`Get-NatsUsers`), `tools/repo-checks/src/nats-auth.test.ts`, `threshold/mcp/test/nats-auth.it.test.ts` | AN-28b | nobody |
| `plugin/.../blockowner/BlockOwnerSetup.java`, `NatsBlockOwnerLink.java` | AN-28b (setup), AN-27a (link `send`) | AN-26a imports the sink only |
| `threshold/mcp/src/events/handlers/index.ts`, `present-handlers/index.ts`, `animus/src/link/mind-event.ts`, `animus/src/ports/body.ts` | AN-28a | nobody |
| `docs/decisions/README.md`, `sql/README.md`, ledger, RESUME, number registry | orchestrator and ops, from "index line to add" | nobody |

## Rules common to every card

- **R1 size.** One Haiku-class coder, about 50k working tokens including reading, checks and the report. A card that grows past that is split before dispatch at its stated split line.
- **R2 worktree, branch.** Kit: branch `scriptorium/hc-<nn>-<slug>` from `scriptorium/hw2`, worktree `.claude/worktrees/hc-<nn>`, repo `C:\Users\Steve\source\projects\geldar-scriptorium`. World: branch `phase1/<id-lower>-<slug>` from `phase1/sheet-w5` (the orchestrator may rename), worktree `.claude/worktrees/<id-lower>` in geldar. The dispatch gives the absolute path. The coder never pushes, tags or opens a PR.
- **R3 worknote.** Kit: `docs/analysis/scriptorium/worknotes/HC-<nn>.md`. World: `docs/analysis/character-sheet/worknotes/AN-<nn>.md`. Shared-file needs go there as "index line to add".
- **R4 commit.** One subject as named on the card, plus the attribution lines the dispatch supplies verbatim. Commit each passing group.
- **R5 on-cap.** Commit what passes, record the base SHA, passing tests and unfinished steps in the worknote, leave a clean branch, stop. Do not weaken a test or invent a design.
- **R6 must-not-edit baseline.** `docs/spec.md`, accepted ADRs, merged SQL, merged prompts, generated output by hand, other packets' worknotes, every `package.json` and lockfile the card does not name, any file not in may-edit, `animus/` (frozen) unless OD-D says otherwise on AN-28a. Never run `adam up`.
- **R7 gates.** Kit `GATE-K`: `git diff --check`; `./scriptorium.ps1 pnpm format`; `./scriptorium.ps1 pnpm lint`; `./scriptorium.ps1 pnpm typecheck`; `./scriptorium.ps1 pnpm vitest run <path>`; `./scriptorium.ps1 pnpm check:repo`; `git merge-tree --write-tree scriptorium/hw2 HEAD` shows no conflict. World `GATE-G`: `git diff --check`; `./geldar.ps1 pnpm format` then `lint`; `./geldar.ps1 pnpm --filter <pkg> typecheck`; `./geldar.ps1 pnpm test <path>`; `./geldar.ps1 pnpm check:repo`; `git merge-tree --write-tree phase1/sheet-w5 HEAD`; contract cards add `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated`; plugin cards add `(cd plugin; ./gradlew :core:test --tests '<class>')` and `(cd plugin; ./gradlew build)`. Real NATS, Postgres, plugin and real-client cases are **ops**, serial, never a coder gate.
- **R8 file caps.** Soft 500 lines, hard 700 (code, JSON, TOML, XML). Split along the seams the card names. No `utils.ts` or `helpers.ts`.
- **R9 pins.** No new dependency without an exact version at least two weeks old. No card here adds one; the instinct package uses `node:` built-ins and the psyche mirror only.
- **R10 behaviour changes.** Every listed behaviour has a test that fails when the change is reverted; the coder runs each revert-check and names the failing test in the report.
- **R11 honesty rules.** No true score, sheet, alignment label or hash in any agent-visible text, workspace file, MCP output or model environment. The instinct step adds no text for the model. Off (switch false, config absent) means the old code path, no draws, no files, no events; each card that has an off path says how its test proves it.

---

# Wave W3: the instinct core (kit; replaces AN-13 to AN-17)

Common shapes for W3 and W4 (created by HC-18, stated here so the other cards code in parallel). All in `packages/instinct/src/` (repo scriptorium). `Score`, `Level`, `Domain`, `CharacterSheet`, `Rng`, `Roll`, `DrawKey` come from the kit package `@geldar/scriptorium-psyche` (its entry exports these names one at a time; the types are type-only exports).

```ts
// types.ts
export type Effort = 'minimal' | 'high';
export type Scalar = string | number | boolean | null;
export type Inputs = Readonly<Record<string, Scalar>>;                 // at most 12 keys
export type WakeReason =                                              // wake-map.ts maps the world's wait events to these (to confirm names in HC-18)
  | 'no_plan' | 'goal_completed' | 'idle' | 'fallback'
  | 'action_failed' | 'precondition_failed' | 'stuck'
  | 'new_agent_nearby' | 'speech' | 'other';
export interface Act { program: string; args: Readonly<Record<string, Scalar>> }   // a program from the Body's current list; the checked path validates
export interface DecisionNote {
  fx: string;                       // /^[a-z][a-z_]{0,47}$/
  policy: string;                   // 'name@N', /^[a-z][a-z_]{0,31}@[0-9]{1,4}$/ ; N bumps when a rule changes
  kind: 'd20' | 'uniform' | 'deterministic';
  inputs: Inputs;
  rolls: readonly Roll[];           // empty unless kind = 'd20'
  uniform?: number;                 // [0,1), set when kind = 'uniform'
  decisionIds: readonly string[];   // psyche decisionId(key) of every draw taken
}
export type FxResult =
  | { kind: 'pass' }                                                        // not mine; the next fx or the model
  | { kind: 'act'; act: Act; note: DecisionNote }                           // settle in code
  | { kind: 'escalate'; effort: Effort; tag: 'insight' | 'cap' | 'no_option' | 'think' | 'handoff' | 'stuck'; note: DecisionNote };
export interface Fx { readonly name: string; readonly policy: string; applies(ctx: FxContext): boolean; run(ctx: FxContext): FxResult }
export interface SnapshotView {      // the subset of the player's `look` result the instinct step reads (field names to confirm in HC-18 against threshold/mcp)
  tick: number; night: boolean; outdoors: boolean; health: number; food: number;
  position: { x: number; y: number; z: number };
  inventory: Readonly<Record<string, number>>; inventoryFull: boolean;
  agents: readonly { name: string; x: number; y: number; z: number }[];
  blocks: readonly { kind: string; x: number; y: number; z: number }[];   // blocks currently in sight only
  structures: readonly { kind: string; x: number; y: number; z: number }[];
  unlockedRecipes: readonly string[];
}
export interface FailedIntent { program: string; args: Readonly<Record<string, Scalar>>; observationId: string }
export interface WakeView { reason: WakeReason; observationId: string; failed?: FailedIntent; completed?: { program: string; args: Readonly<Record<string, Scalar>>; source: 'model' | 'instinct' }; speechAddressed: boolean }
export interface InstinctConfig {
  enabled: boolean;                  // default false (D-HC-09)
  rolls: boolean;                    // default true (D-CS-05)
  idle_requires_goal: boolean;       // default true (D-CS-01)
  max_heuristic_picks: number;       // default 3
  idle_think_probability: number;    // default 0.25
  failure_hard_cap: number;          // default 4
  nitwit_wait_seconds: number;       // default 30
  curiosity_radius: readonly [number, number, number, number, number]; // default [4,8,16,24,32]
}
export interface FxContext {
  lifeId: string; generation: number; tick: number; cycle: number;
  wake: WakeView; snapshot: SnapshotView; goal: string | null;           // goal = top adopted goal text, or null
  sheet: CharacterSheet; sheetStandard: boolean;                         // supervisor-only; never serialised toward the model
  proficiency: Readonly<Record<Domain, Level>>; proficiencyDegraded: boolean;   // OD-C: all 0 and degraded in round one; the levels come from the world state (Body cache or supervisor feed), never from the sheet
  config: InstinctConfig; store: InstinctStore;
  draw(fx: string): { key: DrawKey; rng: Rng };                          // key is one DrawKey object { producer: 'kit', lifeId, generation, tick, fx, decisionSeq }; rng = rngFor(key); decisionSeq counted per cycle
}
```

```ts
// store.ts : kit-local durable state (D-HC-04). One file, <state-dir>/instinct-state.json, written by write-temp-then-rename.
export interface InstinctStore {
  readonly lifeId: string; generation(): number; nextGeneration(): number;          // bumped once per supervisor start (HC-19)
  attempts(key: string): number;
  bumpAttempts(key: string, observationId: string): number;                          // idempotent per (key, observationId); returns the count after
  clearAttempts(key: string): void;
  lastIntent(key: string): { program: string; args: Readonly<Record<string, Scalar>> } | undefined;
  setLastIntent(key: string, intent: { program: string; args: Readonly<Record<string, Scalar>> }): void;
  habit(goal: string): { program: string } | undefined;                              // exact goal string
  setHabit(goal: string, habit: { program: string }): void;
  consecutivePicks(): number; setConsecutivePicks(n: number): void;
  remembered(kind: 'block' | 'structure' | 'agent' | 'place'): readonly { name: string; x: number; y: number; z: number }[]; // what this life has seen; capped 256 per kind
  remember(kind: 'block' | 'structure' | 'agent' | 'place', item: { name: string; x: number; y: number; z: number }): void;
  flush(): Promise<void>;
}
export function problemKey(goal: string, program: string): string;                   // sha256 hex of `${goal}\u0000${program}`, first 16 chars; NOT a function of intent arguments
export function openStore(dir: string, lifeId: string): Promise<InstinctStore>;      // a file with another life_id is ignored and replaced; a corrupt file is renamed *.bad and a fresh store starts
```

```ts
// world.ts : the port to the world. HC-18 implements it over the kit's existing MCP world connector (import it if mind-loop already exports one; do not write a second one).
export interface InstinctWorld {
  look(): Promise<SnapshotView>;
  wake(): Promise<WakeView>;                         // the wake the supervisor is about to act on
  submit(act: Act): Promise<{ accepted: boolean; receiptId: string | null }>;   // the world's normal checked path; a refusal is accepted=false
}
// step.ts
export type StepOutcome = 'handled' | 'escalated' | 'refused' | 'passed';
export interface StepResult { v: 1; outcome: StepOutcome; fx: string | null; effort: Effort | null; tag: string | null; decisionId: string | null; act: Act | null }
export function runStep(ctx: FxContext, registry: readonly Fx[], world: InstinctWorld): Promise<StepResult>;
// instinct.jsonl : one line per step, in the supervisor volume (never in the workspace, never in the model's environment)
export interface InstinctRecord {
  v: 1; ts: string /* ISO UTC */; life_id: string; cycle: number; wake_reason: WakeReason;
  fx: string | null; outcome: StepOutcome; policy: string | null; kind: DecisionNote['kind'] | null;
  decision_ids: string[]; inputs: Inputs; rolls: Roll[]; act: Act | null; source: 'instinct';
  engine_version: number; rolls_enabled: boolean; degraded: boolean; sheet_standard: boolean;
}
```

Result protocol (HC-18 writes it, HC-19 reads it): `geldar-instinct step` prints one `StepResult` JSON line on stdout and exits 0; any other exit or output means "pass" and is logged. The supervisor skips the waking only for `handled`.

Never settled in code (D-HC-09, tested in HC-18's `runStep`): speech addressed to the agent (`wake.speechAddressed`), a first sighting of an agent, a wake with no `goal` when `idle_requires_goal`, a failure past the cap. These always return `pass` or `escalate`, never `act`.

## HC-18: instinct package skeleton, world port, state store, step runner

- **id** HC-18. **wave** W3. **repo** scriptorium. **depends-on** HC-17a, HC-17b (the `packages/psyche` mirror and the sheet parser). **size** 50k (split line below). **branch** `scriptorium/hc-18-instinct-skeleton`. **Replaces** AN-13.
- **trim.** No fx logic (HC-20 to HC-22), no supervisor change (HC-19), no sheet delivery (HC-26: `FxContext.sheet` comes from an injected `SheetSource`, default `STANDARD_SHEET` with `sheetStandard: true`).
- **may-edit** `packages/instinct/package.json` (new, name `@geldar/instinct`, workspace dependency on the psyche mirror, `bin` `geldar-instinct`), `tsconfig.json`, `src/types.ts`, `src/store.ts`, `src/problem-key.ts`, `src/world.ts`, `src/step.ts`, `src/audit.ts` (the `instinct.jsonl` writer), `src/config.ts` (parse and default `InstinctConfig`), `src/wake-map.ts`, `src/cli.ts` (the `step` verb), and tests beside each; `pnpm-workspace.yaml` only if `packages/*` does not already match; `pnpm-lock.yaml` (importer entry only).
- **must-not-edit** R6, `packages/psyche/**`, `packages/supervisor/**`, `packages/mind-loop/**`, `template*/**`.
- **shared files edited** `pnpm-lock.yaml` (importer entry). Nothing else.
- **decisions** D-CS-01, D-CS-03, D-CS-05 (recorded in the one ADR `<allocate via registry>` that HC-24 writes; this card cites it).
- **shapes** the whole common block above, exactly.
- **deliver.** (1) Types, config, store, problem key. (2) `runStep`: build nothing itself; loops the registry in order; the first fx whose `applies` is true and whose result is not `pass` wins; `act` is validated (`program` non-empty, args at most 8 keys) then `world.submit`; `accepted: false` gives outcome `refused` (no retry), `true` gives `handled`; `escalate` gives `escalated`; all pass gives `passed`. Never throws: a throwing fx is recorded as `passed` with `inputs.error` set to the error class name. (3) Writes one `InstinctRecord` per step to `<volume>/instinct.jsonl` (append, newline-terminated, fsync at close) **before** `submit` returns control to the supervisor. If the write fails the act is **not** submitted (no unrecorded act) and the outcome is `passed`. (4) `draw(fx)` builds `DrawKey { lifeId, producer: 'kit', generation, tick, fx, decisionSeq }`, `decisionSeq` counted per cycle from 0, and returns `rngFor(key)`. A repeat `draw` of the same fx in the same cycle gets the next `decisionSeq`. (5) CLI `geldar-instinct step --state-dir <dir> --config <file>`; with the config absent or `enabled: false` it prints `{"v":1,"outcome":"passed",...}` and touches no file.
- **tests** store: reload restores attempts, habits, picks, remembered items; a second life id starts empty; a corrupt file is renamed and a fresh store opens; `bumpAttempts` with a repeated `observationId` counts once; `problemKey` is equal for different arguments and different for a different goal or program; atomic write (kill between temp and rename leaves the old file). Step: an `act` is submitted once and recorded before submit returns; the audit write fails so nothing is submitted; a throwing fx passes; speech-addressed and no-goal contexts never produce `act`; disabled config creates no file; `instinct.jsonl` lines parse as `InstinctRecord`; two draws of one fx in one cycle differ in `decisionIds`.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/instinct`.
- **revert-checks** (1) make `bumpAttempts` ignore `observationId`: "duplicate observation counts once" fails. (2) include args in `problemKey`: "key ignores arguments" fails. (3) submit before the audit write: "no unrecorded act" fails. (4) let `runStep` pass `speechAddressed` contexts to fx: "never settles addressed speech" fails.
- **worknote** `docs/analysis/scriptorium/worknotes/HC-18.md`. **commit** `feat(instinct): instinct package with world port, durable state and step runner (HC-18)`. **split line** types, config and store first; `runStep`, audit and CLI second.

## HC-19: the supervisor runs the step before each waking

- **id** HC-19. **wave** W3. **repo** scriptorium. **depends-on** HC-18, HC-04 (stamps). **size** 40k. **branch** `scriptorium/hc-19-supervisor-instinct`. **Replaces** AN-16 (the no-call execution and journaling half; the loop-seam half is not needed because the kit has no in-house loop to patch).
- **coordination.** `packages/supervisor/src/**` belongs to the scriptorium orchestrator: message him before editing and add only the lines below.
- **may-edit** `packages/supervisor/src/instinct-step.ts` (new), `instinct-step.test.ts` (new), `packages/supervisor/src/settings.ts` (add only the optional `instinct` block: `{ enabled?: boolean; rolls?: boolean }`, default absent), `packages/supervisor/src/supervisor.ts` (one call before the waking is built; one `nextGeneration()` at start), `supervisor.test.ts` (one added group), `schemas/player.schema.json` (the `instinct` object, `additionalProperties: false`).
- **must-not-edit** R6; `packages/mind-loop/**`; `packages/instinct/src/**`; anything that builds the model's prompt or environment.
- **shared files edited** `settings.ts`, `supervisor.ts`, `schemas/player.schema.json` (serial with HC-26c; HC-19 first).
- **decisions** D-HC-09 (off by default). D-CS-05.
- **shape** `runInstinctStep(opts: { stateDir: string; configPath: string; timeoutMs: number /* 10000 */; spawn: SpawnFn }): Promise<StepResult | null>` returns `null` on timeout, crash, bad JSON or any non-zero exit (fail open: the waking proceeds). The supervisor: with `instinct` absent or `enabled: false`, **does not call** `runInstinctStep` and creates no file; otherwise one call per waking, one in flight; `handled` skips the waking and counts as a cycle that did not fail; every other outcome proceeds to the normal waking. The step's child process gets an environment of exactly `PATH` plus the state-dir and config-path as arguments: no model credential, no `HOME` and no sheet path (asserted).
- **tests** off: the supervisor never calls the step (spy) and the volume gains no file; handled skips the waking and the failure counter stays 0; escalated, refused and passed all wake; timeout and non-JSON output wake and log; a second step is not started while one runs; the child environment has no variable containing `TOKEN`, `KEY` or `SHEET`; the new schema field rejects unknown keys.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/supervisor`.
- **revert-checks** (1) call the step when `enabled` is false: "off never calls the step" fails. (2) treat a crash as handled: "crash wakes the model" fails. (3) pass `process.env` to the child: the environment test fails.
- **worknote** `.../HC-19.md`. **commit** `feat(supervisor): run the instinct step before each waking, off by default (HC-19)`. **split line** the runner module and its tests first; the supervisor and schema edits second.

## HC-20: failure counting, falling insight DC, one variation, retry cap

- **id** HC-20. **wave** W3. **repo** scriptorium. **depends-on** HC-18. **size** 45k. **branch** `scriptorium/hc-20-failure-insight`. **Replaces** AN-15.
- **may-edit** `packages/instinct/src/fx/failure.ts` (new, exports `failureFx: Fx`), `src/fx/variation.ts` (new, `variationFor(failed: FailedIntent, ctx: FxContext): Act | null`), `src/fx/failure.test.ts`, `src/fx/variation.test.ts` (new).
- **must-not-edit** R6; everything else in `packages/instinct` (registration is HC-24).
- **shared files edited** none (`index line to add: export { failureFx } from './fx/failure.ts'` goes in the worknote).
- **decisions** D-CS-05. OD-C (proficiency is all 0 and degraded in round one; the roll reads the program's domain level from `ctx.proficiency`, which the world state fills and never the sheet, so nothing changes when a source arrives).
- **rules (exact order, so a coder cannot choose).**
  1. `applies`: `wake.reason` in `action_failed`, `precondition_failed`, `stuck`, and `wake.failed` present (not for `stuck`). `stuck` returns `escalate high tag 'stuck'` at once, no draw, no count.
  2. `key = problemKey(ctx.goal ?? '', failed.program)`. A null goal uses `''` (one shared key; documented).
  3. `n = store.bumpAttempts(key, failed.observationId)` **first** (this failure counts); `store.setLastIntent(key, {program, args})`.
  4. Economic programs (`give`, `deposit`, `withdraw`, `trade`, `sell`, `buy`) are never varied or replayed: `escalate minimal 'no_option'` after step 3.
  5. `n >= failure_hard_cap` (4): `escalate minimal 'cap'`, no draw.
  6. `dc = max(8, 14 - n)`. Insight check: `rolls` true: `roll('insight', cleverness, dc, draw('insight').rng, ctx.proficiency[domainOf(failed.program)])`, kind `d20`; `rolls` false: kind `deterministic`, success iff `exactChance(cleverness, dc, ctx.proficiency[domainOf(failed.program)]).wins * 2 >= total`.
  7. Success: `escalate high 'insight'`. Failure: `variationFor`; non-null gives `act`, null gives `escalate minimal 'no_option'`.
  8. `variationFor` (first that applies): `travel` (`target`): next known waypoint toward the target from `store.remembered('place')` strictly closer than the current distance, else a remembered agent at the target; `gather` (`block`, `count`): `count` halved (floor, at least 1) when `count > 1`, else `travel` to a remembered block of that kind; `craft` (`item`, `count`): craft a missing ingredient only when it is in `snapshot.unlockedRecipes`, else `count` 1 when `count > 1`; `build` (`blueprint`, `block`): another carried block, else blueprint `pillar`; `follow` (`target`): `travel` to the target's last remembered position; `rest`, `flee`: null. Argument names must match the Body's current verb list (HC-18 records the list in its worknote; mismatch is a ruling, not a guess).
  9. A variation never equals the failed intent (deep compare) and never changes `program` except `gather`'s `travel` and `follow`'s `travel` (named above).
- **domain map** `travel`, `follow`, `flee`, `rest` map to `exploring`, `gather` to `mining`, `craft` to `crafting`, `build` to `building`; farming and combat programs have no variation.
- **tests** (table-driven) first failure n=1 dc 13; n=2 dc 12; n=6 would be 8 (never reached because the cap is 4); n=4 escalates minimal 'cap' with no draw recorded; changed arguments on a retry keep the same key and the same count; the same `observationId` twice counts once; each variation row (applies, and the not-applies fallthrough); a variation equal to the failed intent is refused; economic failure never acts; `rolls:false` threshold fixtures at exact chance 0.5 (cleverness 3, dc 11) and just below; `stuck` escalates high with no draw; restart (reopen the store) keeps attempts; `goal_completed` is **not** handled here (HC-21b clears the key through `store.clearAttempts`, test it there).
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/instinct/src/fx/failure packages/instinct/src/fx/variation`.
- **revert-checks** (1) bump after the DC calculation: "n=1 gives dc 13" fails. (2) hash the arguments into the key: "changed arguments keep the count" fails. (3) drop the cap test: "n=4 escalates" fails. (4) allow `give` variation: "economic failure never acts" fails.
- **worknote** `.../HC-20.md`. **commit** `feat(instinct): failure counting, falling insight check and one variation (HC-20)`. **split line** `failure.ts` first; `variation.ts` second.

## HC-21a: idle choice, the weighted pick among known means

- **id** HC-21a. **wave** W3. **repo** scriptorium. **depends-on** HC-18. **size** 45k. **branch** `scriptorium/hc-21a-idle-pick`. **Replaces** AN-14 (candidate half).
- **may-edit** `packages/instinct/src/fx/idle.ts` (new, `idleFx`), `src/fx/candidates.ts` (new, `candidatesFor(ctx): Candidate[]`), `src/fx/weights.ts` (new, `weightFor`), tests for each.
- **must-not-edit** R6; the rest of `packages/instinct`.
- **shared files edited** none (index line to add in the worknote).
- **decisions** D-CS-01 (no goal means escalate when `idle_requires_goal`), D-CS-05 (the pick and think draws stay seeded and recorded when `rolls` is false).
- **shapes**
  ```ts
  export type Mode = 'explorer'|'farmer'|'miner'|'builder'|'crafter'|'warrior'|'nitwit';
  export interface Candidate { mode: Mode; act: Act; weight: number }
  export function candidatesFor(ctx: FxContext): Candidate[];           // known-only; empty when nothing is eligible
  export function weightFor(mode: Mode, ctx: FxContext): number;        // factor(op_mode score, 1, 2), then multipliers, 0 drops it
  ```
- **rules.**
  1. `applies`: `wake.reason` in `no_plan`, `goal_completed`, `idle`, `fallback`, and `!wake.speechAddressed`. With `idle_requires_goal` and `goal === null` run returns `escalate minimal 'no_option'` (no draw).
  2. Think check, in this order: `store.consecutivePicks() >= max_heuristic_picks` returns `escalate minimal 'handoff'` and **resets** the count to 0; else one uniform draw `u = draw('idle_think').rng.next()`, `u < idle_think_probability` returns `escalate minimal 'think'` (kind `uniform`).
  3. `candidatesFor`, programs the Body has **today** (HC-31 adds explore, farm and patrol later): miner: `gather` a block kind the life has seen (`store.remembered('block')` or the snapshot) with `count` 8; farmer: `gather` a crop block kind seen; builder: `build` blueprint `shelter` when at least the shelter's blocks are carried (the list lives in `candidates.ts`, fixed, noted in the worknote), else `pillar` when 1 block is carried; crafter: `craft` an item in `unlockedRecipes` whose ingredients are carried, `count` 1; nitwit: `wait` with `seconds = nitwit_wait_seconds`; **explorer and warrior are ineligible** until HC-31 and HC-27 (no known frontier and no trust data); they return no candidate, never a guess.
  4. Weights `factor(score, 1, 2)` = 0.25, 0.5, 1, 2, 4. Situational multipliers applied in this order: night and outdoors: builder (shelter) and `rest`-like picks x4, all others x0.25; `food <= 6` and no food carried: food-gathering (crop gather) x4; `inventoryFull`: `gather` x0. A weight of 0 or NaN drops the candidate.
  5. No candidate: `escalate minimal 'no_option'`. Otherwise one draw `u = draw('idle_pick').rng.next()`; pick the first candidate with `u * total < cumulative` (strict, in the fixed mode order above); `store.setConsecutivePicks(n+1)`; return `act`, kind `uniform`.
  6. Never creates or edits a goal; never picks an economic program (`give`, `trade`, `deposit`, `withdraw`).
- **tests** unavailable, unknown or locked recipes are never candidates; no goal and `idle_requires_goal` escalates; speech-addressed passes; zero candidates and all-invalid escalate; boundary fixtures: `u*total` exactly on a cumulative edge picks the **next** candidate; weight fixtures for all five scores; each multiplier alone and combined; forced `handoff` at the cap and the count reset; the think probability edge (`u` equal to p does not think); `rolls:false` still records the same uniform draws; two cycles with different `cycle` draw differently; the pick count persists across a store reload.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/instinct/src/fx/idle packages/instinct/src/fx/candidates packages/instinct/src/fx/weights`.
- **revert-checks** (1) allow explorer without a frontier: "explorer is ineligible" fails. (2) use `<=` at the cumulative edge: boundary fixture fails. (3) skip the cap reset: "handoff resets" fails. (4) ignore `idle_requires_goal`: "no goal escalates" fails.
- **worknote** `.../HC-21a.md`. **commit** `feat(instinct): idle weighted pick among known means (HC-21a)`. **split line** `weights.ts` and `candidates.ts` first; `idle.ts` second.

## HC-21b: habits

- **id** HC-21b. **wave** W3. **repo** scriptorium. **depends-on** HC-21a, HC-20 (`setLastIntent`). **size** 25k. **branch** `scriptorium/hc-21b-habits`. **Replaces** AN-14 (habit half).
- **may-edit** `packages/instinct/src/fx/habit.ts` (new, `habitFx`, `recordCompletion(ctx)`), `habit.test.ts`.
- **must-not-edit** R6; `idle.ts`, `candidates.ts` (read, do not change).
- **shared files edited** none.
- **decisions** D-CS-01.
- **rules.** `recordCompletion`: on `wake.reason = 'goal_completed'` with `wake.completed.source === 'model'` and a non-null `goal`, `store.setHabit(goal, {program})` and `store.clearAttempts(problemKey(goal, program))`. Instinct-sourced completions never set a habit (a habit is the model's last working means, not our own). `habitFx.applies`: idle wake reasons (as HC-21a), `goal !== null`, `store.habit(goal)` exists (exact string match, case-sensitive, no trimming beyond a single `.trim()` at both write and read). `run`: arguments are rebuilt fresh from `candidatesFor` for the program's mode (never copied from the old intent); no matching candidate returns `pass` (falls through to `idleFx`); a hit counts toward `consecutivePicks` like an idle pick; economic programs are never stored as habits.
- **tests** a reworded goal misses the habit; the same goal reuses with fresh arguments; instinct completions do not write a habit; `goal_completed` clears the attempt count for the key; a habit for an economic program is refused at write; the habit survives a store reload; a habit whose program has no candidate falls through.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/instinct/src/fx/habit`.
- **revert-checks** (1) store instinct completions: "instinct completions are not habits" fails. (2) copy the old arguments: "fresh arguments" fails. (3) skip the clear: "completion resets the key" fails.
- **worknote** `.../HC-21b.md`. **commit** `feat(instinct): reuse the model's last working means for an unchanged goal (HC-21b)`. **split line** none (small).

---

# Wave W4: checks, attention and prose (kit; replaces AN-18 to AN-23)

W4 contains the only kit cards that can produce agent-visible text. Both are marked and ship inactive.

## HC-22: novelty from authorized knowledge

- **id** HC-22. **wave** W4. **repo** scriptorium. **depends-on** HC-18. **size** 35k. **branch** `scriptorium/hc-22-novelty`. **Replaces** AN-18.
- **may-edit** `packages/instinct/src/fx/novelty.ts` (new, `noveltyFx`), `src/fx/geometry.ts` (new, `withinRadius`), `src/fx/novelty.test.ts`, `src/fx/geometry.test.ts`.
- **must-not-edit** R6; the rest of `packages/instinct`.
- **shared files edited** none.
- **decisions** D-CS-01 (a detour happens only at an accepted wake boundary, never cancelling a valid intent), D-CS-05.
- **shapes**
  ```ts
  export function withinRadius(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}, r: number): boolean;   // Euclidean, inclusive: dx*dx+dy*dy+dz*dz <= r*r
  export function radiusFor(curiosity: Score, table: InstinctConfig['curiosity_radius']): number;
  export interface StrangerPort { (ctx: FxContext, agent: { name: string; x: number; y: number; z: number }): FxResult }   // HC-28b provides it later; absent now
  export function wakeInterest(ctx: FxContext): readonly string[];        // pure; ['new_agent_within_<R>'] unless already present; HC-24 passes it to the act path if the MCP `act` accepts a wake interest (to confirm)
  ```
- **rules.** `applies`: wake reasons `idle`, `goal_completed`, `no_plan`, `fallback`, `other` with a non-empty `snapshot`; **not** during a valid in-flight plan (the supervisor only runs the step at a wake boundary). "New to this life" = not in `store.remembered(kind)` (matched by kind and position within 1 block). Candidates come only from the **current snapshot** (`blocks`, `structures`, `agents`): an unseen structure or block is never a target. Nearest new thing within `R` wins; ties break on kind name then x, y, z ascending. Then `store.remember(...)` for everything new in range (so a later wake does not repeat). Agent target: a stranger port if configured, otherwise `pass` (fallback; speech and approach belong to the model; no dialogue in code). Structure or block target: draw `roll('novelty', curiosity, 11, draw('novelty').rng, level(exploring))`; `rolls:false` uses the deterministic rule; success returns `act` `travel` `{ target: <known coordinates string> }`; failure returns `pass` and the thing stays remembered.
- **tests** radius edges (inclusive at exactly R, out at R+1) on every axis and both signs for all five radii; an unseen structure (not in snapshot) is not a target; remembered things suppress novelty; an agent routes to the port when present and to `pass` otherwise; `wakeInterest` adds no duplicate and keeps an existing one; tie-break order; failure remembers the thing; `rolls:false` threshold fixtures.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/instinct/src/fx/novelty packages/instinct/src/fx/geometry`.
- **revert-checks** (1) change `<=` to `<`: "inclusive edge" fails. (2) skip `remember`: "known suppresses novelty" fails. (3) accept targets outside the snapshot: "unseen is not a target" fails.
- **worknote** `.../HC-22.md`. **commit** `feat(instinct): curiosity novelty from what the life has seen (HC-22)`. **split line** `geometry.ts` first; `novelty.ts` second.

## HC-23a: the sanity veto inside `mind-loop` (owned-loop harnesses)

- **OWNER APPROVAL REQUIRED** (OD-B): the veto message is agent-visible text that tells the agent what to reconsider. Ships **inactive**: `sanity.enabled` defaults false and the message table is empty until the owner approves the wording.
- **id** HC-23a. **wave** W4. **repo** scriptorium. **depends-on** HC-10, HC-11 (the call allowance and the corrective retry, kit A), HC-17b. **Status** BlockedDependency until those merge. **size** 45k. **branch** `scriptorium/hc-23a-sanity-veto`. **Replaces** AN-19 (sanity half; the shared retry allowance is HC-10/11's).
- **coordination.** `packages/mind-loop/**` is shared with kit A; message the scriptorium orchestrator before editing.
- **may-edit** `packages/mind-loop/src/sanity/predicates.ts`, `policy.ts`, `veto-text.ts`, `types.ts` (all new), `packages/mind-loop/src/sanity/*.test.ts` (new), and **one** call site in the loop file that HC-11 named for the act dispatch (a line that calls `checkPlan` when `sanity` is configured; to confirm the file name once HC-11 merges).
- **must-not-edit** R6; the allowance implementation (HC-10/11); transports.
- **shared files edited** the loop file (one call site).
- **decisions** D-CS-18 (two model calls at most per decision across correction, veto and stale handling; exhausted allowance waives the veto), D-CS-05. ADR `<allocate via registry>`.
- **shapes**
  ```ts
  export interface SanityFacts { night: boolean; outdoors: boolean; food: number; health: number; inventoryFull: boolean; carriesFood: boolean; carriesShelter: boolean }
  export interface PlanView { acts: readonly { program: string; args: Readonly<Record<string, Scalar>> }[] }
  export type SanityHit = 'night_exposure' | 'starving_with_food' | 'fighting_near_death' | 'full_inventory';
  export function hitsFor(plan: PlanView, facts: SanityFacts): readonly SanityHit[];     // pure
  export interface VetoParams { commonSense: Score; rolls: boolean; healthFloor: number; lifeId: string; generation: number; tick: number; enabled: boolean }
  export function checkPlan(plan: PlanView, facts: SanityFacts, p: VetoParams, allowance: { remaining(): number; spend(): void }, vetoedBefore: boolean): { veto: false } | { veto: true; hit: SanityHit; note: DecisionNote };
  export const VETO_TEXT: Readonly<Partial<Record<SanityHit, string>>>;   // EMPTY until approved (OD-B); words must pass the kit's marked-word scan
  ```
- **rules.** Predicates: night exposure = night, outdoors, a `travel` of more than 64 blocks and no shelter or bed carried; starving = `food <= 6`, `carriesFood`, no `eat` in the plan; fighting near death = `health <= healthFloor` and an `attack`; full inventory = `inventoryFull` and the plan is `gather`. For each hit (fixed order above) roll `common_sense` against DC 8 (`rolls:false`: deterministic, success iff exact chance at least 0.5, which at score 3, DC 8 is 0.65 so it vetoes, and at score 2, DC 8 is 0.42 so it does not). Caught means veto. **At most one veto per decision** (`vetoedBefore` waives); no allowance (`remaining() < 1`) waives; invalid-output correction, veto and stale-plan resnapshot all draw on the same allowance. An empty `VETO_TEXT[hit]` waives (inactive until approved). `enabled: false` returns `{veto:false}` without any draw.
- **tests** each predicate at its boundary (64 and 65 blocks; food 6 and 7; health at the floor and one above); a caught and a missed roll with fixed seeds; valid output then veto, invalid output then veto, veto then stale refusal, admission denial and cancellation never exceed two calls; `vetoedBefore` waives; empty text waives; disabled draws nothing; `rolls:false` fixtures.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/mind-loop/src/sanity`.
- **revert-checks** (1) remove the allowance test: "never exceeds two calls" fails. (2) veto twice: "one veto per decision" fails. (3) use `<` at 64: boundary fails. (4) fill `VETO_TEXT` in the shipped file: "ships inactive" fails.
- **worknote** `.../HC-23a.md`. **commit** `feat(mind-loop): sanity predicates and one bounded veto, inactive (HC-23a)`. **split line** `predicates.ts` first; `policy.ts` and the call site second.

## HC-23b: deliver the veto parameters to the loop on descriptor 4

- **id** HC-23b. **wave** W4. **repo** scriptorium. **depends-on** HC-19, HC-23a, HC-26c (`readSheetFile`). **size** 25k. **branch** `scriptorium/hc-23b-veto-params`.
- **may-edit** `packages/supervisor/src/veto-params.ts` (new), `veto-params.test.ts`, the spawn call in `packages/supervisor/src/instinct-step.ts`'s sibling that starts the owned loop (one added `stdio[4]` pipe; to confirm the file), `packages/mind-loop/src/sanity/params-reader.ts` (new) and its test.
- **must-not-edit** R6; `packages/supervisor/src/settings.ts`.
- **shared files edited** the loop spawn file (serial after HC-19, HC-26c).
- **shape** one newline-terminated JSON line on fd 4: `{"v":1,"common_sense":<1..5>,"rolls":<bool>,"health_floor":<int>,"enabled":<bool>}`. It carries one derived score and never the sheet or hash. The loop reads it once at start; a missing or malformed line means `enabled:false`. The model's process environment and tool list gain nothing (asserted).
- **tests** the line round-trips; malformed means disabled; the model-facing tool list and prompt are byte-identical with and without fd 4; the sheet hash does not appear in the child's arguments, environment or fd 4.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/supervisor/src/veto-params packages/mind-loop/src/sanity/params-reader`.
- **revert-checks** (1) add `sheet_hash` to the line: the "no hash" test fails. (2) treat malformed as enabled: "malformed means disabled" fails.
- **worknote** `.../HC-23b.md`. **commit** `feat(supervisor): hand the veto parameters to the loop, never the sheet (HC-23b)`. **split line** none.

## HC-25: sheet to persona temperament generator

- **OWNER APPROVAL REQUIRED** (OD-A): the sentences tell an agent who to be. Ships **inactive**.
- **id** HC-25. **wave** W4. **repo** scriptorium. **depends-on** HC-17b. **size** 40k. **branch** `scriptorium/hc-25-temperament`. **Replaces** AN-21 (prompt versioning does not apply: identity is write-once at birth) and AN-22 (the geldar `tools/mcp-tokens` persona export stays untouched).
- **may-edit** `packages/instinct/src/persona.ts` (new: `temperamentText(sheet): string`), `src/persona.test.ts`, `src/temperament-approval.json` (new, shipped `{ "approved": false, "bank_hash": null }`), `src/cli.ts` (add the `persona` verb; HC-18 owns the file, so this is the only edit and goes last, serial), `launcher/geldar-play` and `launcher/geldar-play.ps1` (only the `new --sheet` hand-off line, after HC-26a lands; to confirm).
- **must-not-edit** R6; `packages/psyche/**`; `template/**`; any existing identity file.
- **shared files edited** `packages/instinct/src/cli.ts`, `packages/instinct/src/index.ts` (barrel, index line to add), both launchers (one line).
- **decisions** OD-A, D-CS-10. ADR `<allocate via registry>` (route and wording, written after approval).
- **shape** `temperamentText(sheet: CharacterSheet): string` returns the temperament sentences for the sheet (one per attribute or axis that is not 3, fixed order) joined with single spaces, or `''` for a standard sheet. **Correction:** `@geldar/scriptorium-psyche` does not export `temperamentFor` or `TEMPERAMENT_BANK` (temperament is inactive), so the card cannot import either. The route OD-A names must say how the bank is reached (`to confirm`); until it does, this card stops `blocked` at that import and writes no generator against a missing export. `geldar-instinct persona --sheet <file> --persona-dir <dir>` appends one paragraph to `<dir>/identity.md` **only** when `temperament-approval.json` says `approved: true` **and** its `bank_hash` equals the SHA-256 of canonical JSON of the bank (`TEMPERAMENT_BANK`, by the route to confirm above); it refuses an existing `identity.md` that already contains the paragraph marker; it refuses if the combined text exceeds the identity cap (value from the kit, `to confirm`; refuse, never truncate, request a decision). No numeric score, alignment label (LG, TN and so on), the words `sheet`, `score`, `roll` or `d20` may appear in the output (scan test), nor any word in the kit's marked-word list.
- **tests** standard sheet writes nothing; the maximal sheet fits the cap; every bank sentence passes the scans; unapproved writes nothing and exits non-zero with a fixed message; an approved file with a stale `bank_hash` refuses; existing identity is never overwritten; the output is the same for the same sheet (deterministic); the shipped `temperament-approval.json` has `approved:false`.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/instinct/src/persona`.
- **revert-checks** (1) ship `approved: true`: "ships inactive" fails. (2) skip the hash check: "stale bank refuses" fails. (3) append when the marker exists: "never overwrites" fails. (4) include `alignmentLabel` output: the label scan fails.
- **worknote** `.../HC-25.md`. **commit** `feat(instinct): temperament sentences for a new player's identity, inactive (HC-25)`. **split line** the pure generator first; the CLI verb and launcher line second.

## HC-26a: host side of sheet delivery, `new --sheet` and `sheet-set`

- **id** HC-26a. **wave** W4. **repo** scriptorium. **depends-on** HC-25. **size** 38k. **branch** `scriptorium/hc-26a-sheet-host`.
- **may-edit** `launcher/geldar-play`, `launcher/geldar-play.ps1` (the `new --sheet <file>` flag and the `sheet-set <id> --sheet <file>` verb), `messages.d/sheet.*` (new group `sheet`), `launcher/test/sheet.*` (new).
- **must-not-edit** R6; any birth path other than reading the flag; `template/**`.
- **shared files edited** both launchers, `messages.d` (serial after HC-25).
- **decisions** D-HC-03 (the world database is canonical; the kit copy is supervisor-only; refreshed only by this explicit owner command).
- **shape** the host validates the file with the HC-17b parser (`normalizeSheet`); an invalid sheet refuses with the parser's errors. The validated canonical JSON is staged at `<host>/sheet/<id>.json` (owner-only permissions, never inside the workspace or any path mounted to the model) for HC-26b to copy. Standard sheet input is accepted and recorded.
- **tests** invalid sheet refused; valid staged with canonical bytes; both launchers behave identically on the same input (shared fixture); `sheet-set` on an unknown id refuses; the staged path is outside the workspace mount.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run launcher`.
- **revert-checks** (1) skip validation: "invalid sheet refused" fails. (2) stage under the workspace: "outside the workspace" fails.
- **worknote** `.../HC-26a.md`. **commit** `feat(launcher): new --sheet and sheet-set stage a validated sheet (HC-26a)`. **split line** `new --sheet` first; `sheet-set` second.

## HC-26b: deliver the sheet into the supervisor volume

- **id** HC-26b. **wave** W4. **repo** scriptorium. **depends-on** HC-26a, HC-18 (`check-sheet`). **size** 35k. **branch** `scriptorium/hc-26b-sheet-volume`.
- **may-edit** `launcher/geldar-play`, `launcher/geldar-play.ps1` (the copy into `geldar-sup-<id>:/state/sheet.json` at start and restart), `packages/instinct/src/check-sheet.ts` (the `check-sheet` verb body only if HC-18 left it a stub), compose volume lines in `image/compose/**` only if the volume mount is missing (to confirm).
- **must-not-edit** R6; the workspace volume definition.
- **shared files edited** both launchers, `image/compose/**` (serial).
- **decisions** D-HC-03, D-CS-03 (missing staged sheet means the standard sheet is used and `sheet_standard: true` is recorded; a malformed sheet stops the start).
- **tests** the file lands only in the supervisor volume with mode 0600; a restart re-copies; a malformed staged file stops the start with a fixed message; no mount of the volume appears in the model's container spec.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run launcher packages/instinct/src/check-sheet`.
- **revert-checks** (1) mount the sheet volume in the workspace container: the "model container has no sheet mount" test fails. (2) skip the malformed stop: "malformed stops the start" fails.
- **worknote** `.../HC-26b.md`. **commit** `feat(launcher): copy the sheet into the supervisor volume at start (HC-26b)`. **split line** copy step first; compose edit second.

## HC-26c: supervisor reads the sheet; proof the model never sees it

- **id** HC-26c. **wave** W4. **repo** scriptorium. **depends-on** HC-26b, HC-19. **size** 35k. **branch** `scriptorium/hc-26c-sheet-read`.
- **coordination.** supervisor files: message the scriptorium orchestrator.
- **may-edit** `packages/supervisor/src/sheet-file.ts` (new, `readSheetFile(dir): { sheet: CharacterSheet; hash: string; standard: boolean }`; the hash is `node:crypto` SHA-256 of `canonicalSheetJson(sheet)`), `sheet-file.test.ts`, `packages/supervisor/src/child-env.test.ts` (new: the proof), `packages/supervisor/src/instinct-step.ts` (inject the `SheetSource`, one line).
- **must-not-edit** R6; anything that builds the prompt or the model environment (the test reads them; it does not change them).
- **shared files edited** `packages/supervisor/src/instinct-step.ts` (after HC-19).
- **tests (the proof)** build the full child environment, argument list, prompt, tool list, workspace tree and any file the model can read for a player with a non-standard sheet; assert that the canonical sheet JSON, the hash, every score as `"curiosity":` text, `sheet.json` and the sheet path appear **nowhere**; a missing file returns `standard: true`; a malformed file throws a typed error.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/supervisor/src/sheet-file packages/supervisor/src/child-env`.
- **revert-checks** (1) put the sheet path in the child environment: the proof test fails. (2) write the hash into `instinct.jsonl` and expose that directory to the workspace: the proof fails.
- **worknote** `.../HC-26c.md`. **commit** `feat(supervisor): read the sheet for the instinct step and prove the model never sees it (HC-26c)`. **split line** reader first; proof second.

## HC-33: promises and due wakes (question card)

- **id** HC-33. **wave** W4 (replaces the deferred AN-20). **repo** scriptorium. **depends-on** none. **Status** BlockedDecision (D-HC-06). **size** 15k, docs only.
- **deliver** one doc `docs/analysis/scriptorium/promises-question.md`: what the kit would need (a commitment store, a due timer, a wake reason), three options with their agent-visible consequences, and the owner questions. It adds no code and no agent text.
- **may-edit** that file and the worknote. **checks** `git diff --check`; `check:repo`. **commit** `docs(instinct): the question card for promises and due wakes (HC-33)`. No revert-check (docs only).

## HC-24: HW2 integration against a fake world, and wave close

- **id** HC-24. **wave** W4 (closes W3 and W4). **repo** scriptorium. **depends-on** HC-17a to HC-23b, HC-25, HC-26c merged on `scriptorium/hw2`. **size** 45k plus an ops run. **branch** `scriptorium/hc-24-hw2-integration`. **Replaces** AN-17 and AN-23.
- **may-edit** `packages/instinct/src/registry.ts` (new: `defaultRegistry: readonly Fx[]`), `packages/instinct/src/index.ts` (barrel), `packages/instinct/test/integration.test.ts` and `test/fake-world.ts` (new), the ADR `docs/decisions/<allocate via registry>-instinct-step.md` (D-CS-01, D-CS-05, D-CS-18 and the OD-C interim), docs under `docs/`, the worknote.
- **registry order (fixed).** `failureFx` (it handles `stuck` first), `noveltyFx`, `habitFx`, `idleFx`. Registered inactive: the whole step is off by default (D-HC-09); production sheet values unchanged (D-CS-10).
- **must-not-edit** R6; the cards' own files except to fix an integration bug, which becomes a worknote request, not an edit.
- **shared files edited** `registry.ts`, `index.ts` (they are HC-24's).
- **tests** against a fake world: an eligible idle wake settles with no model call (outcome `handled`, the supervisor skips the waking); a speech wake always reaches the model; a failure wake runs the insight check and, on failure, one variation; the cap escalates; a restart reopens the store and the attempts persist; `enabled:false` leaves the volume with no new file and the supervisor test unchanged; the sheet never appears in any fake-world output (reuse the HC-26c scan); every `act` has a matching `InstinctRecord` with `source: "instinct"` and `decision_ids`; with `rolls:false` the same fixtures settle on the deterministic rule and still record the seeded idle draws.
- **ops (serial, wave close):** disposable players on each harness with the step on: one idle settle, one failure variation, one escalation; read `instinct.jsonl`; confirm the model never received a sheet or a score; full `./scriptorium.ps1 check`; a fresh read-only review. Never turns the step on for a live player.
- **checks** `GATE-K`; `./scriptorium.ps1 pnpm vitest run packages/instinct`.
- **revert-checks** (1) reorder `habitFx` after `idleFx`: "habit wins over weighted pick" fails. (2) register a fx twice: "each fx runs once" fails. (3) default `enabled` to true: "off by default" fails.
- **worknote** `.../HC-24.md`. **commit** `feat(instinct): register the instinct step and prove it against a fake world (HC-24)`. **split line** registry and barrel first; the integration test second.

---

# Wave W5: evidence an observer can actually know (world; AN-24 to AN-28b)

Repo for every card in this wave: **geldar**. Contract owner: **AN-24 only** (serial slot). Evidence reaches the kit only through the player MCP events the agent already reads, so the kit changes nothing in W5; AN-28b's leakage test is the proof the player-facing channel carries only what a player can see.

Shapes created by AN-24 (the other W5 cards code against them in parallel):

```ts
// contract (schemas observation-event, provenance; validators validateObservationPayload, validateProvenance)
export interface ObservedActor { name: string /* ^[A-Za-z0-9_]{3,16}$ */; life: string /* LifeId */ }
export type ObservationPayload =
  | { kind: 'gift_received'; actor?: ObservedActor; item: string; count: number /* 1..2304 */; key: string /* ^[a-z0-9:_-]{8,96}$ */ }
  | { kind: 'property_broken'; actor?: ObservedActor; block: string; key: string };
export type Provenance =
  | { kind: 'break'; world: string; x: number; y: number; z: number; actor: string | null; prior_owner: string | null; block: string; tick: number }
  | { kind: 'pickup'; world: string; picker: string; thrower: string | null; item: string; count: number; age_ticks: number; distance: number | null; tick: number };
// HurtEvent (hurt-event.schema.json) gains optional `actor?: ObservedActor`; old payloads stay valid
// subjects.ts: provenanceBreakSubject(shard), provenancePickupSubject(shard), provenanceWildcard(shard) = geldar.<shard>.provenance.> (four tokens, outside the sink filter geldar.*.*)
// McpPlayerEvent.type gains 'gift_received' | 'property_broken'; optional actor {name}, item, count, block
// outcome-words.ts: observationSentence(input: { kind: unknown; item?: unknown; count?: unknown; block?: unknown }): string
// plugin (created by AN-27a, imported by AN-26a): interface ProvenanceSink { void send(String tail, String json); }   // tails: break, pickup, take, combat
// golem (created by AN-25): observedActor(bot: Bot, username: string | undefined): ObservedActor | null
```

## AN-24: observed-actor contract unblocker

- **OWNER APPROVAL REQUIRED** (OD-E): `observationSentence` is agent-visible text. It ships unused until AN-28a, and AN-28b's gate keeps it off.
- **id** AN-24. **wave** W5. **repo** geldar. **depends-on** AN-12 (W2 close; the candidate list said AN-23, but W4 is kit-side and no longer gates the world), owner ruling D-CS-06. **size** 40k. **branch** `phase1/an-24-observed-contract`. **Contract owner.**
- **trim.** No consumer in `golem/`, `plugin/`, `animus/` or `threshold/`.
- **may-edit** `contract/schemas/observation-event.schema.json` (new, title `ObservationPayload`), `provenance.schema.json` (new, title `Provenance`; reuse `WorldName`, `BlockCoordinateXZ/Y`, `OwnerId` from `block-owner.schema.json`), `hurt-event.schema.json`, `mcp-common.schema.json`, `contract/src/subjects.ts`, `contract/src/outcome-words.ts`, `contract/src/index.ts`, `contract/src/generated/**` (generate only), `contract/test/observation.test.ts` (new), `contract/test/mcp-play.test.ts` (extend its enum fixture only), `docs/decisions/<allocate via registry>-observed-evidence.md`.
- **must-not-edit** R6; `contract/schemas/event.schema.json`; any `$defs` named `*Input` or `*Result` (the generator turns pairs into MCP tools and throws on an unpaired one).
- **contract regeneration: yes, serial.** Shapes touched: `ObservationPayload`, `ObservedActor`, `Provenance`, `HurtEvent` (adds `actor`), `McpPlayerEvent` (adds two types and four optional fields); subject helpers; `observationSentence`. `contract/src/index.ts` is already about 535 lines (`sheet/RESUME.md` follow-up): put the new block in a new file `contract/src/observation.ts` and add only export lines to `index.ts`.
- **shared files edited** `contract/src/index.ts` (export lines), `contract/src/subjects.ts`, `contract/src/outcome-words.ts`, `mcp-common.schema.json`, `hurt-event.schema.json`, generated output.
- **decisions** D-CS-06. ADR `<allocate via registry>` (one record for all of W5, written here).
- **schema detail.** `ActorName` pattern `^[A-Za-z0-9_]{3,16}$`; `ObservedActor` `{name, life}` both required, `additionalProperties:false`; `GiftReceived` and `PropertyBroken` as in the shape above, `additionalProperties:false`; `BreakProvenance` and `PickupProvenance` as above (raw infrastructure, Body-only, never agent-facing). Text templates: `gift_received` gives `You received 3 bread.`; `property_broken` gives `Someone broke one of your blocks (oak planks).`; an unknown kind reads `Something happened.`; a name never enters the text.
- **tests** an attributed and an unattributed gift validate; a hurt payload with and without `actor` validates; a name with a space, a dot or 17 characters fails; a `life` not matching `LifeId` fails; an observation is not a valid `Provenance` and the reverse; the old `damage` and `hurt` fixtures (`contract/test/px-perception.test.ts`) still pass unchanged; `observationSentence` output passes `markedWords` for all inputs; subject helpers reject a dot or wildcard in the shard.
- **checks** `GATE-G` with `generate` and `check:generated`; `./geldar.ps1 pnpm test contract/test/observation contract/test/mcp-play contract/test/agent-visible-text`.
- **revert-checks** (1) remove the `ActorName` pattern: "name with a space fails" fails. (2) require `actor` on `GiftReceived`: "unattributed gift is valid" fails. (3) drop `actor` from `HurtEvent`: "hurt with actor" fails. (4) let `observationSentence` interpolate a name: the no-name test fails.
- **worknote** `docs/analysis/character-sheet/worknotes/AN-24.md`. **commit** `feat(character): observed-actor contract (observation, provenance, hurt actor)`. **split line** schemas and subjects first; `observationSentence` and the ADR second.

## AN-25: visible attacker identity

- **id** AN-25. **wave** W5. **repo** geldar. **depends-on** AN-24. **size** 40k. **branch** `phase1/an-25-visible-attacker`.
- **read first (verified in `geldar-b`).** `golem/src/perception/hurt-trigger.ts` already takes the attacker from the damage packet's cause entity, never from proximity. The snapshot has no attacker field, so the candidate's "event and snapshot paths" reduces to the event path.
- **may-edit** `golem/src/perception/provenance/visible-actor.ts` (new, `observedActor`), `golem/src/perception/hurt.ts`, `golem/src/perception/hurt-trigger.ts`, their tests, `visible-actor.test.ts` (new).
- **must-not-edit** R6; `golem/src/perception/visible-agent.ts`; `golem/src/adam/adam-body.ts`.
- **shared files edited** `hurt.ts`, `hurt-trigger.ts` (AN-25 owns them in W5). Registration is AN-28b's.
- **decisions** D-CS-06.
- **deliver** `observedActor(bot, username)` returns null when `username` is undefined, equals `bot.username`, fails the name pattern, or `findVisibleAgent(bot, username)` is null; else `{ name, life: lifeIdFor(username) }` (inject `lifeIdFor` as a parameter with a default if the registry import is heavy for a unit test, to confirm). `watchHurts(bot, reporter, tick, resolve?)` gains an optional fourth parameter; `attackerOf` also returns the cause entity's username when `type === 'player'`; `HurtInput.actor?`, `HurtEvent.actor?`, copied only when non-null; `hurtWorldEvent` puts it in the payload only when present. Never a nearest-player guess; a true cause without a visible identity stays anonymous; a mob never gets an `actor`.
- **tests** melee by a visible player; an arrow whose shooter is a visible player; a player out of sight or behind a wall (anonymous); a zombie with a nearby innocent player (no actor); fall, fire, starvation (none); two players, only the cause named; a reused display name on another entity; `resolve` omitted gives identical bytes to today.
- **checks** `GATE-G`; `./geldar.ps1 pnpm test golem/src/perception/hurt golem/src/perception/provenance`.
- **revert-checks** (1) skip `findVisibleAgent`: "hidden attacker stays anonymous" fails. (2) fall back to the nearest player: "innocent nearby player" fails. (3) always emit `actor`: "no resolver keeps the old payload" fails.
- **worknote** `.../AN-25.md`. **commit** `feat(character): name a visible player as the cause of a hurt`. **split line** `visible-actor.ts` first; the hurt edits second.

## AN-26a: pickup provenance in the plugin

- **id** AN-26a. **wave** W5. **repo** geldar (plugin, Java). **depends-on** AN-24; imports `ProvenanceSink` created by AN-27a (merge after it). **size** 40k. **branch** `phase1/an-26a-pickup-provenance`.
- **why a plugin card.** The client has no thrower on an item entity; Paper's `Item#getThrower()` (UUID) is the causal source (API and UUID-to-name mapping to confirm).
- **may-edit** `plugin/core/src/main/java/dev/geldar/core/blockowner/PickupProvenanceListener.java` (new), `plugin/core/src/test/java/dev/geldar/core/blockowner/PickupProvenanceListenerTest.java` (new, built like `OwnerOverlayTest` with `ListenerDoubles.java`).
- **must-not-edit** R6; `BlockOwnerSetup.java`, `NatsBlockOwnerLink.java`.
- **shared files edited** none. Registration and the `provenance.enabled` flag are AN-28b's.
- **deliver** `@EventHandler(priority = MONITOR, ignoreCancelled = true) void onPickup(EntityPickupItemEvent e)`: return unless the entity is a `Player` and `getThrower()` is non-null and differs from the picker. Build a `pickup` `Provenance` (`picker`, `thrower` name or null if unresolvable, `item` material key without namespace, `count` taken, `age_ticks` = `getTicksLived()`, `distance` horizontal blocks between thrower and picker when both online else null, `world`, `tick`) and call `ProvenanceSink.send("pickup", json)`. At most 64 messages per tick; drop and count beyond 1024 pending. No message for a death drop, a hopper or a mob.
- **tests** thrown by another player and picked up (one message, right fields); picked up by the thrower (none); no thrower; thrower offline; split stack (two messages, counts add to the stack); queue cap; null sink sends nothing.
- **checks** `GATE-G` plugin form: `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.PickupProvenanceListenerTest')`.
- **revert-checks** (1) drop `thrower != picker`: "thrower pickup sends nothing" fails. (2) send for a null thrower: "death drop sends nothing" fails. (3) remove the per-tick cap: the cap test fails. **ops:** a real two-player toss on a scratch shard; attach the captured payload to the worknote before AN-26b writes parser fixtures.
- **worknote** `.../AN-26a.md`. **commit** `feat(character): publish pickup provenance from the plugin`. **split line** none.

## AN-26b: observed gift in the recipient's Body

- **id** AN-26b. **wave** W5. **repo** geldar. **depends-on** AN-24, AN-25, AN-26a. **size** 40k. **branch** `phase1/an-26b-gift-observation`.
- **may-edit** `golem/src/perception/provenance/gift.ts` (new), `gift.test.ts` (new).
- **must-not-edit** R6; `golem/src/actions/give.ts` (the economic give is unchanged; this adds an observation beside it, never a second ledger).
- **shared files edited** none.
- **decisions** D-CS-06.
- **shape** `observeGift(msg: Provenance & { kind: 'pickup' }, ctx: { selfName: string; bot: Bot; seen: Set<string> }): ObservationPayload | null`.
- **rule (intended gift).** For the **picker only**: `age_ticks <= 100` (the give action waits 5 s, `PICKUP_WAIT_MS`), the thrower visible now through `observedActor` and within `GIVE_REACH + 3` blocks. A fresh, close pickup from an invisible thrower is a gift **without `actor`**. An old, far or unseen-thrower pickup is loot: null. Third-party observers get nothing in round one. Key `gift:<tick>:<thrower>:<item>:<count>:<ordinal>` lower-cased, ordinal per `(tick, thrower, item)`; a key already in `seen` (LRU 256) returns null; net zero items returns null.
- **tests** live giver and recipient plus a third-party control; partial pickup; merged stacks; toss timeout (age over 100); unrelated loot; invisible giver (anonymous, not dropped, not guessed); disconnect; the same message twice yields one row; a pickup by a non-observer yields null.
- **checks** `GATE-G`; `./geldar.ps1 pnpm test golem/src/perception/provenance/gift`.
- **revert-checks** (1) remove the `age_ticks` bound: "old drop is not a gift" fails. (2) skip `observedActor`: "hidden giver is anonymous" fails. (3) drop the `seen` check: "same message twice" fails. (4) emit for a non-picker: "third party gets nothing" fails.
- **worknote** `.../AN-26b.md`. **commit** `feat(character): recipient-side gift observation with visible-giver attribution`. **split line** none.

## AN-27a: break provenance in the plugin

- **id** AN-27a. **wave** W5. **repo** geldar (plugin). **depends-on** AN-24. **size** 40k. **branch** `phase1/an-27a-break-provenance`.
- **read first (verified).** `BlockChangeListener.java` handles `BlockBreakEvent` with `record(event.getBlock(), null)` and drops the breaker. The `changed` ownership message (`BlockOwnerChanged`, decision 0165) must not change (an old Body validates it with `additionalProperties:false`), so the breaker travels on a **new** subject.
- **may-edit** `plugin/.../blockowner/ProvenanceSink.java` (new), `NatsBlockOwnerLink.java` (implement `send`; only tails `break`, `pickup`, `take`, `combat` are accepted, anything else is dropped), `BlockChangeListener.java` (new constructor `(cache, publisher, enabled, ProvenanceSink sink, BooleanSupplier provenanceEnabled)`; the three-argument constructor stays and passes a null sink), `plugin/core/src/test/java/dev/geldar/core/blockowner/BlockChangeProvenanceTest.java` (new).
- **must-not-edit** R6; `BlockOwnerSetup.java`, `OwnerCache.java`, `BlockOwnerPublisher.java`.
- **shared files edited** `NatsBlockOwnerLink.java`, `BlockChangeListener.java` (AN-27a owns both this wave).
- **deliver** in `onBreak`, **before** the cache is updated, read the prior owner from the cache (no synchronous CoreProtect lookup on the server thread; a cache miss means null) and, when `sink != null && provenanceEnabled`, send a `break` `Provenance` (`actor` = the player name, `prior_owner`, `block` material key, `tick`). Player breaks only. The existing `record(block, null)` publish is untouched.
- **tests** an owned block broken by another player (prior owner present); an unowned block; a cache miss (null, no lookup); a cancelled break sends nothing; flag off or null sink sends nothing and the `changed` message is byte-identical to today; the old constructor still works; an unknown tail is dropped.
- **checks** `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.BlockChangeProvenanceTest')`; `./geldar.ps1 pnpm test contract/test/block-owner` (unchanged); `GATE-G`.
- **revert-checks** (1) send from `onPlace`: "placement sends no provenance" fails. (2) put `actor` in the `changed` JSON: "changed is byte-identical" fails. (3) accept any tail: "unknown tail dropped" fails. **ops:** capture a real payload with CoreProtect present and absent before AN-27b writes fixtures.
- **worknote** `.../AN-27a.md`. **commit** `feat(character): publish break provenance with the breaker on its own subject`. **split line** sink and link first; the listener second.

## AN-27b: observed property break in the owner's Body

- **id** AN-27b. **wave** W5. **repo** geldar. **depends-on** AN-24, AN-25, AN-27a. **size** 35k. **branch** `phase1/an-27b-break-observation`.
- **may-edit** `golem/src/perception/provenance/property-break.ts` (new), `property-break.test.ts` (new).
- **must-not-edit** R6; `golem/src/body/block-owners.ts`, `golem/src/actions/protected-blocks.ts` (no change to goto or mining permission decisions).
- **shared files edited** none.
- **shape** `observeBreak(msg: Provenance & { kind: 'break' }, ctx: { selfName: string; bot: Bot; seen: Set<string> }): ObservationPayload | null`.
- **rule (round one, the conservative reading of D-CS-06).** Deliver only when `prior_owner` equals the observer's own name **and** the block cell is visible now (within 24 blocks, clear line). The actor is named only when `observedActor` resolves them, else the observation is unattributed. Breaking your own block is null. Third-party witnesses, unowned blocks and a global change alone produce nothing. Key `brk:<tick>:<x>:<y>:<z>:<actor>`, LRU 256. Placement, replacement and cache invalidation never reach this function.
- **tests** visible actor and owned block (attributed); actor out of sight (unattributed, still delivered); block not visible (null); prior owner is someone else (null); unowned (null); self-break (null); nothing visible (null); the same message twice (one); missing CoreProtect (`prior_owner` null gives null); explosion (never a `BreakProvenance`).
- **checks** `GATE-G`; `./geldar.ps1 pnpm test golem/src/perception/provenance/property-break`.
- **revert-checks** (1) deliver when `prior_owner` is another life: "someone else's block teaches nothing" fails. (2) skip the visibility test: "block out of sight is null" fails. (3) name the actor without `observedActor`: "hidden breaker unattributed" fails.
- **worknote** `.../AN-27b.md`. **commit** `feat(character): owner-side observation of a broken owned block`. **split line** none.

## AN-28a: delivery path to the player log

- **OWNER APPROVAL REQUIRED** (OD-E): these handlers and presenters are the only place the observation sentences reach an agent. Ships **inactive**: nothing publishes `observation` events until AN-28b's `provenance.enabled` gate (default false) is turned on, and no wake interest maps to the new events.
- **id** AN-28a. **wave** W5. **repo** geldar (`threshold/`, and `animus/src/link` only under OD-D). **depends-on** AN-24, AN-25, and GX-04 **or** OD-D. **size** 45k (split line below). **branch** `phase1/an-28a-observation-delivery`.
- **why this touches `animus/`.** The MCP server imports `animus/src/link/mind-event.ts` (the normaliser and `MIND_EVENT_TYPES`). The in-house Mind is frozen, but the file is live shared code on the player path. If GX-04 has moved it to a neutral home, edit it there; if not, OD-D must grant a named exception covering exactly the three `animus/` files below.
- **may-edit** `animus/src/ports/body.ts` (add `| { type: 'observation'; payload: ObservationPayload }`), `animus/src/link/mind-event.ts` (`MIND_EVENT_TYPES` gains `'observation'`; `PAYLOAD_CHECKS.observation`), `animus/src/link/link.fixtures.ts`, `animus/src/link/observation-event.test.ts` (new) **or their GX-04 successors**; `threshold/mcp-mock/src/sim/wake.ts`, `threshold/mcp-mock/src/sim/events.ts`; `threshold/mcp/src/events/handlers/observation.ts` (new), `handlers/damage.ts`, `handlers/index.ts` (one appended line), `present-handlers/observation.ts` (new), `present-handlers/damage.ts`, `present-handlers/index.ts` (one appended line), `handlers/observation.test.ts` (new), `handler-registry.test.ts` (extend).
- **must-not-edit** R6; any Mind behaviour; `contract/` (AN-24 owns it).
- **shared files edited** `animus/src/link/mind-event.ts`, `animus/src/ports/body.ts`, `threshold/mcp/src/events/handlers/index.ts`, `present-handlers/index.ts` (AN-28a owns all four).
- **deliver** map `observation` to one `SimEvent` of kind `observation` with `text: observationSentence(...)`, `actor: payload.actor?.name` (re-checked against the name pattern and `markedWords`; a failing name is dropped and the event is kept unattributed); **never** `actor.life` and never `key`; the `damage` handler copies `actor.name` (same re-check); the presenter emits `{ type, text, actor?: {name}, item?, count?, block? }`. The new event type does **not** wake the agent. Never add `observation`, `roll`, `decision`, `sheet_adopted` or `chunk_visited` to the stream's sink-side lists beyond this one type.
- **tests** each kind maps and presents, attributed and unattributed; a name failing the pattern or containing a marker word is dropped; an old `damage` payload (no `actor`) maps to the same line and fields as before; an unknown observation kind is `invalid` in the normaliser (counted, not thrown); a structural test serialises the presented event and scans for `ag_` ids, `key`, `provenance` and coordinates.
- **checks** `GATE-G`; `./geldar.ps1 pnpm test threshold/mcp/src/events animus/src/link`.
- **revert-checks** (1) drop `observation` from `MIND_EVENT_TYPES`: "stream subject list includes observation" fails. (2) copy `life` into the presented event: the `ag_` scan fails. (3) skip the name re-check: "malicious name dropped" fails. (4) remove the damage `actor` copy: "damage carries the visible actor" fails.
- **worknote** `.../AN-28a.md`. **commit** `feat(character): deliver observation events and the hit actor to the player log`. **split line** the normaliser rows and fixtures first; the MCP handlers and presenters second.

## AN-28b: Body wiring, plugin setup, ACL and the leakage gate

- **id** AN-28b. **wave** W5. **repo** geldar (golem, plugin, `geldar.ps1`, tests). **depends-on** AN-25, AN-26b, AN-27b, AN-28a. **size** 50k plus serial ops evidence (split line below). **branch** `phase1/an-28b-observation-wiring-leakage`.
- **may-edit** `golem/src/perception/provenance/subscribe.ts` (new), `subscribe.test.ts` (new), `golem/src/adam/adam-body.ts` (one block), `golem/src/adam/adam-body.test.ts` (extend), `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java`, `plugin/core/src/test/java/dev/geldar/core/blockowner/ProvenanceSetupTest.java` (new), `geldar.ps1` (the `Get-NatsUsers` table only), `tools/repo-checks/src/nats-auth.test.ts`, `threshold/mcp/test/nats-auth.it.test.ts`, `threshold/mcp/src/events/leakage.test.ts` (new).
- **must-not-edit** R6; `compose/**`, `shards/*.yaml` (the sample off config is W1 and W2's).
- **shared files edited** `golem/src/adam/adam-body.ts` (about 293 lines; keep under 500), `geldar.ps1`, `BlockOwnerSetup.java`, the two nats-auth tests.
- **decisions** D-CS-06.
- **deliver** (1) `subscribe.ts` subscribes on the Body's own `OwnerTransport` connection to `provenanceBreakSubject` and `provenancePickupSubject`, validates with `validateProvenance`, drops invalid or oversize messages, calls `observeBreak` and `observeGift`, and publishes an `observation` WorldEvent (`source_event_id = eventIdFor('observation:' + lifeId + ':' + key)`, `agent_id` = the observer, a three-token subject) through `env.publisher`; `stop()` unsubscribes; with the gate off it does nothing. (2) `adam-body.ts`: when the gate is on pass `resolve = (u) => observedActor(bot, u)` to `watchHurts`, start the subscription, stop both in `stop()` and in the failed-start cleanup. (3) `BlockOwnerSetup.java`: pass the link as `ProvenanceSink` and a `provenance.enabled` supplier (`config.getBoolean("provenance.enabled", false)`, read in `reload`) to `BlockChangeListener` and register `PickupProvenanceListener`. Default **false**. (4) `geldar.ps1` `Get-NatsUsers`: `body.Sub` gains `geldar.$s.provenance.>`; `body.PubDeny` gains the same (a Body must not forge provenance); mirror in the two nats-auth tests with a "provenance routing" case. (5) **Leakage gate** `leakage.test.ts`: replay `threshold/mcp/test/fixtures/real-body-events.json` plus synthetic fixtures through the real filters over a fake bot with entities in and out of line of sight, then `mapMindEvent` and `presentEvents`; assert over the whole serialised output no `ag_` id, no `provenance`, no key, no coordinates in an `observation`, no `actor` where the Body fixture had a hidden actor, and no observation for third-party, unowned or self events.
- **tests** gate off: no subscription and `watchHurts` gets no resolver (bytes identical, asserted); a provenance message with a bad shape is dropped and counted; the leakage cases above including two that deliberately inject a leak and expect failure (proves the scan bites).
- **ops (serial, wave close).** One real hit, one real give and one real break reach an eligible observer in `wait` events; the hidden controls (out of sight, third party, unowned) do not; a Body connection cannot publish `geldar.<shard>.provenance.break`, and the Mind, eventsink and MCP roles cannot subscribe to `provenance.>` (real NATS roles); one observation read by two `wait` calls with the same cursor has one `seq`. Full `./geldar.ps1 check`, the focused real-client cases and the 20 TPS bench before W5 is done. The live `geldar-93` NATS conf is applied by hand (`sheet/RESUME.md`).
- **checks** `GATE-G`; `./geldar.ps1 pnpm test golem/src/perception/provenance tools/repo-checks/src/nats-auth threshold/mcp/src/events/leakage golem/src/adam`; `(cd plugin; ./gradlew :core:test)`.
- **revert-checks** (1) remove the `PubDeny` line for `provenance.>`: "a Body cannot publish provenance" fails. (2) run `subscribe.ts` with the gate off: "gate off starts nothing" fails. (3) make the fixture bot see through the wall: "hidden breaker has no actor" fails. (4) the two injected-leak cases fail when the `ag_` scan is removed.
- **worknote** `.../AN-28b.md`. **commit** `feat(character): wire observed evidence with a leakage gate`. **split line** if the plugin and ACL edits exceed the listed lines, split them into AN-28c (plugin setup, `geldar.ps1`, the two nats-auth tests) before dispatch; the Body subscription and leakage test stay here.

---

## Card count and coordination notes

22 cards: W3 five (HC-18, HC-19, HC-20, HC-21a, HC-21b); W4 nine (HC-22, HC-23a, HC-23b, HC-25, HC-26a, HC-26b, HC-26c, HC-33, HC-24); W5 eight (AN-24, AN-25, AN-26a, AN-26b, AN-27a, AN-27b, AN-28a, AN-28b). Cards marked OWNER APPROVAL REQUIRED: HC-23a, HC-25, AN-24, AN-28a (all ship inactive). Cards touching `contract/`: AN-24 only.
