# AN-47c worknote: visible-fight observation (Body)

Status: done as an inert module. Nothing wires it (AN-50b does). Paper-only in behaviour; do not enable on NeoForge until the human-handling question is decided.

## What it does

`golem/src/perception/provenance/fight-seen.ts` exports `observeFight(msg, ctx)`, the class `FightWindows`, and the type `CombatProvenance`.

- Only `engaged` is observed. `killed` gives null.
- The message must be well formed: `actor` null or a string, `world` a non-empty string, `tick` an integer at least 0, `target` matching `^[a-z_]{1,64}$`.
- `ctx.world`, when given, must equal `msg.world`.
- A null actor, or an actor equal to `ctx.self` (case-insensitive), gives null.
- The fighter is named only through `observedActor(ctx.bot, msg.actor)` (or `ctx.resolve` when injected). A throwing resolver gives null.
- A mob whose `name` is `msg.target`, whose type is not `player`, is within 24 blocks of the Body and passes `canSeePoint` from the eyes to the middle of its body. That is the same sight rule `visibleView` uses for players. No new sight function was written. No mob in reach gives null.
- The key is `fight:<msg.tick>:<actor>:<target>`, lowercased. The payload goes through `validateObservationPayload`. A refused payload takes no window slot.
- The payload is `{ kind, actor, target, key }`. Health, the sheet and the mob position never enter it.

## The 600-tick window

- One entry per (fighter, target) pair, lowercased, stored as the Body's `ctx.tick` at its last observation.
- A repeat is refused while `now - last < 600`. So a repeat 599 ticks later is refused, and one 600 ticks later is admitted.
- A refused repeat does not move the stored time.
- Bounded at 256 pairs. The least recently observed pair is dropped.
- A negative elapsed time (the clock went back) is refused.
- The window is measured on `ctx.tick`, not on `msg.tick`.

## Deviations from the card

- The card's `ctx` had no place for the window state. `ctx.windows: FightWindows` is required, so the caller holds the dedupe state.
- `CombatProvenance` is defined locally as `Extract<Provenance, { kind: 'engaged' | 'killed' }>`. The contract index exports no `CombatProvenance` name (tsc failed on a direct import). The union `Provenance` does include it.
- `ctx.resolve` is optional. It defaults to `observedActor(ctx.bot, name)`. It exists so the throwing-resolver test can inject a throw.
- The mob is matched by `entity.name` (mineflayer's registry name), with `type !== 'player'`. The match is by type only, not tied to the fight: any mob of the target type in reach and in sight counts, not necessarily the mob the actor hit (a known limit, as the card specifies).

## Fixture and real shape

No captured combat provenance payload exists in the repo. The fixture in `fight-seen.test.ts` is hand-made from the `CombatProvenance` type in `contract/src/generated/types.ts`: `{ world, actor, target, kind, tick }`. The plugin side is in the AN-47a worknote (the combat JSON, `engaged` once per encounter, `life_id`). The real message shape still needs a captured sample before wiring.

## Revert-checks (run, each a one-line mutation, file restored from a backup, `git diff --stat` empty afterwards)

| Mutation | Failing tests |
| --- | --- |
| emit for an invisible actor (`fighterOf(...) ?? { name, life }`) | `a hidden or far actor gives null`; `two attackers, only the visible one is observed`; `a throwing resolver gives null` |
| drop the 600-tick window (`if (false) return false;`) | `repeated engaged messages within 600 ticks give one observation`; `after 600 ticks a new observation; 599 ticks is still refused, 600 is allowed` |
| accept `killed` (drop `msg.kind !== 'engaged'`) | `killed gives null` |
| remove the world check | `a fight in another world gives null; the Body world gives the observation` |
| remove the 24-block reach (`true &&`) | `a mob out of 24 blocks, or no such mob nearby, gives null` |
| remove the self check | `the own fight of the Body gives null` |
| unbounded map (`if (false) {` on the size check) | `FightWindows holds 256 pairs and forgets the oldest` |
| sight rule replaced by `true` (the `canSeePoint(...)` call) | `a mob behind a wall gives null; a mob in the open to the north or west is in sight` |
| contract line deleted (`if (!validateObservationPayload(payload)) return null;`) | `a payload the contract refuses gives null and takes no window slot` |
| sight `catch` replaced by `finally` (exception propagates) | `a throwing sight read gives null, not a throw` |
| recency delete removed (`this.last.delete(pair);`) | `a re-admitted pair is the newest, so the next pair drops another` |
| player type check removed (`entity.type !== 'player' &&`) | `a player named like the target is not a mob, gives null` |
| actor type check removed (`(msg.actor === null \|\| typeof msg.actor === 'string') &&`) | `a non-string actor gives null, not a throw` |
| world length check removed (`msg.world.length > 0 &&`) | `an empty world gives null even with a zombie in sight` |
| tick minimum removed (`msg.tick >= 0 &&`) | `a negative tick gives null even with a zombie in sight` |
| tick integer check removed (`Number.isInteger(msg.tick) &&`) | none: the test passes without the line, because the contract refuses the key `fight:1.5:...` (kept as a behaviour test) |
| target pattern removed (`TARGET.test(msg.target)`) | none: the test passes without the line, because a namespaced target matches no mob name and the contract refuses it (kept as a behaviour test) |

## Index for AN-50b

- Import from `golem/src/perception/provenance/fight-seen.ts`: `observeFight`, `FightWindows`, `type FightContext`, `type CombatProvenance`.
- Context per call: `{ bot, tick: <world age now>, self: <Body username>, world: <the Body's world name, e.g. from bukkitWorldOf(bot)>, windows: <one FightWindows per Body> }`. Omit `resolve` in production.
- Dedupe state to hold: one `FightWindows` per Body, kept for that Body's session and not persisted. A restart clears it, so a fight in the window after a restart can be observed again.
- Wire only on the Paper combat subject (`provenanceCombatSubject`). Do not enable on NeoForge.

## Real fixture (replaces the hand-made-only note)

The two real `engaged` payloads captured 2026-11-20 at 73788889 (AN-47a worknote, capture section: kill tick 2631, survived tick 3202) are in `golem/src/perception/provenance/fixtures/combat-real.json`, field for field and biome-formatted. The test `the captured real engaged payloads validate with validateProvenance and give one observation` validates both with `validateProvenance` and runs `observeFight` on each (a visible `ag_capa_01`, Body `ag_capb_02`, world `world`). The `engaged()` helper stays for the edge cases (ticks, actors, kinds). The earlier statement that no captured payload exists was wrong.

Revert-check on the new case: the key prefix `fight:` changed to another word fails 3 tests, among them the new real-payload case. Building the key from `msg.actor` instead of `actor.name` is an equivalent mutant (the message carries the same name) and survives.
