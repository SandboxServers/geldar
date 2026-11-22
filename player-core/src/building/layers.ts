// The bottom-up plan order, streamed one layer at a time (BLD-b8). It yields the same cells, in the
// same order, as `expandPlan` + `orderPlanCells(cells, 'bottom_up')` with no anchor: breaks first
// (highest y first), then placements (lowest y first), each layer ordered by x, then z, then step,
// then the step's own expansion order. Memory is bounded by the number of steps, not by the plan: each
// step yields its cells of one y lazily (layer-sources.ts), and the layer is a k-way merge of those.

import type { PlanSpec, PlanStep } from './expand.ts';
import type { Cell } from './geometry.ts';
import { type Placed, type Source, sourceOf } from './layer-sources.ts';

/** A cell of a lazily ordered plan: its palette key (null for a break) and whether its step replaces. */
export interface LayeredCell extends Cell {
  pal: string | null;
  replaces: boolean;
}

/** Hooks for a caller that measures the stream: told each layer's y once its cells have been yielded. */
export interface LayerObserver {
  onLayer?: (y: number, size: number) => void;
}

/** One step as the merge sees it: its source, its palette key and its index in the plan. */
interface Entrant {
  source: Source;
  pal: string | null;
  replaces: boolean;
  step: number;
}

/** A merge head: the next cell of one entrant on the layer being streamed. */
interface Head {
  entrant: Entrant;
  it: Iterator<Placed>;
  cur: Placed;
}

/**
 * Streams a plan's cells bottom-up, one layer at a time. `base` shifts every cell (the plan origin).
 * Throws `invalid_step` before the first cell, as the eager expansion does.
 */
export function* lazyBottomUp(
  plan: PlanSpec,
  base: Cell = { x: 0, y: 0, z: 0 },
  observer: LayerObserver = {},
): Generator<LayeredCell> {
  const entrants = plan.steps.map((step, index) => entrantOf(step, index));
  const breaks = entrants.filter((entrant) => entrant.pal === null);
  const placed = entrants.filter((entrant) => entrant.pal !== null);
  yield* layers(breaks, base, -1, observer);
  yield* layers(placed, base, 1, observer);
}

function entrantOf(step: PlanStep, index: number): Entrant {
  const pal = palOf(step);
  return { source: sourceOf(step), pal, replaces: step.op === 'replace', step: index };
}

/** Each layer in turn, ordered by y (`direction` 1 ascending, -1 descending). */
function* layers(
  entrants: readonly Entrant[],
  base: Cell,
  direction: 1 | -1,
  observer: LayerObserver,
): Generator<LayeredCell> {
  let from = direction === 1 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (;;) {
    let y: number | null = null;
    for (const entrant of entrants) {
      const next = entrant.source.nextY(from, direction);
      if (next !== null && (y === null || direction * (next - y) < 0)) y = next;
    }
    if (y === null) return;
    let size = 0;
    for (const cell of mergeLayer(entrants, y, base)) {
      size++;
      yield cell;
    }
    observer.onLayer?.(y + base.y, size);
    from = y + direction;
  }
}

/** The cells of one layer, merged by x, then z, then step, then ordinal; one head per step at most. */
function* mergeLayer(entrants: readonly Entrant[], y: number, base: Cell): Generator<LayeredCell> {
  const heads: Head[] = [];
  for (const entrant of entrants) {
    const it = entrant.source.cellsAt(y);
    const first = it.next();
    if (!first.done) heads.push({ entrant, it, cur: first.value });
  }
  while (heads.length > 0) {
    let best = 0;
    for (let k = 1; k < heads.length; k++) {
      if (before(heads[k] as Head, heads[best] as Head)) best = k;
    }
    const head = heads[best] as Head;
    const { cell } = head.cur;
    yield {
      x: cell.x + base.x,
      y: cell.y + base.y,
      z: cell.z + base.z,
      pal: head.entrant.pal,
      replaces: head.entrant.replaces,
    };
    const next = head.it.next();
    if (next.done) heads.splice(best, 1);
    else head.cur = next.value;
  }
}

function before(a: Head, b: Head): boolean {
  const ca = a.cur.cell;
  const cb = b.cur.cell;
  return (
    (ca.x - cb.x ||
      ca.z - cb.z ||
      a.entrant.step - b.entrant.step ||
      a.cur.ordinal - b.cur.ordinal) < 0
  );
}

function palOf(step: PlanStep): string | null {
  if (step.op === 'break' || step.break === true) return null;
  if (step.pal === undefined) throw new Error('invalid_step');
  return step.pal;
}
