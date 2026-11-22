import { describe, expect, it } from 'vitest';
import { type OrderCell, orderCells, orderPlanCells } from './order.ts';

const c = (x: number, y: number, z: number) => ({ x, y, z });

describe('orderCells', () => {
  it('bottom-up puts the lowest layer first', () => {
    const cells = [c(0, 2, 0), c(0, 0, 0), c(0, 1, 0)];
    expect(orderCells(cells, 'bottom_up')).toEqual([c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]);
  });

  it('within a layer, runs outward from the anchor', () => {
    const cells = [c(5, 0, 0), c(1, 0, 0), c(0, 0, 0), c(3, 0, 0)];
    expect(orderCells(cells, 'bottom_up', c(0, 0, 0))).toEqual([
      c(0, 0, 0),
      c(1, 0, 0),
      c(3, 0, 0),
      c(5, 0, 0),
    ]);
  });

  it('without an anchor, a layer runs by x then z', () => {
    const cells = [c(1, 0, 0), c(0, 0, 1), c(0, 0, 0)];
    expect(orderCells(cells, 'bottom_up')).toEqual([c(0, 0, 0), c(0, 0, 1), c(1, 0, 0)]);
  });

  it('given keeps the cells as they came, as a new array', () => {
    const cells = [c(0, 2, 0), c(0, 0, 0)];
    const out = orderCells(cells, 'given');
    expect(out).toEqual(cells);
    expect(out).not.toBe(cells);
  });

  it('an empty list orders to an empty list', () => {
    expect(orderCells([], 'bottom_up')).toEqual([]);
  });

  it('does not mutate its input', () => {
    const cells = [c(0, 1, 0), c(0, 0, 0)];
    orderCells(cells, 'bottom_up');
    expect(cells).toEqual([c(0, 1, 0), c(0, 0, 0)]);
  });
});

describe('orderPlanCells', () => {
  const stone = (x: number, y: number, z: number): OrderCell => ({ ...c(x, y, z), pal: 's' });
  const brk = (x: number, y: number, z: number): OrderCell => ({ ...c(x, y, z), pal: null });
  const sand = (x: number, y: number, z: number): OrderCell => ({
    ...c(x, y, z),
    pal: 'sand',
    falling: true,
  });

  it('support comes before the block it supports (bottom-up)', () => {
    const out = orderPlanCells([stone(0, 2, 0), stone(0, 0, 0), stone(0, 1, 0)], 'bottom_up');
    expect(out.map((o) => o.y)).toEqual([0, 1, 2]);
  });

  it('breaks run first, top-down', () => {
    const out = orderPlanCells(
      [brk(0, 1, 0), stone(0, 0, 0), brk(0, 3, 0), brk(0, 2, 0)],
      'bottom_up',
    );
    expect(out.slice(0, 3).map((o) => o.y)).toEqual([3, 2, 1]);
    expect(out[3]).toEqual(stone(0, 0, 0));
  });

  it('falling blocks run last, bottom-up', () => {
    const out = orderPlanCells(
      [sand(0, 0, 0), stone(0, 5, 0), sand(0, 1, 0), stone(0, 0, 0)],
      'bottom_up',
    );
    expect(out.map((o) => o.pal)).toEqual(['s', 's', 'sand', 'sand']);
    expect(out.slice(2).map((o) => o.y)).toEqual([0, 1]);
  });

  it('given keeps the step order, breaks and falling blocks included', () => {
    const cells = [sand(0, 0, 0), brk(0, 3, 0), stone(0, 5, 0)];
    expect(orderPlanCells(cells, 'given')).toEqual(cells);
  });

  it('a plan of only breaks is ordered top-down', () => {
    expect(orderPlanCells([brk(0, 0, 0), brk(0, 4, 0)], 'bottom_up').map((o) => o.y)).toEqual([
      4, 0,
    ]);
  });

  it('an empty plan orders to an empty list', () => {
    expect(orderPlanCells([], 'bottom_up')).toEqual([]);
  });
});
