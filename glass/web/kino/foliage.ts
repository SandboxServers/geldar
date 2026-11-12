// Follow-camera foliage test: count solid or leaf blocks on the line from the agent to the camera, and
// pull the camera in along that line until few remain. Cheap: one march of at most ~64 steps.

import type { StateReader } from './cull.ts';
import { isAir } from './world.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Anything solid or leafy that hides the agent; air, unloaded space and water do not. */
export function isFoliageBlock(s: string | undefined): boolean {
  return !isAir(s) && !(s ?? '').includes('water');
}

/** Blocks along the segment that are not air or water-like see-through; leaves count. */
export function blockedCount(world: StateReader, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.min(64, Math.ceil(len * 2));
  const seen = new Set<string>();
  let n = 0;
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.floor(from.x + dx * t);
    const y = Math.floor(from.y + dy * t);
    const z = Math.floor(from.z + dz * t);
    const k = `${x},${y},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const s = world.stateAt(x, y, z);
    if (isFoliageBlock(s)) n++;
  }
  return n;
}

export const FOLIAGE_MAX_BLOCKED = 2;
export const FOLIAGE_MIN_DISTANCE = 3;

/**
 * The camera position to use: unchanged when the line to the agent crosses at most `maxBlocked` blocks,
 * else moved towards the agent (and raised a little) until it does, never closer than FOLIAGE_MIN_DISTANCE.
 */
export function foliageSafeCamera(
  world: StateReader,
  agent: Vec3,
  cam: Vec3,
  maxBlocked = FOLIAGE_MAX_BLOCKED,
): Vec3 {
  const dist = Math.hypot(cam.x - agent.x, cam.y - agent.y, cam.z - agent.z);
  if (dist <= FOLIAGE_MIN_DISTANCE) return cam;
  if (blockedCount(world, agent, cam) <= maxBlocked) return cam;
  for (let d = dist - 1; d >= FOLIAGE_MIN_DISTANCE; d -= 1) {
    const f = d / dist;
    const p = {
      x: agent.x + (cam.x - agent.x) * f,
      y: agent.y + (cam.y - agent.y) * f + 0.5,
      z: agent.z + (cam.z - agent.z) * f,
    };
    if (blockedCount(world, agent, p) <= maxBlocked) return p;
  }
  return {
    x: agent.x + ((cam.x - agent.x) * FOLIAGE_MIN_DISTANCE) / dist,
    y: agent.y + ((cam.y - agent.y) * FOLIAGE_MIN_DISTANCE) / dist + 0.5,
    z: agent.z + ((cam.z - agent.z) * FOLIAGE_MIN_DISTANCE) / dist,
  };
}
