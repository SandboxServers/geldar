// The bottom-up plan order, streamed one layer at a time (BLD-b8). It yields the same cells, in the
// same order, as `expandPlan` + `orderPlanCells(cells, 'bottom_up')` with no anchor: breaks first
// (highest y first), then placements (lowest y first), each layer ordered by x, then z, then step,
// then the step's own expansion order. Ordering needs only one layer at a time: a box, sphere or
// wall step yields its cells of a given y directly; any other step is grouped by y once, which is
// bounded by that step's own size (a line, a circle, a list or a single cell).

import { expandPlan, type PlanSpec, type PlanStep } from './expand.ts';
import { type Cell, isqrt, lineCells } from './geometry.ts';

/** A cell of a lazily ordered plan: its palette key (null for a break) and whether its step replaces. */
export interface LayeredCell extends Cell {
  pal: string | null;
  replaces: boolean;
}

/** Hooks for a caller that measures the stream: told the layer's y and how many cells it held. */
export interface LayerObserver {
  onLayer?: (y: number, size: number) => void;
}

interface Entry {
  cell: Cell;
  pal: string | null;
  replaces: boolean;
  step: number;
  ordinal: number;
}

interface Source {
  step: PlanStep;
  index: number;
  pal: string | null;
  replaces: boolean;
  /** The steps whose cells are computed per y (box, hollow box, sphere, wall). */
  analytic: boolean;
  /** The y values this step places cells on, in any order. */
  ys: number[];
  /** For a grouped step: its cells by local y, with the step's expansion order. */
  grouped: Map<number, Entry[]> | null;
}

const ANALYTIC = new Set(['box', 'hollow_box', 'sphere', 'wall']);

/**
 * Streams a plan's cells bottom-up, one layer at a time. `base` shifts every cell (the plan origin).
 * Throws `invalid_step` before the first cell, as the eager expansion does.
 */
export function* lazyBottomUp(
  plan: PlanSpec,
  base: Cell = { x: 0, y: 0, z: 0 },
  observer: LayerObserver = {},
): Generator<LayeredCell> {
  const sources = plan.steps.map((step, index) => describe(plan, step, index));
  const breaks = sources.filter((source) => source.pal === null);
  const placed = sources.filter((source) => source.pal !== null);
  yield* layers(breaks, base, -1, observer);
  yield* layers(placed, base, 1, observer);
}

function describe(plan: PlanSpec, step: PlanStep, index: number): Source {
  const pal = palOf(step);
  const replaces = step.op === 'replace';
  if (ANALYTIC.has(step.op)) {
    return { step, index, pal, replaces, analytic: true, ys: analyticYs(step), grouped: null };
  }
  const grouped = new Map<number, Entry[]>();
  let ordinal = 0;
  for (const cell of expandPlan({ palette: plan.palette, steps: [step] } as PlanSpec)) {
    const entry: Entry = {
      cell: { x: cell.x, y: cell.y, z: cell.z },
      pal,
      replaces,
      step: index,
      ordinal: ordinal++,
    };
    const bucket = grouped.get(cell.y);
    if (bucket === undefined) grouped.set(cell.y, [entry]);
    else bucket.push(entry);
  }
  return { step, index, pal, replaces, analytic: false, ys: [...grouped.keys()], grouped };
}

/** Each layer in turn, ordered by y (`direction` 1 ascending, -1 descending); cells sorted within it. */
function* layers(
  sources: readonly Source[],
  base: Cell,
  direction: 1 | -1,
  observer: LayerObserver,
): Generator<LayeredCell> {
  const ys = new Set<number>();
  for (const source of sources) for (const y of source.ys) ys.add(y);
  const order = [...ys].sort((a, b) => direction * (a - b));
  for (const y of order) {
    const layer: Entry[] = [];
    for (const source of sources) {
      for (const entry of entriesAt(source, y)) layer.push(entry);
    }
    layer.sort(byXzStepOrdinal);
    observer.onLayer?.(y + base.y, layer.length);
    for (const entry of layer) {
      yield {
        x: entry.cell.x + base.x,
        y: entry.cell.y + base.y,
        z: entry.cell.z + base.z,
        pal: entry.pal,
        replaces: entry.replaces,
      };
    }
  }
}

