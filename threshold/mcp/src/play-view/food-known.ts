import type { Snapshot } from '@geldar/contract';

/**
 * The food the Body has seen (food_known), newest first. An empty list is the fact that no food is
 * known; the part is absent only when the Body does not report it.
 */
export function foodKnownPart(
  surroundings: Snapshot['surroundings'],
): Partial<Snapshot['surroundings']> {
  return surroundings.food_known === undefined ? {} : { food_known: surroundings.food_known };
}
