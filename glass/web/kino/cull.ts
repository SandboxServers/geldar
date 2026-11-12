// Hides see-through blocks (leaves, glass, water) close to the camera, so a camera standing inside
// a tree canopy is not buried in foliage. Pure: works on a block-state reader, not on three.js.

import { occludes } from './mesher.ts';
import { isAir } from './world.ts';

export interface StateReader {
  stateAt(x: number, y: number, z: number): string | undefined;
}

export const CULL_RADIUS = 2;

const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Keys ("x,y,z") of the see-through blocks within `radius` blocks of the camera position. */
export function cellsToCull(
  world: StateReader,
  pos: { x: number; y: number; z: number },
  radius = CULL_RADIUS,
): Set<string> {
  const out = new Set<string>();
  const cx = Math.floor(pos.x);
  const cy = Math.floor(pos.y);
  const cz = Math.floor(pos.z);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        const s = world.stateAt(cx + dx, cy + dy, cz + dz);
        if (!isAir(s) && !occludes(s)) out.add(cellKey(cx + dx, cy + dy, cz + dz));
      }
    }
  }
  return out;
}

/** A reader that reports culled cells as air. */
export class CullingWorld implements StateReader {
  private readonly inner: StateReader;
  private readonly culled: ReadonlySet<string>;
  constructor(inner: StateReader, culled: ReadonlySet<string>) {
    this.inner = inner;
    this.culled = culled;
  }
  stateAt(x: number, y: number, z: number): string | undefined {
    return this.culled.has(cellKey(x, y, z)) ? 'minecraft:air' : this.inner.stateAt(x, y, z);
  }
}

/** Section keys ("cx,sy,cz") that contain any of the cells. */
export function sectionsOfCells(cells: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const c of cells) {
    const [x = 0, y = 0, z = 0] = c.split(',').map(Number);
    out.add(`${Math.floor(x / 16)},${Math.floor(y / 16)},${Math.floor(z / 16)}`);
  }
  return out;
}
