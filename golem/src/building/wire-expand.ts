// The plan expander the queue needs (BLD-38b). It adapts the player-core expansion (BLD-04) to the
// cells the lane runs: the origin shifts each cell, the order is applied, and every cell becomes a
// place (its palette block into the cell) or a break (to air). A break or a replace has no planned
// prior (`prior: null`): the cell executor reads the block that is there when the cell runs (BLD-38b2).

import {
  expandPlan,
  type PlanSpec,
  type PlanStep,
} from '@geldar/player-core/src/building/expand.ts';
import { orderPlanCells } from '@geldar/player-core/src/building/order.ts';
import { canonicalBlockRef, parseBlockRef } from './block-ref.ts';
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
    const base = originOf(body.origin, feet);
    // One step at a time, so each cell keeps whether its step replaces (its prior is read live).
    const shifted = steps.flatMap((step) =>
      [...expandPlan({ palette: body.palette, steps: [step] } as PlanSpec)].map((cell) => ({
        x: cell.x + base.x,
        y: cell.y + base.y,
        z: cell.z + base.z,
        pal: cell.pal,
        replaces: step.op === 'replace',
      })),
    );
    const ordered = orderPlanCells(shifted, body.order === 'given' ? 'given' : 'bottom_up');
    return ordered.map((cell) => toLaneCell(cell, body.palette));
  };
}

/**
 * The cell the lane runs. A placing cell's prior is air; a break (no palette key) and a replace have
 * no planned prior, so the executor reads it live. The target is the palette block, written in one
 * spelling (name, then sorted properties) so the executor compares it the same way every time.
 */
function toLaneCell(
  cell: { x: number; y: number; z: number; pal: string | null; replaces: boolean },
  palette: Readonly<Record<string, unknown>>,
): PlanCell {
  const at = { x: cell.x, y: cell.y, z: cell.z };
  if (cell.pal === null) return { at, prior: null, target: 'air' };
  const entry = palette[cell.pal] as { block?: unknown; state?: unknown } | undefined;
  const name = typeof entry?.block === 'string' ? (entry.block.split('[')[0] ?? '') : '';
  if (entry === undefined || typeof entry.block !== 'string' || !BLOCK_NAME.test(name)) {
    throw new PlanNotRunnable(`palette key ${cell.pal} names no block`);
  }
  // The state is built outside the try below, so a bad state is reported as one, not as no block.
  const reference = referenceOf(cell.pal, entry.block, entry.state);
  let target: string;
  try {
    target = canonicalBlockRef(parseBlockRef(reference));
  } catch {
    throw new PlanNotRunnable(`palette key ${cell.pal} has an invalid state`);
  }
  return { at, prior: cell.replaces ? null : 'air', target };
}

/** A block name as the block reference grammar reads it (lowercase letters, digits, underscore). */
const BLOCK_NAME = /^[a-z0-9_]+$/;

/** The palette entry as one block reference: the block, then its state as properties (`name[k=v]`). */
function referenceOf(key: string, block: string, state: unknown): string {
  if (state === undefined) return block;
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new PlanNotRunnable(`palette key ${key} has a state that is not a property map`);
  }
  const pairs = Object.entries(state).map(([name, value]) => {
    if (typeof value !== 'string') {
      throw new PlanNotRunnable(`palette key ${key} has a state value that is not a string`);
    }
    return `${name}=${value}`;
  });
  return pairs.length === 0 ? block : `${block}[${pairs.join(',')}]`;
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
