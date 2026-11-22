import type { Cell } from './geometry.ts';

/** The order a plan's cells run in: bottom-up (the default), or as given. */
export type CellOrder = 'bottom_up' | 'given';

/**
 * Orders cells for the body (BLD-04): bottom-up, outward from an anchor, or as given; breaks run
 * top-down. Stub: throws `not_implemented`.
 */
export function orderCells(_cells: readonly Cell[], _order: CellOrder, _anchor?: Cell): Cell[] {
  throw new Error('not_implemented');
}
