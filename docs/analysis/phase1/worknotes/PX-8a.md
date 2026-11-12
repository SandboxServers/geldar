# PX-8a worknote: reach dry run in the Body

- Branch `phase1/px-8a-reach-dryrun`, from origin/main.
- Code: `golem/src/actions/reach.ts` (pure dry run, injected planner), `golem/src/actions/pathing.ts`
  (`planReach`, a read-only route plan; `REACH_RANGE`), tests in `golem/src/actions/reach.test.ts`.
- Outcomes: `in_hand` (held item kind equals the remembered kind), `walk` (soft-dig movements find a
  route), `needs_digging` (only full digging finds a route), `blocked` (no route either way),
  `unknown` (never seen or remembered, planner timeout, planner throw, or visited nodes over
  `REACH_NODE_CAP`).
- `walk` steps are horizontal blocks, |dx| + |dz|, not the planner's path length.
- The library (mineflayer-pathfinder 2.4.5) has no node cap parameter; the cap is applied to the
  visited count the planner reports, and the search stays bounded by its own timeout.
- Not wired: `perception/surroundings/reach.ts` stays empty and the tool stays hidden until PX-8b.
- Dependency note: the card lists PX-2a as merged, which is not on main at the time of this work.
