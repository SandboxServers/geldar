import { boxCells, type Cell, circleCells, lineCells, sphereCells, wallCells } from './geometry.ts';

/** A cell of a plan: its palette key, or null for a break. */
export interface PlanCell extends Cell {
  pal: string | null;
}

/** One step of a plan, as the contract's build steps state it (fields a step does not use are absent). */
export interface PlanStep {
  op: string;
  pal?: string;
  break?: true;
  at?: Cell;
  from?: Cell;
  to?: Cell;
  center?: Cell;
  radius?: number;
  axis?: 'x' | 'y' | 'z';
  height?: number;
  hollow?: boolean;
  cells?: readonly Cell[];
}

/** The parts of a plan the expansion reads. Matches the contract's `BuildPlan` shape. */
export interface PlanSpec {
  palette: Readonly<Record<string, unknown>>;
  steps: readonly [PlanStep, ...PlanStep[]];
  origin?: Cell | 'here';
  order?: 'bottom_up' | 'given';
}

/** Where expansion resumes: the step index and the cell offset inside that step. */
export interface ExpandCursor {
  step: number;
  offset: number;
}

/**
 * Expands a plan to its cells, lazily, in step order (BLD-04). Each step's geometry is a
 * generator, so a large plan never materialises. `from` resumes at a cursor: the cells of
 * step `from.step` after its first `from.offset` cells, then every later step. Cell order
 * within a plan is `orderCells`' job, not this function's.
 *
 * Throws `invalid_step` for an unknown op, or a placing step with no palette key.
 */
export function* expandPlan(
  plan: PlanSpec,
  from: ExpandCursor = { step: 0, offset: 0 },
): IterableIterator<PlanCell> {
  for (let i = from.step; i < plan.steps.length; i++) {
    const step = plan.steps[i] as PlanStep;
    const skip = i === from.step ? from.offset : 0;
    const pal = palOf(step);
    let index = 0;
    for (const cell of stepCells(step)) {
      if (index++ < skip) continue;
      yield { x: cell.x, y: cell.y, z: cell.z, pal };
    }
  }
}

function palOf(step: PlanStep): string | null {
  if (step.op === 'break' || step.break === true) return null;
  if (step.pal === undefined) throw new Error('invalid_step');
  return step.pal;
}

function* stepCells(step: PlanStep): IterableIterator<Cell> {
  switch (step.op) {
    case 'place':
    case 'replace':
    case 'break':
      yield must(step.at, 'at');
      return;
    case 'box':
    case 'hollow_box':
      yield* boxCells(must(step.from, 'from'), must(step.to, 'to'), step.op === 'hollow_box');
      return;
    case 'line':
      yield* lineCells(must(step.from, 'from'), must(step.to, 'to'));
      return;
    case 'wall':
      yield* wallCells(must(step.from, 'from'), must(step.to, 'to'), must(step.height, 'height'));
      return;
    case 'circle':
      yield* circleCells(
        must(step.center, 'center'),
        must(step.radius, 'radius'),
        must(step.axis, 'axis'),
      );
      return;
    case 'sphere':
      yield* sphereCells(
        must(step.center, 'center'),
        must(step.radius, 'radius'),
        step.hollow === true,
      );
      return;
    case 'list':
      yield* must(step.cells, 'cells');
      return;
    default:
      throw new Error('invalid_step');
  }
}

function must<T>(value: T | undefined, _field: string): T {
  if (value === undefined) throw new Error('invalid_step');
  return value;
}
