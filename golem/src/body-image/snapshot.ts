// The block data the render worker needs, copied out of the bot: one box of cells around the eye.
// The worker never sees the live bot. A cell the Body has not loaded is marked UNLOADED, not guessed.

import type { ViewportWorld } from '../viewport/index.ts';

/** Half the side of the copied box, in blocks. */
export const SNAPSHOT_RADIUS = 32;
/** Rays are cut at this length, so every ray stays inside the copied box (decision 0156, range cap). */
export const SNAPSHOT_RANGE = SNAPSHOT_RADIUS;
/** The cell value for a cell the Body has not loaded. */
export const UNLOADED = 0xffff;

/** Cells per side: the box reaches one block past the radius on each side of the centre cell. */
const SIDE = 2 * (SNAPSHOT_RADIUS + 1) + 1;

export interface Cell {
  x: number;
  y: number;
  z: number;
}

export interface BlockSnapshot {
  /** The lowest cell copied on each axis. */
  origin: Cell;
  /** Cells per side on each axis (always SIDE, so the copy is bounded: 67 cubed cells at most). */
  size: Cell;
  /** Block names; a cell holds an index into this list, or UNLOADED. */
  palette: string[];
  /** x varies fastest, then z, then y. */
  cells: Uint16Array;
}

/** The block name at a cell, or null when the cell is not loaded. */
export type BlockReader = (x: number, y: number, z: number) => string | null;

/** Copies the box of cells around a centre cell into a snapshot. Reads each cell once. */
export function copyBlockBox(read: BlockReader, centre: Cell): BlockSnapshot {
  const origin = {
    x: Math.floor(centre.x) - SNAPSHOT_RADIUS - 1,
    y: Math.floor(centre.y) - SNAPSHOT_RADIUS - 1,
    z: Math.floor(centre.z) - SNAPSHOT_RADIUS - 1,
  };
  const cells = new Uint16Array(SIDE * SIDE * SIDE);
  const palette: string[] = [];
  const index = new Map<string, number>();
  let i = 0;
  for (let y = 0; y < SIDE; y++) {
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const name = read(origin.x + x, origin.y + y, origin.z + z);
        cells[i++] = name === null ? UNLOADED : paletteIndex(name, palette, index);
      }
    }
  }
  return { origin, size: { x: SIDE, y: SIDE, z: SIDE }, palette, cells };
}

function paletteIndex(name: string, palette: string[], index: Map<string, number>): number {
  const known = index.get(name);
  if (known !== undefined) return known;
  const next = palette.length;
  palette.push(name);
  index.set(name, next);
  return next;
}

/** A ViewportWorld that answers from the snapshot. A cell outside the box reads as unloaded (null). */
export function snapshotWorld(snap: BlockSnapshot): ViewportWorld {
  return {
    blockAt(x, y, z) {
      const dx = x - snap.origin.x;
      const dy = y - snap.origin.y;
      const dz = z - snap.origin.z;
      if (
        dx < 0 ||
        dy < 0 ||
        dz < 0 ||
        dx >= snap.size.x ||
        dy >= snap.size.y ||
        dz >= snap.size.z
      ) {
        return null;
      }
      const value = snap.cells[(dy * snap.size.z + dz) * snap.size.x + dx];
      if (value === undefined || value === UNLOADED) return null;
      return snap.palette[value] ?? null;
    },
  };
}
