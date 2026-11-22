import { describe, expect, it } from 'vitest';
import { expandPlan, type PlanSpec, type PlanStep } from './expand.ts';
import { type Cell, sphereCells } from './geometry.ts';
import { type LayeredCell, lazyBottomUp } from './layers.ts';
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
    [
      'lines that slope in every direction, with a repeated layer',
      planOf([
        { op: 'line', pal: 'stone', from: { x: 5, y: 0, z: -6 }, to: { x: -4, y: 3, z: 2 } },
        { op: 'line', pal: 'glass', from: { x: -3, y: 4, z: 1 }, to: { x: 6, y: -2, z: -5 } },
        { op: 'line', pal: 'oak', from: { x: 0, y: 2, z: 0 }, to: { x: 0, y: 2, z: 9 } },
        { op: 'line', pal: 'oak', from: { x: 2, y: 2, z: 5 }, to: { x: -8, y: 6, z: -1 } },
      ]),
    ],
    [
      'circles on each axis, and a radius-0 circle',
      planOf([
        { op: 'circle', pal: 'stone', center: { x: 1, y: 1, z: 1 }, radius: 5, axis: 'x' },
        { op: 'circle', pal: 'glass', center: { x: 1, y: 1, z: 1 }, radius: 4, axis: 'z' },
        { op: 'circle', pal: 'oak', center: { x: -2, y: 0, z: 3 }, radius: 0, axis: 'y' },
      ]),
    ],
    [
      'lists with a repeated cell and cells out of order',
      planOf([
        {
          op: 'list',
          pal: 'stone',
          cells: [
            { x: 2, y: 1, z: 0 },
            { x: 0, y: 3, z: 0 },
            { x: 2, y: 1, z: 0 },
            { x: -1, y: 1, z: 4 },
          ],
        },
        { op: 'break', at: { x: 0, y: 3, z: 0 } },
      ]),
    ],
    [
      'walls, including a zero and a fractional height',
      planOf([
        {
          op: 'wall',
          pal: 'stone',
          from: { x: 0, y: 0, z: 0 },
          to: { x: 4, y: 0, z: 1 },
          height: 0,
        },
        {
          op: 'wall',
          pal: 'glass',
          from: { x: 3, y: 2, z: -2 },
          to: { x: -2, y: 5, z: 2 },
          height: 2.5,
        },
      ]),
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

/** Takes the first `n` cells of a stream, then stops it (the generator is closed, never drained). */
function takeFirst(gen: Generator<LayeredCell>, n: number): LayeredCell[] {
  const taken: LayeredCell[] = [];
  for (const cell of gen) {
    taken.push(cell);
    if (taken.length === n) break;
  }
  return taken;
}

describe('lazyBottomUp with huge steps', () => {
  it('streams a wall of height 2,000,000,000 layer by layer: the first cells arrive at once', () => {
    const plan = planOf([
      {
        op: 'wall',
        pal: 'stone',
        from: { x: 0, y: 0, z: 0 },
        to: { x: 3, y: 0, z: 0 },
        height: 2_000_000_000,
      },
    ]);
    const closed: number[] = [];
    const started = Date.now();
    const first = takeFirst(lazyBottomUp(plan, undefined, { onLayer: (y) => closed.push(y) }), 10);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(first.map((cell) => cell.y)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2]);
    expect(first.map((cell) => cell.x)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
    // Only the layers that were completed are reported: the stream made no per-layer pass ahead.
    expect(closed).toEqual([0, 1]);
  });

  it('streams a break wall of that height from its top layer down', () => {
    const plan = planOf([
      {
        op: 'wall',
        break: true,
        from: { x: 0, y: 0, z: 0 },
        to: { x: 1, y: 0, z: 0 },
        height: 2_000_000_000,
      },
    ]);
    const first = takeFirst(lazyBottomUp(plan), 3);
    expect(first.map((cell) => cell.y)).toEqual([1_999_999_999, 1_999_999_999, 1_999_999_998]);
    expect(first.every((cell) => cell.pal === null)).toBe(true);
  });

  it('streams a flat line from -30,000,000 to +30,000,000 in x in slices', () => {
    const plan = planOf([
      {
        op: 'line',
        pal: 'stone',
        from: { x: -30_000_000, y: 0, z: 0 },
        to: { x: 30_000_000, y: 0, z: 0 },
      },
    ]);
    const first = takeFirst(lazyBottomUp(plan), 10);
    expect(first.map((cell) => cell.x)).toEqual([
      -30_000_000, -29_999_999, -29_999_998, -29_999_997, -29_999_996, -29_999_995, -29_999_994,
      -29_999_993, -29_999_992, -29_999_991,
    ]);
    expect(first.every((cell) => cell.y === 0 && cell.z === 0)).toBe(true);
  });

  it('streams the first layer of a long line that slopes in y, without its other layers', () => {
    const plan = planOf([
      {
        op: 'line',
        pal: 'stone',
        from: { x: -30_000_000, y: -5, z: 0 },
        to: { x: 30_000_000, y: 5, z: 0 },
      },
    ]);
    const first = takeFirst(lazyBottomUp(plan), 10);
    // y runs -5 to 5 over the line: the bottom layer is the first 3,000,000 cells, all at y -5.
    expect(first.map((cell) => cell.x)).toEqual(
      Array.from({ length: 10 }, (_, i) => -30_000_000 + i),
    );
    expect(first.every((cell) => cell.y === -5)).toBe(true);
  });
});

/** A small seeded generator (mulberry32), so every fuzz case is reproducible from its seed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPlan(next: () => number): { plan: PlanSpec; base: Cell } {
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  const cell = (): Cell => ({ x: int(-4, 4), y: int(-4, 4), z: int(-4, 4) });
  const kinds = [
    'place',
    'replace',
    'break',
    'box',
    'hollow_box',
    'sphere',
    'line',
    'circle',
    'wall',
    'list',
  ];
  const steps: PlanStep[] = [];
  const count = int(1, 4);
  for (let i = 0; i < count; i++) {
    const op = kinds[int(0, kinds.length - 1)] as string;
    if (op === 'place' || op === 'replace') steps.push({ op, pal: 'oak', at: cell() });
    else if (op === 'break') steps.push({ op, at: cell() });
    else if (op === 'box' || op === 'hollow_box' || op === 'line' || op === 'wall') {
      const from = cell();
      const to = cell();
      if (op === 'wall') steps.push({ op, pal: 'glass', from, to, height: int(0, 4) });
      else steps.push({ op, pal: 'stone', from, to });
    } else if (op === 'sphere') {
      steps.push({ op, pal: 'stone', center: cell(), radius: int(0, 4), hollow: next() < 0.5 });
    } else if (op === 'circle') {
      const axis = (['x', 'y', 'z'] as const)[int(0, 2)] as 'x' | 'y' | 'z';
      steps.push({ op, pal: 'glass', center: cell(), radius: int(0, 4), axis });
    } else {
      const cells = Array.from({ length: int(0, 5) }, () => cell());
      steps.push({ op, pal: 'stone', cells });
    }
  }
  return { plan: planOf(steps), base: next() < 0.5 ? { x: 0, y: 0, z: 0 } : cell() };
}

describe('lazyBottomUp fuzz against the eager order', () => {
  for (let seed = 1; seed <= 200; seed++) {
    it(`matches the eager order for random plans, seed ${seed}`, () => {
      const { plan, base } = randomPlan(seeded(seed));
      expect(lazyOrder(plan, base)).toEqual(eagerOrder(plan, base));
    });
  }
});
