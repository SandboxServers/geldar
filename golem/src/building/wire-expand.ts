// The plan expander the queue needs (BLD-38b). It adapts the player-core expansion (BLD-04) to the
// cells the lane runs: the origin shifts each cell, the order is applied, and every cell becomes a
// place (its palette block into the cell) or a break (to air). A break or a replace has no planned
// prior (`prior: null`): the cell executor reads the block that is there when the cell runs (BLD-38b2).

import {
  expandPlan,
  type PlanSpec,
  type PlanStep,
} from '@geldar/player-core/src/building/expand.ts';
import { lazyBottomUp } from '@geldar/player-core/src/building/layers.ts';
import { orderPlanCells } from '@geldar/player-core/src/building/order.ts';
import { canonicalBlockRef, parseBlockRef } from './block-ref.ts';
import type { PlanCell } from './cell-do.ts';
import { arrayCellSource, type CellSource, lazyCellSource } from './cell-source.ts';
import type { PlanBody } from './queue.ts';
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
export function createPlanExpand(feet: () => Cell): (body: PlanBody) => readonly PlanCell[] {
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

/** Cells counted between two yields to the event loop, so the count pass never holds it for long. */
export const COUNT_SLICE = 512;

/**
 * The lazy source of a plan's cells in the lane's order (B8-lazy): the same cells, in the same order,
 * as `createPlanExpand`. Each call returns a new source; nothing is expanded until it is read. A bad
 * palette key throws PlanNotRunnable on the read that reaches it, so a count pass at add time
 * reads the whole plan and refuses it before it is stored.
 */
export function createPlanSource(feet: () => Cell): (body: PlanBody) => CellSource {
  return (body) => {
    const steps = body.steps as readonly PlanStep[];
    if (steps.length === 0) return arrayCellSource([]);
    const base = originOf(body.origin, feet);
    const palette = body.palette;
    return lazyCellSource(() =>
      body.order === 'given'
        ? givenCells(steps, palette, base)
        : orderedCells(steps, palette, base),
    );
  };
}

/** Bottom-up order, one layer at a time (`lazyBottomUp`); a falling block is not a plan kind here. */
function* orderedCells(
  steps: readonly PlanStep[],
  palette: Readonly<Record<string, unknown>>,
  base: Cell,
): Generator<PlanCell> {
  for (const cell of lazyBottomUp({ palette, steps } as PlanSpec, base)) {
    yield toLaneCell(cell, palette);
  }
}

/** The step order as given: each step's cells in its own expansion order. */
function* givenCells(
  steps: readonly PlanStep[],
  palette: Readonly<Record<string, unknown>>,
  base: Cell,
): Generator<PlanCell> {
  for (const step of steps) {
    for (const cell of expandPlan({ palette, steps: [step] } as PlanSpec)) {
      const shifted = {
        x: cell.x + base.x,
        y: cell.y + base.y,
        z: cell.z + base.z,
        pal: cell.pal,
        replaces: step.op === 'replace',
      };
      yield toLaneCell(shifted, palette);
    }
  }
}

/**
 * Counts a source's cells by reading it to its end, yielding to the event loop every `slice` cells.
 * The read uses up the source: count one source and run another (`createPlanSource` makes one per call).
 */
export async function countPlanCells(source: CellSource, slice = COUNT_SLICE): Promise<number> {
  let count = 0;
  while (source.at(count) !== undefined) {
    count++;
    if (count % slice === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return count;
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
