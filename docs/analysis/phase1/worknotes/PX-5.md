# PX-5: hazards and line of sight for block counts

Decision: 0154 rulings 5 and 6 (block counts and hazards need line of sight).

## Done

- `golem/src/perception/surroundings/hazards.ts` (the PX-S1 probe file): `hazards` lists lava,
  deep water (any water cell), fire, soul fire as fire, cactus and drops within 8 blocks, at most
  4, nearest first, only cells in line of sight (`canSeeBlock`). Direction is one of the eight
  schema points (`n`, `ne`, ...). Distance is the whole-block distance from the feet to the cell
  centre.
- A drop is an open feet-row cell with no floor, and no fluid, in the three cells below. The
  Body's own column is not listed; a hole under the feet is the hazard-escape reflex's job.
- The field is left out (`{}`) when nothing is in sight, so open ground keeps its snapshot.
- `golem/src/perception/nearby-counts.ts`: counts only cells the Body can see (ruling 5).
  The old test that counted a log hidden under a canopy now expects it not to be counted.

## Not done in this packet

- The shared scan with `golem/src/body/reflexes/hazard-escape.ts` (card: "the Body shares the
  scan"). The reflex is unchanged.
- `threshold/mcp/src/play-view.ts` projection of `hazards` (PX-S2 handler not added).
- The `lake-edge` live case (`live: pending`).
- `blocks_counted_in_sight` is not set by any producer.

## Checks

- `golem` unit tests excluding `test/live`: 136 files passed, 1 skipped, 1405 tests passed.
- `golem` typecheck passes. The generated `hazards` type is a union of tuples up to four long,
  so `hazards.ts` casts the list to it.
