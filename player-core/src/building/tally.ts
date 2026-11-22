import type { PlanCell } from './expand.ts';

/** Block count by palette key. */
export type MaterialCounts = Record<string, number>;

/**
 * Counts the cells of each palette key (BLD-04). Stub: throws `not_implemented`.
 */
export function tallyMaterials(_cells: Iterable<PlanCell>): MaterialCounts {
  throw new Error('not_implemented');
}
