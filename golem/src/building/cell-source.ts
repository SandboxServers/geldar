// The lazy cell source a plan lane pulls from (B8-lazy). A plan's cells come from a generator, one
// layer at a time, so the lane never holds the whole plan. The lane asks for the cell at its cursor.
// The cursor only moves forward, so the source keeps one cell of lookahead. A restart that resumes
// from a numeric cursor fast-forwards the generator by that many cells, without storing them.

import type { PlanCell } from './cell-do.ts';

/** A plan's cells read by index. Indexes must not go back; past the end `at` is undefined. */
export interface CellSource {
  at(index: number): PlanCell | undefined;
}

/**
 * A source over a generator made on first use. `make` is called once; nothing is generated before
 * the first `at`. Reading index `i` pulls the cells before it, so the generator is driven forward only.
 */
export function lazyCellSource(make: () => Iterator<PlanCell>): CellSource {
  let iter: Iterator<PlanCell> | null = null;
  let done = false;
  let started = false;
  let pos = 0;
  let current: PlanCell | undefined;

  const pull = (): PlanCell | undefined => {
    if (done) return undefined;
    iter ??= make();
    const next = iter.next();
    if (next.done === true) {
      done = true;
      return undefined;
    }
    return next.value;
  };

  return {
    at(index: number): PlanCell | undefined {
      if (index < pos) throw new RangeError(`cell ${index} is behind the source at ${pos}`);
      if (!started) {
        started = true;
        current = pull();
      }
      while (pos < index && current !== undefined) {
        current = pull();
        pos++;
      }
      return pos === index ? current : undefined;
    },
  };
}

/** The same reads over an array: the eager form the lazy source must match. */
export function arrayCellSource(cells: readonly PlanCell[]): CellSource {
  return { at: (index) => cells[index] };
}

/** Reads a source to its end into an array. Uses the source up: call it on a fresh one. */
export function cellsOf(source: CellSource): PlanCell[] {
  const out: PlanCell[] = [];
  for (let cell = source.at(0); cell !== undefined; cell = source.at(out.length)) {
    out.push(cell);
  }
  return out;
}

/**
 * The cells of `source` that `keep` allows, in order, read forward only like the source under it.
 * Each call to the result reads the underlying source once more: use a fresh source per call.
 */
export function filteredCellSource(
  source: CellSource,
  keep: (cell: PlanCell) => boolean,
): CellSource {
  let raw = 0;
  let pos = 0;
  let started = false;
  let current: PlanCell | undefined;

  const seek = (): PlanCell | undefined => {
    for (;;) {
      const cell = source.at(raw);
      if (cell === undefined) return undefined;
      raw++;
      if (keep(cell)) return cell;
    }
  };

  return {
    at(index: number): PlanCell | undefined {
      if (index < pos) throw new RangeError(`cell ${index} is behind the source at ${pos}`);
      if (!started) {
        started = true;
        current = seek();
      }
      while (pos < index && current !== undefined) {
        current = seek();
        pos++;
      }
      return pos === index ? current : undefined;
    },
  };
}