function entriesAt(source: Source, y: number): Entry[] {
  if (source.grouped !== null) return source.grouped.get(y) ?? [];
  const { step, index, pal, replaces } = source;
  return analyticAt(step, y).map((cell, ordinal) => ({
    cell,
    pal,
    replaces,
    step: index,
    ordinal,
  }));
}

function byXzStepOrdinal(a: Entry, b: Entry): number {
  return a.cell.x - b.cell.x || a.cell.z - b.cell.z || a.step - b.step || a.ordinal - b.ordinal;
}

/** The cells of an analytic step on one local y. Each such step has each of its cells once. */
function analyticAt(step: PlanStep, y: number): Cell[] {
  switch (step.op) {
    case 'box':
    case 'hollow_box':
      return boxAt(must(step.from), must(step.to), step.op === 'hollow_box', y);
    case 'sphere':
      return sphereAt(must(step.center), must(step.radius), step.hollow === true, y);
    case 'wall':
      return wallAt(must(step.from), must(step.to), must(step.height), y);
    default:
      throw new Error('invalid_step');
  }
}

function analyticYs(step: PlanStep): number[] {
  const ys: number[] = [];
  const add = (lo: number, hi: number): void => {
    for (let y = lo; y <= hi; y++) ys.push(y);
  };
  switch (step.op) {
    case 'box':
    case 'hollow_box': {
      const [lo, hi] = minMax(must(step.from).y, must(step.to).y);
      add(lo, hi);
      break;
    }
    case 'sphere': {
      const center = must(step.center);
      const radius = must(step.radius);
      if (radius >= 0) add(center.y - radius, center.y + radius);
      break;
    }
    case 'wall': {
      const from = must(step.from);
      const to = must(step.to);
      const height = must(step.height);
      if (height > 0) add(Math.min(from.y, to.y), Math.min(from.y, to.y) + Math.ceil(height) - 1);
      break;
    }
    default:
      throw new Error('invalid_step');
  }
  return ys;
}

function boxAt(from: Cell, to: Cell, hollow: boolean, y: number): Cell[] {
  const [x0, x1] = minMax(from.x, to.x);
  const [y0, y1] = minMax(from.y, to.y);
  const [z0, z1] = minMax(from.z, to.z);
  if (y < y0 || y > y1) return [];
  const edgeY = y === y0 || y === y1;
  const out: Cell[] = [];
  for (let x = x0; x <= x1; x++) {
    const edgeX = x === x0 || x === x1;
    for (let z = z0; z <= z1; z++) {
      // The same rule as boxCells: an interior column of a hollow box keeps only its two z ends.
      if (hollow && !edgeX && !edgeY && z !== z0 && z !== z1) continue;
      out.push({ x, y, z });
    }
  }
  return out;
}

function sphereAt(center: Cell, radius: number, hollow: boolean, y: number): Cell[] {
  const dy = y - center.y;
  if (Math.abs(dy) > radius) return [];
  const r2 = radius * radius;
  const inside = (dx: number, ey: number, dz: number): boolean => dx * dx + ey * ey + dz * dz <= r2;
  const out: Cell[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    const rest = r2 - dx * dx - dy * dy;
    if (rest < 0) continue;
    const halfZ = isqrt(rest);
    for (let dz = -halfZ; dz <= halfZ; dz++) {
      if (
        hollow &&
        inside(dx + 1, dy, dz) &&
        inside(dx - 1, dy, dz) &&
        inside(dx, dy + 1, dz) &&
        inside(dx, dy - 1, dz) &&
        inside(dx, dy, dz + 1) &&
        inside(dx, dy, dz - 1)
      ) {
        continue;
      }
      out.push({ x: center.x + dx, y, z: center.z + dz });
    }
  }
  return out;
}

function wallAt(from: Cell, to: Cell, height: number, y: number): Cell[] {
  const h = y - Math.min(from.y, to.y);
  if (h < 0 || h >= height) return [];
  const floor = [...lineCells({ x: from.x, y: 0, z: from.z }, { x: to.x, y: 0, z: to.z })];
  return floor.map((p) => ({ x: p.x, y, z: p.z }));
}

function palOf(step: PlanStep): string | null {
  if (step.op === 'break' || step.break === true) return null;
  if (step.pal === undefined) throw new Error('invalid_step');
  return step.pal;
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('invalid_step');
  return value;
}

function minMax(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}
