# Sheet cards, waves W3 to W5: the instinct step (kit, retired here), kit change cards, and observed evidence (world)

Corrections 2026-11-18: re-verified against geldar `origin/main` = `a8063b0a` and the kit (`geldar-scriptorium`) `origin/scriptorium/hw0` = `673d756`, applying the global fixes G1 to G13 and the per-card mismatches of [sheet-cards-verification-2026-11-18.md](sheet-cards-verification-2026-11-18.md) and four operator rulings: (1) the kit repo's own `docs/analysis/harness/work-packets-kit-b.md` is the authority for HC-19 to HC-26c, so the in-repo copies of HC-18 to HC-26c are retired to stubs; (2) a new kit change card HC-46 adds positions and ids to the kit's observation (`observe.ts`); (3) the `psyche-v1.1.0` tag is approved, and HC-48 tags it and re-mirrors the kit before HC-42; (4) every card names the unruled item that blocks it. New kit change card HC-47 carries the OD-C correction to kit-b HC-20. AN-28b is split into AN-28b and AN-28c. Every change is listed in [worknotes/cards-w3-w12-corrections.md](worknotes/cards-w3-w12-corrections.md), section 2026-11-18. Corrections 2026-11-15 (API names, the proficiency source, numbers) are kept and listed in the same worknote.

Status: **proposal, nothing dispatched.** It continues [work-packets-geldar-a.md](work-packets-geldar-a.md) (W1, W2) and replaces, for these three waves only, the candidate sections AN-13 to AN-28 of [../character-sheet/work-packets.md](../character-sheet/work-packets.md). W5 refines the cards drafted in [work-packets-geldar-b.md](work-packets-geldar-b.md); where they differ, this file wins. Dispatch order: [sheet-next-wave-order.md](sheet-next-wave-order.md).

**Facts every card respects.**

