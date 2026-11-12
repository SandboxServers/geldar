import type { Snapshot } from '@geldar/contract';

/**
 * The hazards near the agent (PX-5): lava, deep water, drops, fire and cactus in sight, nearest
 * first, at most four. They are part of `surroundings`, so the surroundings projector spreads this
 * in. They are not a projector of their own: a projector's keys are copied onto the snapshot part
 * shallowly, and a second `surroundings` key would replace the first. Empty when the Body reports none.
 */
export function hazardsPart(
  surroundings: Snapshot['surroundings'],
): Partial<Snapshot['surroundings']> {
  return surroundings.hazards === undefined ? {} : { hazards: surroundings.hazards };
}
