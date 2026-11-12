// Follow framing: try a few candidate offsets (behind, left, right, higher) and keep the one whose line
// to the agent crosses the fewest foliage blocks. Pure; the rig re-evaluates every FOLLOW_REPICK_SECONDS
// and blends towards the chosen offset, so the view does not jitter.

import { blockedCount } from '../foliage.ts';
import type { VoxelWorld } from '../world.ts';
import { collides, type Vec3 } from './collision.ts';

export const FOLLOW_REPICK_SECONDS = 0.5;
/** A different candidate must beat the current one by at least this many blocked blocks. */
export const FOLLOW_SWITCH_MARGIN = 2;

/** The candidate offsets: the base, 60 degrees left and right of it, and a higher, steeper one. */
export function followCandidates(base: Vec3): Vec3[] {
  const turn = (deg: number): Vec3 => {
    const a = (deg * Math.PI) / 180;
    return {
      x: base.x * Math.cos(a) + base.z * Math.sin(a),
      y: base.y,
      z: -base.x * Math.sin(a) + base.z * Math.cos(a),
    };
  };
  return [
    { ...base },
    turn(60),
    turn(-60),
    { x: base.x, y: base.y + 5, z: base.z * 0.6 },
    { x: base.x, y: base.y + 9, z: base.z * 0.2 },
  ];
}

/**
 * The index of the candidate to use. Candidates whose camera box is inside a solid are skipped.
 * `current` is kept unless another is clearer by FOLLOW_SWITCH_MARGIN blocks (or current is unusable).
 */
export function pickFollowIndex(
  world: VoxelWorld,
  look: Vec3,
  candidates: Vec3[],
  current: number,
): number {
  const score = candidates.map((o) => {
    const p = { x: look.x + o.x, y: look.y + o.y, z: look.z + o.z };
    return collides(world, p) ? Number.POSITIVE_INFINITY : blockedCount(world, look, p);
  });
  let best = 0;
  for (let i = 1; i < score.length; i++) if ((score[i] ?? 0) < (score[best] ?? 0)) best = i;
  const cur = score[current] ?? Number.POSITIVE_INFINITY;
  const bestScore = score[best] ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(cur)) return best;
  return cur - bestScore >= FOLLOW_SWITCH_MARGIN ? best : current;
}
