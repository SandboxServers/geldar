import { describe, expect, it } from 'vitest';
import { expandPlan, type PlanSpec, type PlanStep } from './expand.ts';
import { type Cell, sphereCells } from './geometry.ts';
import { lazyBottomUp } from './layers.ts';
import { orderPlanCells } from './order.ts';

const palette = {
  stone: { block: 'minecraft:stone' },
  oak: { block: 'minecraft:oak_stairs', state: { facing: 'north', half: 'bottom' } },
  glass: { block: 'minecraft:glass' },
};

/** The eager reference: every cell, then the bottom-up order (what the lane runs today). */
function eagerOrder(plan: PlanSpec, base: Cell = { x: 0, y: 0, z: 0 }) {
  const shifted = plan.steps.flatMap((step) =>
    [...expandPlan({ palette: plan.palette, steps: [step] } as PlanSpec)].map((cell) => ({
      x: cell.x + base.x,
      y: cell.y + base.y,
      z: cell.z + base.z,
      pal: cell.pal,
      replaces: step.op === 'replace',
    })),
  );
  return orderPlanCells(shifted, 'bottom_up');
}

function lazyOrder(plan: PlanSpec, base?: Cell) {
  return [...lazyBottomUp(plan, base)];
}

function planOf(steps: PlanStep[]): PlanSpec {
  return { palette, steps: steps as [PlanStep, ...PlanStep[]] };
}

describe('lazyBottomUp order', () => {
  const cases: [string, PlanSpec, Cell?][] = [
    [
      'a box',
      planOf([{ op: 'box', pal: 'stone', from: { x: 0, y: 2, z: 0 }, to: { x: 3, y: 0, z: 2 } }]),
    ],
    [
      'a hollow box',
      planOf([
        { op: 'hollow_box', pal: 'stone', from: { x: 0, y: 0, z: 0 }, to: { x: 4, y: 3, z: 4 } },
      ]),
    ],
    [
      'a wall',
      planOf([
        {
          op: 'wall',
          pal: 'glass',
          from: { x: 0, y: 1, z: 0 },
          to: { x: 5, y: 4, z: 2 },
          height: 3,
        },
      ]),
    ],
    ['a sphere', planOf([{ op: 'sphere', pal: 'stone', center: { x: 0, y: 0, z: 0 }, radius: 6 }])],
    [
      'a hollow sphere',
      planOf([
        { op: 'sphere', pal: 'stone', center: { x: 1, y: 2, z: -1 }, radius: 5, hollow: true },
      ]),
    ],
    [
      'a line and a circle',
      planOf([
        { op: 'line', pal: 'glass', from: { x: 0, y: 5, z: 0 }, to: { x: 7, y: 0, z: 3 } },
        { op: 'circle', pal: 'stone', center: { x: 0, y: 2, z: 0 }, radius: 4, axis: 'y' },
      ]),
    ],
    [
      'stairs with a palette and breaks',
      planOf([
        { op: 'box', pal: 'stone', from: { x: 0, y: 0, z: 0 }, to: { x: 3, y: 2, z: 3 } },
        { op: 'break', at: { x: 1, y: 3, z: 1 } },
        { op: 'break', at: { x: 2, y: 0, z: 2 } },
        { op: 'place', pal: 'oak', at: { x: 2, y: 1, z: 2 } },
        { op: 'replace', pal: 'glass', at: { x: 0, y: 0, z: 0 } },
      ]),
    ],
    [
      'overlapping steps, a sphere over a box, with an origin',
      planOf([
        { op: 'box', pal: 'stone', from: { x: -3, y: 0, z: -3 }, to: { x: 3, y: 4, z: 3 } },
        { op: 'sphere', pal: 'glass', center: { x: 0, y: 2, z: 0 }, radius: 3, hollow: true },
        { op: 'sphere', pal: 'oak', center: { x: 0, y: 2, z: 0 }, radius: 2 },
        {
          op: 'wall',
          pal: 'stone',
          from: { x: -2, y: 1, z: 0 },
          to: { x: 2, y: 1, z: 0 },
          height: 2,
        },
      ]),
      { x: 100, y: -4, z: 7 },
    ],
  ];

  for (const [name, plan, base] of cases) {
    it(`matches the eager order for ${name}`, () => {
      expect(lazyOrder(plan, base)).toEqual(eagerOrder(plan, base));
    });
  }
});

describe('lazyBottomUp at radius 120', () => {
  it('holds one layer at a time, reaches every cell, and stays under the wall-time bound', () => {
    const plan = planOf([
      { op: 'sphere', pal: 'stone', center: { x: 0, y: 0, z: 0 }, radius: 120 },
    ]);
    const sizes = new Map<number, number>();
    for (const cell of sphereCells({ x: 0, y: 0, z: 0 }, 120)) {
      sizes.set(cell.y, (sizes.get(cell.y) ?? 0) + 1);
    }
    const largest = Math.max(...sizes.values());
    const total = [...sizes.values()].reduce((sum, n) => sum + n, 0);

    let peak = 0;
    let layers = 0;
    let previousY = Number.NEGATIVE_INFINITY;
    let yielded = 0;
    const started = Date.now();
    const observer = {
      onLayer: (y: number, size: number) => {
        layers++;
        peak = Math.max(peak, size);
        expect(y).toBeGreaterThan(previousY);
        previousY = y;
      },
    };
    for (const _cell of lazyBottomUp(plan, { x: 0, y: 0, z: 0 }, observer)) {
      yielded++;
    }
    const elapsed = Date.now() - started;

    expect(yielded).toBe(total);
    expect(layers).toBe(241);
    expect(peak).toBe(largest);
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);
});
