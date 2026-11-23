// Scaffolding for a cell (BLD-10). When the stand solver (BLD-09) finds no stand
// cell, the agent pillars up or bridges across with its own cheapest placeable
// block, as a human would. Pure: the caller reads the world and acts on the result.

export interface Cell {
  x: number;
  y: number;
  z: number;
}

export interface HeldBlock {
  name: string;
  count: number;
}

export type ScaffoldOutcome =
  | { kind: 'not_needed' }
  | { kind: 'missing_materials'; needed: number }
  | {
      kind: 'scaffold';
      block: string;
      method: 'pillar' | 'bridge';
      /** Cells to place, in the order they are placed. */
      place: Cell[];
      /** The scaffold cells that sit on a plan cell; these are removed afterwards. */
      remove: Cell[];
    };

export interface ScaffoldInput {
  /** The cell the plan must work. */
  target: Cell;
  /** The agent's feet cell now. */
  at: Cell;
  /** The stand solver's answer: a stand cell, or 'none'. */
  stand: Cell | 'none';
  /** Placeable blocks the agent holds. */
  held: HeldBlock[];
  /** True when the cell is one the plan works. Asked per scaffold cell, so the plan is never listed. */
  onPlan: (c: Cell) => boolean;
  /** True when a cell is solid; a bridge crosses the cells that are not. */
  solid: (c: Cell) => boolean;
}

/** Placeable blocks, cheapest first. Only these are used for scaffolding. */
export const CHEAP_FIRST = [
  'dirt',
  'coarse_dirt',
  'netherrack',
  'cobblestone',
  'stone',
  'andesite',
  'diorite',
  'granite',
] as const;

/** The cheapest placeable block the agent holds, or null when it holds none. */
export function cheapestHeld(held: HeldBlock[]): HeldBlock | null {
  let best: HeldBlock | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const h of held) {
    const rank = (CHEAP_FIRST as readonly string[]).indexOf(h.name);
    if (rank < 0 || h.count <= 0) continue;
    if (rank < bestRank) {
      best = h;
      bestRank = rank;
    }
  }
  return best;
}

/** Cells for a pillar under the agent: the feet rise from `at.y` to `target.y`. */
function pillarCells(input: ScaffoldInput): Cell[] {
  const { at, target } = input;
  if (target.y <= at.y) return [];
  if (at.x === target.x && at.z === target.z) return [];
  const cells: Cell[] = [];
  for (let y = at.y; y < target.y; y++) cells.push({ x: at.x, y, z: at.z });
  return cells;
}

/** Floor cells strictly between the agent and the target, on the agent's level, that are not solid. */
function bridgeCells(input: ScaffoldInput): Cell[] {
  const { at, target, solid } = input;
  const steps = Math.max(Math.abs(target.x - at.x), Math.abs(target.z - at.z));
  const cells: Cell[] = [];
  for (let i = 1; i < steps; i++) {
    const c: Cell = {
      x: at.x + Math.sign(target.x - at.x) * i,
      y: at.y - 1,
      z: at.z + Math.sign(target.z - at.z) * i,
    };
    if (!solid(c)) cells.push(c);
  }
  return cells;
}

/**
 * Decides the scaffold for a cell when there is no stand. A scaffold is only
 * placed with the agent's own block: if it holds too few, the answer is
 * `missing_materials` and nothing is placed.
 */
export function scaffoldFor(input: ScaffoldInput): ScaffoldOutcome {
  if (input.stand !== 'none') return { kind: 'not_needed' };
  const pillar = pillarCells(input);
  const method: 'pillar' | 'bridge' = pillar.length > 0 ? 'pillar' : 'bridge';
  const place = pillar.length > 0 ? pillar : bridgeCells(input);
  if (place.length === 0) return { kind: 'not_needed' };
  const block = cheapestHeld(input.held);
  if (block === null || block.count < place.length) {
    return { kind: 'missing_materials', needed: place.length };
  }
  const remove = place.filter((c) => input.onPlan(c));
  return { kind: 'scaffold', block: block.name, method, place, remove };
}
