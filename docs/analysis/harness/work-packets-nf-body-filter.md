# NeoForge Body filter cards: non-agent players never reach an agent as people

**Status: PENDING OPERATOR CONFIRMATION: DO NOT DISPATCH.**

Written 2026-11-18 against geldar `origin/main` = `6bf345c7`. Planning only: nothing here is dispatched, merged or ruled. The operator's revision of 0329 is pending. The banner branch `docs/nf-human-revision-banner` (not merged at the time of writing) says NF-1 to NF-6 in decision 0329 do not match the operator's intent. Do not build from 0329, from [../sheet/neoforge-delta.md](../sheet/neoforge-delta.md) or from the NeoForge twin cards. Open questions, unverified items and the live-exposure answer are in [../sheet/nf-body-filter-notes.md](../sheet/nf-body-filter-notes.md).

## The model these cards assume (and what they leave open)

The operator model: on the NeoForge shard humans are an **invisible hand**. Agents cannot perceive humans as people. A human's effects reach an agent only as acts of nature or mystery: no name, no alias, no theory-of-mind model. These cards build only the mechanism that model needs in every reading:

1. **One shared predicate** that says whether a player username is an agent (NF-F0).
2. **A per-shard switch**, default off, that turns the filter on (NF-F6).
3. **Filters** that, with the switch on, treat a non-agent player as **absent** wherever the Body reports, resolves or draws players (NF-F1, NF-F2, NF-F4), plus an MCP second line (NF-F5a) and a leakage gate (NF-F5b).

These cards do not decide the following, and stay neutral about them. Each is listed as an open operator question in the notes file:

