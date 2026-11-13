import { Vec3 } from 'vec3';

/**
 * A recipient closer than this (blocks) is too close for a toss to land past them: the items fall
 * short of, or onto, the recipient, who does not move to collect them. The Body steps back first.
 */
export const STEP_BACK_BELOW = 1.5;
/** The distance (blocks) the Body steps back to from a recipient that is too close. */
export const STEP_BACK_TO = 2;

/**
 * The point `distance` blocks from `recipient`, on the line from the recipient through `body`, at
 * the body's height. Only the x and z axes count, so the step is level. Null when the two stand on
 * the same spot: there is no line to step along, so the Body does not step.
 */
export function stepBackPoint(
  body: Vec3,
  recipient: Vec3,
  distance: number = STEP_BACK_TO,
): Vec3 | null {
  const dx = body.x - recipient.x;
  const dz = body.z - recipient.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  return new Vec3(
    recipient.x + (dx / length) * distance,
    body.y,
    recipient.z + (dz / length) * distance,
  );
}
