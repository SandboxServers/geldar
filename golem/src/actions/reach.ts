import type { RememberedBlocks } from '../perception/remembered.ts';

/** A block position in the world (integer block coordinates). */
export interface Cell {
  x: number;
  y: number;
  z: number;
}

/** Most search nodes a reach dry run may report and still answer `walk` or `needs_digging` (gap #14). */
export const REACH_NODE_CAP = 2000;

/** What the planner says for one search: a status word and how many nodes it visited. */
export interface PlanAnswer {
  status: string;
  visited: number;
}

/** Plans a route to a target. `canDig` lets the planner break blocks (the needs-digging check). */
export type ReachPlanner = (target: Cell, canDig: boolean) => PlanAnswer;

/** The reach answer: `in_hand`, `walk` with its steps, `needs_digging`, `blocked` or `unknown`. */
export type ReachOutcome = 'in_hand' | 'walk' | 'needs_digging' | 'blocked' | 'unknown';

export interface ReachAnswer {
  outcome: ReachOutcome;
  /** Present only for `walk`: horizontal blocks to the target, x and z both counted. */
  steps?: number;
}

/** What a dry run is given: where the Body stands, what it holds, what it has seen, the planner. */
export interface ReachInput {
  from: Cell;
  heldName?: string | undefined;
  memory: Pick<RememberedBlocks, 'at'>;
  plan: ReachPlanner;
}

/**
 * How the Body would reach a block, without moving it. A target it has not seen or remembered is
 * `unknown`, the same answer a hidden target gets (0145). A planner that times out or throws, or
 * that visits more than `REACH_NODE_CAP` nodes, is `unknown` too; the dry run never throws.
 */
export function reachTarget(input: ReachInput, target: Cell): ReachAnswer {
  const seen = input.memory.at(target.x, target.y, target.z);
  if (!seen) return { outcome: 'unknown' };
  if (input.heldName !== undefined && input.heldName === seen.type) return { outcome: 'in_hand' };
  try {
    const walk = input.plan(target, false);
    if (walk.status === 'timeout' || walk.visited > REACH_NODE_CAP) return { outcome: 'unknown' };
    if (walk.status === 'success') {
      return { outcome: 'walk', steps: horizontalSteps(input.from, target) };
    }
    const dig = input.plan(target, true);
    if (dig.status === 'timeout' || dig.visited > REACH_NODE_CAP) return { outcome: 'unknown' };
    return { outcome: dig.status === 'success' ? 'needs_digging' : 'blocked' };
  } catch {
    return { outcome: 'unknown' };
  }
}

/** Blocks along x plus blocks along z: the walk the Body would take on flat ground. */
function horizontalSteps(from: Cell, to: Cell): number {
  return Math.abs(to.x - from.x) + Math.abs(to.z - from.z);
}
