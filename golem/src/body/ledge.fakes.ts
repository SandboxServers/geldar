import { Vec3 } from 'vec3';
import type { Block } from '../actions/bot-types.ts';

/** The Body's feet in the ledge fixtures (decision 0333). */
export const FEET = new Vec3(0, 64, 0);

/** The grid key of a cell, the form the action tests use. */
export const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/**
 * The solid cells of a plateau at feet (0, 64, 0), walled on every side but the east one. Its only way off is
 * the walk east onto a column (x = 1) that drops `drop` blocks to a solid floor. Every other cell is air.
 */
export function ledgeCells(drop: number): Set<string> {
  const solid = new Set<string>();
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      if (x === 1 && z === 0) continue;
      solid.add(cellKey(x, 63, z));
    }
  }
  solid.add(cellKey(1, 63 - drop, 0));
  for (const [x, z] of [
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    solid.add(cellKey(x, 64, z));
    solid.add(cellKey(x, 65, z));
  }
  return solid;
}

/** The plateau as a block reader, the shape `noSafeExit` and `planMoves` take. */
export function ledge(drop: number): (at: Vec3) => Block | null {
  const solid = ledgeCells(drop);
  return (at) => {
    const isSolid = solid.has(cellKey(at.x, at.y, at.z));
    return { name: isSolid ? 'stone' : 'air', boundingBox: isSolid ? 'block' : 'empty' } as Block;
  };
}
