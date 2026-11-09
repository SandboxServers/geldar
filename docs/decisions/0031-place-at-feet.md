# 0031. `place ... at: "feet"` means the cell the bot's feet are in

- Status: Accepted
- Date: 2026-11-09
- Spec: Appendix C (the `place` action and its torch example); `contract/schemas/thought.schema.json` (`at`); packet P0-09a

## Decision

For the `place` action, `at: "feet"` is the cell the bot's feet are in (`floor(x), floor(y), floor(z)`). It is allowed only for a block with no collision box (a torch, for example). Any other block at `feet` fails with `failed('blocked', 'target is inside the bot')`. The reference block is the one below the cell.

## Why

The schema text says "the block under the agent", the spec example is `place torch at feet`, and the first draft of P0-09a said "the block in front of the bot". These disagree. The cell the feet are in is the reading under which the spec's own torch example works, and it needs no yaw, so the behaviour is deterministic in tests.

## Consequences

- P0-09a drops the `facing` helper. Placing something in front of the bot uses an absolute position.
- The schema description ("block under the agent") is slightly misleading. The contract is not edited in the Phase 0 body packets; the description is corrected when the contract next changes, and the correction cites this record.
- P0-10b and P0-10c use absolute positions, not `feet`, for blocks that collide.
