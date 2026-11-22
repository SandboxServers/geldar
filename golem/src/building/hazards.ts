// Fall and fluid hazards for a cell (BLD-10). Ordering mechanics only: nothing here
// refuses a cell (decision 0428). Sand and gravel are placed bottom-up and broken
// top-down; a cell touching lava or source water is worked with a retaining block
// first when the agent holds one.

import { type Cell, cheapestHeld, type HeldBlock } from './scaffold.ts';

/** Blocks that fall when the block under them is gone. */
export const FALLING = new Set(['sand', 'red_sand', 'gravel']);

export interface HazardWorld {
  /** Block name at a cell; 'air' for empty. 'water' is a source, 'flowing_water' a flow. */
  blockAt: (c: Cell) => string;
}

export interface HazardAdvice {
  /** A falling block is in the cell or stacked above it. */
  falling: boolean;
  /** Lava or source water touches the cell on one of its six faces. */
  fluid: 'lava' | 'water' | null;
  /** The block to place first when fluid touches the cell and the agent holds one. */
  retainBlock: string | null;
}

const FACES: Cell[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

const MAX_STACK = 384;

/** Advice for one cell. It always returns; there is no refusal. */
export function hazardAt(cell: Cell, world: HazardWorld, held: HeldBlock[]): HazardAdvice {
  let falling = FALLING.has(world.blockAt(cell));
  for (let dy = 1; !falling && dy <= MAX_STACK; dy++) {
    const name = world.blockAt({ x: cell.x, y: cell.y + dy, z: cell.z });
    if (!FALLING.has(name)) break;
    falling = true;
  }
  let fluid: HazardAdvice['fluid'] = null;
  for (const f of FACES) {
    const name = world.blockAt({ x: cell.x + f.x, y: cell.y + f.y, z: cell.z + f.z });
    if (name === 'lava') {
      fluid = 'lava';
      break;
    }
    if (name === 'water') fluid = 'water';
  }
  const retain = fluid === null ? null : cheapestHeld(held);
  return { falling, fluid, retainBlock: retain === null ? null : retain.name };
}

/**
 * Orders the falling cells among `cells` (sand, gravel): bottom-up to place,
 * top-down to break. Other cells keep their place in the list.
 */
export function orderCells(cells: Cell[], world: HazardWorld, mode: 'place' | 'break'): Cell[] {
  const out = [...cells];
  const slots: number[] = [];
  out.forEach((c, i) => {
    if (FALLING.has(world.blockAt(c))) slots.push(i);
  });
  const fallers = slots.map((i) => out[i] as Cell);
  fallers.sort((a, b) => (mode === 'place' ? a.y - b.y : b.y - a.y));
  slots.forEach((slot, k) => {
    out[slot] = fallers[k] as Cell;
  });
  return out;
}
