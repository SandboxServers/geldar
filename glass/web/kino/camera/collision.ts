// Client-side camera collision against the voxels the mesher draws (VoxelWorld).
// Pure functions: nothing here touches the network or writes world data.
//
// Choices (decision 0161):
// - A block stops the camera when it is solid and opaque: a full cube or a block with a box shape
//   (slab, stairs, fence, door). See-through blocks (leaves, glass, water) and plants (grass, flowers,
//   torches) do not: the renderer fades see-through blocks near the camera and on its line to the
//   agent, so the camera passes through a canopy instead of collapsing onto the agent under a tree.
// - An unloaded section counts as solid: the camera cannot fly into void the renderer has not
//   drawn, and it cannot leave the loaded area.
// - A camera box that starts inside a solid does not move (it is never pushed through walls).

import { shapeOf } from '../blockshape.ts';
import { softOf } from '../mesher.ts';
import { isAir, type VoxelWorld } from '../world.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Half-extent of the camera's collision box, in blocks. */
export const CAMERA_HALF = 0.3;
/** Gap left between the camera box and the face it stops against. */
export const EPS = 1e-4;
const STEP = 0.2;

/** A block state the camera cannot pass (undefined, unloaded, counts as solid). */
export function blocksCamera(state: string | undefined): boolean {
  if (state === undefined) return true;
  if (isAir(state) || softOf(state) > 0) return false;
  const kind = shapeOf(state).kind;
  return kind === 'cube' || kind === 'boxes';
}

export function isSolid(world: VoxelWorld, x: number, y: number, z: number): boolean {
  return blocksCamera(world.stateAt(Math.floor(x), Math.floor(y), Math.floor(z)));
}

/** True when the camera box centred on p overlaps any solid or unloaded block. */
export function collides(world: VoxelWorld, p: Vec3, half = CAMERA_HALF): boolean {
  const x1 = Math.floor(p.x + half);
  const y1 = Math.floor(p.y + half);
  const z1 = Math.floor(p.z + half);
  for (let x = Math.floor(p.x - half); x <= x1; x++) {
    for (let y = Math.floor(p.y - half); y <= y1; y++) {
      for (let z = Math.floor(p.z - half); z <= z1; z++) {
        if (!world.has(`${Math.floor(x / 16)},${Math.floor(y / 16)},${Math.floor(z / 16)}`)) {
          return true;
        }
        if (isSolid(world, x, y, z)) return true;
      }
    }
  }
  return false;
}

type Axis = 'x' | 'y' | 'z';

function sweepAxis(world: VoxelWorld, start: Vec3, axis: Axis, delta: number, half: number): Vec3 {
  const p = { ...start };
  let left = delta;
  while (left !== 0) {
    const s = Math.sign(left) * Math.min(STEP, Math.abs(left));
    const next = { ...p, [axis]: p[axis] + s };
    if (collides(world, next, half)) {
      // Snap to the face of the block that was hit.
      p[axis] =
        s > 0
          ? Math.floor(p[axis] + half + s) - half - EPS
          : Math.floor(p[axis] - half + s) + 1 + half + EPS;
      // Snapping never moves backwards past the start of this step.
      if (s > 0 ? p[axis] < start[axis] : p[axis] > start[axis]) p[axis] = start[axis];
      return p;
    }
    p[axis] = next[axis];
    left -= s;
  }
  return p;
}

/**
 * Moves the box centred on `from` by `delta`, one axis at a time (x, y, z), stopping at solids.
 * Because each axis resolves separately, motion along a wall continues: the camera slides.
 */
export function moveWithCollision(
  world: VoxelWorld,
  from: Vec3,
  delta: Vec3,
  half = CAMERA_HALF,
): Vec3 {
  if (collides(world, from, half)) return { ...from };
  let p = { ...from };
  for (const axis of ['x', 'y', 'z'] as const) {
    p = sweepAxis(world, p, axis, delta[axis], half);
  }
  return p;
}
