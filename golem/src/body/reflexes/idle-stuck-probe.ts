import { Vec3 } from 'vec3';
import type { Block } from '../../actions/bot-types.ts';
import { type Move, planMoves } from '../../actions/unstick-plan.ts';

/** Moves the idle_stuck watch line lists: the first four the planner offers (decision 0333 diagnostics). */
export const WATCH_MOVES = 4;
/** Cells the reach walk counts and expands at most, so the watch line costs a bounded read (decision 0333). */
export const WATCH_REACH = 40;
/** A reached cell this far above the feet, or this far across, is a way out of the spot. */
const EXIT_RISE = 3;
const EXIT_RUN = 12;

type BlockRead = (at: Vec3) => Block | null;

/** One planner move as the watch line writes it: the step, its kind, and the block the Body stands on. */
export interface WatchMove {
  dx: number;
  dz: number;
  dy: number;
  kind: 'walk' | 'jump' | 'drop';
  drop: number;
  landing: string;
}

/** The three watch-line fields; all null when no terrain is read (a missing read is not a dead end). */
export interface WatchProbe {
  moves: WatchMove[] | null;
  reach: number | null;
  reach_exit: boolean | null;
}

const UNREAD: WatchProbe = { moves: null, reach: null, reach_exit: null };

const cellKey = (cell: Vec3): string => `${cell.x},${cell.y},${cell.z}`;

/** The move as the watch line shows it. A jump lands on the cell it steps onto; a walk or a drop on the floor under it. */
function watchMove(blockAt: BlockRead, feet: Vec3, move: Move): WatchMove {
  const at = feet.plus(move.dir);
  const floor = move.jump ? at : at.offset(0, -1 - move.drop, 0);
  return {
    dx: move.dir.x,
    dz: move.dir.z,
    dy: move.jump ? 1 : move.drop > 0 ? -move.drop : 0,
    kind: move.jump ? 'jump' : move.drop > 0 ? 'drop' : 'walk',
    drop: move.drop,
    landing: blockAt(floor)?.name ?? 'unloaded',
  };
}

/**
 * Walks the cells planMoves offers from `start`, depth first, and stops at WATCH_REACH cells. It reports the
 * cells reached and whether any of them is a way out: three blocks or more up, or twelve across.
 */
function reachFrom(
  blockAt: BlockRead,
  start: Vec3,
  health: number,
): { seen: Set<string>; exit: boolean } {
  const seen = new Set<string>([cellKey(start)]);
  const stack: Vec3[] = [start];
  let exit = false;
  while (stack.length > 0 && seen.size < WATCH_REACH) {
    const cell = stack.pop() as Vec3;
    // Reversed, so the planner's first (nearest, level) move is the last pushed and is walked first.
    for (const move of planMoves(blockAt, cell, health).reverse()) {
      if (seen.size >= WATCH_REACH) break;
      const next = cell.plus(move.dir).offset(0, move.jump ? 1 : -move.drop, 0);
      if (seen.has(cellKey(next))) continue;
      seen.add(cellKey(next));
      stack.push(next);
      if (
        next.y - start.y >= EXIT_RISE ||
        Math.hypot(next.x - start.x, next.z - start.z) >= EXIT_RUN
      ) {
        exit = true;
      }
    }
  }
  return { seen, exit };
}

type TerrainRead = ((at: Vec3) => Block | null | undefined) | undefined;

/** The cells (as keys) the reach walk covers from the feet cell: the attempt record's pocket (decision 0336). Empty when no terrain is read. */
export function reachRegion(
  terrainAt: TerrainRead,
  feet: { x: number; y: number; z: number },
  health: number,
): Set<string> {
  if (!terrainAt) return new Set();
  const blockAt: BlockRead = (at) => terrainAt(at) ?? null;
  const cell = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
  return reachFrom(blockAt, cell, health).seen;
}

/** True when the cell under the feet (floored) is one of the cells of a region from reachRegion. */
export function regionHas(cells: Set<string>, feet: { x: number; y: number; z: number }): boolean {
  return cells.has(cellKey(new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z))));
}

/**
 * The operator-only probe fields for the idle_stuck watch line (decision 0333). Nothing here acts on the
 * Body: it is read once a minute, when the line is written, from the same block reads the planner uses.
 */
export function watchProbe(
  terrainAt: ((at: Vec3) => Block | null | undefined) | undefined,
  feet: { x: number; y: number; z: number },
  health: number,
): WatchProbe {
  if (!terrainAt) return UNREAD;
  const blockAt: BlockRead = (at) => terrainAt(at) ?? null;
  const cell = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
  const moves = planMoves(blockAt, cell, health)
    .slice(0, WATCH_MOVES)
    .map((move) => watchMove(blockAt, cell, move));
  const { seen, exit } = reachFrom(blockAt, cell, health);
  return { moves, reach: seen.size, reach_exit: exit };
}
