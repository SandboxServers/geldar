# AN-51b: observed container take in the owner's Body (worknote)

Status: `observeTake` returns a `container_taken` observation for a take from a container the Body owns, when the Body can see that container. Nothing subscribes to it or wires it yet, so behaviour and bytes are unchanged.

**Paper-only; do not enable on NeoForge until the human-handling question is decided.** AN-51a/b is dropped on NeoForge.

## What changed

- `golem/src/perception/provenance/container-take.ts` (new):
  - `observeTake(msg, ctx)` where `ctx = { bot, tick, self, seen? }`. Returns `ObservationPayload` (`kind: 'container_taken'`) or null.
  - Null when `msg.prior_owner !== ctx.self` (other lives' containers, and unknown owners), when `msg.actor === ctx.self`, when the message is malformed (non-integer `x`, `y`, `z` or `tick`; a `tick` after `ctx.tick`; an empty or non-`[a-z0-9_]` item; a count that is not a positive integer), when the block at the cell is not `chest`, `trapped_chest` or `barrel` or is not `canSeeBlock` from the Body, or when the block lookup throws.
  - The taker is named only through `observedActor(ctx.bot, msg.actor)` (AN-25). A hidden or loosely spelt taker leaves the observation unattributed (no `actor` field).
  - Key: `take:<msg.tick>:<x>:<y>:<z>:<observed actor name, or ->:<item>`.
  - `TakeKeyLru`: a bounded memory of 256 keys. A repeat is refused and moves to the front; past 256 the least recently seen key goes. A key is admitted only when an observation is returned, so a refused take takes no slot.
  - `TakeProvenance` is derived locally as `Exclude<Provenance, { kind: string }>`, because `@geldar/contract` exports `Provenance` but not `TakeProvenance` by name. The contract is unchanged.
- `golem/src/perception/provenance/container-take.test.ts` (new): 20 tests (`observeTake` and `TakeKeyLru`).

## Deviations from the card

- `ctx` gains `seen?: TakeKeyLru`. Without it nothing is deduplicated, so the LRU is a caller-held object and the function stays pure about its own state.
- `ctx.tick` is used: a take stamped after the current tick is refused (a hostile-input guard).
- The container set (`chest`, `trapped_chest`, `barrel`) is a local constant that matches `container.ts`; `container.ts` is not edited.

## Index line for AN-50b

- Wiring (AN-50b / AN-28b, not this packet): the Body's take subscription passes `{ bot, tick, self, seen }` with one `TakeKeyLru` per Body to `observeTake`, and maps a non-null result to a `container_taken` ObservationPayload. Import `observeTake` and `TakeKeyLru` from `../perception/provenance/container-take.ts`.

## Revert-checks (run on the committed fix)

1. Drop the owner check (`msg.prior_owner !== ctx.self ||` removed). Fails `other-owned teaches nothing`, `unknown container: a take with no prior owner teaches nothing`, `ownership changed mid-operation: the message prior_owner decides`, `a refused take takes no slot in the LRU`.
2. Skip the visibility test (`canSeeBlock(bot, block)` replaced by `true`). Fails `out-of-sight container is null`.
3. Name the actor without `observedActor` (`msg.actor ? { name: msg.actor, life: msg.actor } : null`). Fails `hidden taker unattributed`, `a visible taker with a loose spelling is not named but the take is seen`.

Each mutation was a one-line edit, restored from a scratchpad backup; `git diff --stat` was empty after each restore.

## Notes

- Nothing passes a `seen` yet, so the LRU is inert.
- `world` in the take is not checked against the Body's world. Not in the card; left for AN-50b.
