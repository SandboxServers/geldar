# 0163: A shelter is enclosed by blocks or a closed door

- Status: Accepted
- Date: 2026-11-13
- Spec: the build programs and the enclosed flag, under decision [0074](0074-shelter-means-an-enclosed-safe-space.md). Owner ruling given 2026-11-13 in the journal-watch orchestrator session, quoted below.

## Context

The `shelter` blueprint left a door gap on its +z side: the two cells at dx 0, dz +1, dy 0 and 1 were not built. The enclosure test (`ENCLOSURE` in `golem/src/body/view.ts`) requires those two cells to be solid. So a shelter built exactly to its blueprint could never read as enclosed, and the build reported "Not enclosed: open to the south." after placing every cell.

The diagnosis of the 2026-11-13 Colo run (`diag-build-empty`) found that a ranger who re-issued `build` on the same spot placed nothing: every cell was already solid, the program finished in one tick, and the Mind was still told the shelter was open. Two defects combined: the blueprint could not satisfy the check, and the completion text never reached the Mind. The second is fixed separately. This decision fixes the first.

## Decision

Owner ruling, 2026-11-13:

> a shelter is enclosed when every side cell is solid OR holds a CLOSED door; an open door doesn't count ("they aren't born in a barn; doors need closing"). Both a fully sealed shelter and one with a door are valid.

The rules that follow:

1. A side cell closes the Body when it is a solid block, or a door that is shut (`open` false). An open door never closes a side, whatever its collision box says.
2. The `shelter` blueprint has no door gap. It is 25 cells: a ring of walls two high around the start cell, a roof, and the +z doorway (two cells). The build fills the doorway with a wooden door when the body holds one, else with the build block.
3. A placed door fills both of its halves. The build counts the upper doorway cell as done once the lower one holds a door, and never places it separately.
4. A completed build of a body that is not enclosed names the open sides. When every open side is an open door, it says `Not enclosed: the door is open.`
5. A shelter checkpoint from before this decision counts 23 cells, so its `next` does not index the same cells. It is restarted from cell 0, and the cells already built count as solid. New checkpoints record the cell count they were made from.

## Consequences

- A shelter of blocks, or one with a closed door in the doorway, reads as enclosed. An open door reads as not enclosed.
- The shelter is 25 cells (was 23). A build that places every cell now reports `of 25`, and a rebuild on a finished shelter places nothing and reports the shelter enclosed.
- The doorway is a door or a block, chosen by what the body holds. Iron doors are not used: they need a redstone signal, so they are not wooden doors.
- Old shelter checkpoints restart from cell 0. This costs a rescan of the built cells, which count as solid, so no cell is placed twice.
- Not verified live: the upper door half's collision box. The build's upper-cell check does not depend on it, because it is decided by the lower half.