- human speech (whether a human's chat reaches an agent at all, and in what form). NF-F3 is **BlockedDecision** for this reason.
- the human intervention channel (an in-world avatar, a nudge or command channel, a mod).
- avatar versus nudge (whether a human has a body that blocks, hits or picks up).
- the wording of outcome text that today uses a person-word for an unseen cause ("someone is standing there", "someone else picked the items up"). NF-F2w is **BlockedDecision** for this reason.

"Absent" here means only that the Body's reports, resolvers and images skip the entity. The cards change nothing on the server and nothing about physics. A filtered entity can still block a placement or cause a hurt, and the text for those cases is exactly as today (nameless) or is held by NF-F2w.

**Paper is unchanged.** The switch defaults off, no Paper shard file sets it, and every card carries a test showing that the off path gives exactly today's output. Paper has no human players (Principle 1; ghosts are held in spectator by `plugin/core/.../GhostListener.java`).

## Facts every card relies on (verified against `6bf345c7`)

| Fact | Where |
|---|---|
| Any visible player goes into snapshot `agents[]` by username, with no agent check | `golem/src/perception/entities.ts:244-256` (`observeEntities`) |
| Every loaded player can be resolved by name for give, goto and follow | `golem/src/perception/visible-agent.ts:37-44` (`otherPlayers`), `:91-95` (`isUsernameVisible`), `:112-130` (`findVisibleAgent`); callers `golem/src/actions/give.ts:187,299,324,331`, `golem/src/actions/goto.ts:48`, `golem/src/body/programs/follow.ts:40,47` |
| Attack resolves a target by mob name **or** username. A player's `entity.name` is `player`, so `attack player` reaches the nearest player of any kind | `golem/src/actions/attack.ts:59-73` (`findTarget`, test at `:65`) |
| The effect snapshot matches the same way | `golem/src/actions/effect.ts:63-73` (`targetsOf`, test at `:68`) |
| A give records another collector by username; the outcome names only an exactly visible username, else "someone else picked the items up" | `golem/src/actions/give-pickup.ts:147`, `golem/src/actions/give.ts:185-205` |
| Place says "someone is standing there" for any player in the cell | `golem/src/actions/place.ts:81`, `:478` |
| Ears take all `playerChat` and `chat`, with no distance filter. The sender name goes into `heard`, the `speech` event, and `notifyAddressed`, which writes `addressed by <from>` as the wake reason | `golem/src/voice/ears.ts:63-130`, `golem/src/body/executor.ts:165-169` |
| The text viewport draws a player as `player`, and the image reader draws every sighted entity | `golem/src/perception/view/viewport.ts:211` (`viewFromBot`), `golem/src/body-image/reader.ts:41-58` (`entitiesInSight`) |
| The MCP passes `agents` and heard lines through | `threshold/mcp/src/play-view/surroundings.ts:27`, `threshold/mcp/src/play-view/untrusted.ts:5-9`, `threshold/mcp/src/events/handlers/speech.ts:9`, `threshold/mcp/src/events/present.ts:54` |
| The snapshot contract allows any agent name, 1 to 32 characters | `contract/schemas/snapshot.schema.json:236-243` |
| Hurt and death are already nameless: the damage payload is `{source, amount, bearing?}`, the log name of a player cause is `player`, and death phrases are fixed ("Something struck you down") | `golem/src/perception/hurt-trigger.ts:42-47`, `:105-108`; `threshold/mcp/src/events/handlers/death.ts:4-23` |
| The LifeId pattern exists three times, none exported from a shared package: golem (private), Java, contract schema. The managed id pattern is private to golem | `golem/src/registry.ts:42`, `plugin/core-common/src/main/java/dev/geldar/core/EventEnvelope.java:27,36-38`, `contract/schemas/common.schema.json:33-37`, `golem/src/players/managed-config.ts:15`. Also frozen `animus/src/config.ts:106` (never edit) |
| No `isAgent` exists in golem, threshold or contract. The plugin's Kino `isAgent` is a lambda over the Kino target list, not a shared predicate | `plugin/core/src/main/java/dev/geldar/core/kino/KinoSetup.java:42-43`, decision 0139 |
| Per-Body shard flags follow one pattern: the shard file `shards/<GELDAR_SHARD>.yaml` is parsed by `parseAdamConfig`, the flag is passed to `createBody`, and that call stores it in a `WeakMap<Bot, boolean>` | `golem/src/adam/adam-config.ts:67-74,97-123`; `golem/src/body/create-body.ts:159-160`; `golem/src/actions/water-rules.ts:135-146` (`setSwimEnabled`, `swimEnabled`); `golem/src/adam/adam-body.ts:181-191` |
| Every Body path (Adam, sovereign player host, managed host) goes through `parseAdamConfig` and `startAdamBody` | `golem/src/players/player-config.ts:7`, `golem/src/players/body-host.ts:10,46` |
| The MCP reads the same shard file, `shards/<GELDAR_SHARD>.yaml` | `threshold/mcp/src/config.ts:178-192` (`parseMcpConfig` at `:186`); its Body snapshots enter through `NatsBodyGateway.snapshot` (`threshold/mcp/src/body-gateway.ts:77-81`), built at `threshold/mcp/src/main.ts:362` |
| The NeoForge human lane refuses any name that starts with `ag_` or `ag-`, in any case, and any name that is in the life registry | decision 0388, "What is built" and Amendment (c) |

Line counts at `6bf345c7` (caps: soft 500, hard 700): `contract/src/index.ts` 557, `threshold/mcp/src/main.ts` 503, `threshold/mcp/src/config.ts` 474, `golem/src/adam/adam-body.ts` 413, `golem/src/actions/place.ts` 498, `golem/src/actions/give.ts` 373, `golem/src/actions/effect.ts` 356, `golem/src/perception/entities.ts` 282, `golem/src/body/create-body.ts` 262, `golem/src/actions/attack.ts` 220, `golem/src/perception/view/viewport.ts` 230, `golem/src/voice/ears.ts` 187, `golem/src/body-image/reader.ts` 79, `golem/src/perception/visible-agent.ts` 130, `golem/src/adam/adam-config.ts` 131, `threshold/mcp/src/body-gateway.ts` 157. New code goes in new files. Over-cap files get one-line changes only.

## The predicate: where it lives and why (NF-F0)

**Proposal: `contract/src/agent-name.ts`, exported from `@geldar/contract`.**

- `@geldar/contract` is already a dependency of both golem and the MCP (`golem/package.json:12`, `threshold/mcp/package.json:15`). It holds hand-written, shard-neutral helpers beside the generated code (`contract/src/agent-text.ts`, `contract/src/outcome-words.ts`), and it is where the LifeId pattern is defined (`common.schema.json`). A new package would add a workspace dependency, which needs a pin and a review. golem cannot be imported by the MCP.
- The predicate is an **allow rule**, as Kino's is (decision 0139: "kept by an allow rule, not a deny rule"). `isAgentUsername(name)` is true only for a contract `LifeId` (`^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`) or a managed life id (`^ag_[a-z0-9]{1,12}$`). Both are strict subsets of the names the NeoForge human lane refuses (`ag_` in any case, 0388), so no name that can come through the human lane satisfies it. A broader `ag_` prefix rule would also be sound under 0388, but it would let through names that are not lives. The choice is listed as an operator question (notes, OQ-9).
- **The plugin is not changed.** Java keeps `EventEnvelope.isLifeId`. No Java path needs `isAgentUsername` for these cards, the NeoForge mod has no perception path, and Paper behaviour must not change. A repo-check test pins all four copies of the pattern (contract, golem, Java, schema) to the same text, so they cannot drift.
- `contract/src/index.ts` is 557 lines. It gets **one** named export line, next to the `agent-text.ts` line (line 10).

## Card list and order

| Card | Title | Repo | Depends on | Size | Status |
|---|---|---|---|---|---|
| NF-F0 | shared agent-name predicate, plus parity guard | geldar | none | 25k | Pending operator confirmation; then Code now |
| NF-F6 | the per-shard switch `body_perception.players` (golem side), plus `isHiddenPlayer` | geldar | NF-F0 | 35k | Pending; then BlockedDependency: NF-F0 |
| NF-F1 | snapshot `agents[]` and visible-player resolution | geldar | NF-F0, NF-F6 | 30k | Pending; then BlockedDependency: NF-F6 |
| NF-F2 | action targets: attack and effect | geldar | NF-F0, NF-F6 | 25k | Pending; then BlockedDependency: NF-F6 |
| NF-F2w | person-words for a filtered cause (place, give) | geldar | NF-F1, NF-F2 | 15k | **BlockedDecision: OQ-4 (wording), OQ-3 (avatar)** |
| NF-F3 | voice: ears, `heard`, speech events, `notifyAddressed` | geldar | NF-F0, NF-F6 | 30k | **BlockedDecision: OQ-1 (human speech)** |
| NF-F4 | text viewport and image reader | geldar | NF-F0, NF-F6 | 25k | Pending; then BlockedDependency: NF-F6 |
| NF-F5a | MCP second line: the switch read by the MCP, agents filtered at the gateway | geldar | NF-F0 | 30k | Pending; then BlockedDependency: NF-F0 |
| NF-F5b | leakage gate: scan every agent-visible output for a non-agent name | geldar | NF-F1, NF-F2, NF-F4, NF-F5a | 35k | Pending; then BlockedDependency |

Order: NF-F0, then NF-F6 and NF-F5a (in parallel: disjoint files), then NF-F1, NF-F2 and NF-F4 (in parallel), then NF-F5b. NF-F3 and NF-F2w wait for their rulings. When NF-F3 merges, it updates NF-F5b's pending-channel test (named in both cards).

**What "inert" means for this set.** With every card merged, nothing changes on any running shard: no shard file sets `body_perception`, no Body runs on the NeoForge shard (notes, section 3), and the Paper default is off. Turning the mode on for a NeoForge shard file is an operator act. It is held until NF-F3 is ruled and merged, because before that the speech channel still carries names (NF-F5b states this as a test).

## Shared files and who owns them

| File | Owner | Everyone else |
|---|---|---|
| `contract/src/agent-name.ts`, `contract/src/index.ts` (its one line), `contract/test/agent-name.test.ts`, `tools/repo-checks/src/agent-name-parity.test.ts` | NF-F0 | read only |
| `golem/src/perception/player-filter.ts`, `golem/src/perception/player-filter.test.ts`, `golem/src/adam/adam-config.ts`, `golem/src/adam/adam-config-perception.test.ts`, `golem/src/body/create-body.ts` | NF-F6 | read only |
| `golem/src/adam/adam-body.ts` (413 lines; also held by sheet card AN-28b) | NF-F6 (one line), then NF-F3 (ears options), serial; if AN-28b holds it at dispatch, the line goes in the worknote as "index line to add" and the card stops | nobody else |
| `golem/src/perception/entities.ts`, `golem/src/perception/visible-agent.ts`, `golem/src/perception/hidden-player.test.ts` | NF-F1 | read only |
| `golem/src/actions/attack.ts`, `golem/src/actions/effect.ts`, `golem/src/actions/hidden-target.test.ts` | NF-F2 | read only |
| `golem/src/actions/place.ts`, `golem/src/actions/give.ts`, `golem/src/actions/give-pickup.ts` | NF-F2w (blocked) | read only |
| `golem/src/voice/ears.ts`, `golem/src/voice/ears-hidden.test.ts` | NF-F3 (blocked) | read only |
| `golem/src/perception/view/viewport.ts`, `golem/src/body-image/reader.ts`, `golem/src/perception/view/viewport-hidden.test.ts`, `golem/src/body-image/reader-hidden.test.ts` | NF-F4 | read only |
| `threshold/mcp/src/config-perception.ts`, `threshold/mcp/src/config-perception.test.ts`, `threshold/mcp/src/config.ts` (two lines), `threshold/mcp/src/agents-only.ts`, `threshold/mcp/src/agents-only.test.ts`, `threshold/mcp/src/body-gateway.ts`, `threshold/mcp/src/main.ts` (one line) | NF-F5a | read only |
| `golem/src/perception/hidden-player-leakage.test.ts`, `threshold/mcp/src/agents-only-leakage.test.ts` | NF-F5b; NF-F3 edits the pending-channel test when it lands | nobody else |
| ledger, RESUME, worknotes index | orchestrator | cards write "index line to add" in their worknote |

## Rules common to every card

The sheet rules R1 to R12 of [work-packets-sheet-w3-w5.md](work-packets-sheet-w3-w5.md) apply, with these replacements:

- **R2 (branch).** The orchestrator creates the wave branch `phase1/nf-filter` from `origin/main` before the first dispatch. Packet branch: `phase1/<id-lower>-<slug>` from it. Worktree: `.claude/worktrees/<id-lower>` in geldar. The brief gives the absolute path. The coder never pushes or opens a PR.
- **R3 (worknote).** `docs/analysis/harness/worknotes/NF-F<n>.md`. Write a stub first.
- **R7 (gates), as `GATE-F`, in order:** `git diff --check`; `./geldar.ps1 pnpm format`; `./geldar.ps1 pnpm lint`; `./geldar.ps1 pnpm --filter <package> typecheck` for each package the card touches (`@geldar/contract`, `@geldar/golem`, `@geldar/mcp`, `@geldar/repo-checks`); the card's `./geldar.ps1 pnpm test <paths>`; `./geldar.ps1 pnpm check:repo`; `git merge-tree --write-tree phase1/nf-filter HEAD` prints a tree id and no conflict. No card here regenerates the contract: no schema changes.
- **R10 (revert-checks).** For each revert-check: make the named revert, run the card's test command, see the named test fail, restore the change, run again and see green. Write the failing test's name in the worknote.
- **R11 (honesty, this set).** No card adds agent-visible text. No new string reaches an agent. A filtered player is skipped, never renamed, never replaced by a placeholder, never counted.
- **R12 (stop and report).** Also stop when: a line or symbol named in "facts" is not where the card says; a test outside the card's list fails; the off path changes any existing test's output; or a step would need wording, a placeholder or a behaviour the card does not spell out.
- Never run `adam up`. No live case, bench or shard is needed. Every test is a unit test with fakes.

---

## NF-F0: shared agent-name predicate

- **id** NF-F0. **repo** geldar. **branch** `phase1/nf-f0-agent-name`. **worktree** `.claude/worktrees/nf-f0`. **depends-on** none. **size** 25k. **Status** PENDING OPERATOR CONFIRMATION (OQ-9, the predicate shape); then Code now.
- **may-edit** `contract/src/agent-name.ts` (new), `contract/src/index.ts` (one line only), `contract/test/agent-name.test.ts` (new), `tools/repo-checks/src/agent-name-parity.test.ts` (new), `docs/analysis/harness/worknotes/NF-F0.md`.
- **must-not-edit** R6; `golem/src/registry.ts`, `golem/src/players/managed-config.ts`, `plugin/**`, `animus/**`, `contract/schemas/**`, `contract/src/generated/**`.
- **steps.**
  1. Create `contract/src/agent-name.ts` with exactly these exports, each with a one-line doc comment:
     - `export const LIFE_ID_PATTERN = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;` (comment: the `LifeId` pattern of `contract/schemas/common.schema.json`).
     - `export const MANAGED_LIFE_ID_PATTERN = /^ag_[a-z0-9]{1,12}$/;` (comment: the managed life id of `golem/src/players/managed-config.ts` and the SQL `managed_life_id`).
     - `export function isLifeId(name: unknown): boolean { return typeof name === 'string' && LIFE_ID_PATTERN.test(name); }`
     - `export function isAgentUsername(name: unknown): boolean { return isLifeId(name) || (typeof name === 'string' && MANAGED_LIFE_ID_PATTERN.test(name)); }` (comment: an allow rule, decision 0139; true only for a life or managed life id, never for a name the NeoForge human lane admits, decision 0388).
  2. In `contract/src/index.ts`, directly after line 10 (`export { MARKER_WORD, markedWords } from './agent-text.ts';`), add one line: `export { isAgentUsername, isLifeId, LIFE_ID_PATTERN, MANAGED_LIFE_ID_PATTERN } from './agent-name.ts';`. Change nothing else.
  3. `contract/test/agent-name.test.ts` (tests below). For the schema parity test, read `contract/schemas/common.schema.json` with `readFileSync` and `fileURLToPath(new URL('../schemas/common.schema.json', import.meta.url))`, parse it, and compare `$defs.LifeId.pattern` with `LIFE_ID_PATTERN.source`.
  4. `tools/repo-checks/src/agent-name-parity.test.ts`: `const ROOT = fileURLToPath(new URL('../../../', import.meta.url));` (as in `tools/repo-checks/src/character-fixture.test.ts:10`). Read the three files as text and check that each contains the pattern source as a literal: `golem/src/registry.ts` contains `/^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/`; `plugin/core-common/src/main/java/dev/geldar/core/EventEnvelope.java` contains `"^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$"`; `golem/src/players/managed-config.ts` contains `/^ag_[a-z0-9]{1,12}$/`. `@geldar/repo-checks` does not depend on `@geldar/contract` (its `package.json`, verified): write the two pattern strings as constants in the test and do **not** add a dependency.
- **tests** (named). `contract/test/agent-name.test.ts`: `a life id is an agent` (`ag_kestrel_01`, `ag_adam_03`, `ag_nfprobe_01`); `a managed life id is an agent` (`ag_0123456789ab`, `ag_k`); `a human-shaped name is not an agent` (`Steve`, `Wanderer7`, `player`, `kestrel_01`, empty string); `case and separators matter` (`AG_kestrel_01`, `Ag_kestrel_01`, `ag_Kestrel_01`, `ag-kestrel-01`, `ag_` are all false); `a managed id of 13 characters is not an agent` (`ag_0123456789abc`); `non-strings are not agents` (`undefined`, `null`, `42`, `{}`); `the LifeId pattern equals the schema's`. `tools/repo-checks/src/agent-name-parity.test.ts`: `golem, Java and the managed config carry the contract patterns`.
- **revert-checks** (1) drop `{0,15}` from `LIFE_ID_PATTERN`: `the LifeId pattern equals the schema's` fails. (2) make `isAgentUsername` return `typeof name === 'string' && name.toLowerCase().startsWith('ag_')`: `case and separators matter` fails. (3) change the managed pattern to `{1,13}`: `a managed id of 13 characters is not an agent` fails, and so does the parity test.
- **checks** `GATE-F` (`@geldar/contract`, `@geldar/repo-checks`); `./geldar.ps1 pnpm test contract/test/agent-name tools/repo-checks/src/agent-name-parity`.
- **exit** all tests green. `index.ts` grew by exactly one line. No other contract file changed. `check:generated` is untouched (no schema change).
- **stop and report** if the pattern text in any of the three files differs from the card (a drift found: do not "fix" it); or if `contract/src/index.ts` line 10 is not the `agent-text.ts` export line.
- **commit** `feat(contract): shared agent-name predicate and pattern parity guard (NF-F0)`.

## NF-F6: the per-shard switch (golem side) and `isHiddenPlayer`

- **id** NF-F6. **repo** geldar. **branch** `phase1/nf-f6-perception-switch`. **worktree** `.claude/worktrees/nf-f6`. **depends-on** NF-F0. **size** 35k. **Status** PENDING; then BlockedDependency: NF-F0.
- **The mechanism.** A new optional block in the shard file `shards/<shard>.yaml`, which golem (`parseAdamConfig`) and the MCP (NF-F5a) both read: `body_perception: { players: all | agents_only }`. A missing block or a missing `players` key means `all`, which is today's behaviour. No shard file in the repo is edited: Paper keeps `all` by omission. A NeoForge shard file does not exist yet (NF-BODY, notes section 3). This card only adds the reader and the per-Body flag. Nothing in this card reads the flag.
- **may-edit** `golem/src/perception/player-filter.ts` (new), `golem/src/perception/player-filter.test.ts` (new), `golem/src/adam/adam-config.ts`, `golem/src/adam/adam-config-perception.test.ts` (new), `golem/src/body/create-body.ts`, `golem/src/adam/adam-body.ts` (one line), `docs/analysis/harness/worknotes/NF-F6.md`.
- **must-not-edit** R6; `shards/*.yaml`; `golem/src/adam/adam-config.test.ts` (add tests to the new file instead); `golem/src/body/restart.ts` (if it does not pass the new option through, stop).
- **steps.**
  1. `golem/src/perception/player-filter.ts`, modelled on `golem/src/actions/water-rules.ts:135-146`:
     - `const agentsOnlyFlag = new WeakMap<Bot, boolean>();`
     - `export function setAgentsOnly(bot: Bot, on: boolean): void` (sets it; comment: the shard's `body_perception.players` is `agents_only`; called once, at creation).
     - `export function agentsOnly(bot: Bot): boolean { return agentsOnlyFlag.get(bot) === true; }`
     - `export function isHiddenPlayer(bot: Bot, entity: { type?: unknown; username?: unknown } | null | undefined): boolean` returns `agentsOnly(bot) && entity != null && entity.type === 'player' && !isAgentUsername(entity.username)`, with `isAgentUsername` imported from `@geldar/contract`. Doc comment: with the switch off, always false (Paper). With it on, a player entity whose username is not an agent's (or that has no username) is hidden. It never reads `bot.players`.
     - `export function isHiddenName(bot: Bot, name: unknown): boolean` returns `agentsOnly(bot) && !isAgentUsername(name)` (for callers that hold only a name, such as NF-F3).
  2. `golem/src/adam/adam-config.ts`: add `agentsOnly: boolean` to `AdamConfig`, with the doc comment `` `body_perception.players`: `agents_only` hides non-agent players from this Body's reports (off when left out) ``. Add `function bodyPerceptionAgentsOnly(root: Record<string, unknown>): boolean`, placed after `bodyActionFlag` (line 67). Missing `root.body_perception` returns false. Otherwise read it with `block(root.body_perception, 'body_perception')`. A missing `players` returns false. `'all'` returns false. `'agents_only'` returns true. Anything else throws `new Error('body_perception.players must be all or agents_only')`. In `parseAdamConfig`, add `agentsOnly: bodyPerceptionAgentsOnly(root),` after `swim: ...`.
  3. `golem/src/body/create-body.ts`: add `agentsOnly?: boolean;` to `CreateBodyOptions` next to `swim` (line 48), with the doc comment `The shard's body_perception.players is agents_only. Default: off`. After line 160 (`setSwimEnabled(...)`), add `setAgentsOnly(options.bot, options.agentsOnly ?? false);` and the import.
  4. `golem/src/adam/adam-body.ts`: in the `restartBody` call (lines 181-191), add `agentsOnly: config.agentsOnly,` after `swim: config.swim,`. This is the only change to this file. If `RestartBodyOptions` does not accept it, stop (must-not-edit `restart.ts`).
- **tests** (named). `golem/src/perception/player-filter.test.ts`: `off by default: no player is hidden` (a fresh fake bot, a player `Wanderer7`); `on: a non-agent player is hidden`; `on: a life id and a managed id are not hidden`; `on: a player with no username is hidden`; `on: a mob is never hidden` (type `hostile`, name `zombie`); `isHiddenName follows the same rule`. `golem/src/adam/adam-config-perception.test.ts` (copy the `SHARD` fixture from `golem/src/adam/adam-config.test.ts:8-16`): `no body_perception block is all`; `players all is off, agents_only is on`; `an unknown value throws`; `every shard file in shards/ that parses today parses to agentsOnly false` (read the files `phase0.yaml` and `character-fixture.yaml` under `shards/` with `parseAdamConfig`; skip a file that does not parse as an Adam shard today and name it in the worknote).
- **revert-checks** (1) make `agentsOnly` return `true` when unset: `off by default: no player is hidden` fails. (2) remove the `isAgentUsername` check from `isHiddenPlayer`: `on: a life id and a managed id are not hidden` fails. (3) map `'all'` to true: `players all is off, agents_only is on` fails.
- **checks** `GATE-F` (`@geldar/golem`); `./geldar.ps1 pnpm test golem/src/perception/player-filter golem/src/adam/adam-config golem/src/body/create-body golem/src/adam/adam-body`.
- **exit** all green; the existing `adam-config.test.ts` and `adam-body*.test.ts` pass unchanged; no shard file edited.
- **stop and report** if `block` is not the helper name in `adam-config.ts`; if `CreateBodyOptions` or the `setSwimEnabled` line moved; if `adam-body.ts` is held by AN-28b at dispatch; or if the frozen `animus/` or the MCP refuses an unknown shard key (the MCP side is NF-F5a's; check only that `./geldar.ps1 pnpm test threshold/mcp/src/config` stays green).
- **commit** `feat(golem): body_perception.players switch, inert by default (NF-F6)`.

## NF-F1: snapshot `agents[]` and visible-player resolution

- **id** NF-F1. **repo** geldar. **branch** `phase1/nf-f1-hidden-agents`. **worktree** `.claude/worktrees/nf-f1`. **depends-on** NF-F0, NF-F6 (`isHiddenPlayer`, `setAgentsOnly`). **size** 30k. **Status** PENDING; then BlockedDependency: NF-F6.
- **may-edit** `golem/src/perception/entities.ts`, `golem/src/perception/visible-agent.ts`, `golem/src/perception/hidden-player.test.ts` (new), `docs/analysis/harness/worknotes/NF-F1.md`.
- **must-not-edit** R6; `golem/src/perception/entities.test.ts`, `golem/src/perception/visible-agent.test.ts` (they must pass unchanged); every caller of `findVisibleAgent` (give, goto, follow are covered through this file).
- **steps.**
  1. `entities.ts`, in `observeEntities`, the `if (entity.type === 'player') {` branch (line 244): make the first statement inside it `if (isHiddenPlayer(bot, entity)) continue;`, before `const name = ...`. A hidden player then reaches neither `agents` nor `entities`. Import `isHiddenPlayer` from `./player-filter.ts`. Change nothing else. The closing-sample bookkeeping above it stays.
  2. `visible-agent.ts`, `otherPlayers` (lines 37-44): add `&& !isHiddenPlayer(bot, entity)` to the filter condition. This one change covers `isUsernameVisible`, the exact path of `findVisibleAgent` and its loose path (handle and tab-list display name), because all three read `otherPlayers`. Add one sentence to the `findVisibleAgent` doc comment: "A player hidden by the shard's `body_perception.players` switch is not loaded for this purpose (NF-F1)."
- **tests** (`golem/src/perception/hidden-player.test.ts`, with `FakeWorld` from `./perception.fakes.ts` and entities placed as in `visible-agent.test.ts:24-29`; call `setAgentsOnly(world.bot as unknown as Bot, true)` for the "on" cases). Named: `on: a visible non-agent player is not in agents and not in entities`; `on: a visible agent is still listed`; `on: findVisibleAgent does not resolve a hidden player by exact name`; `on: the loose path does not resolve a hidden player by tab-list display name` (use `world.setPlayer('Wanderer7', 'Kestrel')` and ask for `Kestrel`); `on: isUsernameVisible is false for a hidden player`; `on: a hidden player does not make a loose agent name ambiguous` (a hidden `kit` with display name `Kit` and an agent `ag_kit_01`: `Kit` resolves to `ag_kit_01`); `off: the same world lists and resolves the non-agent player exactly as today` (compare `observeEntities` output with and without the module flag never set, using `toEqual`).
- **revert-checks** (1) remove the `continue` in `entities.ts`: `on: a visible non-agent player is not in agents...` fails. (2) remove the `otherPlayers` condition: the three `findVisibleAgent` and `isUsernameVisible` tests fail. (3) invert the switch in the test setup: the `off:` test fails (proves the off case looks at the same world).
- **checks** `GATE-F` (`@geldar/golem`); `./geldar.ps1 pnpm test golem/src/perception golem/src/actions/give golem/src/actions/goto golem/src/body/programs/follow`.
- **exit** all green; `entities.test.ts`, `visible-agent.test.ts`, the give, goto and follow tests unchanged and green.
- **stop and report** if `FakeWorld.bot` has no `username` (the self check) or the player branch has moved; if any existing test changes output with the flag off.
- **commit** `feat(golem): hide non-agent players from agents[] and name resolution when the switch is on (NF-F1)`.

## NF-F2: action targets (attack, effect)

- **id** NF-F2. **repo** geldar. **branch** `phase1/nf-f2-hidden-targets`. **worktree** `.claude/worktrees/nf-f2`. **depends-on** NF-F0, NF-F6. **size** 25k. **Status** PENDING; then BlockedDependency: NF-F6.
- **Why.** `findTarget` matches `entity.name` or `entity.username`. A player's `entity.name` is `player`, so with no filter `attack player` reaches the nearest human, and `attack <human name>` reaches that human. Both reveal a person through the outcome (`no player in view` against a fight). With the switch on, a hidden player is skipped exactly as an entity that is not loaded, so the outcome text is today's `no <name> in view`. No new text.
- **may-edit** `golem/src/actions/attack.ts`, `golem/src/actions/effect.ts`, `golem/src/actions/hidden-target.test.ts` (new), `docs/analysis/harness/worknotes/NF-F2.md`.
- **must-not-edit** R6; `golem/src/actions/attack.test.ts`, `golem/src/actions/effect.test.ts` (pass unchanged); `place.ts`, `give.ts`, `give-pickup.ts` (NF-F2w).
- **steps.**
  1. `attack.ts` `findTarget` (lines 59-73): after line 64 (`if (entity === bot.entity || entity.isValid === false) continue;`), add `if (isHiddenPlayer(bot, entity)) continue;`. Import from `../perception/player-filter.ts`.
  2. `effect.ts` `targetsOf` (lines 63-73): after line 67, add the same line. This keeps the before and after snapshot of an attack consistent with `findTarget`.
- **tests** (`golem/src/actions/hidden-target.test.ts`; build the fake bot inline as `attack.test.ts:31-65` does, with the entities you need). Named: `on: attack player skips a hidden player and finds an agent`; `on: attack by a hidden player's username finds nothing`; `on: attack zombie still finds the zombie`; `on: the effect snapshot does not list a hidden player`; `off: attack player finds the nearest player of any name, as today`.
- **revert-checks** (1) remove the line in `findTarget`: the first two tests fail. (2) remove the line in `targetsOf`: `on: the effect snapshot does not list a hidden player` fails.
- **checks** `GATE-F` (`@geldar/golem`); `./geldar.ps1 pnpm test golem/src/actions/attack golem/src/actions/effect golem/src/actions/hidden-target`.
- **exit** all green; existing attack and effect tests unchanged.
- **stop and report** if the fake bot needs `bot.username` for `isHiddenPlayer` (it should not); if any other action reads `entity.username` to pick a target (list it; do not edit it).
- **commit** `feat(golem): a hidden player is never an attack target (NF-F2)`.

## NF-F2w: person-words for a filtered cause (BlockedDecision)

- **id** NF-F2w. **repo** geldar. **branch** `phase1/nf-f2w-cause-words`. **worktree** `.claude/worktrees/nf-f2w`. **depends-on** NF-F1, NF-F2. **size** 15k. **Status** **BlockedDecision: OQ-4 (wording) and OQ-3 (avatar versus nudge).**
- **What is open.** With NF-F1, a hidden player is never named. Two existing texts still use a person-word for a cause the agent cannot see: place `somePlayer` = `someone is standing there` (`place.ts:81`, chosen at `:478` for any `type === 'player'` occupant) and give `someone else picked the items up` / `someone else picked up the rest` (`give.ts:194`, `:196`, `:202`, `:204`, used when a collector is not visible, which after NF-F1 includes every hidden collector). Whether a hidden cause should read as a thing (`something is standing there`, which exists as `someEntity` at `place.ts:82`), stay a person-word, or get new text is the operator's choice (OQ-4). Whether a hidden human has a body that can stand in a cell or pick an item up at all is OQ-3.
- **The card, once ruled.** If the ruling is "a hidden cause uses the existing thing-word", the steps are: in `place.ts` `occupantText`, choose `MESSAGE.someEntity` when `isHiddenPlayer(bot, occupant)`; leave give unchanged unless the ruling names give text. Any new text is a different card (R11). Tests: `on: a hidden occupant reads as something`, `off: a player occupant still reads as someone`. Revert-check: remove the branch and the first test fails. Commit `feat(golem): a hidden occupant is something, not someone (NF-F2w)`.
- **stop and report** for any ruling that needs a string that does not exist today.

## NF-F3: voice (BlockedDecision)

- **id** NF-F3. **repo** geldar. **branch** `phase1/nf-f3-hidden-voice`. **worktree** `.claude/worktrees/nf-f3`. **depends-on** NF-F0, NF-F6 (`isHiddenName`), NF-F5b (its pending-channel test). **size** 30k. **Status** **BlockedDecision: OQ-1 (human speech).**
- **Why blocked.** Every filtering choice on this path decides the speech question. Dropping a hidden speaker's line decides that human speech never reaches agents. Delivering the text without the name decides that it does, as a voice without a speaker. Any other form is new design. The card therefore takes no position. It records the path and the steps for the one answer that needs no new text, so that it can be dispatched the day that answer is given.
- **The path (verified).** `BotEars.attach` (`ears.ts:63-80`) hears `playerChat` packets and `chat` events. `onPlayerChatPacket` (`:92-104`) resolves the sender to a username through `bot.players` by UUID, or else uses the packet's `senderName` text. `hear(rawFrom, rawText)` (`:111-130`) adds the line to the ring (`heard()`, snapshot `heard`, MCP `untrusted_world_text.speech`), publishes a `speech` event (stored by the eventsink, presented by the MCP as `speech_to_me` "Someone spoke to you." or as a `conversation_digest`), and calls `executor.notifyAddressed(from)`, which wakes the Mind with the reason `addressed by <from>` (`executor.ts:168`). Speech has no distance filter on NeoForge (no NF-CHAT; delta note section 1).
- **The card, for the ruling "a non-agent line is not heard" (and only for it).** may-edit `golem/src/voice/ears.ts`, `golem/src/voice/ears-hidden.test.ts` (new), `golem/src/adam/adam-body.ts` (the `new BotEars({...})` options at `:298-304`, serial after NF-F6), `golem/src/perception/hidden-player-leakage.test.ts` (the pending-channel test only), `docs/analysis/harness/worknotes/NF-F3.md`. Steps: (1) add `hidden?: (from: string) => boolean` to `BotEarsOptions` with the doc comment "true drops the line before the ring, the event and the wake (NF-F3)"; (2) in `hear`, directly after `if (!from || !text) return;`, add `if (this.opts.hidden?.(from) === true) return;`; (3) in `adam-body.ts`, pass `hidden: (from) => isHiddenName(bot, from)`. A line whose sender comes only from `senderName` (no UUID match) is checked by that text, so a display name that is not a username is dropped when the switch is on (fail closed; note it in the worknote). Tests: `on: a hidden speaker's line is not in heard, not published, and wakes nothing`; `on: an agent's line is heard as today`; `off: the hidden option absent, every line is heard as today`. Revert-check: remove the line in `hear`: the first test fails. Then flip NF-F5b's `KNOWN LEAK until NF-F3` test into `on: heard carries no non-agent name` (the same fixture, the opposite expectation). Commit `feat(golem): a hidden speaker is not heard when the switch is on (NF-F3)`.
- **stop and report** for any other ruling (a nameless voice, a muffled notice, a mystery text, a distance rule): that is a new card with OWNER APPROVAL REQUIRED text (R11 of the sheet rules), probably a `prompts/` or contract change.

## NF-F4: text viewport and image reader

- **id** NF-F4. **repo** geldar. **branch** `phase1/nf-f4-hidden-view`. **worktree** `.claude/worktrees/nf-f4`. **depends-on** NF-F0, NF-F6. **size** 25k. **Status** PENDING; then BlockedDependency: NF-F6.
- **Why.** The text viewport (MCP `view`) draws a player as `player` (`viewport.ts:211`). The image (MCP `see`) draws every sighted entity (`reader.ts:41-58`). A drawn figure of a person is the agent perceiving a human as a person. With the switch on, a hidden player is not drawn. What, if anything, is drawn instead is OQ-3 and is not decided here.
- **may-edit** `golem/src/perception/view/viewport.ts`, `golem/src/body-image/reader.ts`, `golem/src/perception/view/viewport-hidden.test.ts` (new), `golem/src/body-image/reader-hidden.test.ts` (new), `docs/analysis/harness/worknotes/NF-F4.md`.
- **must-not-edit** R6; `golem/src/perception/view/viewport.test.ts`, `golem/src/body-image/reader.test.ts`, `golem/src/viewport/**`.
- **steps.**
  1. `viewport.ts` `viewFromBot`, the entity loop (lines 204-217): after the `if (entity.position.equals(bot.entity.position)) continue;` line, add `if (isHiddenPlayer(bot, entity)) continue;`. Import from `../player-filter.ts`. `BotEntity` must carry `username?: string`. If it does not, add that one optional field to the local interface and nothing else.
  2. `reader.ts` `entitiesInSight` (lines 41-59): after `if (entity === bot.entity) continue;`, add `if (isHiddenPlayer(bot, entity)) continue;`. Import from `../perception/player-filter.ts`.
- **tests** (named). `reader-hidden.test.ts` (fixtures as `reader.test.ts:30-60`): `on: a hidden player is not in the image entities`; `on: an agent player and a zombie still are`; `off: a non-agent player is drawn as today`. `viewport-hidden.test.ts`: build a minimal fake bot: `entity` `{ position, yaw: 0, pitch: 0, eyeHeight: 1.62 }`, `entities` (one hidden player, one agent player, one zombie), and `world.getBlock` returning `null`. Call `viewFromBot`, then assert on `world.mobs`: `on: a hidden player is not a view mob`; `off: it is a view mob named player`.
- **revert-checks** (1) remove the `viewport.ts` line: `on: a hidden player is not a view mob` fails. (2) remove the `reader.ts` line: `on: a hidden player is not in the image entities` fails.
- **checks** `GATE-F` (`@geldar/golem`); `./geldar.ps1 pnpm test golem/src/perception/view golem/src/body-image`.
- **exit** all green; existing viewport and reader tests unchanged.
- **stop and report** if the minimal fake for `viewFromBot` needs more than about 40 lines, or reads a field this card does not name. Then write only the reader half, commit it, and put the question in the worknote.
- **commit** `feat(golem): a hidden player is not drawn in the view or the image (NF-F4)`.

## NF-F5a: MCP second line

- **id** NF-F5a. **repo** geldar. **branch** `phase1/nf-f5a-mcp-agents-only`. **worktree** `.claude/worktrees/nf-f5a`. **depends-on** NF-F0. Its key is the one NF-F6 defines; it reads it independently. **size** 30k. **Status** PENDING; then BlockedDependency: NF-F0.
- **Why.** The Body is the first line. The MCP is the agent's only edge on a shard whose agents play through it, so it drops any `agents[]` entry that is not an agent name, whatever the Body sent. It changes nothing when the switch is off. It does not touch speech (NF-F3, OQ-1).
- **may-edit** `threshold/mcp/src/config-perception.ts` (new), `threshold/mcp/src/config-perception.test.ts` (new), `threshold/mcp/src/config.ts` (two lines: one import, one field), `threshold/mcp/src/agents-only.ts` (new), `threshold/mcp/src/agents-only.test.ts` (new), `threshold/mcp/src/body-gateway.ts`, `threshold/mcp/src/main.ts` (one line at `:362`), `docs/analysis/harness/worknotes/NF-F5a.md`.
- **must-not-edit** R6; `threshold/mcp/src/play-view/**`, `threshold/mcp/src/tools/**`, `threshold/mcp/src/events/**`, `threshold/mcp-mock/**`, `threshold/mcp/src/config.test.ts`.
- **steps.**
  1. `config-perception.ts`: `export function readAgentsOnly(root: Record<string, unknown>): boolean`, the same rule as NF-F6 step 2. Missing block or key, or `all`, gives false. `agents_only` gives true. Anything else throws `new Error('body_perception.players must be all or agents_only')`.
  2. `config.ts`: add `agentsOnly: boolean;` to `McpConfig` (line 87), with the doc comment `` `body_perception.players` is `agents_only` (NF-F5a) ``. In `parseMcpConfig` (line 186), add `agentsOnly: readAgentsOnly(root),` to the returned object. Two lines plus the import, nothing else. If the file would pass 480 lines, stop.
  3. `agents-only.ts`: `export function withAgentsOnly(snapshot: Snapshot): Snapshot` returns a copy in which `surroundings.agents` keeps only the entries whose `name` passes `isAgentUsername` (from `@geldar/contract`). Every other field is the same object reference. A snapshot with no `surroundings` or no `agents` is returned unchanged.
  4. `body-gateway.ts`: add `agentsOnly?: boolean` to `NatsBodyGatewayOptions`, with the doc comment `Drop non-agent names from surroundings.agents (NF-F5a). Default: off`. Store it in the constructor. In `snapshot(lifeId)`, when it is true, map the resolved snapshot through `withAgentsOnly`. When it is false or unset, return the promise exactly as today.
  5. `main.ts:362`: `new NatsBodyGateway({ transport: nats.request, shard: config.shard, agentsOnly: config.agentsOnly })`.
- **tests** (named). `config-perception.test.ts`: `missing is off`; `all is off, agents_only is on`; `an unknown value throws`; `the phase0 shard file reads as off`. `agents-only.test.ts`: `drops a non-agent name and keeps agents in order`; `keeps every other field by reference`; `a snapshot with no agents is unchanged`. Also there, with a fake transport as in `body-gateway.test.ts`: `gateway on: a non-agent agents entry never leaves snapshot()`; `gateway off: the snapshot is byte-identical to the transport's` (`JSON.stringify` equality).
- **revert-checks** (1) skip `withAgentsOnly` in the gateway: `gateway on: ...` fails. (2) make `readAgentsOnly` default to true: `missing is off` fails. (3) filter with `name.startsWith('ag_')`: add the case `ag_Kestrel` (not an agent) to `drops a non-agent name`, which then fails.
- **checks** `GATE-F` (`@geldar/mcp`); `./geldar.ps1 pnpm test threshold/mcp/src/config threshold/mcp/src/agents-only threshold/mcp/src/body-gateway`.
- **exit** all green; `config.test.ts`, `body-gateway*.test.ts`, `main.test.ts` unchanged and green; `config.ts` under 480 lines, `main.ts` under 510.
- **stop and report** if the MCP config builder is not `parseMcpConfig` at `config.ts:186`; if the gateway is built anywhere other than `main.ts:362` (list the places; do not edit them).
- **commit** `feat(mcp): drop non-agent names from surroundings.agents when the switch is on (NF-F5a)`.

## NF-F5b: leakage gate

- **id** NF-F5b. **repo** geldar. **branch** `phase1/nf-f5b-leakage-gate`. **worktree** `.claude/worktrees/nf-f5b`. **depends-on** NF-F1, NF-F2, NF-F4, NF-F5a. **size** 35k. **Status** PENDING; then BlockedDependency.
- **What it proves.** With the switch on, a non-agent player standing in plain sight never appears, by name or as a drawn player, in any output an agent can reach through the Body or the MCP, except in the channels still pending a ruling, which are listed by name and asserted as known leaks so they cannot be forgotten. With the switch off, the same scan finds the name, which proves the scan is not theatre.
- **may-edit** `golem/src/perception/hidden-player-leakage.test.ts` (new), `threshold/mcp/src/agents-only-leakage.test.ts` (new), `docs/analysis/harness/worknotes/NF-F5b.md`. Tests only: no production file.
- **steps.**
  1. Golem test. One fixture: `FakeWorld` with the Body, an agent `ag_kestrel_01` and a non-agent `Wanderer7` (tab-list display name `Wanderer Seven` via `world.setPlayer`), both visible, plus a zombie. `const NAMES = ['Wanderer7', 'Wanderer Seven'];`. `function leaks(value: unknown): string[]` returns the entries of `NAMES` found in `JSON.stringify(value)`. Outputs scanned, each in its own `it`: `observeEntities(bot)`; `findVisibleAgent(bot, n)` for each of `Wanderer7`, `Wanderer Seven`, `wanderer7`, `player`; `isUsernameVisible(bot, 'Wanderer7')` (expect false); `findTarget(bot, 'player')` and `findTarget(bot, 'Wanderer7')` (expect neither to be the `Wanderer7` entity); the effect `snapshot(bot, { do: 'attack', target: 'player' })` targets map (no id of `Wanderer7`); `entitiesInSight(bot)` (count equals agent plus zombie); `viewFromBot(bot).world.mobs` (no entry at `Wanderer7`'s position).
  2. Golem pending channel, as a test with an explicit name: `KNOWN LEAK until NF-F3 (OQ-1): heard carries a non-agent name`. Build a `BotEars` with fake `executor` and `events`, call `hear('Wanderer7', 'hello Kestrel')`, and expect `leaks(ears.heard())` to equal `['Wanderer7']`. The comment above it says: NF-F3 replaces this test. Do not delete it to make a run green.
  3. Golem off case: `off: the same scan finds Wanderer7 in observeEntities` (flag not set). This must fail if the scan is broken.
  4. MCP test (`threshold/mcp/src/agents-only-leakage.test.ts`). A `Snapshot` fixture (copy the smallest valid one from an existing MCP test; name the source file in the worknote) with `surroundings.agents` = `[{ name: 'Wanderer7', ... }, { name: 'ag_kestrel_01', ... }]` and one `heard` line from `Wanderer7`. Through a gateway with `agentsOnly: true` and a fake transport, then `toPlayView(snapshot, { budget: 1, daysSinceSleep: 0 })`: `on: the play view snapshot part carries no non-agent name`. The pending part as its own named test: `KNOWN LEAK until NF-F3 (OQ-1): untrusted speech carries the heard line's name` (expect it present). Off: `off: the play view lists Wanderer7` (expect present).
- **tests** as named in the steps.
- **revert-checks** (1) revert NF-F1 step 1 locally: the `observeEntities` scan fails. (2) revert NF-F2 step 1: the `findTarget` scan fails. (3) revert NF-F4 step 2: the `entitiesInSight` scan fails. (4) revert NF-F5a step 4: the MCP `on:` test fails. Restore each one.
- **checks** `GATE-F` (`@geldar/golem`, `@geldar/mcp`); `./geldar.ps1 pnpm test golem/src/perception/hidden-player-leakage threshold/mcp/src/agents-only-leakage`.
- **exit** all green, including the two `KNOWN LEAK` tests (they assert the leak exists, named, until NF-F3).
- **stop and report** if any scanned function's signature differs from the facts table; if building a valid MCP `Snapshot` fixture needs more than copying one; or if a scan finds a leak this card does not name (write it down: it is a finding, not a test to weaken).
- **commit** `test: leakage gate for hidden players, with the pending speech channel named (NF-F5b)`.

## Index lines to add (orchestrator)

Ledger rows, once the operator confirms the model: NF-F0 (25k), NF-F6 (35k), NF-F1 (30k), NF-F2 (25k), NF-F2w (15k, BlockedDecision OQ-4, OQ-3), NF-F3 (30k, BlockedDecision OQ-1), NF-F4 (25k), NF-F5a (30k), NF-F5b (35k). Total about 250k. Track: "NF body filter". A decision record for the invisible-hand model (revising 0329) is the operator's and comes before dispatch. These cards cite it by number once it exists.
