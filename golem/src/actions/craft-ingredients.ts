/**
 * Ingredient pre-check for recipe-book crafts. A recipe display lists its grid cells as slot displays;
 * each cell is satisfied by one of a few item ids. The check runs before the server is asked to fill
 * the grid, so a craft the inventory cannot cover touches nothing.
 */

/** A slot display as the 26.1 protocol sends it: `data` is an id, a tag name, a list or a stack. */
export interface IngredientDisplay {
  type: string;
  data?: unknown;
}

/** One grid cell: the item ids that can fill it. */
export type Cell = number[];

/**
 * The cells a recipe display needs, read from its slot displays. Cells that cannot be resolved to item
 * ids (a tag, a fuel slot) are left out: the pre-check then cannot refuse on them, and the server
 * decides. Empty cells need nothing.
 */
export function cellsOf(ingredients: IngredientDisplay[] | undefined): Cell[] {
  const cells: Cell[] = [];
  for (const slot of ingredients ?? []) {
    const ids = idsOf(slot);
    if (ids && ids.length > 0) cells.push(ids);
  }
  return cells;
}

/** The item ids one slot display can be, or null when it cannot be resolved to ids. */
function idsOf(slot: IngredientDisplay | undefined): number[] | null {
  if (!slot) return null;
  const data = slot.data;
  if (slot.type === 'item' && typeof data === 'number') return [data];
  if (slot.type === 'item_stack' && typeof data === 'object' && data !== null) {
    const id = (data as { itemId?: unknown }).itemId;
    return typeof id === 'number' ? [id] : null;
  }
  if (slot.type === 'composite' && Array.isArray(data)) {
    const ids: number[] = [];
    for (const part of data as IngredientDisplay[]) {
      const sub = idsOf(part);
      // One unresolvable alternative makes the whole cell unknowable.
      if (!sub) return null;
      ids.push(...sub);
    }
    return ids;
  }
  return null;
}

/** An item the inventory lacks for a recipe, and how many more of it the recipe needs. */
export interface Shortfall {
  id: number;
  short: number;
}

/**
 * What the inventory lacks to fill every cell, or null when it covers them all. Cells are filled
 * fewest-alternatives first, each from the alternative with the most left; a cell with nothing left is
 * short, counted against its first alternative. Cells with several alternatives are re-tried by
 * backtracking before a shortage is reported, so a greedy choice never refuses a craft that works.
 */
export function shortfallOf(cells: Cell[], held: (id: number) => number): Shortfall | null {
  const left = new Map<number, number>();
  for (const cell of cells) for (const id of cell) left.set(id, held(id));
  const order = [...cells].sort((a, b) => a.length - b.length);
  if (assign(order, 0, left)) return null;
  // Not coverable: count the cells a greedy fill leaves empty, per first alternative.
  const greedy = new Map<number, number>();
  for (const id of left.keys()) greedy.set(id, held(id));
  let missingId = -1;
  let short = 0;
  for (const cell of order) {
    const pick = [...cell].sort((a, b) => (greedy.get(b) ?? 0) - (greedy.get(a) ?? 0))[0];
    if (pick === undefined) continue;
    if ((greedy.get(pick) ?? 0) > 0) {
      greedy.set(pick, (greedy.get(pick) ?? 0) - 1);
      continue;
    }
    const first = cell[0] as number;
    if (missingId === -1) missingId = first;
    if (first === missingId) short++;
  }
  return { id: missingId === -1 ? (cells[0]?.[0] ?? -1) : missingId, short: Math.max(short, 1) };
}

/** Whether cells `from..` can all be filled from `left`, trying each alternative in turn. */
function assign(cells: Cell[], from: number, left: Map<number, number>): boolean {
  const cell = cells[from];
  if (!cell) return true;
  for (const id of cell) {
    const have = left.get(id) ?? 0;
    if (have <= 0) continue;
    left.set(id, have - 1);
    if (assign(cells, from + 1, left)) {
      left.set(id, have);
      return true;
    }
    left.set(id, have);
  }
  return false;
}
