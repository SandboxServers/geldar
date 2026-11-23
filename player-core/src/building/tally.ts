import type { PlanCell } from './expand.ts';

/** Block count by palette key. */
export type MaterialCounts = Record<string, number>;

/**
 * Counts the placing cells of each palette key (BLD-04). Break cells (a null key) take no
 * material and are not counted. Accepts any iterable, so a lazy expansion is counted without
 * being collected first.
 */
export function tallyMaterials(cells: Iterable<PlanCell>): MaterialCounts {
  const counts: MaterialCounts = Object.create(null) as MaterialCounts;
  for (const cell of cells) {
    if (cell.pal === null) continue;
    counts[cell.pal] = (counts[cell.pal] ?? 0) + 1;
  }
  return counts;
}
