// The per-step sources of the bottom-up stream (BLD-b8). A source names the y values it places cells on
// (an interval, or the y values of a stored index) and yields one y's cells lazily, sorted by x, then z,
// then ordinal. Box, sphere, wall and line steps hold no layer: each of their cells is computed from the
// step's numbers. List and circle steps keep one sorted index of their cells (the list is stored in the
// plan already).

import type { PlanStep } from './expand.ts';
import { type Cell, circleCells, isqrt } from './geometry.ts';

/** A cell of a source with its ordinal inside the step (the tie-break for a repeated cell). */
export interface Placed {
  cell: Cell;
  ordinal: number;
}

export interface Source {
  /** The first y at or after `from` (at or before it when `dir` is -1) this source places cells on, or null. */
  nextY(from: number, dir: 1 | -1): number | null;
  /** This source's cells on one y, sorted by x, then z, then ordinal. Lazy: holds one cell at a time. */
  cellsAt(y: number): Iterator<Placed>;
}

const NONE: Source = {
  nextY: () => null,
  cellsAt: () => emptyIterator(),
};

/** The source of one step: throws `invalid_step` for an op it does not know or a missing field. */
export function sourceOf(step: PlanStep): Source {
  switch (step.op) {
    case 'place':
    case 'replace':
    case 'break':
      return single(must(step.at));
    case 'box':
    case 'hollow_box': {
      const from = must(step.from);
      const to = must(step.to);
      const [lo, hi] = minMax(from.y, to.y);
      const hollow = step.op === 'hollow_box';
      return interval(lo, hi, (y) => boxAt(from, to, hollow, y));
    }
    case 'sphere': {
      const center = must(step.center);
      const radius = must(step.radius);
      if (radius < 0) return NONE;
      const hollow = step.hollow === true;
      return interval(center.y - radius, center.y + radius, (y) =>
        sphereAt(center, radius, hollow, y),
      );
    }
    case 'wall': {
      const from = must(step.from);
      const to = must(step.to);
      const height = must(step.height);
      if (height <= 0) return NONE;
      const base = Math.min(from.y, to.y);
      return interval(base, base + Math.ceil(height) - 1, (y) => wallAt(from, to, y));
    }
    case 'line': {
      const from = must(step.from);
      const to = must(step.to);
      const [lo, hi] = minMax(from.y, to.y);
      return interval(lo, hi, (y) => lineAt(from, to, y));
    }
    case 'circle':
      return indexed(circleCells(must(step.center), must(step.radius), must(step.axis)));
    case 'list':
      return indexed(must(step.cells));
    default:
      throw new Error('invalid_step');
  }
}

function single(at: Cell): Source {
  return interval(at.y, at.y, (y) =>
    y === at.y ? one({ cell: at, ordinal: 0 }) : emptyIterator(),
  );
}

/** A source whose y values are the interval [lo, hi]; a y outside it has no cells (checked here, once). */
function interval(lo: number, hi: number, at: (y: number) => Iterator<Placed>): Source {
  return {
    nextY(from, dir) {
      if (lo > hi) return null;
      if (dir === 1) return from > hi ? null : Math.max(from, lo);
      return from < lo ? null : Math.min(from, hi);
    },
    cellsAt: (y) => (y >= lo && y <= hi ? at(y) : emptyIterator()),
  };
}

interface Indexed extends Placed {
  y: number;
}

/** A source over stored cells: the cells are sorted once by (y, x, z, ordinal) and read as slices. */
function indexed(cells: Iterable<Cell>): Source {
  const index: Indexed[] = [];
  let ordinal = 0;
  for (const cell of cells)
    index.push({ cell: { x: cell.x, y: cell.y, z: cell.z }, ordinal: ordinal++, y: cell.y });
  index.sort(byYXZ);
  return {
    nextY(from, dir) {
      if (dir === 1) {
        const i = firstAtLeast(index, from);
        return i < index.length ? (index[i] as Indexed).y : null;
      }
      const i = firstAtLeast(index, from + 1) - 1;
      return i >= 0 ? (index[i] as Indexed).y : null;
    },
    cellsAt(y) {
      const from = firstAtLeast(index, y);
      const to = firstAtLeast(index, y + 1);
      return (function* slice() {
        for (let i = from; i < to; i++) {
          const entry = index[i] as Indexed;
          yield { cell: entry.cell, ordinal: entry.ordinal };
        }
      })();
    },
  };
}

function byYXZ(a: Indexed, b: Indexed): number {
  return a.y - b.y || a.cell.x - b.cell.x || a.cell.z - b.cell.z || a.ordinal - b.ordinal;
}

/** The first index whose y is at least `y` (the length when none is). */
function firstAtLeast(index: readonly Indexed[], y: number): number {
  return lowerBound(0, index.length, (i) => (index[i] as Indexed).y >= y);
}

/** The first i in [lo, hi) where `pred` holds, for a predicate that is false then true (hi when none). */
function lowerBound(lo: number, hi: number, pred: (i: number) => boolean): number {
  let l = lo;
  let r = hi;
  while (l < r) {
    const mid = Math.floor((l + r) / 2);
    if (pred(mid)) r = mid;
    else l = mid + 1;
  }
  return l;
}

