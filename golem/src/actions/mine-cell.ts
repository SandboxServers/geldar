import { Vec3 } from 'vec3';
import type { Block, Position } from './bot-types.ts';
import { type ActionOutcome, failed } from './outcome.ts';
import { MESSAGE } from './place.ts';

/** Fixed failure texts for a mine of one exact cell: facts only (decision 0154). Decision 0349. */
export const MINE_CELL_MESSAGE = {
  notWhole: 'the cell must be whole block numbers',
  oneBlock: 'an exact cell is one block',
  notLoaded: MESSAGE.notLoaded,
  outOfReach: 'the target is out of reach',
} as const;

/** The cell as a block position, or null when a coordinate is not an integer. */
export function cellOf(at: Position): Vec3 | null {
  return [at.x, at.y, at.z].every((v) => Number.isInteger(v)) ? new Vec3(at.x, at.y, at.z) : null;
}

/** The failure for an exact cell that is not loaded (null) or holds another block. */
export function cellFailure(block: Block | null, mined: number): ActionOutcome {
  if (!block) return failed('not_possible', MINE_CELL_MESSAGE.notLoaded, { mined });
  return failed('not_found', `that block is ${block.name}`, { mined });
}
