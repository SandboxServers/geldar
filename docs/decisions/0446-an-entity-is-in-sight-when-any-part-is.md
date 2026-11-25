# 0446. An entity is in sight when its feet, middle or eyes are

- Status: Proposed (the owner accepts it in the PR review)
- Date: 2026-11-25
- Spec: the perception channels and the knowledge boundary (5.2); refines decision 0154 ("what a player could see"; rulings 5 and 6)

## Decision

1. **The sight rule.** The Body sees an entity within range when the line from its eyes to any one of three points on the entity is clear: the feet (0.1 above them), the middle (half the height) or the eyes (0.9 of the height). Before this record it was one line, to the middle only.
2. **One rule everywhere.** The snapshot's agents and entities, `findVisibleAgent` (`give`, `goto`, `follow`), the reflexes' hostiles and arrows, the fight provenance and the body-image viewport all use it, through `canSeeBody` in `golem/src/perception/body-sight.ts`. Glass and bars still do not block sight.
3. **Tossing is stricter.** A `give` tosses only when the middle or the eyes line is clear of every block shape, glass included (`canTossTo`). The toss aims at the eyes, so a clear feet line alone does not let an item through. An agent whose feet are in sight under a block is told `something is in the way of the toss`, not that nobody of that name is in sight.
4. **The not-in-sight diag** (operator only) records the blocker's position and the blocker of each of the three lines (`los_block_pos`, `rays`).

## Why

On colo, from 2026-11-22, about half of the `give` attempts failed with "no such agent in sight", up from 28%. The Body's diag put 53 of 54 line-of-sight failures since 11-23 on `oak_planks`. These were mostly at the same height and under 4 blocks apart. One line to the middle can call an agent out of sight while its head is in plain view over a block, which a player would see. Vanilla's own line-of-sight check goes eye to eye. Decision 0154 asks for what a player could see, and a player sees a head over a wall.

Geometry limits how much this explains. Within give reach (3 blocks), one full block at foot height cuts the middle line only when it stands against the target. The colo failures may therefore be mostly real walls, where the refusal is correct. The `rays` field tells the two apart on live data.

## Consequences

- Agents see slightly more: a body partly behind a block is reported. Reflexes may react to a hostile whose head shows over a one-high wall. This is intended under ruling 6, as the Body and the Mind still agree.
- Tests that hid an entity behind one block now use a wall two blocks high.
- The check costs up to three rays per entity when the first is blocked, and one when it is clear.
- On colo this is a dated change to perception. An analysis of sight-dependent actions that spans the deploy must split at it.
