import { describe, expect, it } from 'vitest';
import type { PlanCell } from './cell-do.ts';
import { arrayCellSource, lazyCellSource } from './cell-source.ts';

/** Cells of `layers` layers, `size` cells each; `onLayer` is told each layer as it is generated. */
function* layered(
  layers: number,
  size: number,
  onLayer: (y: number) => void = () => undefined,
): Generator<PlanCell> {
  for (let y = 0; y < layers; y++) {
    onLayer(y);
    for (let i = 0; i < size; i++) {
      yield { at: { x: i, y, z: 0 }, prior: 'air', target: 'stone' };
    }
  }
}

function eagerOf(layers: number, size: number): PlanCell[] {
  return [...layered(layers, size)];
}

describe('lazy cell source', () => {
  it('reads the same cells in the same order as the eager array, then undefined past the end', () => {
    const eager = eagerOf(3, 4);
    const lazy = lazyCellSource(() => layered(3, 4));
    const read = eager.map((_, i) => lazy.at(i));
    expect(read).toEqual(eager);
    expect(lazy.at(eager.length)).toBeUndefined();
    expect(lazy.at(eager.length + 9)).toBeUndefined();
  });

  it('matches the array source for every index, including reads that skip ahead', () => {
    const eager = eagerOf(4, 3);
    const array = arrayCellSource(eager);
    const lazy = lazyCellSource(() => layered(4, 3));
    for (const i of [0, 1, 5, 6, 11, 12]) {
      expect(lazy.at(i)).toEqual(array.at(i));
    }
  });

  it('generates nothing before the first read', () => {
    let made = 0;
    lazyCellSource(() => {
      made++;
      return layered(2, 2);
    });
    expect(made).toBe(0);
  });

  it('resumes from a numeric cursor by generating the cells before it, one layer at a time', () => {
    const layersMade: number[] = [];
    const lazy = lazyCellSource(() => layered(10, 5, (y) => layersMade.push(y)));
    // An old checkpoint only has a cursor: 12 is in layer 2 (cells 10..14).
    expect(lazy.at(12)).toEqual(eagerOf(10, 5)[12]);
    expect(layersMade).toEqual([0, 1, 2]);
  });

  it('walks a long plan in order with each layer generated once', () => {
    const layersMade: number[] = [];
    const lazy = lazyCellSource(() => layered(50, 40, (y) => layersMade.push(y)));
    for (let i = 0; i < 50 * 40; i += 7) lazy.at(i);
    expect(layersMade.length).toBe(50);
    // Every layer was generated once and in order: no restart and no look back.
    expect(layersMade).toEqual(Array.from({ length: 50 }, (_, y) => y));
  });

  it('refuses a read behind the cursor', () => {
    const lazy = lazyCellSource(() => layered(2, 2));
    lazy.at(3);
    expect(() => lazy.at(1)).toThrow(RangeError);
  });

  it('treats an empty generator as an empty plan', () => {
    const lazy = lazyCellSource(() => layered(0, 0));
    expect(lazy.at(0)).toBeUndefined();
  });
});
