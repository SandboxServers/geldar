# World cards B: observed evidence, programs, full evidence, property refusal (W5, W7, W8, W9)

Cards for the **world track** of the harness campaign. They are executed in the **geldar repo** (`SandboxServers/geldar`) by that repo's orchestrator, under geldar's rules (`docs/analysis/phase1/packet-conventions.md`, `CLAUDE.md`, `AGENTS.md`): one worktree per packet, a fresh read-only reviewer per packet, ops merges and runs live checks, number reservations are the orchestrator's. This file only supplies the card text; the scriptorium repo changes nothing in geldar. Status of every card: **proposal, not Ready** until the orchestrator has allocated numbers, recorded the D-CS answers and resolved every `(to confirm)`.

Written 2026-11-14 against geldar `origin/main`. The brief said `907f5b8a`; a `git fetch` before reading moved `origin/main` to `a1c6fb2a` (four commits later: the Body `till` action, PR #343). Every path below was read at `a1c6fb2a`. The original plan's base is `8eac28ba` (66 commits earlier). Differences are listed in `## Open items`.

Sources: `geldar-an-work-packets.md` (original candidate cards, the base text), `integration-plan.md` (findings F1-F16 and the 16 architecture rules, binding), `decisions-before-packets.md` (the recommended D-CS answers are assumed), the brief sections 5.2-5.6, 6.3, 7, 9, [retarget-map.md](retarget-map.md). Cards AN-20, AN-38 and AN-48 are deferred (see `## Deferred`).

## What the kit sees, and why it matters for these cards

The kit (the one Mind) reads the world only through the MCP server `threshold/mcp` (`wait`, `look`, `act`). That server reads the event stream with the subject list `mindEventSubjects()` and the normaliser `normaliseEvent()` from **`animus/src/link/mind-event.ts`**, validates `act` thoughts with **`animus/src/validate/*`** (`PHASE0_PROGRAMS`, `PROGRAM_ARGS`), and builds plans with `animus/src/loop/plan.ts`. So the in-house Mind is abandoned as a *Mind* (D-HC-01) but `animus/` is **live shared code on the player path**. Cards below name the exact `animus/` files they must touch (the PX-4 `heard_sound` event is the precedent: one contract schema, one `animus/src/link/mind-event.ts` row, one MCP handler, one presenter, one `SimEvent` kind). Nothing in `animus/src/` is edited for Mind behaviour.

## Waves and shared owners

Wave order, as in the original: W5 then W7 then W8 then W9. Integration branches `codex/character-sheet-w5`, `-w7`, `-w8`, `-w9` (the kept name from the original; the geldar orchestrator may rename them). Each wave branches from the last merged wave. W5 needs W1-W2 (geldar A) merged; W7 needs W5; W8 needs W7; W9 needs W8.

| Wave | Contract and generated owner | Shared wiring owner | Manifest and lockfile | Shard, ACL, image owner |
|---|---|---|---|---|
| W5 | AN-24 | AN-28a (delivery path through `animus/` and MCP), AN-28b (Body startup, plugin setup) | none expected (no new dependency) | AN-28b (`geldar.ps1` ACL table and its two tests) |
| W7 | AN-44 | AN-45 | none | none |
| W8 | AN-46 | AN-50 | none | AN-50 (plugin setup lines, ACL if a subject is added) |
| W9 | AN-52 | AN-53 | none | AN-53 (Body startup only) |

Parallel cards hand shared-file requests to the owner as `index line to add` in their worknote, as the conventions require. Order inside W5: AN-24 first; AN-25 and AN-27a in parallel; AN-26a and AN-27b after their dependencies; AN-28a, then AN-28b. Order inside W7: AN-44; AN-39, AN-40, AN-41 in parallel; AN-45. Order inside W8: AN-46; AN-47a, AN-49, AN-51a in parallel; AN-47b, AN-51b; AN-50. Order inside W9: AN-52; AN-37; AN-53.

## Shared contract names (created by the unblockers, used by the others)

| Name | Created by | Shape |
|---|---|---|
| `contract/schemas/observation-event.schema.json` (new), title `ObservationPayload`, validator `validateObservationPayload` | AN-24 (W5 kinds `gift_received`, `property_broken`); AN-46 appends `fight_seen`, `container_taken` | `{kind, actor?, ...fields, key}`; `actor` is `ObservedActor` `{name, life}` and is absent when the actor was not visible |
| WorldEvent type `observation` (3-token subject `geldar.<shard>.observation`, `agent_id` = the observer) | AN-24 (name), AN-28b (publish) | payload = `ObservationPayload` |
| `damage` payload field `actor` | AN-24 (schema), AN-25 (producer) | optional `ObservedActor`; absent means the old bytes |
| `contract/schemas/provenance.schema.json` (new), title `Provenance`, validator `validateProvenance` | AN-24 (W5 kinds `BreakProvenance`, `PickupProvenance`); AN-46 appends `TakeProvenance`, `CombatProvenance` | raw infrastructure facts from the plugin, Body-only |
| Subjects `geldar.<shard>.provenance.break`, `.pickup`, later `.take`, `.combat`; helpers `provenanceBreakSubject`, `provenancePickupSubject` (W8: `provenanceTakeSubject`, `provenanceCombatSubject`), wildcard `provenanceWildcard(shard)` = `geldar.<shard>.provenance.>` | AN-24 (W5), AN-46 (W8) | four tokens, so outside the sink filter `geldar.*.*` (the 0165 design); only the Body role may subscribe, only the plugin role may publish |
| `McpPlayerEvent` `type` values `gift_received`, `property_broken` (and W8 `fight_seen`, `container_taken`); optional fields `actor {name}`, `item`, `count`, `block` | AN-24 (W5), AN-46 (W8) | fixed template text, name only in the structured `actor` field |
| `contract/schemas/program-shapes.schema.json` (new), validator `validateProgramShapes`; shapes `ExploreArguments`, `FarmArguments`, `PatrolArguments`, their checkpoints and details | AN-44 | see AN-44 |
| Reason code `declined` (property refusal) | AN-52 | `action-outcome-event.schema.json` enum, `outcome-words.ts`, `golem/src/actions/outcome.ts` |
| `golem/src/perception/provenance/` (new directory) | AN-25 creates `visible-actor.ts`; AN-26b, AN-27b, AN-47b, AN-51b add one filter each; AN-28b adds `subscribe.ts` | the Body's observer-side filters |
| `golem/src/actions/property-refusal.ts` (new) | AN-37 | pure policy plus a module-level setter, like `setOwnerLookup` in `protected-blocks.ts` |

Naming rule: the tails of the generated validators come from `title` and union `type` constants (`contract/scripts/generator.ts`). **Never name a `$defs` entry `*Input` or `*Result`**: the generator turns each pair into an MCP tool and throws on an unpaired one.

## Common blocks (every card uses them; the orchestrator pastes them verbatim into the dispatch)

**MNE-BASE (must-not-edit unless the card owns the file):** `docs/spec.md`; any accepted `docs/decisions/*.md`; any merged `sql/NNNN_*.sql` and `prompts/**` file; generated output by hand (`contract/src/generated/**`; regenerate instead); other packets' worknotes; every `package.json` and `pnpm-lock.yaml`; `geldar.ps1`; `shards/*.yaml`; `compose/**`; `docs/decisions/README.md` and `sql/README.md` (ops adds index lines); the shared wiring files `golem/src/adam/adam-body.ts`, `golem/src/body/programs/index.ts`, `golem/src/body/executor*.ts`, `animus/src/link/mind-event.ts`, `animus/src/ports/body.ts`, `animus/src/validate/bounds.ts`, `threshold/mcp/src/events/handlers/index.ts`, `threshold/mcp/src/events/present-handlers/index.ts`, `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java`, `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java`, `contract/**` (each only for the card the wave table names as its owner). Never: `adam up`, state-changing probes on a live shard, weakening a test, `git reset`/`stash`/`checkout` on tracked work, pushing, opening a PR, pruning a worktree (conventions section 5).

**Gates (G-base):** run in the worktree, through `./geldar.ps1 pnpm` when pnpm is not installed.

1. Targeted test: `./geldar.ps1 pnpm test <path substring>` (vitest, the repo's one runner; the card names the paths).
2. Typecheck of each touched package: `./geldar.ps1 pnpm --filter @geldar/<golem|contract|mcp|eventsink|animus> typecheck`.
3. Format: `./geldar.ps1 pnpm format`, then `git diff --check`.
4. Repo checks: `./geldar.ps1 pnpm check:repo` (file caps 500 soft / 700 hard; decision index; nats auth).
5. Contract cards only: `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated`.
6. Plugin cards only: `(cd plugin; ./gradlew :core:test --tests '<class>')` then `(cd plugin; ./gradlew build)`. The `:core:test` task path follows `include("core")` in `plugin/settings.gradle.kts` (to confirm on first run).
7. Dry merge: `git merge-tree --write-tree codex/character-sheet-w<N> HEAD` reports no conflict.
8. Revert-check: for **each behaviour** the card lists, temporarily revert the named change, run the named test, see it fail, restore. The report names the test.
9. Real NATS, Postgres, plugin and real-client cases are **ops**, serial, and are not a coder gate (listed per card as `ops`). Never run `adam up`.

**Standard on-cap (every card):** commit what passes, write the base SHA, the tests run and the unfinished steps into the worknote and the report, leave a clean branch, stop. No push, no deploy, no weakened test, no invented design.

**Size (every card):** Haiku-class coder, at most about 50k working tokens including reading, checks and the report. Review, fix and ops usage is separate. A card that grows past that is split before dispatch (done below: AN-26, AN-27, AN-28, AN-47, AN-51).

**Worknote path:** `docs/analysis/character-sheet/worknotes/<id>.md` (new directory unless geldar A created it; to confirm). **Worktree:** `C:\Users\Steve\source\projects\geldar\.claude\worktrees\an-<nn>` (the brief supplies the absolute path). **Branch:** `codex/an-<nn>-<slug>` from the named wave branch.

**Number rule:** ADR, migration and prompt numbers are never allocated by a card. Each card writes `<allocate via registry>` and the orchestrator fills it, using `docs/analysis/phase1/packets/decision-number-registry.md`.

## Registry check at `a1c6fb2a` (a recommendation, not an allocation)

Read from `docs/decisions/README.md`, `ls sql/`, `ls prompts/` and a scan of all 308 remote branches for added decision, SQL and prompt files.

| Series | On main | In flight on a branch | Reserved | Free to recommend |
|---|---|---|---|---|
| ADR | highest `0181` (0158, 0159, 0161 are gaps) | `0169` (`phase1/players-host-restart`), `0173` (`phase1/c7-wave3`) | `0173-0179` for C7 (registry file) | `0182` and up. This campaign needs four: observed evidence (W5), programs (W7), evidence sources and exchange (W8), property refusal and the 0164 amendment (W9). Recheck at dispatch; the registry file itself is stale (its "next free" lines stop at 0147) |
| SQL | highest `0034` (`0028-0031` are not on main; C7 reserved `0024-0033`) | `0035`, `0036` (`phase1/c7-wave3`) | C7 range | `0037` and up. **None of these cards needs SQL** unless AN-46 finds the award ledger constrains `evidence_kind` (see AN-46) |
| prompts: thought | `v1-v5` | none | `v6` C3-03, `v7` C4-06 | `v8` and up. These cards add no thought or reflection prompt |
| prompts: reflection | `v1-v2` | none | none | `v3`. Not used here (reflection inputs are kit-local, HC-32) |
| prompts: body-api | `v1-v7` (`v7` is the `till` verb, decision 0167) | none | none | **`v8`. The brief's "body-api v7" for the new programs is stale.** AN-45 publishes `prompts/body-api/v8.json` |

## Gate language the cards share

- **Observer** = the life whose Body runs the filter. **Visible** = `findVisibleAgent(bot, name)` (`golem/src/perception/visible-agent.ts`: a loaded player entity within `ENTITY_RANGE` = 24 blocks and a clear line, never a lookup in `bot.players`). A block is visible when it is within 24 blocks and `canSeePoint` / `canSeeBlock` (`golem/src/perception/notable-blocks.ts`) holds.
- **Actor identity** = `{ name, life }` with `name` the visible username and `life` = `lifeIdFor(name)` from `golem/src/registry.ts` (deterministic; a LifeId username is returned unchanged). Whether a new life of the same owner reuses a username is `(to confirm)`; if it does, `life` alone does not prove "same life", and the observation key below carries the world tick so no two lives are merged by name.
- **Config gate** = the Body's own-life character config from geldar A (AN-05/AN-12): observed-evidence code runs only when `mode: sheet` and `tom.enabled: true`. The accessor name is `(to confirm: geldar A)`. Off or omitted means the old bytes: no `actor` in `damage`, no `observation` event, no subscription work.
- **No true score, no label, no hidden fact** appears in any payload these cards define, and no card writes coaching or game-knowledge text.

---

## W5: evidence an observer can actually know

### AN-24: observed-actor contract unblocker

- **id** AN-24. **wave** W5. **depends-on** AN-12 (geldar A, W2 close); owner ruling D-CS-06 recorded.
- **decisions** D-CS-06 (visible, causal actor evidence only; unknown stays unknown). ADR `<allocate via registry>` (observed evidence; one record for the whole of W5, written by this card).
- **Deliver** (all in `contract/`, then regenerate):
  1. `contract/schemas/observation-event.schema.json` (new). Shape:
     ```jsonc
     { "$id": "https://geldar.dev/schemas/observation-event.schema.json", "title": "ObservationPayload",
       "$ref": "#/$defs/Observation",
       "$defs": {
         "ActorName": { "type": "string", "pattern": "^[A-Za-z0-9_]{3,16}$" },
         "ObservedActor": { "type": "object", "additionalProperties": false, "required": ["name", "life"],
           "properties": { "name": { "$ref": "#/$defs/ActorName" }, "life": { "$ref": "common.schema.json#/$defs/LifeId" } } },
         "Observation": { "oneOf": [ { "$ref": "#/$defs/GiftReceived" }, { "$ref": "#/$defs/PropertyBroken" } ] },
         "GiftReceived": { "type": "object", "additionalProperties": false, "required": ["kind", "item", "count", "key"],
           "properties": { "kind": { "const": "gift_received" }, "actor": { "$ref": "#/$defs/ObservedActor" },
             "item": { "$ref": "common.schema.json#/$defs/ItemName" }, "count": { "type": "integer", "minimum": 1, "maximum": 2304 },
             "key": { "type": "string", "pattern": "^[a-z0-9:_-]{8,96}$" } } },
         "PropertyBroken": { "type": "object", "additionalProperties": false, "required": ["kind", "block", "key"],
           "properties": { "kind": { "const": "property_broken" }, "actor": { "$ref": "#/$defs/ObservedActor" },
             "block": { "$ref": "common.schema.json#/$defs/ItemName" }, "key": { "type": "string", "pattern": "^[a-z0-9:_-]{8,96}$" } } } } }
     ```
     `PropertyBroken` exists only for a block the observer owned (see AN-27b); there is no coordinate and no prior-owner name. `key` is the observation's stable identity (one observation, one key, through wake and digest).
  2. `contract/schemas/hurt-event.schema.json`: add optional `actor` (`$ref` to `observation-event.schema.json#/$defs/ObservedActor`) to `HurtEvent`. Old payloads without it stay valid.
  3. `contract/schemas/provenance.schema.json` (new), title `Provenance`, `oneOf` `BreakProvenance` `{ world, x, y, z, actor: string|null, prior_owner: string|null, block: ItemName, tick }` and `PickupProvenance` `{ world, picker, thrower: string|null, item, count, age_ticks, distance: number|null, tick }`. Reuse `WorldName`, `BlockCoordinateXZ/Y` and `OwnerId` from `block-owner.schema.json`. `actor`, `picker` and `thrower` are Bukkit player names (the plugin has no life ids; `EventExporter.emit` only maps a name that already is a LifeId). These are raw infrastructure facts: never agent-facing.
  4. `contract/src/subjects.ts`: add, with the existing `SHARD` check and no new wildcard token,
     ```ts
     export function provenanceBreakSubject(shard: string): string   // geldar.<shard>.provenance.break
     export function provenancePickupSubject(shard: string): string  // geldar.<shard>.provenance.pickup
     export function provenanceWildcard(shard: string): string       // geldar.<shard>.provenance.>
     ```
  5. `contract/schemas/mcp-common.schema.json`: `McpPlayerEvent.type` enum gains `gift_received`, `property_broken`; new optional properties `actor` (`{name}`, same `ActorName` pattern), `item` (ItemName), `count` (integer 1-2304), `block` (ItemName). Description: "`actor` is a name the player already sees in `snapshot.agents`; present only when the actor was in sight."
  6. `contract/src/outcome-words.ts`: `observationSentence(input: { kind: unknown; item?: unknown; count?: unknown; block?: unknown }): string`, fixed templates built from codes and an item list pattern only: `gift_received` -> `You received 3 bread.`; `property_broken` -> `Someone broke one of your blocks (oak planks).`. An unknown kind reads `Something happened.` The name never enters the text. `contract/src/index.ts`: export `validateObservationPayload`, `validateProvenance`, their types, the three subject helpers and `observationSentence`.
- **may-edit** `contract/schemas/observation-event.schema.json` (new), `contract/schemas/provenance.schema.json` (new), `contract/schemas/hurt-event.schema.json`, `contract/schemas/mcp-common.schema.json`, `contract/src/subjects.ts`, `contract/src/outcome-words.ts`, `contract/src/index.ts`, `contract/src/generated/**` (by `generate` only), `contract/test/observation.test.ts` (new), `contract/test/mcp-play.test.ts` (only to extend its enum fixture), `docs/decisions/<allocate via registry>-observed-evidence.md` (new), worknote.
- **must-not-edit** MNE-BASE. No runtime consumer, no `golem/`, `plugin/`, `animus/`, `threshold/`.
- **checks** `./geldar.ps1 pnpm test contract/test/observation` and `contract/test/mcp-play` and `contract/test/agent-visible-text`; G-base 2-5, 7. Tests: an attributed and an unattributed gift; a hurt payload with and without `actor`; a name with a space, a dot or 17 characters is rejected; `life` not matching the LifeId pattern is rejected; an observation is not a valid `Provenance` and the reverse; old `damage`/`hurt` fixtures in `contract/test/px-perception.test.ts` still pass unchanged; `observationSentence` output passes `markedWords`.
- **size** 35-45k.
- **worknote** `docs/analysis/character-sheet/worknotes/AN-24.md`. **commit** `feat(character): observed-actor contract (observation, provenance, hurt actor)`. **on-cap** standard. **branch** `codex/an-24-observed-contract`.
- **revert-checks** (1) remove the `ActorName` pattern: the "name with a space is rejected" test fails. (2) make `actor` required on `GiftReceived`: the "unattributed gift is valid" test fails. (3) drop the `actor` property from `HurtEvent`: the "hurt with actor" test fails. (4) let `observationSentence` interpolate a name: the markedWords/no-name test fails.

### AN-25: visible attacker identity

- **id** AN-25. **wave** W5. **depends-on** AN-24. **decisions** D-CS-06; ADR from AN-24.
- **Read first (verified):** `golem/src/perception/hurt-trigger.ts` already takes the attacker from the damage packet's cause entity (`entityHurt(entity, cause)`), never from proximity; `golem/src/perception/hurt.ts` (`HurtInput.attacker: {x,z}|null`, `hurtEvent`, `HurtReporter`); Adam and every player share `startAdamBody` (`golem/src/adam/adam-body.ts`, where `watchHurts` is wired), so one change covers both. The snapshot has no attacker field and `hurt` is not in it, so there is no snapshot path to change (the original card's "event and snapshot paths" reduces to the event path).
- **Deliver:**
  1. `golem/src/perception/provenance/visible-actor.ts` (new): the one resolver the other W5/W8 filters reuse.
     ```ts
     export interface ObservedActor { name: string; life: string }
     /** Visible, named actor or null. Never a bot.players lookup, never nearest-player. */
     export function observedActor(bot: Bot, username: string | undefined): ObservedActor | null
     ```
     `null` when `username` is undefined, equals `bot.username`, fails `^[A-Za-z0-9_]{3,16}$`, or `findVisibleAgent(bot, username)` is null. `life` = `lifeIdFor(username)` (import from `golem/src/registry.ts`; its NATS imports are heavy for a pure helper, so if the import breaks a unit test move nothing and instead inject `lifeIdFor` as a parameter with a default (`to confirm`)).
  2. `hurt-trigger.ts`: `attackerOf` also returns the cause entity's `username` when `type === 'player'`; `watchHurts(bot, reporter, tick, resolve?)` gains an optional fourth parameter `resolve: (username: string | undefined) => ObservedActor | null`. With no resolver the behaviour and the bytes are exactly today's.
  3. `hurt.ts`: `HurtInput` gains `actor?: ObservedActor | null`; `HurtEvent` gains optional `actor`; `hurtEvent` copies it only when non-null. `hurtWorldEvent` puts `actor` in the damage payload only when present.
  4. Never: a nearby player who is not the cause; a cause that is a player who is not visible (the hit stays anonymous: `source` and `bearing` only); a mob (`actor` is for players; `mob` stays out of scope).
- **may-edit** `golem/src/perception/provenance/visible-actor.ts` (new), `golem/src/perception/hurt.ts`, `golem/src/perception/hurt-trigger.ts`, `golem/src/perception/hurt.test.ts`, `golem/src/perception/hurt-trigger.test.ts`, `golem/src/perception/provenance/visible-actor.test.ts` (new), worknote. Registration in `adam-body.ts` is AN-28b's (index line).
- **must-not-edit** MNE-BASE, `golem/src/perception/visible-agent.ts`.
- **checks** `./geldar.ps1 pnpm test golem/src/perception/hurt` and `golem/src/perception/provenance`; G-base 2-4, 7. Cases: melee hit by a visible player; arrow whose shooter is a visible player; hit by a player out of sight or behind a wall (anonymous); hit by a zombie with a nearby innocent player (no actor); fall, fire, starvation (no actor); two players, only the cause named; a display name reused by another entity; `resolve` omitted (identical bytes to before).
- **size** 35-45k. **worknote** `docs/analysis/character-sheet/worknotes/AN-25.md`. **commit** `feat(character): name a visible player as the cause of a hurt`. **on-cap** standard. **branch** `codex/an-25-visible-attacker`.
- **revert-checks** (1) make `observedActor` skip the `findVisibleAgent` test: "hidden attacker stays anonymous" fails. (2) fall back to the nearest player when no cause: "innocent nearby player" fails. (3) always emit `actor`, also with no resolver: "no resolver keeps the old payload" fails.

### AN-26a: pickup provenance in the plugin

- **id** AN-26a. **wave** W5. **depends-on** AN-24, AN-27a (shares `ProvenanceSink`). **decisions** D-CS-06.
- **Why a plugin card:** the client has no thrower on an item entity (the spawn packet carries only the stack), so a recipient Body cannot learn who threw an item from mineflayer events. Paper's `Item#getThrower()` (UUID) is the causal source `(to confirm: API and mapping UUID -> player name)`.
- **Deliver** `plugin/core/src/main/java/dev/geldar/core/blockowner/PickupProvenanceListener.java` (new; the package is where the NATS link lives): `@EventHandler(priority = MONITOR, ignoreCancelled = true) void onPickup(EntityPickupItemEvent e)`; return unless the entity is a `Player` and `e.getItem().getThrower()` is non-null and differs from the picker. Build `PickupProvenance` JSON (`picker`, `thrower` name or null if unresolvable, `item` = material key without namespace, `count` = amount taken `(to confirm: use getRemaining())`, `age_ticks` = `getTicksLived()` `(to confirm)`, `distance` = horizontal blocks between thrower and picker when both online else null, `world`, `tick`) and hand it to `ProvenanceSink.send("pickup", json)`. A bounded queue: at most 64 messages per tick, drop and count beyond 1024 pending (same pattern as `BlockOwnerPublisher`). No message for a death drop (thrower null), a hopper or a mob pickup.
- **may-edit** `.../blockowner/PickupProvenanceListener.java` (new), its test `plugin/core/src/test/java/dev/geldar/core/blockowner/PickupProvenanceListenerTest.java` (new, built like `OwnerOverlayTest` with the fakes in `ListenerDoubles.java`), worknote. Registration and the `provenance.enabled` flag are AN-28b's.
- **must-not-edit** MNE-BASE, `BlockOwnerSetup.java`, `NatsBlockOwnerLink.java` (AN-27a added `send`).
- **checks** `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.PickupProvenanceListenerTest')`; G-base 4, 6, 7. Cases: thrown by another player and picked up (one message, correct fields); picked up by the thrower; no thrower; thrower offline; stack split into two partial pickups (two messages, counts add to the stack, each own key material); queue cap; the sink is not called when the sink is null (flag off).
- **size** 35-45k. **worknote** `.../worknotes/AN-26a.md`. **commit** `feat(character): publish pickup provenance from the plugin`. **on-cap** standard. **branch** `codex/an-26a-pickup-provenance-plugin`.
- **revert-checks** (1) drop the `thrower != picker` test: "picked up by the thrower sends nothing" fails. (2) send for a null thrower: "death drop sends nothing" fails. (3) remove the per-tick cap: the cap test fails. `ops`: real two-player toss and pickup on a scratch shard, payload captured and attached to the worknote before AN-26b writes parser fixtures from it.

### AN-26b: observed gift in the recipient's Body

- **id** AN-26b. **wave** W5. **depends-on** AN-24, AN-25, AN-26a. **decisions** D-CS-06.
- **Rule (the intended-gift test):** a pickup becomes `gift_received` for the **picker only** when all hold: the observer is the `picker`; `age_ticks <= 100` (the give action waits 5 s = 100 ticks, `PICKUP_WAIT_MS` in `golem/src/actions/give.ts`); the thrower is a visible player now (`observedActor`) and within `GIVE_REACH + 3` blocks. Otherwise: an item picked up from an unseen or far thrower, or an old drop, is **not** a gift observation at all (it is loot). If the thrower is not visible but the pickup was fresh and close (`distance <= GIVE_REACH + 3` from the plugin), emit the gift **without `actor`** (the observer got something and cannot say from whom). Third-party onlookers get nothing in round one (listed inactive in AN-50).
- **Deliver** `golem/src/perception/provenance/gift.ts` (new): `export function observeGift(msg: PickupProvenance, ctx: GiftContext): ObservationPayload | null` where `GiftContext = { selfName: string; bot: Bot; seen: Set<string> }`; the key is `gift:<tick>:<thrower>:<item>:<count>:<ordinal>` lowercased, ordinal counted per `(tick, thrower, item)`; a key already in `seen` (LRU 256) returns null (redelivery, merged stacks reported twice). A pickup of 0 net items returns null. A disconnect clears nothing durable (the Set is per Body run; a redelivered raw message after a restart is the plugin's problem and AN-28b's subscription is core NATS, not durable, so a restart replays nothing).
- **may-edit** `golem/src/perception/provenance/gift.ts` (new), `.../gift.test.ts` (new), worknote.
- **must-not-edit** MNE-BASE, `golem/src/actions/give.ts` (the economic give is unchanged: this card adds an observation beside it, never a second ledger).
- **checks** `./geldar.ps1 pnpm test golem/src/perception/provenance/gift`; G-base 2-4, 7. Cases from the original: live giver and recipient and a third-party control; partial pickup; merged stacks; toss timeout (age over 100); unrelated loot; invisible giver (anonymous, not dropped, not guessed); disconnect; the same message twice yields one row; pickup by a player who is not the observer yields null.
- **size** 35-45k. **worknote** `.../AN-26b.md`. **commit** `feat(character): recipient-side gift observation with visible-giver attribution`. **on-cap** standard. **branch** `codex/an-26b-gift-observation`.
- **revert-checks** (1) remove the `age_ticks` bound: "old drop is not a gift" fails. (2) skip `observedActor`: "hidden giver is anonymous" fails. (3) drop the `seen` check: "same message twice" fails. (4) emit for a non-picker: "third party gets nothing" fails.

### AN-27a: break provenance in the plugin

- **id** AN-27a. **wave** W5. **depends-on** AN-24. **decisions** D-CS-06.
- **Read first (verified):** `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockChangeListener.java` handles `BlockBreakEvent` with `record(event.getBlock(), null)` and drops the breaker; `OwnerCache` knows the prior owner; the ownership `changed` message (`BlockOwnerChanged`, 0165) must not change (an old Body validates it with `additionalProperties: false`). So the breaker travels on a **new** subject.
- **Deliver:**
  1. `plugin/core/src/main/java/dev/geldar/core/blockowner/ProvenanceSink.java` (new): `interface ProvenanceSink { void send(String tail, String json); }`.
  2. `NatsBlockOwnerLink.java`: implement it: `send(tail, json)` publishes to `"geldar." + shard + ".provenance." + tail` through the existing private `publish`. Only the tails `break`, `pickup`, `take`, `combat` are accepted (anything else is dropped), so the link can never be used to publish on another subject.
  3. `BlockChangeListener.java`: a new constructor `(cache, publisher, enabled, ProvenanceSink sink, BooleanSupplier provenanceEnabled)`; the three-argument constructor stays and passes a null sink. In `onBreak`, **before** the cache is updated, read the prior owner from `cache` (`(to confirm: OwnerCache read method for one cell without a CoreProtect lookup)`; if the cache has no answer the prior owner is null, never looked up synchronously on the server thread) and, when `sink != null && provenanceEnabled`, send `BreakProvenance` with `actor = event.getPlayer().getName()`, `prior_owner`, `block = event.getBlock().getType().getKey().getKey()`, `tick`. Only player breaks: explosions, pistons and fluids are not seen by this listener (unchanged) and send nothing. The existing `record(block, null)` and its publish are untouched.
- **may-edit** `ProvenanceSink.java` (new), `NatsBlockOwnerLink.java`, `BlockChangeListener.java`, `plugin/core/src/test/java/dev/geldar/core/blockowner/BlockChangeProvenanceTest.java` (new), worknote.
- **must-not-edit** MNE-BASE, `BlockOwnerSetup.java` (AN-28b passes the sink and the flag), `OwnerCache.java`, `BlockOwnerPublisher.java`.
- **checks** `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.BlockChangeProvenanceTest')`; `./geldar.ps1 pnpm test contract/test/block-owner` (unchanged); G-base 6, 7. Cases: owned block broken by another player (prior owner present); unowned block; cache miss (prior owner null, no lookup); cancelled break sends nothing; flag off or null sink sends nothing and the `changed` message is byte-identical to today; the three-argument constructor still works; `send` with an unknown tail drops.
- **size** 35-45k. **worknote** `.../AN-27a.md`. **commit** `feat(character): publish break provenance with the breaker on its own subject`. **on-cap** standard. **branch** `codex/an-27a-break-provenance-plugin`.
- **revert-checks** (1) send from `onPlace`: "placement sends no provenance" fails. (2) put `actor` into the `changed` JSON: "changed message is byte-identical" fails. (3) accept any tail: "unknown tail dropped" fails. `ops`: capture a real `BreakProvenance` payload (with CoreProtect present and absent) before AN-27b writes fixtures.

### AN-27b: observed property break in the owner's Body

- **id** AN-27b. **wave** W5. **depends-on** AN-24, AN-25, AN-27a. **decisions** D-CS-06.
- **Knowledge rule (round one, the conservative reading of D-CS-06):** a break becomes `property_broken` for an observer only when (a) `prior_owner` equals the observer's own name (the observer owned that block), and (b) the block cell is visible to the observer now (within 24 blocks and a clear line). The actor is named only when `observedActor` resolves them; otherwise the observation is unattributed. Third-party witnesses of a break of someone else's block, and breaks of unowned blocks, produce nothing (listed inactive in AN-50): the global feed alone teaches no fact, and the observer has no authorized knowledge of another life's ownership.
- **Deliver** `golem/src/perception/provenance/property-break.ts` (new): `observeBreak(msg: BreakProvenance, ctx: BreakContext): ObservationPayload | null`; `BreakContext = { selfName: string; bot: Bot; seen: Set<string> }`; key `brk:<tick>:<x>:<y>:<z>:<actor>`; an LRU of 256 keys; a break with `actor` equal to the observer returns null (breaking your own block is not an event). Placement, replacement and cache invalidation never reach this function (they are not `BreakProvenance`).
- **may-edit** `golem/src/perception/provenance/property-break.ts` (new), `.../property-break.test.ts` (new), worknote.
- **must-not-edit** MNE-BASE, `golem/src/body/block-owners.ts`, `golem/src/actions/protected-blocks.ts` (goto and mining permission decisions are untouched, as in the original).
- **checks** `./geldar.ps1 pnpm test golem/src/perception/provenance/property-break`; G-base 2-4, 7. Cases: visible actor and owned block (attributed); actor out of sight (unattributed, still delivered because the owner saw the block); block not visible (null); prior owner is someone else (null); unowned (null); self-break (null); global change alone with nothing visible (null); the same message twice (one); missing CoreProtect (`prior_owner` null -> null).
- **size** 30-40k. **worknote** `.../AN-27b.md`. **commit** `feat(character): owner-side observation of a broken owned block`. **on-cap** standard. **branch** `codex/an-27b-break-observation`.
- **revert-checks** (1) deliver when `prior_owner` is another life: "someone else's block teaches nothing" fails. (2) skip the block-visibility test: "block out of sight is null" fails. (3) name the actor without `observedActor`: "hidden breaker unattributed" fails.

### AN-28a: delivery path (animus normaliser, MCP handler, presenter)

- **id** AN-28a. **wave** W5. **depends-on** AN-24 (and AN-25 for the damage field). **decisions** D-CS-06.
- **Deliver** (the PX-4 `heard_sound` file set, applied to `observation`; every file below was read):
  1. `animus/src/ports/body.ts`: add `| { type: 'observation'; payload: ObservationPayload }` to `MindEvent` (import the type from `@geldar/contract`). `animus/src/ports/index.ts` re-exports as needed.
  2. `animus/src/link/mind-event.ts`: `MIND_EVENT_TYPES` gains `'observation'`; `PAYLOAD_CHECKS.observation = (p) => validateObservationPayload(p).ok ? null : ['observation payload does not match the schema']`.
  3. `animus/src/link/link.fixtures.ts`: add an `observation` fixture (the file lists one per type).
  4. `threshold/mcp-mock/src/sim/wake.ts`: `WakeEvent.kind` gains `'observation'`; `threshold/mcp-mock/src/sim/events.ts`: `SimEvent` gains optional `actor?: string`, `item?: string`, `count?: number`, `block?: string`, `observation?: 'gift_received' | 'property_broken'`.
  5. `threshold/mcp/src/events/handlers/observation.ts` (new) and one appended line in `handlers/index.ts`: map the event to one `SimEvent` of kind `observation` with `text: observationSentence(...)`, `actor: payload.actor?.name` (re-checked against `^[A-Za-z0-9_]{3,16}$` and `markedWords`; a failing name is dropped, the event kept unattributed), never `payload.actor.life` and never `key`. It does not wake the agent (no interest maps to it, as for `heard_sound`).
  6. `damage.ts` handler: copy `actor.name` (same re-check) into the damage `SimEvent`'s `actor`; the text stays `hurtSentence(...)` unchanged.
  7. `threshold/mcp/src/events/present-handlers/observation.ts` (new) plus one appended line in `present-handlers/index.ts`: a `McpPlayerEvent` `{ type: kind, text, actor?: {name}, item?, count?, block? }`; `damage.ts` presenter adds `actor` when present.
- **may-edit** `animus/src/ports/body.ts`, `animus/src/ports/index.ts`, `animus/src/link/mind-event.ts`, `animus/src/link/link.fixtures.ts`, `animus/src/link/observation-event.test.ts` (new, the `heard-sound-event.test.ts` pattern), `threshold/mcp-mock/src/sim/wake.ts`, `threshold/mcp-mock/src/sim/events.ts`, `threshold/mcp/src/events/handlers/observation.ts` (new), `.../handlers/damage.ts`, `.../handlers/index.ts`, `threshold/mcp/src/events/present-handlers/observation.ts` (new), `.../present-handlers/damage.ts`, `.../present-handlers/index.ts`, `threshold/mcp/src/events/handlers/observation.test.ts` (new), `threshold/mcp/src/events/handler-registry.test.ts` (extend), worknote.
- **must-not-edit** MNE-BASE otherwise. No Mind behaviour in `animus/`: only the type and the normaliser row.
- **checks** `./geldar.ps1 pnpm test threshold/mcp/src/events` and `animus/src/link`; G-base 2-4, 7. Cases: each event kind maps and presents; attributed and unattributed; a name that fails the pattern or contains a marker word is dropped; an old `damage` payload (no `actor`) maps to the same line and the same fields as before; unknown observation kind is `invalid` in the normaliser (counted, not thrown); the event carries no `life`, `key` or coordinates (a structural test: serialise the presented event and scan for `ag_`).
- **size** 40-50k (if the dry run shows more than 50k, split the `animus/` rows from the MCP handlers; do not hand the coder an open list). **worknote** `.../AN-28a.md`. **commit** `feat(character): deliver observation events and the hit actor to the player log`. **on-cap** standard. **branch** `codex/an-28a-observation-delivery`.
- **revert-checks** (1) drop the `observation` row from `MIND_EVENT_TYPES`: "the stream subject list includes observation" fails. (2) copy `life` into the presented event: the `ag_` scan fails. (3) skip the name re-check: "malicious name dropped" fails. (4) remove the damage `actor` copy: "damage carries the visible actor" fails.

### AN-28b: Body wiring, plugin setup, ACL and the leakage gate

- **id** AN-28b. **wave** W5. **depends-on** AN-25, AN-26b, AN-27b, AN-28a. **decisions** D-CS-06.
- **Deliver:**
  1. `golem/src/perception/provenance/subscribe.ts` (new): subscribes on the Body's own `OwnerTransport` connection (the same one `wireBlockOwners` uses: `env.owners`) to `provenanceBreakSubject` and `provenancePickupSubject`, validates with `validateProvenance`, drops invalid or oversize messages, calls `observeBreak` and `observeGift`, builds the `observation` WorldEvent (envelope like `heardSoundEvent` in `heard-sound-event.ts`: `source_event_id = eventIdFor('observation:' + lifeId + ':' + key)`, `agent_id` = observer, 3-token subject) and publishes via `env.publisher`. `stop()` unsubscribes. Does nothing when the config gate is off.
  2. `golem/src/adam/adam-body.ts` (shared owner this wave): when the gate is on, pass `resolve = (u) => observedActor(bot, u)` as the fourth argument of `watchHurts`, start the subscription, and stop both in `stop()` and in the failed-start cleanup. One block, no other change. Check the file stays under 700 lines (it is 293).
  3. `plugin/.../blockowner/BlockOwnerSetup.java`: pass the link as `ProvenanceSink` and a `provenance.enabled` supplier (`config.getBoolean("provenance.enabled", false)`, read in `reload`) to `BlockChangeListener`; register `PickupProvenanceListener` with the same sink. Default **false**.
  4. `geldar.ps1` `Get-NatsUsers`: `body.Sub` gains `geldar.$s.provenance.>`; `body.PubDeny` gains `geldar.$s.provenance.>` (a Body must not forge provenance); `paper` already publishes `geldar.$s.>`. Mirror in `tools/repo-checks/src/nats-auth.test.ts` (`expectedTable`, the deny lists and a new "provenance routing" case modelled on the existing block-ownership case) and `threshold/mcp/test/nats-auth.it.test.ts` (the live table, `to confirm`; ops runs it).
  5. **Leakage gate.** `threshold/mcp/src/events/leakage.test.ts` (new): replays `threshold/mcp/test/fixtures/real-body-events.json` plus synthetic fixtures through `mapMindEvent` -> `presentEvents` and asserts, over the whole output list serialised: no string matching `ag_[a-z][a-z0-9]*_[0-9]+`, no `provenance`, no key, no coordinates in an `observation`, no `actor` on any event whose Body fixture had a hidden actor (hit from out of sight; gift with a thrower beyond range; break with the actor behind a wall), no observation for third-party, unowned, or self events. It builds the Body side from the real filters (`observeGift`, `observeBreak`, `observedActor`) over a fake bot with entities placed in and out of line of sight, so the test checks the whole chain: raw provenance -> Body filter -> WorldEvent -> mapper -> player event. **This is also the check the kit's event reader (HC-27) relies on:** the kit sees only `wait`/`look` results, which are exactly the presented list, so this test is the proof that the player-facing channel carries only what a player can see.
- **may-edit** `golem/src/perception/provenance/subscribe.ts` (new), `.../subscribe.test.ts` (new), `golem/src/adam/adam-body.ts`, `golem/src/adam/adam-body.test.ts` (extend; `to confirm`), `plugin/core/src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java`, `plugin/core/src/test/java/dev/geldar/core/blockowner/` (one new `ProvenanceSetupTest.java`), `geldar.ps1` (the `Get-NatsUsers` table only), `tools/repo-checks/src/nats-auth.test.ts`, `threshold/mcp/test/nats-auth.it.test.ts`, `threshold/mcp/src/events/leakage.test.ts` (new), worknote.
- **must-not-edit** MNE-BASE otherwise; `compose/**` and `shards/*.yaml` (the sample off config is geldar A's; this card adds no shard file change).
- **checks** `./geldar.ps1 pnpm test golem/src/perception/provenance`, `tools/repo-checks/src/nats-auth`, `threshold/mcp/src/events/leakage`, `golem/src/adam`; `(cd plugin; ./gradlew :core:test)`; G-base 2-4, 6, 7. Gate-off cases: with the gate off, `adam-body` starts no subscription and `watchHurts` gets no resolver (bytes identical, asserted).
- **ops (serial, wave close):** one real hit, one real give and one real break reach an eligible observer in the `wait` events; the hidden controls (out of sight, third party, unowned) do not; a Body connection cannot publish `geldar.<shard>.provenance.break` and the Mind/eventsink/MCP roles cannot subscribe to `provenance.>` (real NATS roles); the same observation read by two `wait` calls with the same cursor has one `seq`. Full `./geldar.ps1 check`, the focused real-client cases and the 20 TPS bench before W5 is done.
- **size** 45-50k (hold the plugin and ACL edits to the listed lines; if the real code needs more, split the plugin and ACL part into AN-28c before dispatch). **worknote** `.../AN-28b.md`. **commit** `feat(character): wire observed evidence with a leakage gate`. **on-cap** standard. **branch** `codex/an-28b-observation-wiring-leakage`.
- **revert-checks** (1) remove the `PubDeny` line for `provenance.>`: the nats-auth "a Body cannot publish provenance" case fails. (2) let `subscribe.ts` run with the gate off: "gate off starts nothing" fails. (3) make the fixture bot see through the wall: the leakage test's "hidden breaker has no actor" fails (proves the test bites). (4) the leakage test keeps one case that injects a `life` into a presented event and expects the failure (proves the `ag_` scan bites).

---

## W7: explore, farm and patrol (Body half; the idle binding is the kit card HC-31)

Decision D-CS-14 (recommended): known frontier, observed field, known route; bounded checkpointed motor routines; no wiki coordinates, no new goals, no automatic player attack. Each program is an `IntentProgram` (`golem/src/body/program.ts`: `start`, `step`, `checkpoint`, `resume`), validated with `ArgReader` / `checkpointReader` (`golem/src/body/programs/args.ts`), acting only through `runStepAction`/`stopOf` (`action-step.ts`). Program checkpoints stay under 2 KiB (the `animus` validator caps a thought-echoed checkpoint at 4096 bytes). `Intent.arguments` is untyped in `contract/schemas/thought.schema.json` and `Intent.program` accepts any name matching the skill pattern, so a new built-in name needs **no** change there; the gates that do need a change are the `animus/src/validate/bounds.ts` allow-list the MCP `act` path uses (`PHASE0_PROGRAMS`, `PROGRAM_ARGS`) and the Body registry.

### AN-44: program contract and API unblocker

- **id** AN-44. **wave** W7. **depends-on** AN-28b (W5 merged; the wave order, there is no code dependency). **decisions** D-CS-14; ADR `<allocate via registry>` (the three programs: arguments, checkpoints, limits, completion, refusals); body-api number `<allocate via registry>` (the registry check recommends `v8`; `v7` is taken by `till`).
- **Deliver:**
  1. `contract/schemas/program-shapes.schema.json` (new), title `ProgramShapes`, root `oneOf` of the three argument shapes told apart by a `program` constant (the shapes live in `$defs` as `ExploreArguments`, `FarmArguments`, `PatrolArguments`, `ExploreCheckpoint`, `FarmCheckpoint`, `PatrolCheckpoint`, `ExploreDetail`, `FarmDetail`, `PatrolDetail`). Argument shapes (every integer bounded; no free text; no coordinates the Body did not observe):
     ```jsonc
     // explore: advance in bounded legs toward the nearest unvisited, loaded-in-view chunk direction
     ExploreArguments: { "legs": int 1..12 (default 6), "leg_blocks": int 8..48 (default 24), "avoid_water": bool (default true) }
     ExploreCheckpoint: { "legs_done": int 0..12, "visited": [ [cx, cz] ... max 96 ], "heading": "n"|"e"|"s"|"w"|null }
     ExploreDetail: { "legs": int, "chunks_new": int, "stopped": "legs"|"no_frontier"|"danger"|"limit" }
     // farm: one harvest-and-replant pass over crop cells the Body has seen
     FarmArguments: { "radius": int 4..24 (default 12), "max_cells": int 1..32 (default 16), "replant": bool (default true) }
     FarmCheckpoint: { "cells": [ [x, y, z, "ripe"|"unripe"|"empty"] ... max 32 ], "next": int, "harvested": int, "sown": int, "skipped": int }
     FarmDetail: { "harvested": int, "sown": int, "skipped_owned": int, "skipped_unknown": int, "stopped": "done"|"no_cells"|"no_seeds"|"limit" }
     // patrol: walk a known route for a bounded number of laps
     PatrolArguments: { "route": [ {x,y,z} ... 2..8 ], "laps": int 1..5 (default 1), "loop": bool (default true) }
     PatrolCheckpoint: { "leg": int 0..8, "laps_done": int 0..5 }
     PatrolDetail: { "laps": int, "stopped": "laps"|"danger"|"limit" }
     ```
     Finite-limit defaults the programs enforce in addition to the intent's `limits`: each step does at most one leg, cell or goto; explore caps `legs`; farm caps `max_cells`; patrol caps `laps` and route length. Hard caps are schema `maximum`s, so an oversize argument is invalid, not clamped.
  2. `contract/src/outcome-words.ts`: `INTENT_WHY.explore`, `.farm`, `.patrol` entries (fixed templates, facts only; e.g. `explore: { not_found: 'You found no new direction to explore nearby.' }`).
  3. `contract/schemas/mcp-play.schema.json`: the `ActInput.intent` description names the three programs neutrally next to `build` (list only; no coaching).
  4. `contract/src/index.ts`: export `validateProgramShapes` and types.
- **may-edit** `contract/schemas/program-shapes.schema.json` (new), `contract/schemas/mcp-play.schema.json`, `contract/src/outcome-words.ts`, `contract/src/index.ts`, `contract/src/generated/**` (by `generate`), `contract/test/program-shapes.test.ts` (new), `contract/test/mcp-play.test.ts` (description fixture), `docs/decisions/<allocate via registry>-explore-farm-patrol.md` (new), worknote.
- **must-not-edit** MNE-BASE; `golem/`, `animus/`, `prompts/` (AN-45 owns `prompts/body-api/v<allocate via registry>.json`).
- **checks** `./geldar.ps1 pnpm test contract/test/program-shapes` and `contract/test/mcp-play` and `contract/test/thought`; G-base 2-5, 7. Cases: every example valid; every bound at, just under and just over; oversize route, 9 points, rejected; a checkpoint with 97 chunks rejected; `visited`/`cells` carry only integers; old thought and intent fixtures (`contract/test/thought.test.ts`) unchanged; each program has a timeout and operation-cap `stopped` value; no schema field names a hidden coordinate source (`farm` takes a radius, never a position).
- **size** 40-50k. **worknote** `.../AN-44.md`. **commit** `feat(character): program shapes for explore, farm and patrol`. **on-cap** standard. **branch** `codex/an-44-programs-contract`.
- **revert-checks** (1) raise `legs` maximum to 13: "legs 13 rejected" fails. (2) allow `route` of 9: "route 9 rejected" fails. (3) add an `additionalProperties: true` to `FarmArguments`: "unknown argument rejected" fails.

### AN-39: explore program

- **id** AN-39. **wave** W7. **depends-on** AN-44. **decisions** D-CS-14.
- **Deliver** `golem/src/body/programs/explore.ts` (new), `golem/src/perception/observed-chunks.ts` (new).
  - `observed-chunks.ts`: `export interface VisitedChunks { has(cx: number, cz: number): boolean }`; `setVisitedChunks(reader: VisitedChunks | null)` and `visitedChunks()` (module-level, the `setOwnerLookup` pattern in `protected-blocks.ts`); default reader: empty. AN-45 wires geldar A's first-visit tracker (AN-09, path `(to confirm)`) into it; explore also keeps its own run coverage, so it works before that wiring.
  - `ExploreProgram implements IntentProgram`, `name = 'explore'`. `start(args)`: read with `ArgReader` (`legs`, `leg_blocks`, `avoid_water`); `done()` rejects unknown fields. `step(ctx)`: one leg per step. Frontier = the four axis directions from the current chunk whose neighbour chunk is **loaded in the bot's world** (`bot.world.getColumn(cx, cz)` non-null; unloaded terrain is never a target and no terrain is guessed) and not in `visited` or `visitedChunks()`; pick the first by a fixed deterministic order starting from the checkpoint `heading` (continue straight, then right, left, back); target cell = current position + `leg_blocks` along that axis, snapped to the loaded surface the bot already sees. Walk with `runStepAction(ctx, { do: 'goto', target })`; `stopOf(run, ctx)` for failures; add the arrival chunk to `visited` (cap 96, oldest dropped). Stop `completed` with `ExploreDetail` when `legs_done == legs`; `completed` with `stopped: 'no_frontier'` when no candidate; `wake` `precondition_failed` never; a hostile within 8 blocks (`ctx.view.nearbyHostiles(8)`) or health under 8 returns `completed` `stopped: 'danger'` so the Mind decides (the reflexes still act first).
  - `checkpoint()`: `{ legs_done, visited, heading }`; `resume` validates with `checkpointReader` and rejects an unknown field, an out-of-range chunk list or a visited list over 96.
  - First-visit XP: the program emits nothing itself; the canonical evidence key and the persistence are AN-09's first-visit producer in the Body (a chunk entered by walking is evidence regardless of which program walked). This card adds no award code.
- **may-edit** `golem/src/body/programs/explore.ts` (new), `.../explore.test.ts` (new), `golem/src/perception/observed-chunks.ts` (new), `.../observed-chunks.test.ts` (new), worknote. Test helpers come from `golem/src/body/programs/programs.fakes.ts` (`newWorld`, `contextFor`, `drive`, `expectResumeEverywhere`), not edited.
- **must-not-edit** MNE-BASE, `golem/src/body/programs/index.ts` and `args.ts`.
- **checks** `./geldar.ps1 pnpm test golem/src/body/programs/explore` and `golem/src/perception/observed-chunks`; G-base 2-4, 7. Cases: known-only frontier; opaque or unloaded neighbour is not a target; all four axis and sign choices from each heading; no valid candidate completes with `no_frontier`; legs cap; a duplicate chunk visit adds nothing; interruption, cancel and `expectResumeEverywhere` restart; a hostile nearby stops; no invented goal or coordinate; the checkpoint stays under 2 KiB with 96 chunks.
- **size** 45-50k. **worknote** `.../AN-39.md`. **commit** `feat(character): explore program over the observed frontier`. **on-cap** standard. **branch** `codex/an-39-explore-program`.
- **revert-checks** (1) treat an unloaded column as a candidate: "unloaded terrain is not a target" fails. (2) skip the `visited` test: "visited chunk is not the frontier" fails. (3) drop the legs cap: "stops at legs" fails. (4) let `resume` accept 97 chunks: the checkpoint bound test fails.

### AN-40: farm program

- **id** AN-40. **wave** W7. **depends-on** AN-44. **decisions** D-CS-14.
- **Deliver** `golem/src/body/programs/farm.ts` (new), `golem/src/body/programs/farm-field.ts` (new, the field reader). One harvest-and-replant pass over crop cells the Body can see now. Knowledge rule: a cell is in the field only if its crop block is currently loaded and in line of sight (`canSeeBlock`, `FOOD_RANGE` 24 and the `radius` argument), its crop is one of `CROP_MAX_AGE` (`golem/src/perception/surroundings/food-known.ts`: wheat, carrots, potatoes, beetroots), ripeness from `getProperties().age >= CROP_MAX_AGE[name]` (an unreadable age is `unripe`, never harvested), and the farmland below is `farmland`. No wiki recipe, no hidden-field search, no tilling (the `till` verb exists at `a1c6fb2a` but this card never calls it; a card that tills is a future decision).
  - Ownership: before each harvest read `ownerRecordAt(pos)` (`protected-blocks.ts`) and `isOwnPlacement(bot, pos)` (`own-placements.ts`): **own or world-generated (known, owner null) cells only**. A cell owned by someone else is `skipped_owned`; an unknown answer (`known: false`) is `skipped_unknown` (the 0164 rule: unknown is protected). No refusal text; the program just does not touch them.
  - Step: take the next checkpointed cell; `ripe` -> `{ do: 'mine', block: crop, count: 1 }` (harvest) then, if `replant` and a seed item for it is carried (`SEED_CROPS` from `golem/src/actions/place.ts`, inverted by crop) -> `{ do: 'place', block: seedItem, at: { x, y, z } }`; `empty` farmland + `replant` + seed -> the `place` only; `unripe` skipped. A `harvested` counts only when the `mine` action completed **and** the crop block is gone or reset (`bot.blockAt` re-read), a `sown` only when the `place` completed; an attempted action that failed counts nothing. The award is existing AN-09 farming evidence from the completed actions (this card adds no award code and emits no event). `missing_materials` on seeds -> `stopped: 'no_seeds'` completes the pass.
  - Limits: `max_cells`, `radius`, and a per-step single action. `FarmCheckpoint` holds the cell list (cap 32) and counters; `resume` re-reads each remaining cell's state (a crop already harvested before the restart is not harvested twice: `mine` on an air cell would fail, so the resume step re-classifies first).
- **may-edit** `golem/src/body/programs/farm.ts` (new), `.../farm-field.ts` (new), `.../farm.test.ts` (new), `.../farm-field.test.ts` (new), worknote.
- **must-not-edit** MNE-BASE, `golem/src/actions/place.ts`, `till.ts`, `mine.ts`, `protected-blocks.ts`.
- **checks** `./geldar.ps1 pnpm test golem/src/body/programs/farm`; G-base 2-4, 7. Cases (original): observed ripe and unripe; seeds present and missing; own, other and unknown cells; partial work; a failed or cancelled `mine`; the `max_cells` boundary; resumed checkpoint without double harvest; one counted unit per completed harvest or sow; no recipe or field the Body has not seen.
- **size** 45-50k. **worknote** `.../AN-40.md`. **commit** `feat(character): farm program over observed crop cells`. **on-cap** standard. **branch** `codex/an-40-farm-program`.
- **revert-checks** (1) skip the `ownerRecordAt` check: "another life's crop is skipped" fails. (2) treat `known: false` as allowed: "unknown ownership is skipped" fails. (3) count an attempted `mine` that failed: "failure counts nothing" fails. (4) harvest an `unripe` crop: "unripe is left" fails.

### AN-41: patrol program

- **id** AN-41. **wave** W7. **depends-on** AN-44. **decisions** D-CS-14.
- **Deliver** `golem/src/body/programs/patrol.ts` (new). A bounded traversal of a route the **caller supplies** as `route` (the Mind took it from its own memory or a trusted person's last position it was told; the Body never looks a position up). Validation at `start`: 2-8 points through `ArgReader.position` (integers inside the contract bounds); an empty, single-point or unknown-shape route is `invalid_args`. Step: one `goto` to point `leg`; arrive within 2 blocks (`ARRIVED`-style check on `ctx.view.position`) then `leg += 1`; wrap and `laps_done += 1` when `loop`, else stop at the end; `completed` with `PatrolDetail { laps, stopped: 'laps' }` at `laps`. Danger: a hostile within 8 blocks or health under 8 -> `completed` `stopped: 'danger'` (the program never attacks and never selects an attack goal; reflexes still act first). The Body takes points, never people, so a stale person position cannot occur at the Body; a route taken from a trusted person's last authorized position is the Mind's job and the Body checks only the shape rules.
- **may-edit** `golem/src/body/programs/patrol.ts` (new), `.../patrol.test.ts` (new), worknote.
- **must-not-edit** MNE-BASE, `golem/src/body/programs/follow.ts`, `travel.ts`.
- **checks** `./geldar.ps1 pnpm test golem/src/body/programs/patrol`; G-base 2-4, 7. Cases: invalid, empty, one-point and nine-point routes; finite laps and the `limits` boundary; interruption, cancel, restart (`expectResumeEverywhere`); hostile nearby ends `danger`; no `attack` action is ever issued (assert on the fake registry's action log); a blocked leg reports through `stopOf` and does not loop.
- **size** 35-45k. **worknote** `.../AN-41.md`. **commit** `feat(character): patrol program over a supplied route`. **on-cap** standard. **branch** `codex/an-41-patrol-program`.
- **revert-checks** (1) allow a 9-point route: "route over 8 rejected" fails. (2) ignore `laps`: "stops at laps" fails. (3) issue `attack` when a hostile is near: "never attacks" fails.

### AN-45: program publication and registration (world half; the idle binding is HC-31)

- **id** AN-45. **wave** W7. **depends-on** AN-39, AN-40, AN-41. **decisions** D-CS-14; body-api number `<allocate via registry>` (recommended `v8`); prompt immutability (every older body-api file stays loadable).
- **Deliver:**
  1. `golem/src/body/programs/index.ts` (shared owner this wave): register `explore`, `farm`, `patrol` in `createProgramRegistry()` and export the classes.
  2. `animus/src/validate/bounds.ts` (the allow-list the MCP `act` path enforces): `PHASE0_PROGRAMS` gains the three names; `PROGRAM_ARGS` gains rows with the same bounds as `program-shapes.schema.json` (`legs` 1-12, `leg_blocks` 8-48, `radius` 4-24, `max_cells` 1-32, `laps` 1-5, ...) and the new `ArgSpec` kinds the `route` array and booleans need (`bool`, `route`); `animus/src/validate/bounds.test.ts` or `output.test.ts` rows. **A drift test** `golem/src/body/programs/program-shapes-drift.test.ts` (new) asserts the three sources agree: the schema's argument names equal the Body `ArgReader` fields (start each example) equal the `PROGRAM_ARGS` keys. This is the only thing standing between the three copies, so it is part of the card, not an extra.
  3. `prompts/body-api/v<allocate via registry>.json` (new, recommended `v8`): `v7` copied unchanged plus three `programs` entries (summary, `arguments` text, one valid `example` with `goal`, `wake_on: ["goal_completed"]`, `limits`), version field set, description extended. No game knowledge or coaching in the summaries ("Walk to a nearby unvisited direction", "Harvest ripe crops you can see and replant", "Walk a route you give, for a few laps"). `prompts/README.md` gets an index line (ops adds it; this card writes the `index:` line in the worknote). `animus/src/prompts/library.ts` `DEFAULT_BODY_API_VERSION` is **not** changed (the in-house Mind keeps `7`; off means old behaviour).
  4. `golem/src/mind-link/body-api-v<allocate via registry>.test.ts` (new, the `body-api.test.ts` pattern): every example in the new file validates as a thought and its program starts on the Body; a second test pins the sha256 of `prompts/body-api/v1.json` to `v7.json` so an edit of a released file fails.
  5. Wire the visited-chunk reader: `setVisitedChunks(...)` from geldar A's first-visit tracker in `adam-body.ts` `(to confirm: the tracker and its handle are AN-09's; if none exposes a reader, record BlockedDependency and leave explore on its own run coverage)`. Cleanup on `stop()`.
- **may-edit** `golem/src/body/programs/index.ts`, `golem/src/body/programs/program-shapes-drift.test.ts` (new), `animus/src/validate/bounds.ts`, `animus/src/validate/output.test.ts` (rows only), `prompts/body-api/v<allocate via registry>.json` (new), `golem/src/mind-link/body-api-v<allocate via registry>.test.ts` (new), `golem/src/adam/adam-body.ts` (the single `setVisitedChunks` pair, only if AN-28b's block is merged and the file is under 700 lines), worknote.
- **must-not-edit** MNE-BASE otherwise; `animus/src/prompts/library.ts`, `animus/src/prompts/decode-schema.ts` (in-house Mind frozen), `prompts/body-api/v1-v7.json`.
- **checks** `./geldar.ps1 pnpm test golem/src/body/programs`, `golem/src/mind-link`, `animus/src/validate`, `animus/src/prompts`, `contract/test/thought`; G-base 2-4, 7. Cases: the three programs registered and `UNSUPPORTED_PROGRAMS` unchanged; `validateThought` plus the animus validator accept each new example and refuse a sixth argument; the old `v1-v7` still load (`animus/src/prompts/library.test.ts` unchanged); an unregistered program name still fails `unsupported_program`.
- **ops (wave close, serial, a real client):** a sovereign test player starts, completes and resumes (Body restart) each program through `act` and sees the receipts; missing knowledge ends `no_frontier`/`no_cells`/`danger` instead of looping; the old body-api and a thought without programs behave as before; full `./geldar.ps1 check`, the 20 TPS bench.
- **size** 45-50k. **worknote** `.../AN-45.md`. **commit** `feat(character): register explore, farm and patrol and publish the body api`. **on-cap** standard. **branch** `codex/an-45-programs-publish`.
- **revert-checks** (1) leave `farm` out of `PHASE0_PROGRAMS`: the MCP `act` validator test "farm is allowed" fails. (2) change one bound in `PROGRAM_ARGS`: the drift test fails. (3) register no `patrol`: "registry names" fails. (4) change a byte of `prompts/body-api/v7.json`: the sha256 pin test fails.

---

## W8: complete evidence and proficiency sources

D-CS-04 (evidence matrix) and D-CS-15 (bilateral exchange only; the promise half is deferred with AN-48, D-HC-06). Everything here is for **headless and sovereign Bodies alike**; no source depends on an Animus Mind. The award ledger, `evidence_key` normalisation and the XP increment are geldar A's (AN-04, AN-09, AN-10); the cards below add **producers and normalisers** and name the ledger entry point as `(to confirm: AN-09's award-normalisation module under eventsink/src/)`. The common convention: a new normaliser file under `eventsink/src/awards/` (new directory unless AN-09 chose another) exporting `normalize<Source>(event: WorldEvent): AwardUnit[]` where `AwardUnit = { domain, evidenceKey, lifeId, tick }` is geldar A's type `(to confirm name)`.

### AN-46: complete evidence contract unblocker (trimmed)

- **id** AN-46. **wave** W8. **depends-on** AN-45. **decisions** D-CS-04, D-CS-06, D-CS-15 (exchange only); ADR `<allocate via registry>` (evidence sources and exchange, written by this card). **Dropped from the original:** the commitment declaration/reference/outcome shapes and the memory/MCP declaration adapter (deferred with AN-48).
- **Deliver:**
  1. `contract/schemas/observation-event.schema.json`: append kinds `FightSeen` `{ kind: 'fight_seen', actor?: ObservedActor, target: mob name (^[a-z_]{1,64}$), key }` and `ContainerTaken` `{ kind: 'container_taken', actor?: ObservedActor, item, count, key }`; add both to the `Observation` `oneOf`. `fled` is **not** a kind: there is no causal flee signal (see AN-50, inactive list).
  2. `contract/schemas/provenance.schema.json`: append `TakeProvenance` `{ world, x, y, z, actor: string|null, prior_owner: string|null, item, count, tick }` and `CombatProvenance` `{ world, actor: string|null, target: mob name, kind: 'engaged'|'killed', tick }`. Subjects `provenanceTakeSubject`, `provenanceCombatSubject` in `contract/src/subjects.ts`.
  3. `contract/schemas/combat-fact-event.schema.json` (new), title `CombatFactPayload`, the **own-combat** WorldEvent type `combat_fact` (3-token, `agent_id` = the killer's life, produced by the plugin through `EventExporter.emit`): `{ kind: 'hostile_kill'|'fight_survived', mob: ^[a-z_]{1,64}$, encounter_key: ^[a-z0-9:_-]{8,96}$ }`. `encounter_key` is fixed by AN-47a (one key per (life, target entity id, first-hit tick) so per-tick events cannot farm awards).
  4. Bilateral exchange id: no schema. It is the string `exch:<lifeLow>:<lifeHigh>:<windowIndex>` (lives sorted, `windowIndex = floor(tick / 600)`), documented in the ADR and built and tested in AN-49. The award `evidence_key` pattern is geldar A's (AN-04/AN-09; `to confirm` it admits `exch:` and `combat:` prefixes).
  5. `contract/schemas/mcp-common.schema.json`: `McpPlayerEvent.type` gains `fight_seen`, `container_taken`; `outcome-words.ts` `observationSentence` gains the two templates (`Someone fought a creeper nearby.` with the mob name passed through the pattern only; `Someone took 3 bread from your container.`).
  6. **SQL: none**, unless AN-04's award ledger constrains `evidence_kind` by `CHECK`; then this card does not edit SQL, it writes one `index line to add` for a migration `<allocate via registry>` that widens the check, and the orchestrator allocates and a separate SQL card is created (do not surprise-fan-out a migration).
- **may-edit** `contract/schemas/observation-event.schema.json`, `contract/schemas/provenance.schema.json`, `contract/schemas/combat-fact-event.schema.json` (new), `contract/schemas/mcp-common.schema.json`, `contract/src/subjects.ts`, `contract/src/outcome-words.ts`, `contract/src/index.ts`, `contract/src/generated/**` (by `generate`), `contract/test/evidence-sources.test.ts` (new), `docs/decisions/<allocate via registry>-evidence-sources.md` (new), worknote.
- **must-not-edit** MNE-BASE; any promise, commitment or memory shape.
- **checks** `./geldar.ps1 pnpm test contract/test/evidence-sources` and `contract/test/observation`; G-base 2-5, 7. Cases: causal ids validate; a combat fact without `encounter_key` is invalid; a malformed or ambiguous actor is invalid; absent actor is valid; W5 payloads unchanged; no promise shape exists in the schema.
- **size** 40-50k. **worknote** `.../AN-46.md`. **commit** `feat(character): evidence-source contract (combat, container taking, observation kinds)`. **on-cap** standard. **branch** `codex/an-46-evidence-contract`.
- **revert-checks** (1) make `encounter_key` optional: "combat fact needs a key" fails. (2) add `fled` to the kinds: "no flee kind" fails (guards the honesty rule). (3) drop `ContainerTaken` from the `oneOf`: its fixture fails.

### AN-47a: combat facts in the plugin

- **id** AN-47a. **wave** W8. **depends-on** AN-46, AN-27a (the `ProvenanceSink`). **decisions** D-CS-04, D-CS-06.
- **Deliver** `plugin/core/src/main/java/dev/geldar/core/CombatFactListener.java` (new; `listeners()` in `GeldarCore.java` is AN-50's registration):
  - `onKill(EntityDeathEvent e)` (MONITOR): killer = `e.getEntity().getKiller()` (Paper: the last player to damage it `(to confirm)`), a hostile mob (`(to confirm: Monster/Enemy instance and the existing hostile list in golem/src/perception/hostile-types.ts so the two agree)`). Emit through `EventExporter.emit("combat_fact", killerName, payload)` with `kind: 'hostile_kill'`. **Stolen kill rule:** credit the killer only (Paper's `getKiller`), never an assisting player; one `encounter_key` per (killer, entity UUID), so a second event for the same entity is dropped by the exporter's own `source_event_id` derivation (key in the id).
  - `fight_survived`: a per-encounter record `(player, mob entity UUID)` opened at the first `EntityDamageByEntityEvent` where a hostile damages the player; closed (emit once) when the mob dies or after `FIGHT_END_TICKS = 200` with no damage either way while the player is alive. A death of the player before close emits nothing. At most one `fight_survived` per encounter key; map capped at 512 open encounters.
  - Provenance for observers: a `CombatProvenance` `engaged` message on `provenance.combat` the first time a player damages a hostile in an encounter, and `killed` on the kill, through `ProvenanceSink.send("combat", json)`.
- **may-edit** `CombatFactListener.java` (new), `plugin/core/src/test/java/dev/geldar/core/CombatFactListenerTest.java` (new), worknote.
- **must-not-edit** MNE-BASE, `EventExporter.java` (use its public `emit`), `GeldarCore.java`.
- **checks** `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.CombatFactListenerTest')`; G-base 4, 6, 7. Cases: real-shaped kill; survived and aborted and died encounters; multiple attackers (killer only); stolen kill; per-tick damage events (one encounter); mob that despawns (timeout path); duplicate event ids; encounter-map cap; payload validates against `CombatFactPayload` (reuse the `EventSchemaCheck` pattern).
- **size** 45-50k. **worknote** `.../AN-47a.md`. **commit** `feat(character): plugin combat facts with one key per encounter`. **on-cap** standard. **branch** `codex/an-47a-combat-facts-plugin`.
- **revert-checks** (1) key by tick instead of entity: "per-tick damage is one encounter" fails. (2) credit the last damager: "stolen kill credits the killer" fails. (3) emit on player death: "died encounter emits nothing" fails. `ops`: capture real payloads (kill, survived) before AN-47b fixtures.

### AN-47b: own and observed combat evidence (Body filter and eventsink normaliser)

- **id** AN-47b. **wave** W8. **depends-on** AN-46, AN-47a, AN-25 (resolver). **decisions** D-CS-04, D-CS-06.
- **Deliver:**
  1. `eventsink/src/awards/combat.ts` (new): `normalizeCombat(event)`: both `hostile_kill` and `fight_survived` map to one combat unit with the **same evidence key** `combat:enc:<encounter_key>`, so the ledger's `(life, domain, evidence_key)` uniqueness makes them **one award per encounter** (the rule D-CS-04 asks to be explicit; recorded in the ADR). No dedupe state lives in the normaliser.
  2. `golem/src/perception/provenance/fight-seen.ts` (new): `observeFight(msg: CombatProvenance, ctx)` -> `fight_seen` only when the actor is **visible now** (`observedActor`) and the target mob is within 24 blocks and visible; key `fight:<tick>:<actor>:<target>`; `engaged` only (one per encounter: LRU of `(actor, target)` for 600 ticks); `killed` is not an aggression signal and returns null. An unseen fight returns null (no update). The observer's own fight returns null.
- **may-edit** `eventsink/src/awards/combat.ts` (new), `eventsink/src/awards/combat.test.ts` (new), `golem/src/perception/provenance/fight-seen.ts` (new), `.../fight-seen.test.ts` (new), worknote. Dispatch into the sink's writer and the Body subscription are AN-50's.
- **must-not-edit** MNE-BASE, `eventsink/src/projection.ts`, `writer.ts`, `consumer.ts` (registration is AN-50's).
- **checks** `./geldar.ps1 pnpm test eventsink/src/awards/combat` and `golem/src/perception/provenance/fight-seen`; G-base 2-4, 7. Cases: kill then survived of the same encounter gives one key; two different encounters give two; redelivered events give the same key (idempotent); a hidden or far actor yields null; two attackers, only the visible one; repeated engaged ticks give one observation; stolen kill; sight loss mid-fight; the observer fighting yields null; never exposes another life's health or sheet (assert the payload fields).
- **size** 45-50k. **worknote** `.../AN-47b.md`. **commit** `feat(character): combat award normaliser and visible-fight observation`. **on-cap** standard. **branch** `codex/an-47b-combat-evidence`.
- **revert-checks** (1) give kill and survived different keys: "one award per encounter" fails. (2) emit `fight_seen` for an invisible actor: "hidden fight updates nothing" fails. (3) emit on every tick: "repeated ticks, one observation" fails.

### AN-49: conversation exchange and complete social XP

- **id** AN-49. **wave** W8. **depends-on** AN-46. **decisions** D-CS-04, D-CS-15 (the proposed starting rule below needs the owner's number for the window; marked `(owner parameter)`).
- **Deliver** `eventsink/src/awards/exchange.ts` (new). Input: the stream of `speech` WorldEvents (`from`, `text`, `distance`, `own`, `agent_id`; `contract/schemas/speech-event.schema.json`). Rule: a **bilateral exchange** between lives A and B is a directed pair inside one window: A speaks (own speech event of A) and, within `EXCHANGE_WINDOW_TICKS = 600` (30 s, `(owner parameter)`), B speaks and A's Body heard it as non-own speech from B (so it was spoken within hearing), then optionally A's reply closes it; the exchange qualifies at the **second** speaker's first line. Award: one social unit per participant per exchange, key `exch:<lifeLow>:<lifeHigh>:<windowIndex>` (windowIndex = floor(tick / 600); a pair has at most one exchange per window). Not an exchange: monologue; one-way overheard speech; the same speaker's lines; a repeated greeting (identical text within the window does not open a second window); wrong recipient (B never within hearing, i.e. no heard event for A from B); echoed or replayed events (the key is idempotent); overlapping windows between the same pair (one key). The normaliser keeps a bounded in-memory per-pair state (LRU 512 pairs, entries expire after 2 windows); a sink restart loses an open window, which is a documented limitation (the ledger's unique key prevents any double award). **Confirmed give** is already an AN-09 unit; this card adds the **no-double-count rule**: a give completed inside an exchange window keeps its own `give:<action id>` key and does not feed the exchange key. The kept-promise award waits for AN-48 (deferred).
- **may-edit** `eventsink/src/awards/exchange.ts` (new), `eventsink/src/awards/exchange.test.ts` (new), worknote. No SQL, no new LLM call, no global speech access beyond the events the sink already stores.
- **must-not-edit** MNE-BASE, `eventsink/src/projection.ts`, `writer.ts`.
- **checks** `./geldar.ps1 pnpm test eventsink/src/awards/exchange`; G-base 2-4, 7. Cases as in the original (two-way vs monologue, spam, wrong recipient, overlapping windows, replay, restart) plus the give-in-window case and the LRU bound.
- **size** 40-50k. **worknote** `.../AN-49.md`. **commit** `feat(character): bilateral conversation exchange and social award keys`. **on-cap** standard. **branch** `codex/an-49-exchange-social-xp`.
- **revert-checks** (1) qualify at the first speaker's line: "monologue is not an exchange" fails. (2) drop the window index from the key: "two windows, two awards" fails. (3) let a repeated greeting open a second window: "greeting spam" fails.

### AN-51a: container-taking facts in the plugin

- **id** AN-51a. **wave** W8. **depends-on** AN-46, AN-27a. **decisions** D-CS-06.
- **Deliver** `plugin/core/src/main/java/dev/geldar/core/blockowner/ContainerTakeListener.java` (new): on `InventoryClickEvent` / drag where a `Player` moves a stack **out of** a block-backed container inventory (`(to confirm: Inventory#getLocation() and the event action names, including shift-click and hotbar swap)`), after the click is not cancelled (MONITOR, `ignoreCancelled`), send `TakeProvenance` `{ world, x, y, z, actor, prior_owner (from OwnerCache; null if no cached answer, never a synchronous CoreProtect call), item, count, tick }` through `ProvenanceSink.send("take", json)`. Opening without taking sends nothing; a take of zero items sends nothing; a deposit sends nothing; per-tick cap and queue bound as in AN-26a.
- **may-edit** `ContainerTakeListener.java` (new), `plugin/core/src/test/java/dev/geldar/core/blockowner/ContainerTakeListenerTest.java` (new), worknote.
- **must-not-edit** MNE-BASE, `BlockOwnerSetup.java` (AN-50 registers it).
- **checks** `(cd plugin; ./gradlew :core:test --tests 'dev.geldar.core.blockowner.ContainerTakeListenerTest')`; G-base 4, 6, 7. Cases: own, other-owned and unknown-owner container; open without take; failed or partial take; shift-click; double event for one transfer (one message: key material by tick and slot); ownership changing between click and send (the prior owner read at click time wins).
- **size** 35-45k. **worknote** `.../AN-51a.md`. **commit** `feat(character): publish container-taking provenance from the plugin`. **on-cap** standard. **branch** `codex/an-51a-container-take-plugin`.
- **revert-checks** (1) send on deposit: "deposit sends nothing" fails. (2) send on open: "open without take sends nothing" fails. (3) look up CoreProtect synchronously on a cache miss: "cache miss sends null prior owner without a lookup" fails.

### AN-51b: observed container taking in the owner's Body

- **id** AN-51b. **wave** W8. **depends-on** AN-46, AN-51a, AN-25. **decisions** D-CS-06.
- **Rule (same conservative reading as AN-27b):** `container_taken` reaches an observer only when the observer owns the container (`prior_owner` equals the observer's name) and the container block is visible; the taker is named only through `observedActor`. A gift (a `give` toss) is not a take (different provenance); a container visit with no take never reaches here; unknown ownership is not someone else's property; third-party observers get nothing (inactive, AN-50).
- **Deliver** `golem/src/perception/provenance/container-take.ts` (new): `observeTake(msg: TakeProvenance, ctx)`; key `take:<tick>:<x>:<y>:<z>:<actor>:<item>`; LRU 256; the observer taking from their own container returns null.
- **may-edit** `golem/src/perception/provenance/container-take.ts` (new), `.../container-take.test.ts` (new), worknote.
- **must-not-edit** MNE-BASE, `golem/src/actions/container.ts` (the Body's own `withdraw` is AN-37's hook point, not this card's).
- **checks** `./geldar.ps1 pnpm test golem/src/perception/provenance/container-take`; G-base 2-4, 7. Cases: own, other and unknown container; open without take; partial take; actor hidden (unattributed, still delivered: the owner saw the container); same message twice; ownership changed mid-operation (the message's `prior_owner` is the truth at click time).
- **size** 30-40k. **worknote** `.../AN-51b.md`. **commit** `feat(character): owner-side observation of a take from an owned container`. **on-cap** standard. **branch** `codex/an-51b-container-take-observation`.
- **revert-checks** (1) deliver for someone else's container: "other-owned teaches nothing" fails. (2) skip the container-visibility test: "container out of sight is null" fails. (3) name the actor without `observedActor`: "hidden taker unattributed" fails.

### AN-50: complete evidence integration (trimmed: the promise row stays inactive)

- **id** AN-50. **wave** W8. **depends-on** AN-47b, AN-49, AN-51b. **decisions** D-CS-04, D-CS-06; ADR from AN-46.
- **Deliver:**
  1. Registration: the three normalisers (`combat`, `exchange`, and AN-09's existing give/farm/mine/build/craft/explore normalisers) into the sink's writer hook `(to confirm: AN-09/AN-10 entry point in eventsink/src/writer.ts)`; `plugin/.../GeldarCore.java` `listeners()` registers `CombatFactListener`; `BlockOwnerSetup.java` registers `ContainerTakeListener`; `subscribe.ts` (AN-28b) gains the `take` and `combat` subjects and the `observeTake` / `observeFight` dispatch; `adam-body.ts` unchanged except through `subscribe.ts`.
  2. ACL: no new line needed (`provenance.>` from AN-28b covers `take` and `combat`; `paper` publishes `geldar.$s.>`). The `combat_fact` WorldEvent is a 3-token subject the plugin already may publish and the sink already reads; the MCP stream does **not** need it (own-combat is XP, not perception), so `MIND_EVENT_TYPES` gains only `observation` kinds already added.
  3. `animus/src/link/mind-event.ts` needs no new type: `fight_seen` and `container_taken` are kinds of the existing `observation` event; AN-28a's `observationSentence` and `McpPlayerEvent` enum changes (AN-46) are the only delivery edits. `threshold/mcp/src/events/leakage.test.ts` (AN-28b) is **extended** with the two new kinds and their hidden controls (this card owns that edit).
  4. **The evidence table (the brief's 6.3 and section 7), with the status each row ships in. A row marked inactive is listed, tested as inactive, and never faked:**

| Evidence | Source | Ships |
|---|---|---|
| Spoke to me first (curiosity 4.0) | `speech` events | already works, no card |
| Came toward me / kept away (curiosity) | snapshot `agents` positions over time | already observable; the kit's sampling rule (HC-27) |
| Hit me (aggression 4.5) | AN-25 `damage.actor` | active when the attacker was visible |
| Gave me an item (good 4.5) | AN-26 `gift_received` | active for the recipient |
| Broke my owned block (law 1.5, good 2.0) | AN-27 `property_broken` | active for the owner |
| Took from my container (law, good) | AN-51 `container_taken` | active for the owner |
| Fought a mob in view (aggression 4.5) | AN-47b `fight_seen` | active when the fighter was visible |
| **Fled a mob (aggression 1.5)** | none | **inactive**: no causal flee signal exists; not faked |
| **Kept or broke a promise (law)** | none | **inactive**: AN-48 deferred (D-HC-06) |
| **Third-party gift, break or take (someone else's property)** | none | **inactive**: the observer has no authorized knowledge of another life's ownership or of the giver's intent |
| **common_sense, cleverness estimates** | none | **inactive**: the brief supplies no observation rule; stay at the prior |
| XP: combat, social (exchange, give), farming, mining, building, crafting, exploring | AN-47b, AN-49, AN-09 | active; the **kept-promise** social unit is inactive |

  The test `eventsink/src/awards/evidence-table.test.ts` (new) asserts every `inactive` row has no producer and no award key (a future change that quietly produces one fails it).
- **may-edit** `eventsink/src/writer.ts` (registration lines only, `to confirm`), `eventsink/src/awards/evidence-table.test.ts` (new), `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java`, `.../blockowner/BlockOwnerSetup.java`, `golem/src/perception/provenance/subscribe.ts`, `.../subscribe.test.ts`, `threshold/mcp/src/events/leakage.test.ts`, worknote. **must-not-edit** MNE-BASE otherwise; no widening of any fact into agent perception.
- **checks** `./geldar.ps1 pnpm test eventsink/src/awards`, `golem/src/perception/provenance`, `threshold/mcp/src/events/leakage`; `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink` (ops); `(cd plugin; ./gradlew build)`; G-base 2-4, 7.
- **ops (serial):** producer-to-sink-to-cache XP and observer-to-player-event for every active row, with a positive, a hidden, a duplicate and a restart control each; real NATS role denial of raw `provenance.>` to the MCP, eventsink and mind roles; full W8 close (`./geldar.ps1 check`, integration floor, 20 TPS).
- **size** 45-50k. **worknote** `.../AN-50.md`. **commit** `feat(character): register evidence sources, leakage gate for the new kinds`. **on-cap** standard. **branch** `codex/an-50-evidence-integration`.
- **revert-checks** (1) register `ContainerTakeListener` twice: the "listeners() has each class once" test fails. (2) make `evidence-table` produce a flee key: the inactive-row test fails. (3) present a `container_taken` with a `life` field: the extended leakage test fails.

---

## W9: property refusal (Body hook) and wiring

D-CS-02 (recommended: approve both hooks as explicit traits, `morality_hooks: false` by default; only the refusal hook is a world card, the commitment-wake hook is deferred) and D-CS-05 (the deterministic rule when d20 checks are off).

### AN-52: moral decision contract unblocker (trimmed)

- **id** AN-52. **wave** W9. **depends-on** AN-50. **decisions** D-CS-02, D-CS-05; ADR `<allocate via registry>` (the 0164 amendment: a deliberate `mine` or `withdraw` on another life's recorded property may be refused by trait; principle 5 reading; the starving exception). **Dropped from the original:** every reflection-input shape (kit-local now, HC-32), the commitment decision identity, and any reflection prompt (no `reflection/v3`).
- **Deliver:**
  1. Reason code `declined` in `contract/schemas/action-outcome-event.schema.json` (enum), `contract/src/outcome-words.ts` (`REASON_PHRASE.declined = "you decided against taking what is someone else's"`, so the player reads `Your mine failed: you decided against taking what is someone else's.`; no name, no score, no operator text), `golem/src/actions/outcome.ts` (`FailReason` union), `golem/src/metrics.ts` (the reason list at line ~239), and `threshold/mcp/src/events/handlers/intent.ts` (`failureReason`: a `declined` prefix maps to the same fixed words). Name `declined` is a recommendation; the orchestrator may choose another fixed word, but it must be one code, agent-safe.
  2. Decision identity (a documented string rule plus a pure builder in `contract/src/`): `propertyDecisionKey({ lifeId, verb, x, y, z, day }) = "prop:<life>:<verb>:<x>,<y>,<z>:d<day>"` with `day = floor(worldTick / 24000)` (one reconsideration per in-game day: the same cell and verb inside one day always reuse the same decision, so repeated submission cannot reroll until success; after a restart the deterministic draw below gives the same answer; a new day is a new decision). The key is the roll's decision id in geldar A's audit event (AN-02 `RollEvent`; field name `(to confirm)`).
  3. `docs/decisions/<allocate via registry>-property-refusal.md`: the amendment text, the truth table (`mode` off / `morality_hooks` false / unknown ownership / own / other; every score for law 1-5 with and without `rolls`; `good <= 2` and starving), the d20-off rule (see AN-37), and "no information-leaking refusal".
- **may-edit** `contract/schemas/action-outcome-event.schema.json`, `contract/src/outcome-words.ts`, `contract/src/property-decision.ts` (new), `contract/src/index.ts`, `contract/src/generated/**` (by `generate`), `golem/src/actions/outcome.ts` and `golem/src/metrics.ts` (one union member and one list entry each, so the typecheck passes), `threshold/mcp/src/events/handlers/intent.ts` (one line), `contract/test/property-decision.test.ts` (new), `contract/test/outcome-detail.test.ts` (fixture row), the ADR (new), worknote.
- **must-not-edit** MNE-BASE; no hook behaviour, no `golem/src/actions/mine.ts` or `container.ts`.
- **checks** `./geldar.ps1 pnpm test contract/test/property-decision`, `contract/test/outcome-detail`, `threshold/mcp/src/events/failure-reason`; G-base 2-5, 7. Cases: old action outcomes still validate; the `declined` message contains no owner name, number or marker word; `propertyDecisionKey` is stable for the same inputs, differs by day, verb and cell, and rejects a malformed life id; repeated delivery of the same decision preserves its id.
- **size** 35-45k. **worknote** `.../AN-52.md`. **commit** `feat(character): property-refusal reason code and decision identity`. **on-cap** standard. **branch** `codex/an-52-refusal-contract`.
- **revert-checks** (1) drop `declined` from the enum: "declined validates" fails. (2) include the day in neither key nor builder: "a new day is a new decision" fails. (3) put a name in `REASON_PHRASE.declined`: the no-name test fails.

### AN-37: trait-based deliberate property refusal (a Body action hook)

- **id** AN-37. **wave** W9. **depends-on** AN-52. **decisions** D-CS-02, D-CS-05, D-CS-01 (a refusal is a trait of the agent; it never writes a goal).
- **Read first (verified):** `till.ts` (decision 0167) already refuses another life's recorded block with the pattern `ownerRecordAt(pos)` + `isOwnPlacement`; `mine` stays free and `goto`'s protection is separate (0164, `protected-blocks.ts`) and is **unchanged** here. The hook goes in `mineBlocks` (`golem/src/actions/mine.ts`, after the `unbreakableReason`/`hazardReason` check and before `digOnce`, with `at` the target cell) and in `withdrawAction.run` (`golem/src/actions/container.ts`, before `withContainer`, using the action's `at`).
- **Deliver:**
  1. `golem/src/actions/property-refusal.ts` (new):
     ```ts
     export interface RefusalPolicy {
       /** Characters of this life: law, good (1-5), rolls enabled, proficiency level for law (0 when none). */
       sheet(): { law: number; good: number; rollsEnabled: boolean; lawProficiency: number } | null;
       /** The roll engine call from geldar A (AN-03; to confirm the name): returns success for law vs DC 11. */
       check(decisionKey: string, sheet: ..., dc: 11): { success: boolean; recorded: boolean };
       starving(bot: Bot): boolean;                   // hunger <= 6 and no edible food carried (BodyView.hunger, edibleFoods)
       day(): number;
     }
     export function setRefusalPolicy(p: RefusalPolicy | null): void
     export function refuseProperty(ctx: ActionContext, verb: 'mine' | 'withdraw', cell: Vec3): ActionOutcome | null
     ```
     `refuseProperty` returns `null` (proceed) unless **all** hold: a policy is set (off means no policy: the old behaviour, bytes identical); the cell is not an own placement (`isOwnPlacement`); `ownerRecordAt(cell)` is `{ known: true, owner }` with `owner !== null` and `owner !== bot.username` (**unknown ownership is never refused**: it is not proof of someone else's property; `goto`'s unknown-is-protected rule is a different path); not (`sheet.good <= 2` and `starving`). Then one decision: `decisionKey = propertyDecisionKey(...)` (AN-52), cached in a bounded `Map` (256, oldest dropped) so a repeat inside the same day returns the stored result without a new draw. `rollsEnabled` true: `check(key, sheet, 11)`; `success` means refuse. `rollsEnabled` false (the D-CS-05 recommendation): **refuse iff the exact success probability of the check is at least 0.5** (law 3 or more with no proficiency at DC 11; derived from the engine's probability table, not a constant), a deterministic rule recorded as `recorded: true, mode: 'deterministic'`. A refusal returns `failed('declined', FIXED_TEXT, { })` with the fixed text of AN-52 and **no** owner, score, roll or key in the outcome; the roll audit event carries the decision id.
  2. Call sites: two lines, one in each action, `const refused = refuseProperty(ctx, 'mine', at); if (refused) return refused;` (for `mine`, `failed(..., { mined })` keeps the count so far: build the outcome with `mined` in the detail). Nothing else in `mine.ts`/`container.ts` changes.
  3. A refusal consumes no extra world time and leaves the cell untouched.
- **may-edit** `golem/src/actions/property-refusal.ts` (new), `.../property-refusal.test.ts` (new), `golem/src/actions/mine.ts` (one call site), `golem/src/actions/container.ts` (one call site), `golem/src/actions/mine.test.ts` and `container.test.ts` (one case each; `to confirm` names), worknote. Registration and config are AN-53's.
- **must-not-edit** MNE-BASE, `golem/src/actions/protected-blocks.ts`, `till.ts`, `goto*.ts` (goto protection unchanged, decision 0164).
- **checks** `./geldar.ps1 pnpm test golem/src/actions/property-refusal`, `golem/src/actions/mine`, `golem/src/actions/container`; G-base 2-4, 7. Cases: self, other and unknown ownership; every law score 1-5 with rolls on (injected draws) and off (deterministic); `good <= 2` and starving exception; `good <= 2` and not starving; the same cell and verb twice in one day (one decision, one roll record); a new day; action cancelled mid-way; a restart (new policy instance, same key, same outcome with the seeded draw); the outcome text and detail contain no owner name or number; with **no policy set, `mine` and `withdraw` behave exactly as before** (run the existing mine and container suites unchanged).
- **size** 45-50k. **worknote** `.../AN-37.md`. **commit** `feat(character): trait-based refusal to take another life's recorded property`. **on-cap** standard. **branch** `codex/an-37-property-refusal`.
- **revert-checks** (1) refuse for `known: false`: "unknown ownership is never refused" fails. (2) drop the cache: "same day, one decision" fails. (3) drop the starving exception: "good 2 and starving proceeds" fails. (4) ignore `rollsEnabled`: "d20-off is deterministic" fails. (5) set a policy default: "no policy keeps old behaviour" fails.

### AN-53: morality integration (world half)

- **id** AN-53. **wave** W9. **depends-on** AN-37. **decisions** D-CS-02, D-CS-10 (activation is its own gate; this card ships inactive). **Dropped from the original:** the commitment-wake binding, the reflection input and trust revision (AN-38 deferred; reflection is HC-32).
- **Deliver:**
  1. `golem/src/adam/adam-body.ts` (shared owner this wave): when the Body's character config has `mode: sheet` and `morality_hooks: true` (accessor `(to confirm: geldar A)`), build a `RefusalPolicy` from the Body's own-life sheet and proficiency cache (AN-05/AN-11) and the roll producer (AN-06 adapter) and call `setRefusalPolicy`; `setRefusalPolicy(null)` in `stop()` and in the failed-start cleanup. Both flags false or omitted: no call, the old path.
  2. A fixture shard config with `morality_hooks: true` for **disposable** lives only (`shards/` fixture file `(to confirm)`; geldar A owns the sample off config; production stays false until D-CS-10).
  3. The worknote captures the observed refusals for the ops run.
- **may-edit** `golem/src/adam/adam-body.ts`, `golem/src/adam/adam-body.test.ts` (extend), a non-live fixture shard file (new), worknote. **must-not-edit** MNE-BASE otherwise; no production shard or ACL change.
- **checks** `./geldar.ps1 pnpm test golem/src/adam` and `golem/src/actions/property-refusal`; G-base 2-4, 7. Cases: hook on/off by flag; `mode: off` with `morality_hooks: true` does nothing; stop clears the policy; a restart rebuilds it.
- **ops (serial, wave close):** one real refused `mine` on another life's recorded block and one real `good <= 2` starving exception on a disposable shard; control runs with `morality_hooks` false and with `mode` off showing the old behaviour; full `./geldar.ps1 check`, integration floor, focused real-client cases, 20 TPS bench. Never activates a live ranger.
- **size** 30-40k. **worknote** `.../AN-53.md`. **commit** `feat(character): bind the property-refusal hook behind its flag`. **on-cap** standard. **branch** `codex/an-53-morality-integration`.
- **revert-checks** (1) call `setRefusalPolicy` without checking the flag: "flag false sets no policy" fails. (2) skip the `stop()` clear: "stop clears the policy" fails.

---

## Deferred

Not written; held with the reason (D-HC-06 and the retarget map).

- **AN-20 future commitment scheduling.** Waits for a design of commitments in the kit (the kit has markdown memory, no commitment store); question card HC-33.
- **AN-38 law-weighted due commitment wakes.** Waits for AN-20 and the same kit design; the law DC 8 decision and `commitment_due` wake reason have no home until then.
- **AN-48 observed promise outcomes.** Waits for HC-33; the structured promise declaration, the observer-scoped matcher and the kept-promise social award all depend on it. Until then the promise evidence row and the kept-promise award stay inactive (AN-50 table).

## Open items

For the orchestrator and the owner, in rough order of risk.

1. **`animus/` is live on the player path.** The MCP stream subjects, the event normaliser, the `act` validator (`PHASE0_PROGRAMS`, `PROGRAM_ARGS`) and the plan builder all import `animus/`. The retarget map treats the whole Mind as abandoned; AN-28a and AN-45 edit four small `animus/` files for that reason. If the owner wants `animus/` deleted, those pieces must first move to `threshold/mcp` or `contract/`. Not decided here.
2. **Body-api number.** The brief's `body-api/v7` for explore, farm and patrol is taken by `till` (decision 0167). The cards use `<allocate via registry>` and recommend `v8`; the ADR numbers recommended are `0182` and up, SQL `0037` and up, thought prompts `v8` and up (none needed). Recheck at dispatch: `0173`/`0035`/`0036` are on `phase1/c7-wave3`, `0169` on `phase1/players-host-restart`, and the registry file's own "next free" lines are stale.
3. **D-CS-05 d20-off rule changes all-3 behaviour for the refusal hook.** With the recommended "refuse iff P(success) >= 0.5", law 3 at DC 11 (exactly 50%) refuses **every** time when `rolls: false`. That is a bigger effect than the d20-on 50%. The owner must accept it per function (the brief says so) or pick another rule; AN-37 isolates the rule in one function.
4. **Observation knowledge rules are the conservative reading of D-CS-06.** Gifts only for the recipient; breaks and takes only for the owner of the block or container, who must see it; no third-party evidence; no flee evidence; no promise evidence. If the owner wants third-party witnesses to learn "X broke Y's block", that is a new knowledge rule (and an ownership-disclosure question), not a change inside these cards.
5. **Geldar A names are unknown.** Config accessor for `mode`, `tom.enabled`, `morality_hooks`; the roll engine call and its audit event field names; AN-09's first-visit tracker and award-normalisation entry point; whether AN-04's ledger constrains `evidence_kind`. All marked `(to confirm)`; none of these cards is Ready until geldar A's cards fix them.
6. **Plugin API names unconfirmed** (no Paper source read): `Item#getThrower`, `getTicksLived`, `EntityPickupItemEvent#getRemaining`, `LivingEntity#getKiller`, `InventoryClickEvent` location access, the `OwnerCache` single-cell read, and the Gradle task path `:core:test`. Ops must capture real payloads before TypeScript fixtures are written (AN-26a, AN-27a, AN-47a, AN-51a).
7. **`lifeIdFor` identity.** `golem/src/registry.ts` maps a username to a life id deterministically; whether a new life of the same owner reuses a username is not established. If it does, an observer's per-name memory can conflate lives; the kit (HC-27) must key estimates by `actor.name` **and** the observation's world tick context, or the Body must carry a life suffix. Needs a ruling with the birth work (W10).
8. **Observation events do not wake the agent** (same as `heard_sound`). If the kit wants a wake on "someone took my things", a wake interest and `McpInterest` value are a separate small card.
9. **Farm does not till.** The Body `till` verb exists at `a1c6fb2a` (it did not at `907f5b8a`, which only had the contract and body-api `v7` entries); the farm program only harvests and replants existing farmland. A program that prepares fields is a new decision (D-CS-14 follow-up).
10. **File sizes.** `golem/src/adam/adam-body.ts` is 293 lines and receives edits from AN-28b, AN-45 and AN-53 in three waves; `golem/src/actions/mine.ts` is 405. Both stay under the 500-line soft cap if the edits stay as listed; a coder who needs more splits first, in a separate commit (conventions section 1).
11. **Original text reconciled.** Differences from the original W5-W9 cards, besides trims: AN-26, 27, 28, 47, 51 split into a/b halves (plugin/Java versus TypeScript, four plugin classes need real payload capture first); the "snapshot path" of AN-25 does not exist; the contract unblockers add four new schema files (`observation-event`, `provenance`, `program-shapes`, `combat-fact-event`); W8 needs no SQL unless AN-04's ledger forces it; the leakage gate is a test over the whole chain (Body filter to presented player event), because the kit reads only the presented list.
12. **Not run:** nothing in this file was built or tested; every `(to confirm)` is a place a coder or the orchestrator must read code before the card is Ready.
