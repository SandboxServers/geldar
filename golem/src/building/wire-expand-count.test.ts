import { lazyBottomUp } from '@geldar/player-core/src/building/layers.ts';
import { describe, expect, it, vi } from 'vitest';
import { arrayCellSource, type CellSource } from './cell-source.ts';
import { contendFor } from './contention.ts';
import { PlanLane } from './lane.ts';
import { PlanQueue, type StoredPlan } from './queue.ts';
import {
  COUNT_SLICE,
  countPlanCells,
  countSliceFor,
  createPlanSource,
  pinOrigin,
} from './wire-expand.ts';

const FEET = { x: 0, y: 64, z: 0 };
const SPHERE = {
  palette: { s: { block: 'stone' } },
  steps: [{ op: 'sphere', pal: 's', center: { x: 0, y: 64, z: 0 }, radius: 120 }],
};

/** A source of `n` cells at x = 0..n-1 (a fresh one each call; the count uses it up). */
function sourceOf(n: number): CellSource {
  return arrayCellSource(
    Array.from({ length: n }, (_, i) => ({
      at: { x: i, y: 0, z: 0 },
      pal: 's',
      replaces: false,
    })) as never,
  );
}

/** Spies on the event loop yields a count makes. */
function spyYields() {
  return vi.spyOn(globalThis, 'setImmediate');
}

describe('countSliceFor: the add-time count slice follows the lane throttle (throttle.ts)', () => {
  it('is COUNT_SLICE while TPS is unknown or at the base gap (18 TPS and up)', () => {
    expect(countSliceFor(undefined)).toBe(COUNT_SLICE);
    expect(countSliceFor(20)).toBe(COUNT_SLICE);
    expect(countSliceFor(18)).toBe(COUNT_SLICE);
  });

  it('halves from 18 down to 12 TPS (the doubled gap), and stays halved below 12 (paused)', () => {
    expect(countSliceFor(17.9)).toBe(COUNT_SLICE / 2);
    expect(countSliceFor(15)).toBe(COUNT_SLICE / 2);
    expect(countSliceFor(12)).toBe(COUNT_SLICE / 2);
    expect(countSliceFor(11)).toBe(COUNT_SLICE / 2);
    expect(countSliceFor(0)).toBe(COUNT_SLICE / 2);
  });
});

describe('countPlanCells yields to the event loop after each slice and always progresses', () => {
  it('yields once per full slice and returns the exact count', async () => {
    const yields = spyYields();
    try {
      const count = await countPlanCells(sourceOf(1300), () => COUNT_SLICE);
      expect(count).toBe(1300);
      expect(yields.mock.calls.length).toBe(2);
    } finally {
      yields.mockRestore();
    }
  });

  it('a slower TPS reading yields more often for the same cells', async () => {
    const yields = spyYields();
    try {
      await countPlanCells(sourceOf(1300), () => countSliceFor(15));
      expect(yields.mock.calls.length).toBe(5);
    } finally {
      yields.mockRestore();
    }
  });

  it('a slice below 1, or not a number, still counts every cell (one cell per slice)', async () => {
    const yields = spyYields();
    try {
      expect(await countPlanCells(sourceOf(5), () => 0)).toBe(5);
      expect(yields.mock.calls.length).toBe(5);
      expect(await countPlanCells(sourceOf(3), () => Number.NaN)).toBe(3);
    } finally {
      yields.mockRestore();
    }
  });
});

describe('a radius-120 sphere: the stream is bounded and the add yields', () => {
  it('the generator holds at most its largest layer: the layer spy bounds the peak', () => {
    const sizes: number[] = [];
    let total = 0;
    const spec = SPHERE as unknown as Parameters<typeof lazyBottomUp>[0];
    for (const _cell of lazyBottomUp(spec, FEET, { onLayer: (_y, size) => sizes.push(size) })) {
      total++;
    }
    const peak = Math.max(...sizes);
    expect(sizes.length).toBeGreaterThan(200);
    expect(sizes.reduce((sum, n) => sum + n, 0)).toBe(total);
    // A layer of a radius-120 sphere is at most a disc: about pi * 120^2 cells.
    expect(peak).toBeLessThanOrEqual(Math.ceil(Math.PI * 120 * 120) + 1);
    expect(peak * 100).toBeLessThan(total);
  }, 60_000);

  it('the add completes, yields while it counts, and stores a record under 64 KiB', async () => {
    const stored: StoredPlan[] = [];
    const store = {
      stored: async (_planId: string, plan: StoredPlan) => {
        stored.push(plan);
        return 1;
      },
      dropped: async () => {},
      progressed: () => {},
    };
    const lane = new PlanLane();
    const queue = new PlanQueue({
      lifeId: 'L',
      lane,
      contention: contendFor(lane),
      expand: createPlanSource(() => FEET),
      pin: (body) => pinOrigin(body, () => FEET),
      store,
    });
    const yields = spyYields();
    try {
      const reply = await queue.submit({ planId: 'p1', op: 'add', final: true, body: SPHERE });
      expect(reply).toMatchObject({ kind: 'queued' });
      const cells = reply.kind === 'queued' ? reply.cells : 0;
      expect(cells).toBeGreaterThan(100_000);
      expect(yields.mock.calls.length).toBeGreaterThanOrEqual(Math.floor(cells / COUNT_SLICE));
      expect(yields.mock.calls.length).toBeGreaterThan(0);
    } finally {
      yields.mockRestore();
    }
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored[0]).length).toBeLessThan(64 * 1024);
  }, 60_000);
});
