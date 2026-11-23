import { describe, expect, it } from 'vitest';
import type { PlanCell } from './cell-do.ts';
import { arrayCellSource, type CellSource } from './cell-source.ts';
import { LayerKeys } from './layer-keys.ts';
import type { Cell } from './stand.ts';

const cellAt = (x: number, y: number, z: number): PlanCell => ({
  at: { x, y, z },
  prior: 'air',
  target: 'stone',
});

/** A plan of `n` cells on y 64 (z = index) and one cell on y 65 at x 1000. */
function flat(n: number): PlanCell[] {
  const cells = Array.from({ length: n }, (_, z) => cellAt(0, 64, z));
  cells.push(cellAt(1000, 65, 0));
  return cells;
}

const SLICE = () => 512;

describe('layer keys (scaffold removal, BLD-10)', () => {
  it('answers which of the asked cells the plan works, judged per layer', async () => {
    const layers = new LayerKeys();
    const source = (): CellSource => arrayCellSource(flat(3));
    const asked: Cell[] = [
      { x: 0, y: 64, z: 1 },
      { x: 0, y: 64, z: 9 },
      { x: 1000, y: 65, z: 0 },
    ];
    expect(await layers.onPlanOf(asked, source, SLICE, async () => {})).toEqual([
      { x: 0, y: 64, z: 1 },
      { x: 1000, y: 65, z: 0 },
    ]);
  });

  it('after a reset, a new plan with other cells on the same layer answers from its own cells (F1)', async () => {
    const layers = new LayerKeys();
    const x0: Cell = { x: 0, y: 64, z: 0 };
    const first = (): CellSource => arrayCellSource([cellAt(0, 64, 0)]);
    expect(await layers.onPlanOf([x0], first, SLICE, async () => {})).toEqual([x0]);
    layers.reset();
    const second = (): CellSource => arrayCellSource([cellAt(5, 64, 0)]);
    expect(await layers.onPlanOf([x0], second, SLICE, async () => {})).toEqual([]);
  });

  it('without a reset the cached layer answers and the plan is not read again', async () => {
    const layers = new LayerKeys();
    let reads = 0;
    const counted = (): CellSource => {
      reads++;
      return arrayCellSource(flat(2));
    };
    const x0: Cell = { x: 0, y: 64, z: 0 };
    await layers.onPlanOf([x0], counted, SLICE, async () => {});
    await layers.onPlanOf([x0], counted, SLICE, async () => {});
    expect(reads).toBe(1);
  });

  it('reads a layer in slices and yields between them (F3): 2001 cells in slices of 512 yield 4 times', async () => {
    const layers = new LayerKeys();
    let yields = 0;
    const x0: Cell = { x: 0, y: 64, z: 0 };
    const out = await layers.onPlanOf(
      [x0],
      () => arrayCellSource(flat(2000)),
      SLICE,
      async () => {
        yields++;
      },
    );
    expect(out).toEqual([x0]);
    // 2001 cells in slices of 512 is 4 slices, so 3 yields between them; the last slice ends the walk.
    expect(yields).toBe(3);
  });

  it('a failing read rejects and stores nothing, so the next ask reads again', async () => {
    const layers = new LayerKeys();
    const x0: Cell = { x: 0, y: 64, z: 0 };
    let calls = 0;
    const flaky = (): CellSource => {
      calls++;
      if (calls === 1) throw new Error('chunk not loaded');
      return arrayCellSource(flat(1));
    };
    await expect(layers.onPlanOf([x0], flaky, SLICE, async () => {})).rejects.toThrow(
      'chunk not loaded',
    );
    expect(await layers.onPlanOf([x0], flaky, SLICE, async () => {})).toEqual([x0]);
    expect(calls).toBe(2);
  });

  it('a reset during the walk is not stored: the next ask reads the plan again', async () => {
    const layers = new LayerKeys();
    const x0: Cell = { x: 0, y: 64, z: 0 };
    let calls = 0;
    // 601 cells in slices of 512: the walk yields once, and the reset lands during that yield.
    const counted = (): CellSource => {
      calls++;
      return arrayCellSource(flat(600));
    };
    await layers.onPlanOf([x0], counted, SLICE, async () => {
      layers.reset();
    });
    await layers.onPlanOf([x0], counted, SLICE, async () => {});
    expect(calls).toBe(2);
  });
});
