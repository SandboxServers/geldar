import type { Vec3 } from 'vec3';

/**
 * A player other than the recipient this close (blocks, horizontal) to the recipient catches a toss
 * meant for them: the items land within about 1.3 blocks of the recipient's feet (decision 0190).
 */
export const CROWD_RADIUS = 2;
/** A player this close (blocks, horizontal) to the line between giver and recipient catches the toss too. */
export const LINE_MARGIN = 1;

/** Where another player stands that would catch a toss: next to the recipient, or beside the line. */
export type CrowdSpot = 'recipient' | 'line';

/**
 * The horizontal distance (blocks, x and z only) from `point` to the segment from `from` to `to`,
 * with the segment ending at its two points (a point past either end counts from that end).
 */
export function distanceToSegment(point: Vec3, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared),
        );
  return Math.hypot(point.x - (from.x + along * dx), point.z - (from.z + along * dz));
}

/**
 * Where a bystander stands that would catch a toss from the Body at `giver` to the recipient at
 * `recipient`, or null when none does. The recipient spot is checked first. A bystander at the
 * exact recipient's spot is the recipient's own entity and is not passed in (the caller excludes it).
 */
export function crowdSpot(
  giver: Vec3,
  recipient: Vec3,
  bystanders: readonly Vec3[],
): CrowdSpot | null {
  const nearRecipient = bystanders.some(
    (at) => Math.hypot(at.x - recipient.x, at.z - recipient.z) <= CROWD_RADIUS,
  );
  if (nearRecipient) return 'recipient';
  const nearLine = bystanders.some((at) => distanceToSegment(at, giver, recipient) <= LINE_MARGIN);
  return nearLine ? 'line' : null;
}
