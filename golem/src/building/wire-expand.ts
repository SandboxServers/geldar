// The plan expander the queue needs (BLD-38b). It adapts the player-core expansion (BLD-04) to the
// cells the lane runs: the origin shifts each cell, the order is applied, and every cell becomes a
// `place` into air. Break and replace steps are refused for now: a cell that breaks needs the block
// that is there first, and the expansion does not know it (no prior is read at submit time).

import {
  expandPlan,
  type PlanSpec,
  type PlanStep,
} from '../../../player-core/src/building/expand.ts';
import { orderPlanCells } from '../../../player-core/src/building/order.ts';
import type { PlanCell } from './cell-do.ts';
import type { PlanExpand } from './queue.ts';
import type { Cell } from './stand.ts';

/** Thrown for a plan the lane cannot run yet; the queue refuses the plan with this message. */
export class PlanNotRunnable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PlanNotRunnable';
  }
}

/**
 * The expander the plan queue is built with. `feet` gives the origin of an `origin: "here"` plan
 * (the Body's feet now); an origin left out is the world origin, as plan-check reads it.
 */
export function createPlanExpand(feet: () => Cell): PlanExpand {
  return (body) => {
    const steps = body.steps as readonly PlanStep[];
    if (steps.length === 0) return [];
    for (const step of steps) {
      if (step.op === 'replace') throw new PlanNotRunnable('replace steps are not run yet');
      if (step.op === 'break' || step.break === true) {
        throw new PlanNotRunnable('break steps are not run yet');
      }
    }
    const spec: PlanSpec = {
      palette: body.palette,
      steps: steps as [PlanStep, ...PlanStep[]],
    };
    const base = originOf(body.origin, feet);
    const shifted = [...expandPlan(spec)].map((cell) => ({
      x: cell.x + base.x,
      y: cell.y + base.y,
      z: cell.z + base.z,
      pal: cell.pal,
    }));
    const ordered = orderPlanCells(shifted, body.order === 'given' ? 'given' : 'bottom_up');
    return ordered.map((cell) => toLaneCell(cell, body.palette));
  };
}

/** The cell the lane runs: an empty cell that the plan's block goes into. */
function toLaneCell(
  cell: { x: number; y: number; z: number; pal: string | null },
  palette: Readonly<Record<string, unknown>>,
): PlanCell {
  if (cell.pal === null) throw new PlanNotRunnable('break steps are not run yet');
  const entry = palette[cell.pal] as { block?: unknown } | undefined;
  if (entry === undefined || typeof entry.block !== 'string') {
    throw new PlanNotRunnable(`palette key ${cell.pal} names no block`);
  }
  return { at: { x: cell.x, y: cell.y, z: cell.z }, prior: 'air', target: entry.block };
}

/** The shift of the plan: zero when none is given, the feet for `here`, else the given cell. */
function originOf(origin: unknown, feet: () => Cell): Cell {
  if (origin === undefined) return { x: 0, y: 0, z: 0 };
  if (origin === 'here') return feet();
  const at = origin as Partial<Cell>;
  if (typeof at.x !== 'number' || typeof at.y !== 'number' || typeof at.z !== 'number') {
    throw new PlanNotRunnable('origin is not a cell');
  }
  return { x: at.x, y: at.y, z: at.z };
}
