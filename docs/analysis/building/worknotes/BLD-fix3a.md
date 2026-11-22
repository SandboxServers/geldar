# BLD-fix3a worknote: refuse an unachievable state before digging

Base a2dd9846 (building/integration). Branch phase1/bld-fix3a-dig-order. Fixes review-code-3 I1 and N4.

## Done

- **I1, dig order.** `doCell` (golem/src/building/cell-do.ts) now returns `state_unachievable` before any
  dig or walk when the wanted state has a key the block does not take. Before, a replace of
  `oak_stairs[facing=north]` dug the block and then the place refused the facing, leaving a hole.
- `takesState(block, state)` is exported from golem/src/actions/place-state.ts. `planAt` uses it too
  (no behaviour change there). place.ts refuses the same state before `reachTarget`.
- Tests in golem/src/building/cell-do.test.ts: a replace to `oak_stairs[facing=north]` over stone returns
  `state_unachievable`, the dig is not called and the stone stays; a replace to `oak_stairs[half=top]`
  still digs and places. The two stateful placement tests now use `half` (a facing is no longer placed).
- Not covered by a test: the place.ts ordering. place.test.ts is owned by another coder.

## Facing

Facing is refused for every kind (`FACING_VERIFIED` is empty). See BLD-fix2d.md. The facing sections of
BLD-fix2b.md are struck.