function* boxAt(from: Cell, to: Cell, hollow: boolean, y: number): Generator<Placed> {
  const [x0, x1] = minMax(from.x, to.x);
  const [y0, y1] = minMax(from.y, to.y);
  const [z0, z1] = minMax(from.z, to.z);
  if (y < y0 || y > y1) return;
  const edgeY = y === y0 || y === y1;
  for (let x = x0; x <= x1; x++) {
    const edgeX = x === x0 || x === x1;
    for (let z = z0; z <= z1; z++) {
      // The same rule as boxCells: an interior column of a hollow box keeps only its two z ends.
      if (hollow && !edgeX && !edgeY && z !== z0 && z !== z1) continue;
      yield { cell: { x, y, z }, ordinal: 0 };
    }
  }
}

function* sphereAt(center: Cell, radius: number, hollow: boolean, y: number): Generator<Placed> {
  const dy = y - center.y;
  if (Math.abs(dy) > radius) return;
  const r2 = radius * radius;
  const inside = (dx: number, ey: number, dz: number): boolean => dx * dx + ey * ey + dz * dz <= r2;
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
      yield { cell: { x: center.x + dx, y, z: center.z + dz }, ordinal: 0 };
    }
  }
}

/** The floor of a wall (the line in x and z) on one layer; the floor is walked lazily, in x, then z order. */
function* wallAt(from: Cell, to: Cell, y: number): Generator<Placed> {
  for (const placed of sortedPath(
    { x: from.x, y: 0, z: from.z },
    { x: to.x, y: 0, z: to.z },
    0,
    Number.POSITIVE_INFINITY,
  )) {
    yield { cell: { x: placed.cell.x, y, z: placed.cell.z }, ordinal: placed.ordinal };
  }
}

/** The cells of a line on one y: the line's slice at that y, sorted by x, then z. */
function* lineAt(from: Cell, to: Cell, y: number): Generator<Placed> {
  const n = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z));
  const dy = to.y - from.y;
  const sign = dy >= 0 ? 1 : -1;
  // y is monotone along the line (each step moves it by 0 or by one step of the dominant axis).
  const yOf = (i: number): number => linePoint(from, to, n, i).y;
  const a = lowerBound(0, n + 1, (i) => sign * (yOf(i) - y) >= 0);
  const b = lowerBound(0, n + 1, (i) => sign * (yOf(i) - y) > 0);
  yield* sortedPath(from, to, a, b - 1);
}

/**
 * The points of the line from `from` to `to` with indices in [a, b], sorted by x, then z. The line's x
 * and z are each monotone in its index, so a group of equal x is a run of indices: the groups come in x
 * order, and each group is walked in z order. Only the current group's ends are searched, never a copy.
 */
function* sortedPath(from: Cell, to: Cell, a: number, b: number): Generator<Placed> {
  const n = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z));
  const b2 = Math.min(b, n);
  if (a > b2) return;
  const at = (i: number): Cell => linePoint(from, to, n, i);
  const xUp = at(b2).x >= at(a).x;
  const zUp = at(b2).z >= at(a).z;
  const dir = xUp ? 1 : -1;
  let cur = xUp ? a : b2;
  while (cur >= a && cur <= b2) {
    const x = at(cur).x;
    let lo = cur;
    let hi = cur;
    if (dir === 1) {
      if (cur < b2 && at(cur + 1).x === x) hi = lastEqualX(cur, b2, x, at, 1);
    } else if (cur > a && at(cur - 1).x === x) {
      lo = lastEqualX(cur, a, x, at, -1);
    }
    yield* groupInZOrder(lo, hi, zUp, at);
    cur = dir === 1 ? hi + 1 : lo - 1;
  }
}

function lastEqualX(
  cur: number,
  end: number,
  x: number,
  at: (i: number) => Cell,
  dir: 1 | -1,
): number {
  let l = cur;
  let r = end;
  // The run of equal x grows from `cur` toward `end`; search its far edge.
  if (dir === 1) {
    while (l < r) {
      const mid = Math.ceil((l + r) / 2);
      if (at(mid).x === x) l = mid;
      else r = mid - 1;
    }
    return l;
  }
  r = cur;
  l = end;
  while (l < r) {
    const mid = Math.floor((l + r) / 2);
    if (at(mid).x === x) r = mid;
    else l = mid + 1;
  }
  return r;
}

function* groupInZOrder(
  lo: number,
  hi: number,
  zUp: boolean,
  at: (i: number) => Cell,
): Generator<Placed> {
  if (zUp) {
    for (let i = lo; i <= hi; i++) yield { cell: at(i), ordinal: i };
  } else {
    for (let i = hi; i >= lo; i--) yield { cell: at(i), ordinal: i };
  }
}

/** Point i of the line from `from` to `to` (n steps): the same rounding as `lineCells`. */
function linePoint(from: Cell, to: Cell, n: number, i: number): Cell {
  if (n === 0) return { x: from.x, y: from.y, z: from.z };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return {
    x: from.x + Math.round((dx * i) / n),
    y: from.y + Math.round((dy * i) / n),
    z: from.z + Math.round((dz * i) / n),
  };
}

function emptyIterator(): Iterator<Placed> {
  const none: Placed[] = [];
  return none[Symbol.iterator]();
}

function* one(placed: Placed): Generator<Placed> {
  yield placed;
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('invalid_step');
  return value;
}

function minMax(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}
