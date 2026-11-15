/** The drop, move and soft-block rules that unstick plans with: pure functions of a block reader. */
import { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';

/** Health below this: the Body never drops on purpose (a fall could finish it). */
export const MIN_HEALTH_TO_DROP = 12;
/** Health the Body keeps after the worst fall it chooses. */
const HEALTH_MARGIN = 8;
/** The deepest drop the Body takes on purpose, in blocks. */
export const MAX_DROP = 6;
/** The lowest block row of the world; a column with no floor above it is a void. */
const WORLD_BOTTOM = -64;

/** Blocks the Body digs with bare hands to get out: leaves and loose or soft ground, never ore or wood. */
const SOFT = new Set([
  'dirt',
  'grass_block',
  'coarse_dirt',
  'podzol',
  'sand',
  'red_sand',
  'gravel',
  'snow',
  'snow_block',
]);
/** Blocks that hurt or kill whoever lands on them. */
export const HARMFUL = new Set([
  'lava',
  'magma_block',
  'cactus',
  'fire',
  'soul_fire',
  'sweet_berry_bush',
]);

/** The eight horizontal directions, nearest-first: the four axes, then the diagonals. */
export const EIGHT: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
  new Vec3(1, 0, 1),
  new Vec3(1, 0, -1),
  new Vec3(-1, 0, 1),
  new Vec3(-1, 0, -1),
];

type BlockAt = (cell: Vec3) => Block | null;

/** Fall damage in half hearts for a drop of `blocks` (vanilla: one per block past three). */
export function fallDamage(blocks: number): number {
  return Math.max(0, Math.ceil(blocks - 3));
}

/** Where a fall from a cell ends, and how far it is. */
export interface Drop {
  blocks: number;
  /** `water` cancels the damage; `unsafe` is lava, a cactus, a void or an unloaded column. */
  lands: 'solid' | 'water' | 'unsafe';
}

/** Scans down from `start` (the first cell under the feet) until something stops the fall. */
export function scanDrop(blockAt: BlockAt, start: Vec3): Drop {
  for (let blocks = 0; blocks <= MAX_DROP; blocks++) {
    const cell = start.offset(0, -blocks, 0);
    if (cell.y < WORLD_BOTTOM) return { blocks, lands: 'unsafe' };
    const block = blockAt(cell);
    if (block === null) return { blocks, lands: 'unsafe' };
    if (HARMFUL.has(block.name)) return { blocks, lands: 'unsafe' };
    if (block.name === 'water') {
      // Water breaks the fall, but not over lava or magma (the cell under the water is checked too).
      const below = blockAt(cell.offset(0, -1, 0));
      if (below === null || HARMFUL.has(below.name)) return { blocks, lands: 'unsafe' };
      return { blocks, lands: 'water' };
    }
    if (block.boundingBox !== 'empty') return { blocks, lands: 'solid' };
  }
  return { blocks: MAX_DROP + 1, lands: 'unsafe' };
}

/**
 * The safe-drop rule (owner ruling 2026-11-14, decision 0183). A fall that cannot hurt (three blocks or
 * fewer, onto solid ground) and a fall into water (water takes the damage away) are taken at any health.
 * A fall that does damage needs `MIN_HEALTH_TO_DROP` and must leave `HEALTH_MARGIN`. Never into lava, a
 * void or an unloaded column, never deeper than `MAX_DROP`.
 */
export function dropAllowed(health: number, drop: Drop, maxDrop = MAX_DROP): boolean {
  if (drop.lands === 'unsafe' || drop.blocks > maxDrop) return false;
  if (drop.lands === 'water') return true;
  if (drop.lands === 'solid' && fallDamage(drop.blocks) === 0) return true;
  if (health < MIN_HEALTH_TO_DROP) return false;
  return fallDamage(drop.blocks) <= health - HEALTH_MARGIN;
}

/** One way off the spot: where to head, whether to jump, and how far it drops. */
export interface Move {
  dir: Vec3;
  jump: boolean;
  drop: number;
}

export const empty = (block: Block | null): boolean =>
  block !== null && block.boundingBox === 'empty';

/**
 * The moves from `feet` that a bot may try: a level walk, a one-block step up (jump), or a walk off a
 * ledge that `dropAllowed` accepts. Level moves come first, then steps, then drops shallowest first.
 * `maxDrop` caps the drop (default `MAX_DROP`); a caller whose fall is stopped at a shallower edge
 * passes that depth, so the planner never offers a walk-off the Body will be stopped from (decision 0333).
 */
export function planMoves(
  blockAt: BlockAt,
  feet: Vec3,
  health: number,
  maxDrop = MAX_DROP,
): Move[] {
  const moves: Move[] = [];
  const up = new Vec3(0, 1, 0);
  for (const dir of EIGHT) {
    const at = feet.plus(dir);
    if (empty(blockAt(at)) && empty(blockAt(at.plus(up)))) {
      const drop = scanDrop(blockAt, at.minus(up));
      if (drop.blocks === 0 && drop.lands === 'solid') moves.push({ dir, jump: false, drop: 0 });
      else if (dropAllowed(health, drop, maxDrop))
        moves.push({ dir, jump: false, drop: drop.blocks });
    } else if (
      empty(blockAt(at.plus(up))) &&
      empty(blockAt(at.plus(up).plus(up))) &&
      empty(blockAt(feet.plus(up).plus(up)))
    ) {
      moves.push({ dir, jump: true, drop: 0 });
    }
  }
  return moves.sort((a, b) => Number(a.drop > 0) - Number(b.drop > 0) || a.drop - b.drop);
}

/** True for a block bare hands can take out quickly: leaves and `SOFT`. */
export function isSoft(block: Block | null): boolean {
  return (
    block !== null &&
    block.diggable !== false &&
    (block.name.endsWith('_leaves') || SOFT.has(block.name))
  );
}
