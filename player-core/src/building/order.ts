import type { Cell } from './geometry.ts';

/** The order a plan's cells run in: bottom-up (the default), or as given. */
export type CellOrder = 'bottom_up' | 'given';

/** A cell with what the plan order needs: a null palette key is a break, `falling` a falling block. */
export interface OrderCell extends Cell {
  pal: string | null;
  falling?: boolean;
}

/**
 * Orders cells bottom-up (BLD-04): lowest y first; within a layer, outward from the anchor by
 * horizontal distance (or by x then z without one). Ties keep their input order. `given` returns
 * the cells as they came. Returns a new array.
 */
export function orderCells<T extends Cell>(
  cells: readonly T[],
  order: CellOrder,
  anchor?: Cell,
): T[] {
  if (order === 'given') return [...cells];
  return cells
    .map((cell, index) => ({ cell, index }))
    .sort((a, b) => {
      if (a.cell.y !== b.cell.y) return a.cell.y - b.cell.y;
      const da = horizontal(a.cell, anchor);
      const db = horizontal(b.cell, anchor);
      if (da !== db) return da - db;
      if (a.cell.x !== b.cell.x) return a.cell.x - b.cell.x;
      if (a.cell.z !== b.cell.z) return a.cell.z - b.cell.z;
      return a.index - b.index;
    })
    .map((entry) => entry.cell);
}

/**
 * Orders a whole plan's cells (BLD-04). `given` keeps the step order. Otherwise breaks run
 * first, top-down (highest y first), then placements bottom-up as `orderCells` orders them, with
 * falling blocks last, also bottom-up. Returns a new array.
 */
export function orderPlanCells<T extends OrderCell>(
  cells: readonly T[],
  order: CellOrder,
  anchor?: Cell,
): T[] {
  if (order === 'given') return [...cells];
  const breaks = cells
    .filter((cell) => cell.pal === null)
    .sort((a, b) => b.y - a.y || a.x - b.x || a.z - b.z);
  const placed = cells.filter((cell) => cell.pal !== null);
  const solid = orderCells(
    placed.filter((cell) => cell.falling !== true),
    'bottom_up',
    anchor,
  );
  const falling = orderCells(
    placed.filter((cell) => cell.falling === true),
    'bottom_up',
    anchor,
  );
  return [...breaks, ...solid, ...falling];
}

function horizontal(cell: Cell, anchor: Cell | undefined): number {
  if (anchor === undefined) return 0;
  const dx = cell.x - anchor.x;
  const dz = cell.z - anchor.z;
  return dx * dx + dz * dz;
}