- The in-house Mind (`animus/`) is **frozen** (D-HC-01). The player kit is the sibling repo `geldar-scriptorium`; the dispatch brief gives its absolute worktree path (no local path is written in this file). Every Mind-side card is a **kit card** (`HC-nn`, repo scriptorium); every W5 card is a **world card** (`AN-nn`, repo geldar). Each card says `repo`.
- Kit repo changes go through the **scriptorium orchestrator**: a geldar-side session never edits, branches, pushes or merges in the kit repo. The kit cards below are written for the scriptorium orchestrator to dispatch.
- `psyche/` (geldar) is a pure, zero-import package. Version on main: **1.1.0** (`psyche/RELEASE.json` tree `f243f7c233c78f77fcf051b95a38635d84fde318c9a81301fea998b0720182cf`, tag field `psyche-v1.1.0`, record landed in merge `4cff991d`, PR #458). Only tag `psyche-v1.0.0` exists. The kit mirror (`packages/psyche/engine/`, `MIRROR.json`) is pinned at `psyche-v1.0.0`, tree `b89848ab...`, and has no `threat.ts`. The kit's own entry is `packages/psyche/src/` (`check.ts`, `sheet.ts`, `index.ts`), package `@geldar/scriptorium-psyche`. **No card here edits `psyche/src/`.**
- **The sheet scores never reach any model context.** Agents are never told they are watched, scored or coached.
- **OWNER APPROVAL REQUIRED** marks a card that produces agent-visible text or changes what the agent is told about the world. Such a card **ships inactive**: the text or field is behind a switch that defaults off, and a test proves off adds nothing. Approval is a separate owner act.
- Numbers (G6, G7): on 2026-11-18 the decisions session drafted 0320 to 0328 (0320 kit-b authority, 0324 observation positions and ids, 0325 the `psyche-v1.1.0` tag, 0327 no births, drift or persona refresh, and others), so the wave-order note's old "AN-24 = 0320" proposal is void. AN-24 takes the next free number from the registry at dispatch; the orchestrator writes it into the brief. A card that writes a decision record also adds its one row to `docs/decisions/README.md` in numeric order (`check:repo` fails a record the index does not list). SQL: no card in this file needs a migration (0053 stays free).
- Contract regeneration is serial. Only **AN-24** touches `contract/` in this file (slot 1 in the wave-order note). `contract/src/index.ts` is **557 lines**: new code goes in a new file, `index.ts` gets named export lines only (G8).
- Plugin layout (verified): `NatsBlockOwnerLink.java`, `OwnerCache.java`, `BlockOwnerPublisher.java` and their tests (`OwnerOverlayTest` among them) are in `plugin/core-common/src/{main,test}/java/dev/geldar/core/blockowner/`. `BlockChangeListener.java` and `BlockOwnerSetup.java` are in `plugin/core/src/main/java/dev/geldar/core/blockowner/`. `ListenerDoubles.java` (`plugin/core/src/test/java/dev/geldar/core/`) and `EventSchemaCheck.java` (core-common testFixtures, `dev.geldar.core`) are **package-private** in `dev.geldar.core`: tests in the `blockowner` package cannot use them; they build their own `java.lang.reflect.Proxy` doubles as `NatsBlockOwnerLinkHookTest` does. Every class in the core jar (core-common classes included) is listed in `plugin/core/src/test/resources/jar-contents.golden`, checked by `:core:verifyJarContents` (part of `check`): a card that adds a plugin class adds its line there, sorted.
- Live Body-link code is in `player-core/` (GX-04 landed): `player-core/src/link/mind-event.ts` (110 lines), `player-core/src/ports/body.ts` (109), `player-core/src/link/link.fixtures.ts` (140). The `animus/src/link/mind-event.ts` and `animus/src/ports/body.ts` files are 2-line deprecated `export *` stubs: never edit them. OD-D is moot.

## Status words and the unruled items

Status words used on every card:

- **Code now**: no unruled item and no unmerged dependency stops writing it; merge in the depends-on order.
- **Code now, activation held: X**: it is written and merged inactive; X must be ruled before anything turns it on.
- **BlockedDecision: X**: it cannot be written until X is ruled.
- **BlockedDependency: Y**: it waits for card Y to merge.
- **Retired**: the in-repo copy is replaced by the kit repo's card; only the id stays here.

Unruled items (operator ruling 4). The OD sentence items are the wording items OD-A, OD-B and OD-E. OD-C is ruled for round one by operator ruling 1 (all levels 0, degraded; the sheet is never read for proficiency). OD-D is moot (GX-04 landed). The D-CS ids are from [../character-sheet/decisions-before-packets.md](../character-sheet/decisions-before-packets.md); their recommended answers are assumed in the code but not ruled.

| Item | What is unruled | Cards in this file it touches |
|---|---|---|
| OD-A | wording and delivery route of the temperament sentences | HC-25 (BlockedDecision) |
| OD-B | wording of the sanity veto messages | HC-23a (activation held) |
| OD-E | wording of the two observation sentences | AN-24, AN-28a (activation held) |
| D-CS-04 | XP matrix rows, crop list | none in W3 to W5 |
| D-CS-05 | `rolls:false` means deterministic d20 checks; weighted and think draws stay seeded and recorded | HC-20, HC-21a, HC-22, HC-23a, HC-24 (activation held) |
| D-CS-06 | attribution needs a visible causal actor; unknown stays unknown | AN-24 to AN-28c (activation held) |
| D-CS-14 | explore, farm and patrol boundaries | none in W3 to W5 |
| D-CS-15 | evidence sources for the missing domains | none in W3 to W5 |
| decision: observation fields (number assigned in the registry; drafted as 0324, "Accepted in principle") | the principle is accepted (positions and ids, only as facts the agent's own Body perceived); **unruled: the exact fields and wording the agent is told** (pending OD approval under that record) | HC-46b (BlockedDecision); HC-27b (W6) through it |

## Dependency table

| Card | Wave | Repo | Depends on | Status | Unruled item that blocks it |
|---|---|---|---|---|---|
| HC-18 instinct package | W3 | kit | HC-17a, HC-17b | **Done** (merged on hw0, `4ab4493`, per kit-b) | none |
| HC-19 supervisor runs the step | W3 | kit | HC-18, HC-04 | Retired (kit-b HC-19); Code now | none |
| HC-20 failure, insight, retry cap | W3 | kit | HC-18, **HC-47** | Retired (kit-b HC-20); BlockedDependency: HC-47 | activation held: D-CS-05 |
| HC-21a idle weighted pick | W3 | kit | HC-18 | Retired (kit-b HC-21a); Code now | activation held: D-CS-05 |
| HC-21b habits | W3 | kit | HC-21a, HC-20 | Retired (kit-b HC-21b); BlockedDependency: HC-20 | none |
| HC-22 novelty | W4 | kit | HC-18, **HC-46a**, HC-47 | Retired (kit-b HC-22); BlockedDependency: HC-46a, HC-47 | activation held: D-CS-05 |
| HC-23a sanity veto | W4 | kit | HC-10, HC-11 (merged on hw0), HC-17b | Retired (kit-b HC-23a); Code now | activation held: OD-B, D-CS-05 |
| HC-23b veto parameters on fd 4 | W4 | kit | HC-19, HC-23a, HC-26c | Retired (kit-b HC-23b); BlockedDependency: HC-19, HC-23a, HC-26c | none |
| HC-24 integration and wave close | W4 | kit | HC-17a to HC-23b | Retired (kit-b HC-24); BlockedDependency: all of them | activation held: D-CS-05 |
| HC-25 sheet to persona temperament | W4 | kit | HC-17b | Retired (kit-b HC-25) | **BlockedDecision: OD-A** |
| HC-26a host side of sheet delivery | W4 | kit | HC-25 | Retired (kit-b HC-26a); BlockedDependency: HC-25 | none of its own (OD-A through HC-25) |
| HC-26b sheet into the volume | W4 | kit | HC-26a, HC-18 | Retired (kit-b HC-26b); BlockedDependency: HC-26a | none |
| HC-26c sheet read and blindness proof | W4 | kit | HC-26b, HC-19 | Retired (kit-b HC-26c); BlockedDependency: HC-26b, HC-19 | none |
| HC-33 promises question card | W4 | kit | none | Code now (docs only) | none (D-HC-06 is the question it asks) |
| HC-46a observation: positions the world already sends | W4 | kit | HC-18 | Code now | none |
| HC-46b observation: agent positions and ids | W6 | kit | HC-46a, a geldar world card (unwritten) that adds the fields to the world output | BlockedDecision (and BlockedDependency on the world card) | **decision: observation fields**: the agent-visible fields and wording (OWNER APPROVAL REQUIRED) |
| HC-47 kit-b HC-20 and HC-22 proficiency correction (OD-C) | W3 | kit (docs) | none | Code now | none |
| HC-48 tag `psyche-v1.1.0`, re-mirror the kit at 1.1.0 | W4 | geldar (tag) then kit | none | Code now (ops; operator pushes the tag if the pusher lacks credentials) | none (tag approved, decision 0325) |
| AN-24 observed-actor contract | W5 | geldar | contract slot 1 | Code now | activation held: OD-E, D-CS-06 |
| AN-25 visible attacker identity | W5 | geldar | AN-24 | BlockedDependency: AN-24 | activation held: D-CS-06 |
| AN-26a pickup provenance (plugin) | W5 | geldar | AN-24, AN-27a | BlockedDependency: AN-27a | activation held: D-CS-06 |
| AN-26b recipient gift observation | W5 | geldar | AN-24, AN-25, AN-26a (and its ops payload) | BlockedDependency | activation held: D-CS-06 |
| AN-27a break provenance (plugin) | W5 | geldar | none to code; AN-24 for merge order | Code now | activation held: D-CS-06 |
| AN-27b owner-side break observation | W5 | geldar | AN-24, AN-25, AN-27a (and its ops payload) | BlockedDependency | activation held: D-CS-06 |
| AN-28a delivery path | W5 | geldar | AN-24, AN-25 | BlockedDependency: AN-24, AN-25 | activation held: OD-E, D-CS-06 |
| AN-28b Body subscription and leakage gate | W5 | geldar | AN-25, AN-26b, AN-27b, AN-28a | BlockedDependency (last but one) | activation held: D-CS-06 |
| AN-28c plugin setup and NATS ACL | W5 | geldar | AN-26a, AN-27a, AN-28b | BlockedDependency (last) | activation held: D-CS-06 |

Order inside the kit track: HC-47 and HC-46a first; then the kit-b cards in kit-b's fan-out order; HC-48 before any kit card that imports a psyche 1.1.0 export, and before HC-42 (in [work-packets-sheet-w9-w12.md](work-packets-sheet-w9-w12.md)). Under the drafted decision 0327 (no births this campaign) HC-42 and S10-02 are not dispatched and no psyche release after 1.1.0 is planned, so HC-48 is the campaign's only re-mirror.

## Shared files and who owns them (W5 and the kit change cards)

| Shared file | Owner | Everyone else |
|---|---|---|
| `contract/schemas/*`, `contract/src/index.ts`, `contract/src/subjects.ts`, `contract/src/generated/**` | AN-24 only | read only; regenerate serially (ask the geldar-3b contract slot holder) |
| `golem/src/perception/hurt.ts`, `hurt-trigger.ts` | AN-25 | read only |
| `golem/src/adam/adam-body.ts` (413 lines) | AN-28b only | AN-25 to AN-27b put "index line to add" in their worknote |
| `plugin/core/src/test/resources/jar-contents.golden` | AN-27a, then AN-26a (serial, one class line each) | nobody else in W5 |
| `plugin/core-common/.../blockowner/NatsBlockOwnerLink.java`, `plugin/core/.../blockowner/BlockChangeListener.java` | AN-27a | read only |
| `plugin/core/.../blockowner/BlockOwnerSetup.java` | AN-28c | read only |
| `geldar.ps1` (`Get-NatsUsers`), `tools/repo-checks/src/nats-auth.test.ts`, `threshold/mcp/test/nats-auth.it.test.ts` | AN-28c | nobody |
| `player-core/src/link/mind-event.ts`, `player-core/src/ports/body.ts`, `player-core/src/link/link.fixtures.ts`, `threshold/mcp/src/events/handlers/index.ts`, `threshold/mcp/src/events/present-handlers/index.ts` | AN-28a | nobody |
| kit `packages/instinct/src/observe.ts` | HC-46a, then HC-46b | kit-b cards read it |
| kit `packages/psyche/**` | HC-48 (re-mirror) | nobody |
| `docs/decisions/README.md` | the card that writes the record adds its own row; the rest is the orchestrator's | |
| ledger, RESUME, number registry | orchestrator, from "index line to add" | nobody |

## Rules common to every card

- **R1 size.** One Haiku-class coder, about 50k working tokens. The dispatch brief pastes the card, its shapes and these rules; never the whole file.
- **R2 worktree, branch, base (G1, G5).** World: the orchestrator creates the wave branch `phase1/sheet-w5` from `origin/main` before the first W5 dispatch and names it in the brief; packet branch `phase1/<id-lower>-<slug>` from it; worktree `.claude/worktrees/<id-lower>` in geldar. Kit: base `scriptorium/hw0` (or a wave branch the scriptorium orchestrator creates from it; `scriptorium/hw2` and `scriptorium/hw4` do not exist); packet branch `scriptorium/hc-<nn>-<slug>`; worktree `.claude/worktrees/hc-<nn>` in the kit. The brief gives the absolute worktree path. The coder never pushes, tags or opens a PR (HC-48's tag step is ops, not a coder step).
- **R3 worknote (G3, G4).** World: `docs/analysis/harness/worknotes/AN-<nn>.md` in geldar. Kit: `docs/analysis/harness/worknotes/HC-<nn>.md` in the kit. Shared-file needs go there as "index line to add". Write a stub first, then fill it.
- **R4 commit.** One subject as named on the card, plus the attribution lines the brief supplies verbatim.
- **R5 on-cap.** Commit what passes, record the base SHA, passing tests and unfinished steps in the worknote, leave a clean branch, stop. Never weaken a test or invent a design.
- **R6 must-not-edit baseline.** `docs/spec.md`, accepted ADRs, merged SQL, merged prompts, generated output by hand, other packets' worknotes, every `package.json` and lockfile the card does not name, any file not in may-edit, `animus/` (frozen; the stubs included). Never run `adam up`.
- **R7 gates.** World `GATE-G`, in this order: `git diff --check`; `./geldar.ps1 pnpm format`; `./geldar.ps1 pnpm lint`; `./geldar.ps1 pnpm --filter <package> typecheck` for each package the card touches (`@geldar/contract`, `@geldar/golem`, `@geldar/player-core`, `@geldar/mcp`, `@geldar/mcp-mock`, `@geldar/repo-checks`); the card's `./geldar.ps1 pnpm test <paths>`; `./geldar.ps1 pnpm check:repo`; `git merge-tree --write-tree phase1/sheet-w5 HEAD` prints a tree id and no conflict. Contract cards add `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated`. Plugin cards add the card's `(cd plugin; ./gradlew ...)` test lines, then `(cd plugin; ./gradlew :core:verifyJarContents)` and `(cd plugin; ./gradlew build)`. Kit `GATE-K` (G12): `git diff --check`; `./scriptorium.ps1 pnpm format`; `./scriptorium.ps1 pnpm lint`; `./scriptorium.ps1 pnpm typecheck`; the card's `./scriptorium.ps1 pnpm exec vitest run <files>`; `./scriptorium.ps1 pnpm check:repo`; docs cards add `./scriptorium.ps1 pnpm lint:md`; `git merge-tree --write-tree scriptorium/hw0 HEAD` shows no conflict. In a new kit worktree run `./scriptorium.ps1 setup` first. Real NATS, Postgres, plugin and real-client cases are **ops**, serial, never a coder gate.
- **R8 file caps.** Soft 500 lines, hard 700. No `utils.ts` or `helpers.ts`. New tests for `adam-body.ts` go in a new `golem/src/adam/adam-body-<topic>.test.ts`, never in the 624-line `adam-body.test.ts` (G9).
- **R9 pins.** No new dependency. No card here adds one.
- **R10 behaviour changes.** Every listed behaviour has a test that fails when the change is reverted. For each revert-check: make the named revert, run the card's test command, see the named test fail, restore, run again green. Name the failing test in the worknote.
- **R11 honesty.** No true score, sheet, alignment label, hash, `ag_` life id or provenance key in any agent-visible text, MCP output or model environment. Off (switch false, config absent) means the old code path, no draws, no files, no events.
- **R12 stop and report.** Stop, commit nothing further, and write the question in the worknote when: a named file, symbol, export or line is not where the card says; a compile fails on a named API; the generator names a validator differently; a test outside the card's list fails; or the card would need a file outside may-edit. Never guess a replacement.

---

# Waves W3 and W4: the kit (retired in this file; the authority is the kit repo)

The kit's `docs/analysis/harness/work-packets-kit-b.md` (on `scriptorium/hw0`) is the authoritative card text for HC-19 to HC-26c (operator ruling 1; drafted as decision 0320, which also records OD-C round one). The merged HC-18 follows it: package `@geldar/scriptorium-instinct`, `geldar-instinct run --run <n>`, `type Fx = (ctx: FxContext) => FxResult` in `decide.ts`, `InstinctResult` (`settle` / `pass-with-facts` / `pass`) in `contract.ts`, `InstinctState` in `state.ts`, `readConfig(env)` from `GELDAR_INSTINCT_*` in `run.ts`, `DEFAULT_FXS` in `run.ts`, `Observation` in `observe.ts`. The "common shapes" block that stood here (`types.ts`, `store.ts`, `step.ts`, `config.ts`, `InstinctStore`, `runStep`, `SnapshotView`) never existed and is removed.

Each stub keeps the id. The "re-verify on dispatch" lines are the mismatches the verification found that the scriptorium orchestrator checks in kit-b before dispatch; they are not edits for a geldar session to make.

## HC-18 (Done)

Merged on `scriptorium/hw0` (`4ab4493`) per kit-b. Nothing to dispatch.

## HC-19: Retired, see kit-b HC-19

- **Status** Retired; Code now (scriptorium orchestrator's go for `packages/supervisor/src/**`). Unruled item: none.
- **Re-verify on dispatch** kit-b's `execSelf`, `instinctEnv`, `last.json` and the eight `GELDAR_INSTINCT*` names in `image/compose/player.yml` against hw0; `GELDAR_INSTINCT` must not be enabled on a life until the world-side non-advancing read is wired kit-side (`packages/instinct/README.md`; GX-08 is merged in geldar, the kit does not use it yet).

## HC-20: Retired, see kit-b HC-20 (needs HC-47 first)

- **Status** Retired; BlockedDependency: HC-47. Activation held: D-CS-05.
- **Required change to kit-b HC-20 (OD-C, operator ruling 1).** Kit-b HC-20 step 4(e) reads the insight proficiency from `sheet.proficiency`. That is wrong: the kit's `Sheet` has no proficiency and `parseSheet` refuses the key. Round one passes proficiency **0** for every program and the run is degraded. The change is made in the kit repo by HC-47, through the scriptorium orchestrator; HC-20 is not dispatched before HC-47 merges.
- **Re-verify on dispatch** kit-b's retry cap `clamp(base + (cleverness - 3), 2, 6)` stands (kit-b is the authority; this file's old fixed cap 4 is dropped). Kit-b's travel and follow variations stay dropped (kit-b Open item 7) unless kit-b is amended after HC-46b.

## HC-21a: Retired, see kit-b HC-21a

- **Status** Retired; Code now. Activation held: D-CS-05.
- **Re-verify on dispatch** kit-b HC-21a's may-edit says `run.ts` reads `goals.md` into `ctx.goal`; merged `run.ts` sets `goal: obs.intent?.goal ?? null`. The kit orchestrator settles which source wins before dispatch.

## HC-21b: Retired, see kit-b HC-21b

- **Status** Retired; BlockedDependency: HC-20 (`last_intent`). Unruled item: none. `state.habits` (max 5 per goal) exists in `state.ts` as kit-b says.

## HC-22: Retired, see kit-b HC-22 (needs HC-46a and HC-47)

- **Status** Retired; BlockedDependency: HC-46a, HC-47. Activation held: D-CS-05.
- **Why HC-46a.** Kit-b HC-22 picks sightings with `distance !== null && distance <= R` from `entities` and `notable`. Merged `observe.ts` sets every notable distance to `null`, so notable blocks never qualify. HC-46a computes it from the positions the world already sends. **Why HC-47.** Kit-b HC-22 calls `proficiency('exploring')`; OD-C round one passes 0.

## HC-23a: Retired, see kit-b HC-23a

- **Status** Retired; Code now (HC-10 and HC-11 are merged on hw0; the loop is `packages/mind-loop/src/loop.ts`). OWNER APPROVAL REQUIRED for the veto text: activation held: OD-B, D-CS-05.
- **Re-verify on dispatch** kit-b ships a filled `VETO_TEXT`; OD-B is unruled, so the shipped switch must default off (`GELDAR_INSTINCT_SANITY` off) and a test must prove off adds nothing.

## HC-23b: Retired, see kit-b HC-23b

- **Status** Retired; BlockedDependency: HC-19, HC-23a, HC-26c. Unruled item: none.

## HC-24: Retired, see kit-b HC-24

- **Status** Retired; BlockedDependency: HC-17a to HC-23b. Activation held: D-CS-05.
- **Re-verify on dispatch** the fx registration point is `DEFAULT_FXS` in `run.ts` (the scriptorium orchestrator merges the HC-20, HC-21a and HC-22 lines by hand); the wave branch is the one the kit orchestrator names (no `scriptorium/hw2` exists).

## HC-25: Retired, see kit-b HC-25

- **Status** Retired; **BlockedDecision: OD-A** (temperament route and wording; kit-b's 36-sentence bank is unapproved). OWNER APPROVAL REQUIRED.

## HC-26a: Retired, see kit-b HC-26a

- **Status** Retired; BlockedDependency: HC-25 (kit-b gives HC-25 the `sheet` group in `launcher/test/parity.ts`). It is unblocked early only if the kit orchestrator moves that group registration into HC-26a. Unruled item: none of its own.
- **Re-verify on dispatch** message files are `launcher/messages.d/NN-<group>.tsv`; 50 to 61, 72, 73 and 90 are taken on hw0; kit-b names `62-persona-sheet.tsv` (HC-25) and `63-sheet.tsv` (HC-26a), both free.

## HC-26b: Retired, see kit-b HC-26b

- **Status** Retired; BlockedDependency: HC-26a. Unruled item: none. `check-sheet` is already a `cli.ts` verb on hw0; compose is `image/compose/player.yml`.

## HC-26c: Retired, see kit-b HC-26c

- **Status** Retired; BlockedDependency: HC-26b, HC-19. Unruled item: none. `run.ts` reads `<stateDir>/sheet.json` itself with `parseSheet` (type `Sheet`); kit-b's `readSheetFile` replaces that read.

## HC-33: promises and due wakes (question card)

- **id** HC-33. **wave** W4. **repo** scriptorium. **base** `scriptorium/hw0`. **branch** `scriptorium/hc-33-promises-question`. **worktree** `.claude/worktrees/hc-33`. **depends-on** none. **size** 15k, docs only. **Status** Code now. Unruled item: none (it writes the D-HC-06 question; it decides nothing).
- **may-edit** `docs/analysis/scriptorium/promises-question.md` (new), `docs/analysis/harness/worknotes/HC-33.md` (new). Nothing else.
- **deliver** one document, at most 120 lines, with four headings in this order: `## What the kit would need` (a commitment store, a due timer, a wake reason; one paragraph each), `## Options` (exactly three, each with its agent-visible consequence in one sentence), `## Owner questions` (numbered), `## Not in this document` (no code, no agent text). Plain ASCII.
- **checks** `git diff --check`; `./scriptorium.ps1 pnpm lint:md`; `./scriptorium.ps1 pnpm check:specs`; `./scriptorium.ps1 pnpm check:repo`.
- **exit** the file exists with the four headings; all checks pass. No revert-check (docs only).
- **stop and report** if `check:specs` refuses a new file under `docs/analysis/scriptorium/` (it may require an index entry): write the message in the worknote, do not edit any other file.
- **commit** `docs(instinct): the question card for promises and due wakes (HC-33)`.

---

# Kit change cards (new 2026-11-18; dispatched by the scriptorium orchestrator)

## HC-47: correct kit-b HC-20 and HC-22 to the OD-C round-one proficiency rule

- **id** HC-47. **wave** W3 (before HC-20 and HC-22). **repo** scriptorium (docs). **base** `scriptorium/hw0`. **branch** `scriptorium/hc-47-kitb-proficiency`. **worktree** `.claude/worktrees/hc-47`. **depends-on** none. **size** 10k. **Status** Code now. Unruled item: none (OD-C round one is ruled by operator ruling 1).
- **why** the kit's `Sheet` (`packages/psyche/src/sheet.ts`) has no proficiency and `parseSheet` refuses a `proficiency` key, so `sheet.proficiency` does not exist. OD-C round one: every level is 0 and the step is degraded; a supervisor-only feed from the world is a later card.
- **may-edit** `docs/analysis/harness/work-packets-kit-b.md` (the HC-20 and HC-22 sections only), `docs/analysis/harness/worknotes/HC-47.md` (new).
- **steps.**
  1. In kit-b HC-20, Behaviour 4(e), replace the text from `` `ctx.check('insight', cleverness, Math.max(8, 14 - attempts), proficiencyOf(program))` `` through `other programs 0).` with: `` `ctx.check('insight', cleverness, Math.max(8, 14 - attempts), 0)`. Round one has no proficiency source (OD-C): every level is 0 and the run is degraded. The kit `Sheet` has no proficiency (`parseSheet` refuses the key), so this card never reads `sheet.proficiency`; a supervisor-only feed from the world is a later card. ``
  2. In kit-b HC-20, Tests, append one test: `` `insight uses proficiency 0 for every program: the recorded bonus equals the score bonus` (revert: pass 1 for gather: the bonus differs, fails) ``.
  3. In kit-b HC-22, Behaviour 3, replace `` `ctx.check('novelty', curiosity, 11, proficiency('exploring'))` `` with `` `ctx.check('novelty', curiosity, 11, 0)` (OD-C round one, as HC-20) ``.
  4. Add a dated line under kit-b's title: `Corrected 2026-11-18 (HC-47): HC-20 and HC-22 pass proficiency 0 (OD-C round one); no card reads sheet.proficiency.`
- **checks** `git diff --check`; `./scriptorium.ps1 pnpm lint:md`; `./scriptorium.ps1 pnpm check:repo`; then `git grep -n "sheet.proficiency" -- docs/analysis/harness/work-packets-kit-b.md` prints only the new sentence of step 1.
- **exit** the four edits are in; no other line of kit-b changed (`git diff --stat` shows one file plus the worknote).
- **stop and report** if any quoted old text is not found verbatim (kit-b changed since hw0 `673d756`).
- **commit** `docs(harness): kit-b HC-20 and HC-22 pass proficiency 0 in round one (OD-C) (HC-47)`.

## HC-46a: the observation keeps the positions the world already sends

- **id** HC-46a. **wave** W4 (before HC-22). **repo** scriptorium. **base** `scriptorium/hw0`. **branch** `scriptorium/hc-46a-observe-positions`. **worktree** `.claude/worktrees/hc-46a`. **depends-on** HC-18 (merged). **size** 20k. **Status** Code now. Unruled item: none. **Ships inactive**: the instinct step is off by default (`GELDAR_INSTINCT=off`); no world change and no agent-visible text (the agent already receives every field read here).
- **facts** geldar's `PlaySurroundings` (`contract/schemas/mcp-common.schema.json`) gives `notable_blocks[]` as `{type, x, y, z, lit?}` (integers) or an `{unchanged, count}` fact, and `entities[]` as `SnapshotEntity` `{type, distance, direction, x, y, z, ...}`. Merged `observe.ts` drops the coordinates and sets every notable `distance` to `null`.
- **may-edit** `packages/instinct/src/observe.ts`, `packages/instinct/src/observe.test.ts`, `docs/analysis/harness/worknotes/HC-46a.md` (new).
- **must-not-edit** every other file (`decide.ts`, `run.ts`, other tests and fixtures).
- **steps.**
  1. In `Observation`, change `entities` to `{ kind: string; hostile: boolean; distance: number | null; pos?: { x: number; y: number; z: number } }[]` and `notable` to `{ kind: string; distance: number | null; pos?: { x: number; y: number; z: number } }[]`. `pos` is optional so existing fixtures still compile.
  2. Add `function posOf(v: Obj): { x: number; y: number; z: number } | undefined` returning the three numbers when all of `num(v.x)`, `num(v.y)`, `num(v.z)` are non-null, else `undefined`.
  3. `entitiesOf`: add `pos` when `posOf(e)` is defined (omit the key otherwise). `distance` stays the world's value.
  4. `notableOf(value, self: Observation['position'])`: add `pos` when defined; `distance` = `Math.hypot(pos.x - self.x, pos.y - self.y, pos.z - self.z)` when both `pos` and `self` are known, else `null`. Pass `positionOf(self.position)` from `parseObservation`. Replace the comment `Notable blocks carry no distance in the contract, so distance is always null here.` with `Notable blocks carry x, y, z; the distance is measured from the agent's own position, null when either is unknown.` An `{unchanged, count}` value still gives `[]` (unchanged behaviour).
  5. Update the header comment line `Not given by the world:` only if it names notable distance; touch nothing else.
- **tests** (in `observe.test.ts`, named): `notable distance is the straight-line distance from the agent's position` (self at 0,64,0, block at 3,64,4: distance 5); `notable has no distance when the agent's position is unknown`; `a notable block missing z has no pos and no distance`; `entity pos is copied from x, y, z and its distance is the world's`; `an unchanged notable fact still gives an empty list`. Every existing test in the file passes unchanged.
- **revert-checks** (1) set notable `distance: null` again: "notable distance is the straight-line distance" fails. (2) drop `pos` from `entitiesOf`: "entity pos is copied" fails.
- **checks** `GATE-K` with `./scriptorium.ps1 pnpm exec vitest run packages/instinct/src/observe.test.ts`, then `./scriptorium.ps1 pnpm exec vitest run packages/instinct` (all instinct tests green).
- **exit** five new tests green, both revert-checks seen failing, `typecheck` clean with no edit outside may-edit.
- **stop and report** if `typecheck` fails in any other file because of the type change.
- **commit** `feat(instinct): keep the block and entity positions the world sends (HC-46a)`.

## HC-46b: agent positions and ids in the observation (OWNER APPROVAL REQUIRED)

- **id** HC-46b. **wave** W6 (before HC-27b). **repo** scriptorium. **depends-on** HC-46a; a geldar world card (contract `PlaySurroundings.agents`, the Body's surroundings and the MCP presenter) that adds the approved fields to the world output; that card is not written in this file. **Status** **BlockedDecision: decision: observation fields (number assigned in the registry)**. The decisions session owns that record (drafted as 0324: positions and ids accepted in principle, only as facts the agent's own Body perceived; the exact agent-visible fields and wording pending OD approval). This card only points at it. **Ships inactive**: the new fields are optional in the parse; the instinct step stays off by default.
- **OWNER APPROVAL REQUIRED: what the agent is told about the world.** The instinct step reads the world through the same MCP `wait` the agent reads, so any field it needs is a field the agent is told. The owner approves the list in the decision record. Today (`mcp-common.schema.json`, `PlaySnapshot`): `world_time`; `self` (position, health, hunger, inventory with `edible`); `surroundings.blocks_summary`; `surroundings.notable_blocks[]` `{type, x, y, z, lit?}`; `surroundings.entities[]` `{type, distance, direction, x, y, z, item?, count?, hostile?, state?}`; `surroundings.agents[]` `{name, distance, held_item, health_estimate, vertical?, in_reach?}`; `current_plan`; the event lines; `untrusted_world_text`. Proposed additions for the approval: (a) `agents[].x, y, z` (a perceived agent's position); (b) a per-agent id. The drafted record says the id is the life id resolved from a visible agent's name; R11 and AN-28b's leakage scan bar `ag_` ids from agent-visible text today, so the approval must either allow that id in the world output or name another handle, and AN-28b's scan follows the approval. HC-27b (W6) needs both; kit-b HC-20's dropped travel and follow variations would need (a).
- **may-edit (after the ruling)** `packages/instinct/src/observe.ts`, `packages/instinct/src/observe.test.ts`, `docs/analysis/harness/worknotes/HC-46b.md`.
- **steps (after the ruling)** add the approved fields to `Observation['agents']` as optional keys, parsed like HC-46a's `pos` (absent or malformed means the key is omitted); nothing else.
- **tests** an agent with the approved fields parses them; an agent without them parses as today; a malformed field is dropped. **revert-check** drop the new parse: the first test fails.
- **commit** `feat(instinct): read the approved agent fields from the observation (HC-46b)`.

## HC-48: tag `psyche-v1.1.0`, then re-mirror the kit at 1.1.0

- **id** HC-48. **wave** W4 (before any kit card that imports a 1.1.0 export, and before HC-42). **repos** geldar (step 1, ops), then scriptorium (step 2, through the scriptorium orchestrator). **size** ops plus 15k. **Status** Code now: the tag is approved (operator ruling 3; drafted as decision 0325). Unruled item: none.
- **Step 1: the tag (geldar, ops).** Psyche has not changed since the 1.1.0 record merged.
  1. `git fetch origin --tags` and confirm `git diff --quiet 4cff991d1a4a4fac3ba509b023c3b8f5bb21580d origin/main -- psyche/` exits 0 and `git tag -l psyche-v1.1.0` prints nothing.
  2. In a worktree at that commit: `node tools/psyche-release/src/cli.ts --check` exits 0, and `psyche/RELEASE.json` shows `"version": "1.1.0"`, `"tag": "psyche-v1.1.0"`, tree `f243f7c233c78f77fcf051b95a38635d84fde318c9a81301fea998b0720182cf`.
  3. `git tag -a psyche-v1.1.0 4cff991d1a4a4fac3ba509b023c3b8f5bb21580d -m "psyche 1.1.0 (geldar-tree-v1 f243f7c233c78f77fcf051b95a38635d84fde318c9a81301fea998b0720182cf)"` (the same message form as `psyche-v1.0.0`).
  4. `git push origin psyche-v1.1.0`. **Operator step:** the push needs credentials with tag-push rights on the public repo. If the pushing session lacks them (or the push is refused), stop after step 3, report, and the operator runs step 4.
  5. Record the tag in `docs/analysis/harness/worknotes/GX-02.md` (the release history) as an "index line to add" for the orchestrator.
  If S10-02 is ever dispatched (0327 holds it inactive), this tag must exist before it bumps psyche to 1.2.0.
- **Step 2: the kit re-mirror (scriptorium; base `scriptorium/hw0`; branch `scriptorium/hc-48-psyche-remirror`; worktree `.claude/worktrees/hc-48`).**
  - **may-edit** `packages/psyche/scripts/vendor.ts` (the `RELEASE_TAG` constant only), `packages/psyche/MIRROR.json` (written by the script), `packages/psyche/engine/**` (written by the script), `packages/psyche/src/mirror.test.ts` (the pinned `RELEASE_TREE_HASH` constant on line 45 and the tag literal on line 212 only), `docs/analysis/harness/worknotes/HC-48.md`.
  - **must-not-edit** `packages/psyche/src/index.ts` (no new export: a card that needs `decideThreat`, `fightFloor` or `fightLimitMs` adds named exports itself), every other file.
  1. Set `RELEASE_TAG = 'psyche-v1.1.0'` in `vendor.ts`.
  2. Get the released source: `git -C <geldar checkout> worktree add --detach <temp dir> psyche-v1.1.0` (the brief gives both paths).
  3. `node packages/psyche/scripts/vendor.ts --source <temp dir>/psyche/src --commit 4cff991d1a4a4fac3ba509b023c3b8f5bb21580d`.
  4. Expect `MIRROR.json` `source_release_tag` `psyche-v1.1.0`, `tree_sha256` `f243f7c2...82cf`, and `threat.ts` in `files`; `engine/threat.ts` exists.
  5. Set `RELEASE_TREE_HASH` (line 45) to `f243f7c233c78f77fcf051b95a38635d84fde318c9a81301fea998b0720182cf` and the tag literal (line 212) to `psyche-v1.1.0` in `mirror.test.ts`.
  6. Remove the temporary geldar worktree (`git -C <geldar checkout> worktree remove <temp dir>`).
  - **checks** `GATE-K` with `./scriptorium.ps1 pnpm exec vitest run packages/psyche`.
  - **revert-check** change one byte of `engine/threat.ts`: the mirror hash test fails; restore.
  - **exit** psyche tests green; `git diff --stat` shows only the may-edit files.
  - **stop and report** if the vendor script refuses the source, if any kit test other than the two pinned literals fails (for example a purity or temperament scan over `threat.ts`), or if `check.test.ts`'s pinned runtime names change.
  - **commit** `chore(psyche): mirror psyche-v1.1.0 (HC-48)`.

---

# Wave W5: evidence an observer can actually know (world; AN-24 to AN-28c)

Repo for every card: **geldar**. Base: the wave branch `phase1/sheet-w5` (R2). Contract owner: **AN-24 only**. Evidence reaches the kit only through the player MCP events the agent already reads, so the kit changes nothing in W5.

Unruled items for this wave: **D-CS-06** (every card: activation held) and **OD-E** (AN-24, AN-28a: activation held). Nothing in W5 turns anything on: the plugin flag `provenance.enabled` defaults false (AN-28c) and the Body option `observations` defaults absent (AN-28b). D-CS-04, D-CS-05, D-CS-14 and D-CS-15 touch no W5 card.

Shapes created by AN-24 (the other W5 cards code against them):

```ts
// contract/schemas/observation-event.schema.json (title ObservationPayload) and provenance.schema.json (title Provenance)
export interface ObservedActor { name: string /* ActorName ^[A-Za-z0-9_]{3,16}$ */; life: string /* LifeId */ }
export type ObservationPayload =
  | { kind: 'gift_received'; actor?: ObservedActor; item: string; count: number /* 1..2304 */; key: string /* ^[a-z0-9:_-]{8,96}$ */ }
  | { kind: 'property_broken'; actor?: ObservedActor; block: string; key: string };
export type Provenance =
  | { kind: 'break'; world: string; x: number; y: number; z: number; actor: string | null; prior_owner: string | null; block: string; tick: number }
  | { kind: 'pickup'; world: string; picker: string; thrower: string | null; item: string; count: number; age_ticks: number; distance: number | null; tick: number };
// generated validators (contract/src/generated/validators.js, re-exported by name from index.ts):
//   validateObservationPayload, validateProvenance
// hurt-event.schema.json HurtEvent gains optional actor (ObservedActor); old payloads stay valid
// contract/src/subjects.ts: provenanceBreakSubject(shard) = geldar.<shard>.provenance.break,
//   provenancePickupSubject(shard) = geldar.<shard>.provenance.pickup, provenanceWildcard(shard) = geldar.<shard>.provenance.>
//   (four tokens, outside the sink filter geldar.*.*)
// mcp-common.schema.json McpPlayerEvent.type enum gains 'gift_received', 'property_broken'; optional actor {name}, item, count, block
// contract/src/observation.ts: observationSentence(input: { kind: unknown; item?: unknown; count?: unknown; block?: unknown }): string
// plugin (AN-27a, in core-common): public interface ProvenanceSink { void send(String tail, String json); }   // tails: break, pickup, take, combat
// golem (AN-25): observedActor(bot: Bot, username: string | undefined, lifeIdOf?: (u: string) => string): ObservedActor | null
```

## AN-24: observed-actor contract unblocker

- **OWNER APPROVAL REQUIRED** (OD-E): `observationSentence` is agent-visible text. It ships unused; only AN-28a calls it, and nothing publishes an observation until AN-28b and AN-28c are switched on.
- **id** AN-24. **wave** W5. **repo** geldar. **branch** `phase1/an-24-observed-contract`. **worktree** `.claude/worktrees/an-24`. **depends-on** contract regeneration slot 1 (ask the geldar-3b slot holder; AN-12 is merged). **size** 40k. **Status** Code now; activation held: OD-E, D-CS-06. **Contract owner.**
- **may-edit** `contract/schemas/observation-event.schema.json` (new), `contract/schemas/provenance.schema.json` (new), `contract/schemas/hurt-event.schema.json`, `contract/schemas/mcp-common.schema.json` (`McpPlayerEvent` only), `contract/src/subjects.ts`, `contract/src/observation.ts` (new), `contract/src/index.ts` (named export lines only), `contract/src/generated/**` (by `generate` only), `contract/test/observation.test.ts` (new), `contract/test/mcp-play.test.ts` (its event-type enum fixture only), `docs/decisions/<number>-observed-evidence.md` (new; the number the brief gives from the registry), `docs/decisions/README.md` (its one row), `docs/analysis/harness/worknotes/AN-24.md`.
- **must-not-edit** R6; `contract/schemas/event.schema.json`; `contract/src/outcome-words.ts`; any `$defs` named `*Input` or `*Result` (the generator pairs them into MCP tools and throws on an unpaired one).
- **steps.**
  1. `observation-event.schema.json`: `$id` `https://geldar.dev/schemas/observation-event.schema.json`, `title` `ObservationPayload`, root `oneOf` of `#/$defs/GiftReceived` and `#/$defs/PropertyBroken`. `$defs`: `ActorName` (string, pattern `^[A-Za-z0-9_]{3,16}$`); `ObservedActor` (object, required `name`, `life`, `additionalProperties: false`, `name` `$ref` `#/$defs/ActorName`, `life` `$ref` `common.schema.json#/$defs/LifeId`); `GiftReceived` (`kind` const `gift_received`, optional `actor` `ObservedActor`, `item` `common.schema.json#/$defs/ItemName`, `count` integer 1 to 2304, `key` pattern `^[a-z0-9:_-]{8,96}$`; required `kind`, `item`, `count`, `key`; `additionalProperties: false`); `PropertyBroken` (`kind` const `property_broken`, optional `actor`, `block` string pattern `^[a-z_]{1,64}$`, `key`; required `kind`, `block`, `key`; `additionalProperties: false`). Copy the file layout of `heard-sound-event.schema.json`.
  2. `provenance.schema.json`: `$id` `https://geldar.dev/schemas/provenance.schema.json`, `title` `Provenance`, root `oneOf` of `BreakProvenance` and `PickupProvenance` (fields as in the shapes block; `world` `block-owner.schema.json#/$defs/WorldName`, `x`/`z` `BlockCoordinateXZ`, `y` `BlockCoordinateY`, `actor` and `prior_owner` `anyOf` [`block-owner.schema.json#/$defs/OwnerId`, null], `thrower` `anyOf` [ActorName from `observation-event.schema.json`, null], `picker` ActorName, `count` integer 1 to 2304, `age_ticks` integer at least 0, `distance` `anyOf` [number at least 0, null], `tick` integer at least 0; all fields required; `additionalProperties: false`). Description: raw infrastructure, Body-only, never agent-facing.
  3. `hurt-event.schema.json`: `HurtEvent.properties.actor` = `$ref` `observation-event.schema.json#/$defs/ObservedActor`; not added to `required`.
  4. `mcp-common.schema.json` `McpPlayerEvent`: append `gift_received` and `property_broken` to the `type` enum; add optional `actor` (object, `{name: ActorName}`, `additionalProperties: false`), `item` (ItemName), `count` (integer 1 to 2304), `block` (string pattern `^[a-z_]{1,64}$`).
  5. `subjects.ts`: add `provenanceBreakSubject(shard)`, `provenancePickupSubject(shard)`, `provenanceWildcard(shard)`, each with the `SHARD.test` guard copied from `blockownerChangedSubject` (line 108) and a doc comment naming the four tokens.
  6. `contract/src/observation.ts`: `observationSentence(input)`: `gift_received` with an integer `count` 1 to 2304 and an `item` matching `^[a-z_]{1,64}$` gives `You received <count> <item with _ as space>.` (`You received 3 bread.`); `property_broken` with a valid `block` gives `Someone broke one of your blocks (<block with _ as space>).`; anything else gives `Something happened.`. It never reads an actor; a name never enters the text.
  7. `index.ts`: add only these lines, in the file's named-export style: `export { validateObservationPayload, validateProvenance } from './generated/validators.js';`, `export { observationSentence } from './observation.ts';`, `export { provenanceBreakSubject, provenancePickupSubject, provenanceWildcard } from './subjects.ts';` (or extend the existing `subjects.ts` export list if there is one), and the type exports `ObservationPayload`, `ObservedActor`, `Provenance` from `./generated/types.ts`.
  8. `./geldar.ps1 pnpm --filter @geldar/contract generate`; check `contract/src/generated/validators.d.ts` declares `validateObservationPayload` and `validateProvenance`.
  9. The decision record (Status **Proposed**; D-CS-06 and OD-E unruled): attribution only from a visible causal actor; provenance subjects outside the sink; the two sentences unapproved and unused. Add its README row.
- **tests** (`contract/test/observation.test.ts`, named): `an attributed and an unattributed gift validate`; `a hurt payload with and without actor validates`; `a name with a space, a dot or 17 characters fails`; `a life that is not a LifeId fails`; `an observation is not a Provenance and a Provenance is not an observation`; `observationSentence never contains a name and passes markedWords for every kind` (iterate kinds, items, counts; `markedWords` from `contract/src/agent-text.ts`); `subject helpers reject a dot or a wildcard in the shard`; `provenance subjects have four tokens`. `contract/test/px-perception.test.ts` (old `damage` and `hurt` fixtures) and `contract/test/agent-visible-text.test.ts` pass unchanged.
- **revert-checks** (1) remove the `ActorName` pattern: "a name with a space ... fails" fails. (2) add `actor` to `GiftReceived.required`: "an unattributed gift validates" fails. (3) drop `actor` from `HurtEvent`: "a hurt payload with actor validates" fails. (4) interpolate `input.actor` into the sentence: "never contains a name" fails.
- **checks** `GATE-G` with `generate` and `check:generated`; `./geldar.ps1 pnpm test contract/test/observation contract/test/mcp-play contract/test/agent-visible-text contract/test/px-perception`.
- **exit** all tests green; `check:generated` clean; `index.ts` grew by named export lines only and stays under 600 lines.
- **stop and report** if the generator names the validators differently, throws a duplicate export, or refuses a `$ref` across files.
- **commit** `feat(character): observed-actor contract (observation, provenance, hurt actor) (AN-24)`.

## AN-25: visible attacker identity

- **id** AN-25. **wave** W5. **repo** geldar. **branch** `phase1/an-25-visible-attacker`. **worktree** `.claude/worktrees/an-25`. **depends-on** AN-24 (types). **size** 40k. **Status** BlockedDependency: AN-24; activation held: D-CS-06.
- **facts (verified).** `golem/src/perception/hurt-trigger.ts`: `attackerOf(cause, selfId)` (line 32) takes the attacker from the damage packet's cause entity, never from proximity; `attackerNameOf` gives `player` for a player; `watchHurts(bot, reporter, tick)` (line 55) has three parameters; `hurtWorldEvent(hurt, ctx)` (line 106) builds the `damage` payload `{source, amount, bearing?}`. `golem/src/perception/hurt.ts`: `HurtEvent` (line 21), `HurtInput` (line 31), `hurtEvent(input)` (line 92). `lifeIdFor(username)` is `golem/src/registry.ts:51`. `findVisibleAgent(bot, name)` is `golem/src/perception/visible-agent.ts:112`.
- **may-edit** `golem/src/perception/provenance/visible-actor.ts` (new), `golem/src/perception/provenance/visible-actor.test.ts` (new), `golem/src/perception/hurt.ts`, `golem/src/perception/hurt-trigger.ts`, `golem/src/perception/hurt.test.ts`, `golem/src/perception/hurt-trigger.test.ts`, `docs/analysis/harness/worknotes/AN-25.md`.
- **must-not-edit** R6; `golem/src/perception/visible-agent.ts`; `golem/src/adam/adam-body.ts` (AN-28b passes the resolver).
- **steps.**
  1. `visible-actor.ts`: `export function observedActor(bot: Bot, username: string | undefined, lifeIdOf: (u: string) => string = lifeIdFor): ObservedActor | null`. Null when `username` is undefined, equals `bot.username`, fails `^[A-Za-z0-9_]{3,16}$`, or `findVisibleAgent(bot, username)` is null; else `{ name: username, life: lifeIdOf(username) }`.
  2. `hurt-trigger.ts`: add `function actorUsernameOf(cause: unknown, selfId: number | undefined): string | undefined` returning the cause entity's `username` when `type === 'player'` and the id is not the Body's. `watchHurts(bot, reporter, tick, resolve?: (username: string | undefined) => ObservedActor | null)`: when `resolve` is given, call it once per `entityHurt` on the Body with that username and keep the result in `pending`; pass it as `HurtInput.actor` only when non-null.
  3. `hurt.ts`: `HurtInput.actor?: ObservedActor`, `HurtEvent.actor?: ObservedActor`; `hurtEvent` copies it only when present.
  4. `hurtWorldEvent`: `if (hurt.actor !== undefined) payload.actor = hurt.actor;` and nothing else changes.
  5. A mob cause never yields an actor (`actorUsernameOf` returns undefined for non-players).
- **tests** (named): `melee by a visible player names the player`; `an arrow whose shooter is a visible player names the shooter`; `a player out of sight stays anonymous`; `a zombie hit with an innocent player nearby has no actor`; `fall, fire and starvation have no actor`; `two players nearby: only the cause is named`; `a display name used by another entity is not named`; `no resolver: the damage event bytes are identical to today` (compare `JSON.stringify` of `hurtWorldEvent` output with and without the change path).
- **revert-checks** (1) skip `findVisibleAgent`: "a player out of sight stays anonymous" fails. (2) fall back to the nearest player: "innocent player nearby" fails. (3) always set `actor`: "no resolver ... identical" fails.
- **checks** `GATE-G` (`@geldar/golem`); `./geldar.ps1 pnpm test golem/src/perception/hurt golem/src/perception/provenance`.
- **exit** all tests green; existing hurt tests unchanged and green.
- **stop and report** if importing `golem/src/registry.ts` in a unit test needs a live NATS (then the default parameter is replaced by a required one and the question goes in the worknote).
- **commit** `feat(character): name a visible player as the cause of a hurt (AN-25)`.

## AN-26a: pickup provenance in the plugin

- **id** AN-26a. **wave** W5. **repo** geldar (plugin, Java). **branch** `phase1/an-26a-pickup-provenance`. **worktree** `.claude/worktrees/an-26a`. **depends-on** AN-27a (creates `ProvenanceSink`; merge after it, and after AN-24 in merge order). **size** 40k. **Status** BlockedDependency: AN-27a; activation held: D-CS-06.
- **may-edit** `plugin/core/src/main/java/dev/geldar/core/blockowner/PickupProvenanceListener.java` (new), `plugin/core/src/test/java/dev/geldar/core/blockowner/PickupProvenanceListenerTest.java` (new), `plugin/core/src/test/resources/jar-contents.golden` (one line), `docs/analysis/harness/worknotes/AN-26a.md`.
- **must-not-edit** R6; `BlockOwnerSetup.java` (registration is AN-28c's), `NatsBlockOwnerLink.java`, `plugin/core/src/main/resources/config.yml` (its hash is in the golden).
- **steps.**
  1. `public final class PickupProvenanceListener implements Listener` with constructor `(ProvenanceSink sink, BooleanSupplier enabled, LongSupplier tick, Function<UUID, Player> online)`. No nested, inner or anonymous classes (lambdas are fine), so the jar gains exactly one class.
  2. `@EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void onPickup(EntityPickupItemEvent e)`: return when `sink == null`, `!enabled.getAsBoolean()`, the entity is not a `Player`, `e.getItem().getThrower()` is null, or the thrower UUID equals the picker's UUID.
  3. Thrower name: `online.apply(uuid)` gives a `Player` or null; name is `getName()` or null.
  4. `distance`: when the thrower is online and in the same world, `Math.hypot(dx, dz)` between the two players' locations; else null.
  5. `static String pickupJson(String world, String picker, String thrower, String item, int count, int ageTicks, Double distance, long tick)` builds the JSON with Gson `JsonObject` (keys exactly `kind` = `pickup`, `world`, `picker`, `thrower`, `item`, `count`, `age_ticks`, `distance`, `tick`; nulls written as JSON null). `item` is `stack.getType().getKey().getKey()` (no namespace); `count` is `e.getItem().getItemStack().getAmount() - e.getRemaining()`; `age_ticks` is `e.getItem().getTicksLived()`.
  6. Per-tick cap: at most 64 sends per value of `tick`; beyond that drop and increment a counter read by package-private `long dropped()`.
  7. Call `sink.send("pickup", json)`.
  8. Add `dev/geldar/core/blockowner/PickupProvenanceListener.class` to `jar-contents.golden` in sorted position.
- **tests** (JUnit, Proxy doubles for `Player`, `Item`, `World` built in the test class as `NatsBlockOwnerLinkHookTest` builds its `Connection`; the event built with `new EntityPickupItemEvent(entity, item, remaining)` as `plugin/ledger/src/test/java/dev/geldar/ledger/paper/curated/BlocksItemsFamilyTest.java` does): `thrown by another player and picked up sends one message with the right fields`; `picked up by the thrower sends nothing`; `no thrower (a death drop or a mob drop) sends nothing`; `thrower offline sends thrower null and distance null`; `a partial pickup sends the count taken`; `the 65th pickup in one tick is dropped and counted`; `flag off or null sink sends nothing`; `pickupJson writes exactly the nine keys`.
- **revert-checks** (1) drop the thrower-equals-picker check: "picked up by the thrower sends nothing" fails. (2) send for a null thrower: "no thrower ... sends nothing" fails. (3) remove the per-tick cap: "the 65th pickup ... is dropped" fails.
- **checks** `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.PickupProvenanceListenerTest')`; `(cd plugin; ./gradlew :core:verifyJarContents)`; `(cd plugin; ./gradlew build)`; `git diff --check`; `./geldar.ps1 pnpm check:repo`.
- **exit** tests green; `verifyJarContents` passes with the one added line.
- **stop and report** if `Item#getThrower()`, `Material#getKey()` or the `EntityPickupItemEvent` constructor does not compile against the pinned Paper API (`plugin/gradle/libs.versions.toml`, `paper = "26.1.2.build.74-stable"`), or if an `ItemStack` cannot be built in a unit test (then name the call that fails).
- **ops (serial, scratch shard, after merge to the wave branch)** one real two-player toss with `provenance.enabled` set by hand on the scratch shard only; the captured `pickup` JSON goes into `docs/analysis/harness/worknotes/AN-26a.md` before AN-26b writes its fixtures.
- **commit** `feat(character): publish pickup provenance from the plugin (AN-26a)`.

## AN-26b: observed gift in the recipient's Body

- **id** AN-26b. **wave** W5. **repo** geldar. **branch** `phase1/an-26b-gift-observation`. **worktree** `.claude/worktrees/an-26b`. **depends-on** AN-24, AN-25, AN-26a and its captured payload. **size** 40k. **Status** BlockedDependency; activation held: D-CS-06.
- **facts** `PICKUP_WAIT_MS = 5_000` (`golem/src/actions/give.ts:64`), `GIVE_REACH = 3` (`give.ts:26`).
- **may-edit** `golem/src/perception/provenance/gift.ts` (new), `golem/src/perception/provenance/gift.test.ts` (new), `golem/src/perception/provenance/fixtures/pickup-real.json` (new; the AN-26a capture, copied verbatim), `docs/analysis/harness/worknotes/AN-26b.md`.
- **must-not-edit** R6; `golem/src/actions/give.ts`.
- **shape** `observeGift(msg: Provenance & { kind: 'pickup' }, ctx: { selfName: string; bot: Bot; seen: Set<string>; resolve: (u: string | undefined) => ObservedActor | null }): ObservationPayload | null`. `seen` is an insertion-ordered set the caller keeps at 256 entries (drop the oldest).
- **rule.** Null unless `msg.picker === ctx.selfName`. Null when `msg.age_ticks > 100` (5 s at 20 TPS, `PICKUP_WAIT_MS`) or `msg.count < 1`. Actor: `ctx.resolve(msg.thrower ?? undefined)`; when it is non-null and `msg.distance !== null && msg.distance <= GIVE_REACH + 3`, the gift is attributed; when the thrower is not resolved, the gift is unattributed (no `actor`); when the actor resolves but the distance is null or over `GIVE_REACH + 3`, null (loot). Key: `gift:<tick>:<thrower or none>:<item>:<count>:<ordinal>` lower-cased, ordinal counting messages with the same `(tick, thrower, item)` from 0; a key already in `seen` gives null; else add it.
- **tests** (named): `a visible giver within reach gives an attributed gift`; `an invisible giver gives an unattributed gift`; `a third party's pickup gives nothing`; `an old drop (age over 100) is not a gift`; `a far visible thrower is loot`; `the same message twice gives one observation`; `two equal tosses in one tick get ordinals 0 and 1`; `the captured real payload validates with validateProvenance and maps`.
- **revert-checks** (1) remove the `age_ticks` bound: "an old drop is not a gift" fails. (2) name the thrower without `resolve`: "an invisible giver gives an unattributed gift" fails. (3) drop the `seen` check: "the same message twice" fails. (4) skip the picker check: "a third party's pickup" fails.
- **checks** `GATE-G` (`@geldar/golem`); `./geldar.ps1 pnpm test golem/src/perception/provenance/gift`.
- **exit** tests green; the real fixture validates.
- **stop and report** if the AN-26a capture is missing from its worknote or does not validate.
- **commit** `feat(character): recipient-side gift observation with visible-giver attribution (AN-26b)`.

## AN-27a: break provenance in the plugin

- **id** AN-27a. **wave** W5. **repo** geldar (plugin). **branch** `phase1/an-27a-break-provenance`. **worktree** `.claude/worktrees/an-27a`. **depends-on** none to code (Java does not import the contract); merges after AN-24. **size** 40k. **Status** Code now; activation held: D-CS-06.
- **facts (verified).** `BlockChangeListener.onBreak` calls `record(event.getBlock(), null)` and drops the breaker. The `changed` message (`BlockOwnerChanged`, decision 0165) must not change. `OwnerCache` has no single-block lookup: `freshBase(ChunkKey)` returns `Optional<Owners>` and `withChanges(key, base)` overlays recent changes; `Owners.blocks()` holds `OwnedBlock(x, y, z, owner, block)`.
- **may-edit** `plugin/core-common/src/main/java/dev/geldar/core/blockowner/ProvenanceSink.java` (new), `plugin/core-common/src/main/java/dev/geldar/core/blockowner/NatsBlockOwnerLink.java`, `plugin/core-common/src/test/java/dev/geldar/core/blockowner/NatsBlockOwnerLinkProvenanceTest.java` (new), `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockChangeListener.java`, `plugin/core/src/test/java/dev/geldar/core/blockowner/BlockChangeProvenanceTest.java` (new), `plugin/core/src/test/resources/jar-contents.golden` (one line), `docs/analysis/harness/worknotes/AN-27a.md`.
- **must-not-edit** R6; `BlockOwnerSetup.java`, `OwnerCache.java`, `BlockOwnerPublisher.java`, `config.yml`.
- **steps.**
  1. `ProvenanceSink.java`: `public interface ProvenanceSink { void send(String tail, String json); }` in `dev.geldar.core.blockowner` (core-common, because the link implements it and core depends on core-common).
  2. `NatsBlockOwnerLink implements ... , ProvenanceSink`: `send(tail, json)` publishes on `"geldar." + shard + ".provenance." + tail` through the existing private `publish` only when `tail` is one of `break`, `pickup`, `take`, `combat`; any other tail is dropped silently. Add `static String provenanceSubject(String shard, String tail)` beside `changedSubject` (line 108).
  3. `BlockChangeListener`: add fields `ProvenanceSink sink`, `BooleanSupplier provenanceEnabled`, `LongSupplier tick`; new constructor `(OwnerCache cache, BlockOwnerPublisher publisher, BooleanSupplier enabled, ProvenanceSink sink, BooleanSupplier provenanceEnabled, LongSupplier tick)`; the existing three-argument constructor delegates with `null, () -> false, () -> 0L`.
  4. `onBreak`: **before** `record(...)`, when `enabled`, `sink != null` and `provenanceEnabled` are all true: `prior = priorOwner(cache, pos)` where `static String priorOwner(OwnerCache cache, Pos pos)` = `freshBase(chunkOf(pos))`, mapped through `withChanges`, the `owner` of the `OwnedBlock` at `pos.x, pos.y, pos.z`, else null (no CoreProtect lookup on the server thread). Build with Gson `{"kind":"break","world","x","y","z","actor":<player name>,"prior_owner":<prior or null>,"block":<material key without namespace>,"tick":<tick>}` and `sink.send("break", json)`. Then the unchanged `record(event.getBlock(), null)`.
  5. Add `dev/geldar/core/blockowner/ProvenanceSink.class` to `jar-contents.golden` in sorted position.
- **tests.** `NatsBlockOwnerLinkProvenanceTest` (Proxy `Connection` recording `publish(subject, bytes)`, pattern from `plugin/core/src/test/java/dev/geldar/core/blockowner/NatsBlockOwnerLinkHookTest.java`; use the package-private `attach(Connection)`): `send break publishes on geldar.<shard>.provenance.break`; `an unknown tail is dropped`. `BlockChangeProvenanceTest` (Proxy doubles for `Block`, `World`, `Player`; a real `OwnerCache` with a fixed clock and `storeBase`): `an owned block broken by another player sends the prior owner`; `an unowned block sends prior_owner null`; `a cache miss sends prior_owner null`; `flag off or null sink sends nothing and the changed publish is unchanged`; `placement sends no provenance`; `the three-argument constructor still records the change`.
- **revert-checks** (1) send from `onPlace`: "placement sends no provenance" fails. (2) accept any tail: "an unknown tail is dropped" fails. (3) read the prior owner after `record`: "an owned block broken ... sends the prior owner" fails (the cache then holds null).
- **checks** `(cd plugin; ./gradlew :core-common:test --tests 'dev.geldar.core.blockowner.NatsBlockOwnerLinkProvenanceTest')`; `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.BlockChangeProvenanceTest')`; `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.*')` (existing link tests unchanged); `(cd plugin; ./gradlew :core:verifyJarContents)`; `(cd plugin; ./gradlew build)`; `./geldar.ps1 pnpm test contract/test/block-owner` (unchanged); `git diff --check`; `./geldar.ps1 pnpm check:repo`.
- **exit** all green; the `changed` JSON for a break is byte-identical to before (asserted in the flag-off test).
- **stop and report** if a `Block` or `BlockBreakEvent` cannot be doubled without a server, or `Material#getKey()` does not compile.
- **ops (serial, scratch shard, after merge)** capture one real `break` payload with CoreProtect present and one with it absent; put both in `docs/analysis/harness/worknotes/AN-27a.md` before AN-27b writes fixtures.
- **commit** `feat(character): publish break provenance with the breaker on its own subject (AN-27a)`.

## AN-27b: observed property break in the owner's Body

- **id** AN-27b. **wave** W5. **repo** geldar. **branch** `phase1/an-27b-break-observation`. **worktree** `.claude/worktrees/an-27b`. **depends-on** AN-24, AN-25, AN-27a and its captured payloads. **size** 35k. **Status** BlockedDependency; activation held: D-CS-06.
- **may-edit** `golem/src/perception/provenance/property-break.ts` (new), `golem/src/perception/provenance/property-break.test.ts` (new), `golem/src/perception/provenance/fixtures/break-real.json` (new; the AN-27a captures verbatim), `docs/analysis/harness/worknotes/AN-27b.md`.
- **must-not-edit** R6; `golem/src/body/block-owners.ts`, `golem/src/actions/protected-blocks.ts`.
- **shape** `observeBreak(msg: Provenance & { kind: 'break' }, ctx: { selfName: string; bot: Bot; seen: Set<string>; resolve: (u: string | undefined) => ObservedActor | null; canSee: (x: number, y: number, z: number) => boolean }): ObservationPayload | null`. `canSee` is injected (this card never calls the real one); AN-28b builds it from `canSeeBlock(bot: Bot, block: Block): boolean` (`golem/src/perception/notable-blocks.ts:72`).
- **rule.** Null unless `msg.prior_owner === ctx.selfName` and `msg.actor !== ctx.selfName`. Null unless the bot is within 24 blocks of the cell (`bot.entity.position` distance) and `ctx.canSee(x, y, z)`. Actor: `ctx.resolve(msg.actor ?? undefined)`; non-null gives `actor`, null gives an unattributed observation. Key `brk:<tick>:<x>:<y>:<z>:<actor or none>` lower-cased; `seen` handled as AN-26b.
- **tests** (named): `a visible breaker of an owned block is named`; `a breaker out of sight gives an unattributed observation`; `a block out of sight gives nothing`; `someone else's block gives nothing`; `an unowned block gives nothing`; `breaking your own block gives nothing`; `the same message twice gives one`; `prior_owner null (CoreProtect missing) gives nothing`; `the captured real payloads validate with validateProvenance`.
- **revert-checks** (1) deliver when `prior_owner` is another name: "someone else's block" fails. (2) skip `canSee`: "a block out of sight" fails. (3) name the actor without `resolve`: "a breaker out of sight" fails.
- **checks** `GATE-G` (`@geldar/golem`); `./geldar.ps1 pnpm test golem/src/perception/provenance/property-break`.
- **exit** tests green; real fixtures validate.
- **stop and report** if the AN-27a captures are missing.
- **commit** `feat(character): owner-side observation of a broken owned block (AN-27b)`.

## AN-28a: delivery path to the player log

- **OWNER APPROVAL REQUIRED** (OD-E): these handlers and presenters are the only place the observation sentences reach an agent. Ships **inactive**: nothing publishes an `observation` event until AN-28b and AN-28c are switched on, and no wake maps to the new event.
- **id** AN-28a. **wave** W5. **repo** geldar (`player-core/`, `threshold/`). **branch** `phase1/an-28a-observation-delivery`. **worktree** `.claude/worktrees/an-28a`. **depends-on** AN-24, AN-25. **size** 45k (split line below). **Status** BlockedDependency: AN-24, AN-25; activation held: OD-E, D-CS-06.
- **facts.** `MIND_EVENT_TYPES` and the private `PAYLOAD_CHECKS` are in `player-core/src/link/mind-event.ts` (lines 21, 67); the `MindEvent` union is in `player-core/src/ports/body.ts` (lines 78 to 88). `mapMindEvent` is `threshold/mcp/src/events/mapper.ts:17`; `presentEvents` is `threshold/mcp/src/events/present-handlers/index.ts:44`; `handler-registry.test.ts` is in `threshold/mcp/src/events/`. The `animus/` files are stubs: never edit them.
- **may-edit** `player-core/src/ports/body.ts` (one union member `| { type: 'observation'; payload: ObservationPayload }`), `player-core/src/link/mind-event.ts` (`'observation'` appended to `MIND_EVENT_TYPES`; `PAYLOAD_CHECKS.observation` calls `validateObservationPayload`), `player-core/src/link/link.fixtures.ts` (one observation fixture per kind), `player-core/src/link/observation-event.test.ts` (new); `threshold/mcp-mock/src/sim/wake.ts`, `threshold/mcp-mock/src/sim/events.ts` (only what the type union forces); `threshold/mcp/src/events/handlers/observation.ts` (new), `threshold/mcp/src/events/handlers/damage.ts`, `threshold/mcp/src/events/handlers/index.ts` (one appended line), `threshold/mcp/src/events/handlers/observation.test.ts` (new), `threshold/mcp/src/events/present-handlers/observation.ts` (new), `threshold/mcp/src/events/present-handlers/damage.ts`, `threshold/mcp/src/events/present-handlers/index.ts` (one appended line), `threshold/mcp/src/events/handler-registry.test.ts` (extend), `docs/analysis/harness/worknotes/AN-28a.md`.
- **must-not-edit** R6; `animus/**`; `contract/**`; any wake list.
- **steps.**
  1. The normaliser rows and fixtures (body.ts, mind-event.ts, link.fixtures.ts, observation-event.test.ts).
  2. `handlers/observation.ts`: map `observation` to one `SimEvent` of kind `observation` with `text: observationSentence(payload)` and `actor: payload.actor?.name` only when the name matches `^[A-Za-z0-9_]{3,16}$` and `markedWords` finds nothing in it (else the event is kept without `actor`); never `actor.life`, never `key`.
  3. `handlers/damage.ts`: copy `payload.actor.name` with the same re-check.
  4. `present-handlers/observation.ts`: emit `{ type, text, actor?: { name }, item?, count?, block? }`; `present-handlers/damage.ts` adds `actor?: { name }`.
  5. The two `index.ts` lines. The new type wakes nothing.
- **tests** (named): `each observation kind maps and presents, attributed and unattributed`; `a name failing the pattern or holding a marked word is dropped and the event kept`; `an old damage payload without actor maps and presents exactly as before`; `an unknown observation kind is invalid in the normaliser (counted, not thrown)`; `the presented event serialised holds no ag_ id, no key, no provenance and no coordinates`; `observation is in MIND_EVENT_TYPES`.
- **revert-checks** (1) drop `observation` from `MIND_EVENT_TYPES`: "observation is in MIND_EVENT_TYPES" fails. (2) copy `actor.life` into the presented event: the `ag_` scan fails. (3) skip the name re-check: "a name failing the pattern ... is dropped" fails. (4) remove the damage `actor` copy: the attributed damage case fails.
- **checks** `GATE-G` (`@geldar/player-core`, `@geldar/mcp`, `@geldar/mcp-mock`); `./geldar.ps1 pnpm test threshold/mcp/src/events player-core/src/link threshold/mcp-mock/src/sim`.
- **exit** all green; the existing `real-body.test.ts` and `present*.test.ts` in `threshold/mcp/src/events/` pass unchanged.
- **split line** step 1 is one commit; steps 2 to 5 a second. If the first report shows more than 30k used, dispatch steps 2 to 5 as a second session on the same branch.
- **stop and report** if `mcp-mock` needs more than the type-forced edits, or a wake list would have to change.
- **commit** `feat(character): deliver observation events and the hit actor to the player log (AN-28a)`.

## AN-28b: Body subscription and the leakage gate

- **id** AN-28b. **wave** W5. **repo** geldar (golem, threshold tests). **branch** `phase1/an-28b-observation-wiring`. **worktree** `.claude/worktrees/an-28b`. **depends-on** AN-25, AN-26b, AN-27b, AN-28a. **size** 45k. **Status** BlockedDependency; activation held: D-CS-06.
- **facts.** `golem/src/adam/adam-body.ts` is 413 lines; `AdamBodyEnv` (line 59) has `owners?: OwnerTransport` (the Body's own NATS connection, `subscribe(subject, {callback})` in `golem/src/body/block-owners.ts:35`); `watchHurts(bot, hurts, tick)` is called at line 340; `stop()` calls `owners?.stop()` at line 396. `eventIdFor(key)` is `golem/src/body/derived-id.ts:29`. `threshold/mcp/test/fixtures/real-body-events.json` exists. Player Bodies (`golem/src/players/main.ts`) do not use `startAdamBody`; they are out of W5 scope.
- **may-edit** `golem/src/perception/provenance/subscribe.ts` (new), `golem/src/perception/provenance/subscribe.test.ts` (new), `golem/src/adam/adam-body.ts` (one option and one block), `golem/src/adam/adam-body-observations.test.ts` (new), `threshold/mcp/src/events/leakage.test.ts` (new), `docs/analysis/harness/worknotes/AN-28b.md`.
- **must-not-edit** R6; `golem/src/adam/adam-body.test.ts`; `compose/**`; `shards/*.yaml`; the plugin; `geldar.ps1`.
- **steps.**
  1. `subscribe.ts`: `startObservations(opts: { transport: OwnerTransport; shard: string; lifeId: string; selfName: string; bot: Bot; publisher: EventPublisher; resolve; canSee; log }): { stop(): void }` subscribes to `provenanceBreakSubject(shard)` and `provenancePickupSubject(shard)`, drops a message over 4096 bytes or failing `validateProvenance` (one log line, a counter), calls `observeBreak` or `observeGift`, and for a non-null result publishes on `geldar.<shard>.observation` a WorldEvent `{ type: 'observation', payload, agent_id: lifeId, source_event_id: eventIdFor('observation:' + lifeId + ':' + payload.key), ... }` built like `hurtWorldEvent` and checked with `validateWorldEvent`. `stop()` unsubscribes both.
  2. `adam-body.ts`: add `observations?: boolean` to `AdamBodyEnv` with a doc comment (absent or false: off; nothing in production sets it in W5). When `env.observations === true` and `env.owners` is defined: pass `resolve = (u) => observedActor(bot, u)` as the fourth argument to `watchHurts`, start `startObservations` with `canSee = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b !== null && canSeeBlock(bot, b); }` (`canSeeBlock` from `golem/src/perception/notable-blocks.ts:72`, `import { Vec3 } from 'vec3';` as `golem/src/actions/attack.ts` does; `vec3` is already a pinned golem dependency), and stop it in `stop()` and in the failed-start cleanup. Otherwise the code path is byte-for-byte today's (three-argument `watchHurts`, no subscription). Keep `adam-body.ts` under 450 lines.
  3. `leakage.test.ts`: replay `threshold/mcp/test/fixtures/real-body-events.json` plus synthetic `observation` and `damage` events (built from the AN-26b and AN-27b fixtures over a fake bot with one entity in and one out of line of sight) through `mapMindEvent` and `presentEvents`; assert over the whole serialised output: no `ag_` id, no `provenance`, no `key`, no coordinates in an `observation`, no `actor` where the Body fixture had a hidden actor, and no observation for third-party, unowned or self events. Add two cases that inject a leak (an `ag_` id; a coordinate) and assert the scan reports it.
- **tests** (named): `observations off: no subscription and watchHurts gets three arguments` (spy); `observations on: both subjects subscribed and stop unsubscribes`; `a provenance message with a bad shape is dropped and counted`; `an oversize message is dropped`; `a valid break for the owner publishes one observation event`; the leakage cases above, including the two injected-leak cases.
- **revert-checks** (1) start the subscription when `observations` is absent: "observations off" fails. (2) remove the `validateProvenance` drop: "bad shape is dropped" fails. (3) make the fixture bot see through the wall: the hidden-actor leakage case fails. (4) remove the `ag_` scan: both injected-leak cases fail.
- **checks** `GATE-G` (`@geldar/golem`, `@geldar/mcp`); `./geldar.ps1 pnpm test golem/src/perception/provenance golem/src/adam threshold/mcp/src/events/leakage`.
- **exit** all green; `adam-body.test.ts` unchanged and green.
- **stop and report** if the WorldEvent for `observation` fails `validateWorldEvent`.
- **commit** `feat(character): Body subscription for observed evidence, with a leakage gate (AN-28b)`.

## AN-28c: plugin setup and the NATS role table

- **id** AN-28c (split from AN-28b, 2026-11-18). **wave** W5. **repo** geldar (plugin, `geldar.ps1`, tests). **branch** `phase1/an-28c-provenance-setup-acl`. **worktree** `.claude/worktrees/an-28c`. **depends-on** AN-26a, AN-27a, AN-28b. **size** 35k plus serial ops. **Status** BlockedDependency (last); activation held: D-CS-06.
- **facts.** `BlockOwnerSetup.register` (line 61) builds the link (line 76) and registers `new BlockChangeListener(cache, publisher, () -> setup.enabled)` (lines 83, 84); `reload(FileConfiguration)` (line 91) reads `blockowner.enabled`. `Get-NatsUsers` is `geldar.ps1:391`; the `body` entry has `PubDeny` (line 403) and `Sub` (line 407); the `paper` entry already allows `geldar.$s.>` publish.
- **may-edit** `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java`, `plugin/core/src/test/java/dev/geldar/core/blockowner/ProvenanceSetupTest.java` (new), `geldar.ps1` (the `body` entry of `Get-NatsUsers` only), `tools/repo-checks/src/nats-auth.test.ts`, `threshold/mcp/test/nats-auth.it.test.ts`, `docs/analysis/harness/worknotes/AN-28c.md`.
- **must-not-edit** R6; `config.yml` (no default added: the code default is false); `BlockChangeListener.java`, `NatsBlockOwnerLink.java`.
- **steps.**
  1. `BlockOwnerSetup`: a `volatile boolean provenance` field; `static boolean provenanceEnabled(FileConfiguration c)` returns `c.getBoolean("provenance.enabled", false)`; `reload` sets the field from it. Register the listener with the six-argument constructor (`link` as the `ProvenanceSink`, `() -> setup.enabled && setup.provenance`, `Bukkit::getCurrentTick` as a `LongSupplier`), and register `new PickupProvenanceListener(link, () -> setup.enabled && setup.provenance, Bukkit::getCurrentTick, Bukkit::getPlayer)`.
  2. `geldar.ps1` `body`: append `"geldar.$s.provenance.>"` to `Sub` and to `PubDeny`, with one comment line: the Body hears provenance and cannot forge it.
  3. Mirror the change in `tools/repo-checks/src/nats-auth.test.ts` and `threshold/mcp/test/nats-auth.it.test.ts` with a case named `provenance routing: the body subscribes and cannot publish; mind, eventsink and mcp cannot subscribe`.
- **tests** `ProvenanceSetupTest` (with `YamlConfiguration`): `provenance is off when the key is absent`; `provenance is on when provenance.enabled is true`. The nats-auth cases above.
- **revert-checks** (1) default `provenanceEnabled` to true: "off when the key is absent" fails. (2) remove the `PubDeny` entry: the provenance routing case fails.
- **checks** `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.ProvenanceSetupTest')`; `(cd plugin; ./gradlew :core:verifyJarContents)`; `(cd plugin; ./gradlew build)`; `./geldar.ps1 pnpm test tools/repo-checks/src/nats-auth`; `GATE-G` (`@geldar/repo-checks`). `threshold/mcp/test/nats-auth.it.test.ts` needs a real NATS: ops.
- **exit** tests green; `verifyJarContents` passes with no golden change.
- **stop and report** if `Bukkit::getCurrentTick` or `Bukkit::getPlayer(UUID)` does not compile against the pinned Paper API.
- **ops (serial, test shard only, W5 close)** with `provenance.enabled: true` and a test Body started with `observations: true` from a live test case (never on a live life): one real hit, one real give and one real break reach an eligible observer in `wait` events; the hidden controls (out of sight, third party, unowned) do not; a Body connection cannot publish `geldar.<shard>.provenance.break`, and the Mind, eventsink and MCP roles cannot subscribe to `provenance.>` (real NATS roles, `nats-auth.it.test.ts`); one observation read by two `wait` calls with the same cursor has one `seq`. Then the full `./geldar.ps1 check`, the focused real-client cases and the 20 TPS bench. The live server's NATS conf change is applied by the operator by hand (`docs/analysis/sheet/RESUME.md`); nothing is switched on there.
- **commit** `feat(character): plugin provenance setup and the Body's provenance ACL (AN-28c)`.

---

## Card count and coordination notes

27 ids. Retired or done (kit-b is the authority): HC-18 (done), HC-19, HC-20, HC-21a, HC-21b, HC-22, HC-23a, HC-23b, HC-24, HC-25, HC-26a, HC-26b, HC-26c. Live in this file: HC-33, HC-46a, HC-46b, HC-47, HC-48 (kit or kit-bound), AN-24, AN-25, AN-26a, AN-26b, AN-27a, AN-27b, AN-28a, AN-28b, AN-28c (world). OWNER APPROVAL REQUIRED: HC-46b (observation fields), AN-24 and AN-28a (OD-E); through kit-b, HC-23a (OD-B) and HC-25 (OD-A). Cards touching `contract/`: AN-24 only. New ids for the ledger: HC-46a, HC-46b, HC-47, HC-48, AN-28c.
