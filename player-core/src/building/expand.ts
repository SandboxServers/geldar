import type { Cell } from './geometry.ts';

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
 * Expands a plan to its cells, lazily, from a cursor (BLD-04). Stub: throws `not_implemented`.
 */
export function expandPlan(_plan: PlanSpec, _from?: ExpandCursor): IterableIterator<PlanCell> {
  throw new Error('not_implemented');
}
