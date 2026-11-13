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

/**
 * The turns (radians) the Body tries around the recipient when the straight-back spot is blocked:
 * 45 and 90 degrees either side. The straight-back turn comes first.
 */
export const STEP_BACK_TURNS: readonly number[] = [
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
];

/**
 * The spots the Body may step back to, in the order it tries them: the straight-back point, then
 * the same point rotated around `recipient` by each of `STEP_BACK_TURNS`, at the body's height and
 * `distance` blocks out. Empty when the two stand on the same spot.
 */
export function stepBackSpots(
  body: Vec3,
  recipient: Vec3,
  distance: number = STEP_BACK_TO,
): Vec3[] {
  const straight = stepBackPoint(body, recipient, distance);
  if (!straight) return [];
  const dx = straight.x - recipient.x;
  const dz = straight.z - recipient.z;
  return STEP_BACK_TURNS.map((turn) => {
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return new Vec3(recipient.x + dx * cos - dz * sin, body.y, recipient.z + dx * sin + dz * cos);
  });
}
