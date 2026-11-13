# 0160: `place <solid block> at: "feet"` is a pillar step

- Status: Accepted
- Date: 2026-11-13
- Supersedes: the solid-block part of [0031](0031-place-at-feet.md). Owner approval given in session on 2026-11-13.

## Context

Sovereign rangers trapped in pits on Colo spent hours calling `place dirt at feet` and expecting to rise. Their reports said placing at feet "changed nothing". Under 0031 as later implemented, a solid block at the feet moved to a free cell beside the bot. In a crowded or narrow pit that cell was blocked or useless, so the bot never rose.

## Decision

A solid block (not a bed) placed at `at: "feet"` is a pillar step:

- the bot must stand on the ground, over a solid block;
- the two cells above the head must be free or hand-diggable, else the placement fails `blocked` with a "no headroom" message;
- the bot jumps and places the block in the cell its feet were in, then lands one block higher;
- the placement completes only if the block is placed there and the bot ends at least 0.9 higher, else it fails with the reason.

Non-colliding blocks at feet (torch and the like) keep today's behaviour. A bed at feet keeps the beside path of 0031.

## Consequences

- The escape ladder's pillar rung and `place` share one pillar step (`golem/src/actions/pillar.ts`), so the ladder and the placement cannot drift apart.
- The contract description of `at` ("block under the agent") now matches what the server does. No schema change.
- Other entities count as occupying a cell only when their box overlaps it (strict overlap, flush contact is not a collision).
