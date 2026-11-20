# AN-51b: observed container take in the owner's Body (worknote)

Status: `observeTake` returns a `container_taken` observation for a take from a container the Body owns, when the Body can see that container. Nothing subscribes to it or wires it yet, so behaviour and bytes are unchanged.

**Paper-only; do not enable on NeoForge until the human-handling question is decided.** AN-51a/b is dropped on NeoForge.

## What changed

- `golem/src/perception/provenance/container-take.ts` (new):
  - `observeTake(msg, ctx)` where `ctx = { bot, tick, self, seen }` (`seen` is required). Returns `ObservationPayload` (`kind: 'container_taken'`) or null.
  - Null when `msg.prior_owner !== ctx.self` (other lives' containers, and unknown owners), when `msg.actor === ctx.self`, when the message is malformed (non-integer `x`, `y`, `z` or `tick`; a `tick` below 0 or after `ctx.tick`; `x` or `z` beyond ±30000000 or `y` beyond ±2048; an empty, over-64-character or non-`[a-z0-9_]` item; a count that is not an integer from 1 to 2304), when the block at the cell is not `chest`, `trapped_chest` or `barrel` or is not `canSeeBlock` from the Body, or when the block lookup throws.
  - The taker is named only through `observedActor(ctx.bot, msg.actor)` (AN-25). A hidden or loosely spelt taker leaves the observation unattributed (no `actor` field).
  - Key: `take:<msg.tick>:<x>:<y>:<z>:<observed actor name, or ->:<item>`.
  - The built payload goes through `validateObservationPayload` (`@geldar/contract`) before the key is admitted. The contract has the last word on key shape and length, count and item.
  - `TakeKeyLru`: a bounded memory of 256 keys. A repeat is refused and moves to the front; past 256 the least recently seen key goes. A key is admitted only when an observation is returned, so a refused take takes no slot.
  - `TakeProvenance` is derived locally as `Exclude<Provenance, { kind: string }>`, because `@geldar/contract` exports `Provenance` but not `TakeProvenance` by name. The contract is unchanged.
- `golem/src/perception/provenance/container-take.test.ts` (new): 32 tests (`observeTake`, the contract gate, and `TakeKeyLru`). The key is asserted on the hidden, loosely spelt and empty-actor takes; the container set is a table over `chest`, `trapped_chest`, `barrel` and a non-container `ender_chest`; the bounds, the validator on both the named and the unattributed result, and the `seen` type are tested.

## Deviations from the card

- `ctx` gains `seen: TakeKeyLru`, required (review 1, note 3). A caller that omits it is a type error, so every redelivery is deduplicated by construction. The card's shape has no `seen`; this is the stated deviation.
- `ctx.tick` is used: a take stamped after the current tick is refused (a hostile-input guard).
- The container set (`chest`, `trapped_chest`, `barrel`) is a local constant that matches `container.ts`; `container.ts` is not edited.

## Index line for AN-50b

- Wiring (AN-50b / AN-28b, not this packet): the Body's take subscription passes `{ bot, tick, self, seen }` with one `TakeKeyLru` per Body to `observeTake`, and maps a non-null result to a `container_taken` ObservationPayload. Import `observeTake` and `TakeKeyLru` from `../perception/provenance/container-take.ts`. `seen` is required, so the wiring cannot leave it out.
- Redelivery after the taker becomes visible gives a second observation, attributed this time (the key embeds the observed name, so the key differs). The consumer must not treat the unattributed one as an event.

## Revert-checks (run on the committed fix)

1. Drop the owner check (`msg.prior_owner !== ctx.self ||` removed). Fails `other-owned teaches nothing`, `unknown container: a take with no prior owner teaches nothing`, `ownership changed mid-operation: the message prior_owner decides`, `a refused take takes no slot in the LRU`.
2. Skip the visibility test (`canSeeBlock(bot, block)` replaced by `true`). Fails `out-of-sight container is null`.
3. Name the actor without `observedActor` (`msg.actor ? { name: msg.actor, life: msg.actor } : null`). Fails `hidden taker unattributed`, `a visible taker with a loose spelling is not named but the take is seen`.

Review 1 mutations (each a one-line edit, restored from a scratchpad backup; `git diff --stat` empty after each restore):

4. Key uses the raw message actor (`${msg.actor ?? '-'}`). Fails `hidden taker unattributed`, `a visible taker with a loose spelling is not named but the take is seen`, `an empty actor name is unattributed, never named`.
5. The explicit `msg.tick >= 0` removed. Fails `a take past the contract bounds is refused: count, item length, tick, coordinates`.
6. The validator gate removed (`validateObservationPayload` line deleted). Review 1 passed all 29 tests; after review 2 it fails `the contract gate in observeTake: a take the contract refuses is null and takes no LRU slot` (the validator is a `vi.mock` spy queued to return false).
7. `seen` made optional again (`seen?`, and the previous `ctx.seen && ...` guard). `tsc --noEmit` fails: `Unused '@ts-expect-error' directive` in `container-take.test.ts`.
8. `barrel` removed from the container set. Fails `a take from a barrel is observed`.
9. `trapped_chest` removed from the container set. Fails `a take from a trapped_chest is observed`.

Review 2 fix (AN-51b-review-2, notes 1 and 2):

10. The validator and its order are now pinned. The test file wraps `validateObservationPayload` in a `vi.fn` that calls through; two tests queue its result. Validator line deleted: fails the refused-take case. Validator swapped after `admit`: fails the same case (`seen.size` is 1, not 0).
11. The bounds test is renamed to what it pins (count, item length, tick). The three coordinate cases moved to `far coordinates are refused for lack of a block, so this does not pin the coordinate bound`: no block exists there in FakeWorld, so they are refused without the bound. Mutation `inBounds` replaced by `true`: passes 32/32. The coordinate bound is defence in depth, not pinned by a test.
## Notes

- Nothing passes a `seen` yet, so the LRU is inert. The wiring must pass one; `tsc` enforces it.
- `world` in the take is not checked against the Body's world. Not in the card; left for AN-50b.
